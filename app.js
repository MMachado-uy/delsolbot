require('dotenv').config();

const requestP = require('request-promise-native');
const CronJob = require('cron').CronJob;
const concat = require('concat-stream');
const Parser = require('rss-parser');
const NodeID3 = require('node-id3');
const fs = require('fs');

const {
  cleanDownloads,
  debug,
  log,
  logError,
  getIdFromItem,
  getMedia,
  sanitizeContent,
  sanitizeEpisode
} = require('./lib/helpers');

const TwController = require('./controllers/twitter.controller');
const DbController = require('./controllers/db.controller');

const {
  BOT_TOKEN,
  TEST_CHANNEL,
  CRON_MAIN,
  NODE_ENV: ENV
} = process.env;

const COVER = './assets/cover.jpg';
const DDIR = './downloads/';

const DB = new DbController();

const mainCron = new CronJob(CRON_MAIN, () => {
  main();
}, null);

/**
 * Main Application logic
 */
async function main () {
  try {
    await cleanDownloads(DDIR);

    const rssList = await DB.getRssList();
    debug(`Found ${rssList.length} rss sources`);

    for await (const rssSource of rssList) {
      log(`Starting to process ${rssSource.channel}`);

      const feed = await getFeed(rssSource.url);
      feed.items.map(item => {
        item.channel = rssSource.channel;

        return item;
      });

      const { title } = feed;

      for await (const item of feed.items) {
        await processItem(item, title);
      }
    }
  } catch (error) {
    logError(`Error in main process: ${error}`);
  }
}

/**
 * Obtener la lista de episodios del feed
 * @param {string} rssUri - The url of the RSS Feed
 * @returns {Promise}
 */
const getFeed = async rssUri => await new Parser().parseURL(rssUri);

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
      if (ENV === 'prod') await sendToTwitter(messageId, imagePath, item.title, item.channel);
      debug('Sent!');
    }
  } catch (error) {
    logError(`Error processing item ${itemId}:`, error);
  } finally {
    log(`Done processing item: ${itemId}`);
  }
};

/**
 * @param {Object} feedItem
 * @param {String} channelName
 * @returns telegramMessage - see: https://core.telegram.org/bots/api#message
 */
const sendToTelegram = async (feedItem, channelName) => {
  const { title, content, link: url } = feedItem;
  const { image } = feedItem.itunes;
  const archivo = getIdFromItem(feedItem);
  const caption = `<b>${title}</b>\n${content}`;
  const folderName = sanitizeContent(channelName);
  const episodePath = `${DDIR}${folderName}/${sanitizeEpisode(title)}.mp3`;
  const { channel } = feedItem;

  try {
    const forward = feedItem.forwardFile ? feedItem.forwardFile : null;
    const imagePath = await downloadImage(image, folderName);

    if (!forward) {
      await downloadEpisode(url, episodePath, folderName);
      await editMetadata(channelName, title, caption, episodePath, imagePath, archivo);
    }

    const telegramResponse = await sendEpisodeToChannel(episodePath, caption, channel, channelName, title, archivo, forward);

    debug(telegramResponse);
    debug(`${archivo} Uploaded`);

    const { file_id: fileId } = telegramResponse.result.audio;
    await DB.registerUpload(archivo, '', true, fileId, channel);

    return { ...telegramResponse.result, imagePath };
  } catch (err) {
    logError(`${archivo} Failed to upload. ${err.message}`);
    DB.registerUpload(archivo, err.message, false, '', channel);

    return false;
  }
};

const sendToTwitter = async (messageId, imagePath, title, channel) => {
  return await new TwController().tweetit(messageId, imagePath, title, channel);
};

/**
 * Decarga un episodio al servidor para luego procesar su metadata
 * @param {String} episodeUrl - La url del episodio a descargar
 * @param {String} episodePath - La ruta local donde almacenarlo
 * @param {String} folder - El nombre de la carpeta a descargar
 * @returns {Promise} La ruta local del episodio
 */
const downloadEpisode = async (episodeUrl, episodePath, folder) => {
  if (!fs.existsSync(`${DDIR}${folder}`)) fs.mkdirSync(`${DDIR}${folder}`);

  return await getMedia(episodeUrl, episodePath);
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

  return await getMedia(imageUrl, path);
};

/**
 * Writes an episode's idv3 metadata to create content-coherent data
 * @param {String} artist - Show's name, mapped to the 'artist' field
 * @param {String} title - Episode's name, mapped to the 'title' field
 * @param {String} comment - Episode's description, mapped to the 'comment' field
 * @param {String} episodePath -The episode's path
 * @param {String} imagePath - Cover Image for the episode
 * @param {Integer} track - Track number, mapped from file number
 */
const editMetadata = (artist, title, comment, episodePath, imagePath = COVER, track) => {
  return new Promise((resolve, reject) => {
    debug('Started Metadating');

    let coverBuffer = null;
    const readStream = fs.createReadStream(imagePath);
    const concatStream = concat(buff => {
      coverBuffer = buff;

      return coverBuffer;
    });

    readStream.on('error', (err) => reject(err));
    readStream.pipe(concatStream);

    const tags = {
      artist,
      title,
      comment,
      APIC: imagePath,
      TRCK: track,
      image: {
        mime: 'png/jpeg',
        type: {
          id: 3,
          name: 'front cover'
        },
        description: 'front cover',
        imageBuffer: coverBuffer
      }
    };

    NodeID3.write(tags, episodePath, (err) => {
      debug('Metadata callback');
      if (err) reject(err);
      else resolve();
    });
  });
};

/**
 * Posts the actual audio file to Telegram
 * @param {String} episodePath The path to the downloaded episode file
 * @param {String} caption The Message attached to the audio file
 * @param {String} chat_id Telegram's chat id '@something'
 * @param {String} performer Name of the Channel
 * @param {String} title Title of the episode
 * @param {String} id Id of the episode
 * @param {String} file_id Previously uploaded file. If forwarded.
 * @param {String|Integer} id The Id of the Episode
 */
const sendEpisodeToChannel = async (episodePath, caption, chatId, performer, title, id, fileId = null) => {
  debug(`Sending: ${id}`);

  const connectcionUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`;
  const destination = ENV === 'prod' ? chatId : TEST_CHANNEL;

  const file = !fileId ? fs.createReadStream(episodePath) : fileId;

  const payload = {
    audio: fileId === null ? file : fileId,
    disable_notification: 'true',
    parse_mode: 'html',
    caption: caption,
    chat_id: destination,
    performer: performer,
    title: title
  };

  return await requestP.post({
    url: connectcionUrl,
    formData: payload,
    json: true
  });
};

if (ENV === 'local') {
  main();
} else {
  mainCron.start();
}
