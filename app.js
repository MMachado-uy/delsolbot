require('dotenv').config();

const CronJob = require('cron').CronJob;
const FormData = require('form-data');
const NodeID3 = require('node-id3');
const axios = require('axios');
const fs = require('fs');

const TwController = require('./controllers/twitter.controller');
const DbController = require('./controllers/db.controller');
const DB = new DbController();
const {
  cleanDownloads,
  debug,
  log,
  logError,
  getIdFromItem,
  getMedia,
  sanitizeContent,
  sanitizeEpisode,
  getFeed
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
 * Main Application logic
 */
const main = async () => {
  try {
    const rssList = await DB.getRssList();
    debug(`Found ${rssList.length} rss sources`);

    for (const rssSource of rssList) {
      log(`Starting to process ${rssSource.channel}`);

      await processFeed(rssSource);

      log(`Finished processing ${rssSource.channel}`);
    }
  } catch (error) {
    logError(`Error in main process: ${error}`);
  } finally {
    cleanDownloads(DDIR);
  }
}

const processFeed = async rssSource => {
  const feed = await getFeed(rssSource.url);
  feed.items.map(item => {
    item.channel = rssSource.channel;

    return item;
  });

  const { title } = feed;

  feed.items.forEach(async item => {
    await processItem(item, title);
  })
}

const processItem = async (item, title) => {
  const itemId = getIdFromItem(item);
  debug(`Processing item: ${itemId}`);

  try {
    const stored = await DB.getPodcastById(itemId);

    const isForward = stored &&
                      stored.length &&
                      stored[0].pudo_subir &&
                      !stored.some(record => record.channel === item.channel);

    if (isForward) item.forwardFile = stored[0].file_id;

    if (isForward || stored.length === 0) {
      const telegramMessage = await sendToTelegram(item, title);
      const { message_id: messageId, imagePath } = telegramMessage;

      debug('Sending to Twitter...');

      try {
        if (ENV === 'prod') await sendToTwitter(messageId, imagePath, item.title, item.channel);
      } catch (error) {
        log('Elon finally did it - Unable to post to Twitter API :: ', error);
      }

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
  const { title, content, link: url, channel, itunes: { image } } = feedItem;
  const archivo = getIdFromItem(feedItem);
  const caption = `<b>${title}</b>\n${content}`;
  const folderName = sanitizeContent(channelName);
  const episodePath = `${DDIR}${folderName}/${sanitizeEpisode(title)}.mp3`;

  try {
    const forward = feedItem.forwardFile ? feedItem.forwardFile : null;
    const imagePath = await downloadImage(image, folderName);

    if (!forward) {
      await downloadEpisode(url, episodePath, folderName);
      editMetadata(channelName, title, caption, episodePath, archivo, imagePath);
    }

    const telegramResponse = await sendEpisodeToChannel(episodePath, caption, channel, channelName, title, archivo, forward);

    debug(telegramResponse);
    debug(`${archivo} Uploaded`);

    const { file_id: fileId } = telegramResponse.result.audio;
    const { message_id } = telegramResponse.result;
    await DB.registerUpload(archivo, '', true, fileId, channel, title, caption, url, message_id);

    return { ...telegramResponse.result, imagePath };
  } catch (err) {
    logError(`${archivo} Failed to upload. ${err.message ?? err}`);
    await DB.registerUpload(archivo, err.response?.body?.description ?? err.message, false, '', channel, title, caption, url);

    throw err;
  }
};

const sendToTwitter = (messageId, imagePath, title, channel) => {
  return new TwController().tweetit(messageId, imagePath, title, channel);
};

/**
 * Decarga un episodio al servidor para luego procesar su metadata
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
  const path = `${downloadFolder}/${imgName}`;

  return getMedia(imageUrl, path);
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
const editMetadata = (artist, title, comment, episodePath, track, imagePath = COVER) => {
  debug('Started Metadating');

  const coverBuffer = fs.readFileSync(imagePath);
  const episodeBuffer = fs.readFileSync(episodePath);
  const tags = {
    artist,
    title,
    comment,
    TRCK: track,
    image: {
      mime: 'image/jpeg',
      type: {
        id: 3,
        name: 'front cover'
      },
      description: 'front cover',
      imageBuffer: coverBuffer
    }
  };

  return NodeID3.write(tags, episodeBuffer);
};

/**
 * Posts the actual audio file to Telegram
 * @param {String} episodePath The path to the downloaded episode file
 * @param {String} caption The Message attached to the audio file
 * @param {String} chatId Telegram's chat id '@something'
 * @param {String} performer Name of the Channel
 * @param {String} title Title of the episode
 * @param {String} id Id of the episode
 * @param {String} fileId Previously uploaded file. If forwarded.
 * @param {String|Number} id The ID of the Episode
 */
const sendEpisodeToChannel = async (episodePath, caption, chatId, performer, title, id, fileId = null) => {
  debug(`Sending: ${id}`);

  const connectionUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`;
  const destination = ENV === 'prod' ? chatId : TEST_CHANNEL;

  const file = !fileId ? fs.createReadStream(episodePath) : fileId;

  const payload = new FormData();
  payload.append('audio', fileId === null ? file : fileId);
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
    // If file is a Read Stream, destroy it
    if (typeof file.destroy === 'function') file.destroy();
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
