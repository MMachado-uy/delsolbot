require('dotenv').config();

const httpClient = require('axios').default;
const { DateTime } = require('luxon');
const rimraf = require('rimraf');
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

const debug = msg => {
  if (DEBUG) log(msg);
};

const getIdFromItem = item => item.link.substring(item.link.lastIndexOf('/') + 1, item.link.lastIndexOf('.mp3'));

const sanitizeEpisode = episodeTitle => {
  return episodeTitle.replace(/\//gui, '-')
    .replace(/ /gui, '_')
    .trim();
};

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
  return new Promise((resolve, reject) => {
    rimraf(path, err => {
      if (err) {
        reject(err);
      } else {
        fs.mkdir(path, error => {
          if (!error) resolve();
          else {
            reject(err);
          }
        });
      }
    });
  });
};

/**
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

module.exports = {
  cleanDownloads,
  debug,
  getIdFromItem,
  getMedia,
  getTimestamp,
  log,
  logError,
  parseResponse,
  sanitizeContent,
  sanitizeEpisode
};
