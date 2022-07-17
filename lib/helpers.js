require('dotenv').config();

const httpClient = require('axios').default;
const { DateTime } = require('luxon');
const Parser = require('rss-parser');
const Path = require('path');
const fs = require('fs');

const DEBUG = !!+process.env.DEBUG;

const getTimestamp = () => {
  return DateTime.local().toFormat('yyyyMMdd-HH:mm:ssZZZZ');
};

// eslint-disable-next-line
const log = (...messages) => console.log(`[${getTimestamp()}]`, ...messages);

// eslint-disable-next-line
const logError = (...messages) => console.error(`[${getTimestamp()}]`, ...messages);

const debug = (...msg) => {
  if (DEBUG) log(...msg);
};

const getIdFromItem = item => item.link.substring(item.link.lastIndexOf('/') + 1, item.link.lastIndexOf('.mp3'));

const sanitizeEpisode = episodeTitle => {
  return episodeTitle.replace(/\//gui, '-')
    .replace(/ /gui, '_')
    .trim();
};

/**
 * Clears a string from several special characters
 * 
 * @param {string} str Input string to sanitize
 * @returns A sanitized string
 */
const sanitizeContent = str => {
  let parsed = str;

  if (typeof str !== 'string') parsed = JSON.stringify(str);

  return parsed.replace(/"/gui, '&quot;')
    .replace(/&/gui, '&amp;')
    .replace(/</gui, '&lt;')
    .replace(/>/gui, '&gt;')
    .replace(/'/gui, '')
    .replace(/ /gui, '_')
    .replace(/á/gui, 'a')
    .replace(/é/gui, 'e')
    .replace(/í/gui, 'i')
    .replace(/ó/gui, 'o')
    .replace(/ú/gui, 'u');
};

const parseResponse = response => {
  let result = '';

  if (response.indexOf('413_Request_Entity_Too_Large') > -1) {
    result = 'file_too_large';
  }

  return result;
};

/**
 * Deletes the contents of the folder specified in _path_
 * @param {String} path - The path to the folder to bea cleared
 */
const cleanDownloads = path => {
  log('Cleaning downloads');

  const files = getDirectoryContents(path);

  for (const file of files) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      logError(`Error deleting file ${file}`,  error);
    }
  }

  log('Downloads clared!');
};

/**
 * Download media asset to the specified path
 * 
 * @param {string} url The url of the requested media
 * @param {string} path The destination path of the downloaded stream
 */
const getMedia = async (url, path) => {
  const parsedPath = Path.resolve(path);
  const stream = fs.createWriteStream(parsedPath);

  const response = await httpClient(url, {
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(stream);

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(path));
    stream.on('error', err => reject(err));
  });
};

/**
 * Obtener la lista de episodios del feed
 * @param {string} rssUri - The url of the RSS Feed
 * @returns {Promise}
 */
const getFeed = rssUri => new Parser().parseURL(rssUri);

/**
 * Searches for all files within a path
 * 
 * @param {string} path The folder to inspect
 * @param {array} arrayOfFiles Accumulator for recursive call
 * @returns The paths of the files within specified path
 */
const getDirectoryContents = (path, arrayOfFiles = []) => {
  const files = fs.readdirSync(path);

  files.forEach(file => {
    if (fs.statSync(`${path}/${file}`).isDirectory()) {

      arrayOfFiles = getDirectoryContents(`${path}/${file}`, arrayOfFiles);  // eslint-disable-line
    } else {
      arrayOfFiles.push(`${path}/${file}`);
    }
  })

  return arrayOfFiles;
}

module.exports = {
  cleanDownloads,
  debug,
  getFeed,
  getIdFromItem,
  getMedia,
  getTimestamp,
  log,
  logError,
  parseResponse,
  sanitizeContent,
  sanitizeEpisode
};
