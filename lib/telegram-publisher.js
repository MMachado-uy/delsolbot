const path = require('path');
const fs = require('fs');

const FormData = require('form-data');
const NodeID3 = require('node-id3').Promise;
const axios = require('axios');

const { httpsAgent: telegramAgent, TIMEOUT_MS: UPLOAD_TIMEOUT_MS } = require('./telegram-http');
const {
    buildCaption,
    debug,
    envInt,
    getIdFromItem,
    getMedia,
    log,
    logError,
    pathToTitle,
    pause,
    sanitizeEpisode,
    sanitizeFilename
} = require('./helpers');

const {
    BOT_TOKEN,
    TEST_CHANNEL,
    NODE_ENV: ENV
} = process.env;

const COVER = './assets/cover.jpg';
const DDIR = './downloads/';

// In-attempt network retries. A transient blip (timeout, reset, 429, 5xx) is
// retried here so it does NOT consume processItem's permanent per-episode retry
// budget. Only genuinely persistent failures fall through to that budget.
// (The IPv4 agent + request timeout live in ./telegram-http, shared with the
// notifier and feed/media downloads.)
const MAX_SEND_ATTEMPTS = Math.max(1, envInt('TELEGRAM_SEND_RETRIES', 3));
const RETRY_BASE_DELAY_MS = envInt('TELEGRAM_RETRY_DELAY_MS', 2000);

const TRANSIENT_CODES = new Set([
    'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENETUNREACH',
    'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK'
]);

/**
 * Classify an error as a transient network/server condition worth retrying
 * in-place (vs. a permanent failure like 400 Bad Request).
 * @param {object} error - The caught error (typically an AxiosError).
 * @returns {boolean} True when a same-attempt retry is warranted.
 */
const isTransientError = (error) => {
    const code = error?.code ?? error?.cause?.code;
    if (code && TRANSIENT_CODES.has(code)) return true;

    const status = error?.response?.status;

    return status === 429 || (status >= 500 && status <= 599);
};

/**
 * Ensures a per-channel download folder exists, then downloads the episode.
 * @param {string} episodeUrl - Source URL of the episode MP3.
 * @param {string} episodePath - Destination path on local filesystem.
 * @param {string} folder - Sanitized channel folder name.
 * @returns {Promise<string>} Path to the downloaded file.
 */
const downloadEpisode = (episodeUrl, episodePath, folder) => {
    if (!fs.existsSync(`${DDIR}${folder}`)) fs.mkdirSync(`${DDIR}${folder}`, { recursive: true });

    return getMedia(episodeUrl, episodePath);
};

/**
 * Downloads a feed-provided cover image, falling back to the static COVER when
 * the imageUrl is missing or non-string (some feeds expose `image` as an object).
 * @param {string | object | undefined} imageUrl - Feed-provided image URL.
 * @param {string} folder - Sanitized channel folder name.
 * @returns {Promise<string>} Path to the downloaded cover (or COVER fallback).
 */
const downloadImage = async (imageUrl, folder) => {
    if (typeof imageUrl !== 'string') return COVER;

    const downloadFolder = `${DDIR}${folder}`;

    if (!fs.existsSync(downloadFolder)) fs.mkdirSync(downloadFolder, { recursive: true });

    const imgName = imageUrl.split('/').pop();
    const filePath = path.join(downloadFolder, imgName);

    return getMedia(imageUrl, filePath);
};

/**
 * Writes ID3v2 tags (artist, title, comment, track, cover) to an MP3 file.
 * @param {string} artist - Show name (mapped to ID3 artist field).
 * @param {string} title - Episode title (mapped to ID3 title field).
 * @param {string} comment - Episode description (mapped to ID3 comment field).
 * @param {string} episodePath - Path to the MP3 file to tag.
 * @param {string|number} track - Track number (TRCK frame).
 * @param {string} [imagePath=COVER] - Path to cover image.
 * @returns {Promise<void>}
 */
const editMetadata = async (artist, title, comment, episodePath, track, imagePath = COVER) => {
    try {
        debug(`Started editing metadata for: ${episodePath}`);

        const coverBuffer = await fs.promises.readFile(imagePath);

        const tags = {
            artist,
            title,
            comment,
            TRCK: track,
            image: {
                mime: 'image/jpeg',
                type: { id: 3, name: 'front cover' },
                description: 'front cover',
                imageBuffer: coverBuffer
            }
        };

        await NodeID3.write(tags, episodePath);
        debug('Metadata editing completed successfully.');
    } catch (error) {
        logError(`Error editing metadata: ${error.message}`);
        logError(error);
        throw error;
    }
};

/**
 * Posts the actual audio file to Telegram via POST /bot{TOKEN}/sendAudio.
 * Uses TEST_CHANNEL override when NODE_ENV !== 'prod'. Closes the read stream
 * on axios error.
 * @param {string|null} episodePath - Path to MP3; null when using fileId.
 * @param {string} caption - Message caption (HTML).
 * @param {string} chatId - Target channel id or @handle.
 * @param {string} performer - Channel/performer name.
 * @param {string} title - Episode title.
 * @param {string|number} id - Episode id for debug logs.
 * @param {string|null} [fileId=null] - Existing Telegram file_id; null for fresh upload.
 * @returns {Promise<object>} Telegram API response body.
 */
const sendEpisodeToChannel = async (episodePath, caption, chatId, performer, title, id, fileId = null) => {
    debug(`Sending: ${id}`);
    debug({ episodePath, caption, chatId, performer, title, id, fileId });

    const connectionUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`;
    const destination = ENV === 'prod' ? chatId : TEST_CHANNEL;

    let lastError;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        // Build a fresh stream + payload every attempt: a read stream is
        // single-use and cannot be replayed after a failed/aborted upload.
        const file = fileId === null ? fs.createReadStream(episodePath) : null;

        const payload = new FormData();
        payload.append('audio', file ?? fileId);
        payload.append('disable_notification', 'true');
        payload.append('parse_mode', 'html');
        payload.append('caption', caption);
        payload.append('chat_id', destination);
        payload.append('performer', performer);
        payload.append('title', title);

        try {
            const { data } = await axios({
                method: 'post',
                url: connectionUrl,
                data: payload,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: UPLOAD_TIMEOUT_MS,
                httpsAgent: telegramAgent,
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            return data;
        } catch (error) {
            file?.destroy();
            lastError = error;

            if (attempt < MAX_SEND_ATTEMPTS && isTransientError(error)) {
                // Honor Telegram's 429 retry_after when present; otherwise back
                // off linearly so we don't hammer a struggling endpoint.
                const retryAfter = error.response?.data?.parameters?.retry_after;
                const delay = retryAfter ? retryAfter * 1000 : RETRY_BASE_DELAY_MS * attempt;

                log(
                    `Transient error sending ${id} (attempt ${attempt}/${MAX_SEND_ATTEMPTS}): `
                    + `${error.code ?? error.message}. Retrying in ${delay}ms`
                );
                await pause(delay);

                continue;
            }

            throw error;
        }
    }

    throw lastError;
};

/**
 * Factory: produces the `sendToTelegram(feedItem, channelName)` function bound
 * to the injected db controller and splitEpisode implementation. Keeps the
 * call site in processItem simple (sendToTelegram has no third-arg deps),
 * while keeping the module unit-testable.
 * @param {object} deps - Injected collaborators.
 * @param {object} deps.db - DbController instance exposing registerUpload.
 * @param {Function} deps.splitEpisode - async (filePath, outputBase) => string[].
 * @returns {Function} async (feedItem, channelName) => boolean
 */
const createSendToTelegram = ({ db, splitEpisode }) => async (feedItem, channelName) => {
    const { title, content, link: url, channel, channelId, itunes: { image } } = feedItem;
    const episodeNumber = getIdFromItem(feedItem);
    const folderName = sanitizeFilename(channelName);
    const fileName = `${sanitizeEpisode(title)}.mp3`;
    const caption = buildCaption(title, content);
    const forwardFiles = feedItem.forwardFiles ?? null;

    try {
        // Forward path: all parts already exist on Telegram; re-post via file_id
        if (forwardFiles?.length) {
            const hadMultipleParts = forwardFiles.length > 1;
            let success = true;
            for (const [i, fileId] of forwardFiles.entries()) {
                const track = hadMultipleParts ? `${episodeNumber}-${i + 1}` : episodeNumber;
                const currentCaption = hadMultipleParts ? `(Parte ${i + 1}) ${caption}` : caption;
                try {
                    debug(`Forwarding ${track} with file_id: ${fileId}`);
                    const telegramResponse = await sendEpisodeToChannel(null, currentCaption, channel, channelName, title, track, fileId);
                    const { file_id } = telegramResponse.result.audio;
                    const { message_id } = telegramResponse.result;
                    await db.registerUpload({ archivo: track, obs: '', exito: true, fileId: file_id, channelId, title, caption: currentCaption, url, message_id });
                } catch (error) {
                    logError(`Error forwarding part ${i + 1} of ${episodeNumber}:`, error);
                    success = false;
                    await db.registerUpload({ archivo: track, obs: error.response?.data?.description ?? error.message, exito: false, fileId: '', channelId, title, caption: currentCaption, url, message_id: '' });
                }
            }

            return success;
        }

        // Fresh upload path: download, split if needed, tag, upload
        const originalPath = path.join(DDIR, folderName, fileName);
        const imagePath = await downloadImage(image, folderName);

        await downloadEpisode(url, originalPath, folderName);

        const episodePaths = await splitEpisode(path.join(DDIR, folderName, fileName), pathToTitle(fileName));
        const hadToSplit = episodePaths.length > 1;

        let success = true;
        for (const [i, episodePath] of episodePaths.entries()) {
            const track = hadToSplit ? `${episodeNumber}-${i + 1}` : episodeNumber;
            const currentCaption = hadToSplit ? `(Parte ${i + 1}) ${caption}` : caption;

            try {
                await editMetadata(channelName, title, caption, episodePath, track, imagePath);

                debug({ episodePath, currentCaption, channel, channelName, title, episodeNumber });
                const telegramResponse = await sendEpisodeToChannel(episodePath, currentCaption, channel, channelName, title, track, null);

                debug(telegramResponse);
                debug(`${episodeNumber} Uploaded`);

                const { file_id } = telegramResponse.result.audio;
                const { message_id } = telegramResponse.result;

                await db.registerUpload({ archivo: track, obs: '', exito: true, fileId: file_id, channelId, title, caption, url, message_id });
            } catch (error) {
                // Defect #1 fix: always attempt a fallback failure row so processItem's
                // retry-with-budget logic can take over on the next tick. Previous code
                // had no fallback here — leaving Telegram-success + DB-fail as a silent
                // state that produced duplicates on subsequent runs.
                logError(`Error uploading part ${i + 1} of ${episodeNumber}:`, error);
                success = false;
                try {
                    await db.registerUpload({
                        archivo: track,
                        obs: error.response?.data?.description ?? error.message,
                        exito: false,
                        fileId: '',
                        channelId,
                        title,
                        caption,
                        url,
                        message_id: ''
                    });
                } catch (fallbackError) {
                    logError(
                        `Also failed to record upload failure for ${track} in DB: `
                        + `${fallbackError.message}`
                    );
                }
            }
        }

        return success;
    } catch (err) {
        logError(`${episodeNumber} Failed to upload. ${err.message ?? err}`);
        await db.registerUpload({
            archivo: episodeNumber,
            obs: err.response?.data?.description ?? err.message,
            exito: false,
            fileId: '',
            channelId,
            title: pathToTitle(fileName),
            caption,
            url,
            message_id: ''
        });

        throw err;
    }
};

module.exports = { createSendToTelegram };
