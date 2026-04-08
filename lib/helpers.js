require('dotenv').config();

const httpClient = require('axios').default;
const { DateTime } = require('luxon');
const Parser = require('rss-parser');
const Path = require('path');
const fs = require('fs');

const DEBUG = !!+process.env.DEBUG;

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
const getIdFromItem = (item) => item.link
                                  .split('/')
                                  .pop()
                                  .replace('.mp3', '');

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
    .replace(/[^a-zA-Z0-9_\-]/gu, '');

/**
 * Pause execution for a specified amount of time.
 * @param {number} timeout - The time to pause in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the timeout.
 */
const pause = timeout => new Promise(resolve => {
  setTimeout(() => resolve(), timeout);
});

/**
 * Sanitize a string by replacing special characters and accented letters.
 * Intended for use in HTML contexts (e.g. Telegram captions).
 * @param {string} str - The input string to sanitize.
 * @returns {string} The sanitized string.
 */
const sanitizeContent = (str) => {
    // eslint-disable-next-line no-param-reassign
    if (typeof str !== 'string') str = JSON.stringify(str);

    const replacements = {
        '"': '&quot;',
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '',
        ' ': '_',
        á: 'a',
        é: 'e',
        í: 'i',
        ó: 'o',
        ú: 'u'
    };

    return Object.entries(replacements).reduce(
        (sanitized, [char, replacement]) => sanitized.replace(new RegExp(char, 'gui'), replacement),
        str
    );
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
        const response = await httpClient.get(url, { responseType: 'stream' });
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
    cleanDownloads,
    debug,
    getFeed,
    getIdFromItem,
    getMedia,
    getTimestamp,
    log,
    logError,
    sanitizeContent,
    sanitizeEpisode,
    sanitizeFilename,
    getFileSizeInMB,
    pathToTitle,
    pause
};
