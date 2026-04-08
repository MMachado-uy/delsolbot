require('dotenv').config();

const path = require('path');
const fs = require('fs');

const CronJob = require('cron').CronJob;
const FormData = require('form-data');
const NodeID3 = require('node-id3').Promise;
const axios = require('axios');

const DbController = require('./controllers/db.controller');
const DB = new DbController();
const { splitEpisode } = require('./lib/splitter');
const {
    cleanDownloads,
    debug,
    log,
    logError,
    getIdFromItem,
    getMedia,
    sanitizeEpisode,
    sanitizeFilename,
    getFeed,
    pathToTitle,
    pause
} = require('./lib/helpers');

const {
    BOT_TOKEN,
    TEST_CHANNEL,
    CRON_MAIN,
    NODE_ENV: ENV
} = process.env;
const COVER = './assets/cover.jpg';
const DDIR = './downloads/';

const mainCron = new CronJob(CRON_MAIN, () => {
    main().catch(e => {
        logError(e);
    });
}, null);

/**
 * Main Application logic entry point.
 * Processes all RSS sources and handles podcast uploads.
 * @returns {Promise<void>}
 */
const main = async () => {
    try {
        const rssList = await DB.getRssList();
        debug(`Found ${rssList.length} rss sources`);

        for (const rssSource of rssList) {
            log(`Starting to process ${rssSource.channel}`);

            await processFeed(rssSource);
            await pause(1000);

            log(`Finished processing ${rssSource.channel}`);
        }
    } catch (error) {
        logError(`Error in main process: ${error}`);
    } finally {
        cleanDownloads(DDIR);
    }
}

/**
 * Processes a single RSS feed source.
 * @param {Object} rssSource - RSS source object with id, url, channel, nombre.
 * @returns {Promise<void>}
 */
const processFeed = async rssSource => {
    const feed = await getFeed(rssSource.url);
    feed.items.forEach(item => {
        item.channel = rssSource.channel;
        item.channelId = rssSource.id;
    });

    const { title } = feed;

    for (const item of feed.items) {
        await processItem(item, title);
    }
}

/**
 * Processes a single RSS feed item (episode).
 * @param {Object} item - RSS feed item.
 * @param {string} title - Podcast title.
 * @returns {Promise<void>}
 */
const processItem = async (item, title) => {
    const itemId = getIdFromItem(item);
    debug(`Processing item: ${itemId}`);

    try {
        const stored = await DB.getPodcastById(itemId);
        debug({ stored });

        const alreadyUploaded = stored.some(r => r.pudo_subir && r.file_id && r.channel === item.channel);
        if (alreadyUploaded) {
            debug(`Skipping ${itemId}: already uploaded to ${item.channel}`);
            return;
        }

        const priorUploads = stored.filter(r => r.pudo_subir && r.file_id && r.channel !== item.channel);
        const isForward = priorUploads.length > 0;

        if (isForward) item.forwardFiles = priorUploads.map(r => r.file_id);

        if (isForward || stored.length === 0) {
            await sendToTelegram(item, title);
            debug('Sent!');
        }

        log(`Done processing item: ${itemId}`);
    } catch (error) {
        logError(`Error processing item ${itemId}:`, error);
    }
};

/**
 * @param {Object} feedItem
 * @param {String} channelName
 * @returns telegramMessage - see: https://core.telegram.org/bots/api#message
 */
const sendToTelegram = async (feedItem, channelName) => {
    const { title, content, link: url, channel, channelId, itunes: { image } } = feedItem;
    const episodeNumber = getIdFromItem(feedItem);
    const folderName = sanitizeFilename(channelName);
    const fileName = `${sanitizeEpisode(title)}.mp3`;
    const caption = `<b>${title}</b>\n${content}`;
    const forwardFiles = feedItem.forwardFiles ?? null;

    try {
        // Forward path: all parts already exist on Telegram, send each by file_id
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
                    await DB.registerUpload({ archivo: track, obs: '', exito: true, fileId: file_id, channelId, title, caption: currentCaption, url, message_id });
                } catch (error) {
                    logError(`Error forwarding part ${i + 1} of ${episodeNumber}:`, error);
                    success = false;
                    await DB.registerUpload({ archivo: track, obs: error.response?.body?.description ?? error.message, exito: false, fileId: '', channelId, title, caption: currentCaption, url, message_id: '' });
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
            try {
                const track = hadToSplit ? `${episodeNumber}-${i + 1}` : episodeNumber;
                const currentCaption = hadToSplit ? `(Parte ${i + 1}) ${caption}` : caption;

                await editMetadata(channelName, title, caption, episodePath, track, imagePath);

                debug({ episodePath, currentCaption, channel, channelName, title, episodeNumber });
                const telegramResponse = await sendEpisodeToChannel(episodePath, currentCaption, channel, channelName, title, track, null);

                debug(telegramResponse);
                debug(`${episodeNumber} Uploaded`);

                const { file_id } = telegramResponse.result.audio;
                const { message_id } = telegramResponse.result;

                await DB.registerUpload({ archivo: track, obs: '', exito: true, fileId: file_id, channelId, title, caption, url, message_id });
            } catch (error) {
                logError(`Error uploading part ${i + 1} of ${episodeNumber}:`, error);
                success = false;
            }
        }

        return success;
    } catch (err) {
        logError(`${episodeNumber} Failed to upload. ${err.message ?? err}`);
        await DB.registerUpload({
            archivo: episodeNumber,
            obs: err.response?.body?.description ?? err.message,
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

/**
 * Descarga un episodio al servidor para luego procesar su metadata
 * @param {String} episodeUrl - La url del episodio a descargar
 * @param {String} episodePath - La ruta local donde almacenarlo
 * @param {String} folder - El nombre de la carpeta a descargar
 * @returns {Promise} La ruta local del episodio
 */
const downloadEpisode = (episodeUrl, episodePath, folder) => {
    if (!fs.existsSync(`${DDIR}${folder}`)) fs.mkdirSync(`${DDIR}${folder}`);

    return getMedia(episodeUrl, episodePath);
};

/**
 * Descarga la imagen asociada al episodio, a adjuntar en Twitter
 * @param {String} imageUrl - La url de la imagen a descargar
 * @param {String} folder - El nombre de la carpeta a descargar
 * @returns {Promise} La ruta local de la imagen
 */
const downloadImage = async (imageUrl, folder) => {
    if (typeof imageUrl !== 'string') return COVER;

    const downloadFolder = `${DDIR}${folder}`;

    if (!fs.existsSync(downloadFolder)) fs.mkdirSync(downloadFolder);

    const imgName = imageUrl.split('/').pop();
    const filePath = path.join(downloadFolder, imgName);

    return getMedia(imageUrl, filePath);
};

/**
 * Writes an episode's idv3 metadata to create content-coherent data
 * @param {String} artist - Show's name, mapped to the 'artist' field
 * @param {String} title - Episode's name, mapped to the 'title' field
 * @param {String} comment - Episode's description, mapped to the 'comment' field
 * @param {String} episodePath -The episode's path
 * @param {String} imagePath - Cover Image for the episode
 * @param {Number} track - Track number, mapped from file number
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
 * Posts the actual audio file to Telegram
 * @param {String} episodePath The path to the downloaded episode file
 * @param {String} caption The message attached to the audio file
 * @param {String} chatId Telegram's chat id '@something'
 * @param {String} performer Name of the Channel
 * @param {String} title Title of the episode
 * @param {String|Number} id The Id of the episode
 * @param {String|null} fileId Previously uploaded file id, or null for a fresh upload
 */
const sendEpisodeToChannel = async (episodePath, caption, chatId, performer, title, id, fileId = null) => {
    debug(`Sending: ${id}`);
    debug({episodePath, caption, chatId, performer, title, id, fileId});

    const connectionUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`;
    const destination = ENV === 'prod' ? chatId : TEST_CHANNEL;

    const file = fileId == null ? fs.createReadStream(episodePath) : null;

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
            headers: { 'Content-Type': 'multipart/form-data' }
        });

        return data;
    } catch (error) {
        file?.destroy();
        throw error;
    }
};

if (ENV === 'local') {
    main().catch(e => {
        logError(e);
    });
} else {
    mainCron.start();
}
