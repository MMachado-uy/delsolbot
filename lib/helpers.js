require('dotenv').config();

const httpClient = require('axios').default;
const { DateTime } = require('luxon');
const Parser = require('rss-parser');
const Path = require('path');
const fs = require('fs');

const { httpsAgent, httpAgent, TIMEOUT_MS } = require('./telegram-http');

const DEBUG = !!+process.env.DEBUG;

// Telegram caption limit is 1024 chars (counted on rendered text, so the <b>
// tags don't count); leave margin for a "(Parte N) " prefix and the ellipsis.
const TELEGRAM_CAPTION_LIMIT = 1024;
const CAPTION_PREFIX_MARGIN = 32;

/**
 * Get the current timestamp in the format `yyyyMMdd-HH:mm:ssZZZZ`.
 * @returns {string} The formatted timestamp.
 */
const getTimestamp = () => DateTime.local().toFormat('yyyyMMdd-HH:mm:ssZZZZ');

/**
 * Log messages to the console with a timestamp.
 * @param {...any} messages - The messages to log.
 */
// eslint-disable-next-line no-console
const log = (...messages) => console.log(`[${getTimestamp()}]`, ...messages);

/**
 * Log error messages to the console with a timestamp.
 * @param {...any} messages - The error messages to log.
 */
// eslint-disable-next-line no-console
const logError = (...messages) => console.error(`[${getTimestamp()}]`, ...messages);

/**
 * Log debug messages to the console if debugging is enabled.
 * @param {...any} msg - The debug messages to log.
 */
const debug = (...msg) => {
    if (DEBUG) log(...msg);
};

/**
 * Extract the ID from an RSS item link.
 * @param {object} item - The RSS feed item.
 * @returns {string} The extracted ID.
 */
const getIdFromItem = (item) => {
    const link = item?.link;

    // A missing/non-string link previously threw an opaque "Cannot read
    // properties of undefined" TypeError; surface what actually went wrong.
    if (typeof link !== 'string') {
        throw new Error(`Cannot derive episode id: item.link is ${link === undefined ? 'missing' : typeof link}`);
    }

    return link
        .split('/')
        .pop()
        .replace('.mp3', '');
};

/**
 * Sanitize an episode title for safe file naming.
 * Removes accents, question marks, and other unsafe characters.
 * @param {string} episodeTitle - The episode title to sanitize.
 * @returns {string} The sanitized title.
 */
const sanitizeEpisode = (episodeTitle) => episodeTitle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[¿?]/gu, '')
    .replace(/\//gu, '-')
    .replace(/ /gu, '_')
    .replace(/:/gu, '')
    .replace(/"/gu, '')
    .replace(/"/gu, '')
    .replace(/'/gu, '')
    .replace(/'/gu, '')
    .trim();

/**
 * Sanitize a string for safe use as a filesystem path component.
 * Strips accents, replaces spaces with underscores, and removes all
 * characters that are unsafe in directory or file names.
 * @param {string} str - The input string to sanitize.
 * @returns {string} The sanitized filename-safe string.
 */
const sanitizeFilename = (str) => str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/ /gu, '_')
    .replace(/[^a-zA-Z0-9_-]/gu, '');

/**
 * Pause execution for a specified amount of time.
 * @param {number} timeout - The time to pause in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the timeout.
 */
const pause = timeout => new Promise(resolve => {
  setTimeout(() => resolve(), timeout);
});

/**
 * Escape the HTML-significant characters so arbitrary text (episode titles,
 * RSS descriptions, error messages) is safe inside Telegram's HTML parse mode.
 * `&` must be escaped first so the entities we introduce aren't re-escaped.
 * @param {*} value - Any value; coerced to string.
 * @returns {string} HTML-escaped string.
 */
const escapeHtml = (value) => String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');

/**
 * Build a Telegram caption from an episode title and description, HTML-escaping
 * both and truncating the description so the rendered caption stays within
 * Telegram's 1024-char limit (a raw, over-length, or HTML-bearing caption is
 * rejected with a non-transient HTTP 400 and the episode is abandoned).
 * @param {string} title - Episode title (rendered bold).
 * @param {string} content - Episode description.
 * @returns {string} HTML caption: `<b>title</b>\n{trimmed content}`.
 */
const buildCaption = (title, content) => {
    const safeTitle = String(title ?? '');
    const rawContent = String(content ?? '');
    const budget = Math.max(0, TELEGRAM_CAPTION_LIMIT - safeTitle.length - CAPTION_PREFIX_MARGIN);
    const trimmed = rawContent.length > budget
        ? `${rawContent.slice(0, Math.max(0, budget - 1))}…`
        : rawContent;

    return `<b>${escapeHtml(safeTitle)}</b>\n${escapeHtml(trimmed)}`;
};

/**
 * Parse an env var as a non-negative integer, falling back when unset/invalid.
 * Unlike `Number(x) || default`, a configured `0` is honored (e.g. a 0ms retry
 * delay) rather than silently replaced by the default.
 * @param {string} name - Env var name.
 * @param {number} fallback - Default when unset or not a non-negative integer.
 * @returns {number}
 */
const envInt = (name, fallback) => {
    const parsed = Number.parseInt(process.env[name], 10);

    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Delete all contents of the specified directory (files and subdirectories).
 * @param {string} dirPath - The directory path to clean.
 * @returns {Promise<void>} Resolves when the directory is cleaned.
 */
const cleanDownloads = async (dirPath) => {
    log('Cleaning downloads');

    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = Path.join(dirPath, entry.name);
            await fs.promises.rm(fullPath, { recursive: true, force: true });
        }
        log('Downloads cleared!');
    } catch (err) {
        logError(`Error during cleanup: ${err.message}`);
    }
};

/**
 * Download a media file from a URL to a specified path.
 * @param {string} url - The URL of the media to download.
 * @param {string} path - The destination path for the downloaded file.
 * @returns {Promise<string>} The path to the downloaded file.
 */
const getMedia = async (url, path) => {
    const parsedPath = Path.resolve(path);
    const stream = fs.createWriteStream(parsedPath);

    try {
        // Same IPv4 + timeout hardening as the Telegram uploads: a dead IPv6
        // route or stalled connect would otherwise hang the download forever.
        const response = await httpClient.get(url, {
            responseType: 'stream',
            timeout: TIMEOUT_MS,
            httpAgent,
            httpsAgent
        });
        response.data.pipe(stream);

        return new Promise((resolve, reject) => {
            stream.on('finish', () => resolve(parsedPath));
            stream.on('error', (err) => {
                stream.destroy();
                reject(err);
            });
        });
    } catch (err) {
        stream.destroy();
        throw err;
    }
};

/**
 * Parse an RSS feed from a URL.
 * @param {string} rssUri - The URL of the RSS feed.
 * @returns {Promise<object>} The parsed RSS feed.
 */
const getFeed = (rssUri) => new Parser().parseURL(rssUri);

/**
 * Get the size of a file in megabytes.
 * @param {string} filePath - The file path.
 * @returns {number} The size of the file in MB.
 */
const getFileSizeInMB = (filePath) => {
  try {
      const stats = fs.statSync(filePath);

      return stats.size / (1024 * 1024);
  } catch (err) {
      logError(`Error getting file size: ${filePath} - ${err.message}`);
      throw err;
  }
};

/**
 * Convert a file path to a title by removing underscores and extensions.
 * @param {string} pathLike - The file path.
 * @returns {string} The derived title.
 */
const pathToTitle = (pathLike) => pathLike
      .split('/')
      .pop()
      .replace('.mp3', '')
      .replaceAll('_', ' ');

module.exports = {
    buildCaption,
    cleanDownloads,
    debug,
    envInt,
    escapeHtml,
    getFeed,
    getIdFromItem,
    getMedia,
    getTimestamp,
    log,
    logError,
    sanitizeEpisode,
    sanitizeFilename,
    getFileSizeInMB,
    pathToTitle,
    pause
};
