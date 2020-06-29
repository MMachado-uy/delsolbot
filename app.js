require('dotenv').config()

const requestP = require('request-promise-native');
const CronJob = require('cron').CronJob;
const concat = require('concat-stream');
const axios = require('axios').default;
const Parser = require('rss-parser');
const NodeID3 = require('node-id3');
const Path = require('path');
const fs = require('fs');

const { cleanDownloads, debug, log, logError, getIdFromItem, sanitizeContent, sanitizeEpisode } = require('./lib/helpers');
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
const TwCli = new TwController();
const parser = new Parser();

/**
 * Main Application logic
 */
async function main() {
    try {
        await cleanDownloads(DDIR);
        
        const rssList = await DB.getRssList();
        debug(`Found ${rssList.length} rss sources`);
        
        for await (const rssSource of rssList) {
            log(`Starting to process ${rssSource.channel}`);
    
            let feed = await getFeed(rssSource.url);
            feed.items.map(item => item.channel = rssSource.channel);

            await processFeed(feed);
        }
    } catch (error) {
        logError(`Error in main process: ${error}`)
    }
}

/**
 * Obtener la lista de episodios del feed
 * @param {string} rssUri - The url of the RSS Feed
 * @returns {Promise}
 */
const getFeed = async rssUri => await parser.parseURL(rssUri);

/**
 * Toma un feed de un canal especifico y lo envia a Telegram y Twitter
 * @param {Object} feed - Los episodios para el canal actual, con la metadata filtrada
 */
const processFeed = async feed => {
    const { title } = feed;

    feed.items.forEach(async item => {
        const itemId = getIdFromItem(item);

        try {
            const stored = await DB.getPodcastById(itemId);
    
            if (stored.length > 1) logError(`Review logs for id ${stored[0].archivo}: Too many entries in DB`);
            else {
                const isForward = stored.length === 1 && stored.pudo_subir && stored.channel !== item.channel;
                
                if (isForward) item.set('forwardFile', stored.file_id);
    
                if (isForward || stored.length === 0) {
                    const telegramMessage = await sendToTelegram(item, title);
                    const { message_id, imagePath } = telegramMessage;

                    if (ENV === 'prod') await sendToTwitter(message_id, imagePath, title, item.channel);
                }
            }
        } catch (error) {
            logError(`Error processing item ${itemId}:`, error);
        }
    })
}

/**
 * 
 * @param {*} feedItem 
 * @returns telegramMessage - see: https://core.telegram.org/bots/api#message
 */
const sendToTelegram = async (feedItem, channelName) => {
    const { title, desc, link: url, imagen } = feedItem;
    const archivo = getIdFromItem(feedItem);
    const content = `<b>${title}</b>\n${desc}`;
    const folderName = sanitizeContent(channelName);
    const episodePath = `${DDIR}${folderName}/${sanitizeEpisode(title)}.mp3`;
    const { channel } = feedItem;
    
    try {
        await downloadEpisode(url, episodePath, folderName);
        const imagePath = await downloadImage(imagen, folderName);
        
        await editMetadata(channelName, title, content, episodePath, imagePath, archivo);
        const telegramResponse = await sendEpisodeToChannel(episodePath, content, channel, channelName, title, archivo);
        
        debug(`${archivo} Uploaded!`);

        const { message_id } = telegramResponse;

        await DB.registerUpload(archivo, '', true, message_id, channel);

        if (ENV === 'prod') await sendToTwitter(message_id, imagePath, title, channel);

        return {...telegramResponse, imagePath};
    } catch(err) {
        logError(`${archivo} Failed to upload. ${err.message}`);
        DB.registerUpload(archivo, err.message, false, '', channel);

        return false;
    }
}

const sendToTwitter = async (message_id, imagePath, title, channel) => {
    return await TwCli.tweetit(message_id, imagePath, title, channel);
}

/**
 * Decarga un episodio al servidor para luego procesar su metadata
 * @param {String} episodeUrl - La url del episodio a descargar
 * @param {String} episodePath - La ruta local donde almacenarlo
 * @param {String} folder - El nombre de la carpeta a descargar
 * @returns {Promise} La ruta local del episodio
 */
const downloadEpisode = async (episodeUrl, episodePath, folder) => {
    if (!fs.existsSync(`${DDIR}${folder}`)) fs.mkdirSync(`${DDIR}${folder}`);
    
    const path = Path.resolve(episodePath);
    const stream = fs.createWriteStream(path);

    const response = await axios(episodeUrl, {
        method: 'GET',
        responseType: 'stream'
      })
    
      response.data.pipe(stream)
    
    return new Promise((resolve, reject) => {
        stream.on('finish', resolve)
        stream.on('error', reject)
    })
}

/**
 * Descarga la imagen asociada al episodio, a adjuntar en Twitter
 * @param {String} imageUrl - La url de la imagen a descargar
 * @param {String} folder - El nombre de la carpeta a descargar
 * @returns {Promise} La ruta local de la imagen
 */
const downloadImage = async (imageUrl, folder) => {
    if (!imageUrl) return COVER;

    const downloadFolder = `${DDIR}${folder}`;

    if (!fs.existsSync(downloadFolder)) fs.mkdirSync(downloadFolder);

    const imgName = imageUrl.split('/').pop();
    const path = Path.resolve(`${downloadFolder}/${imgName}`);
    const stream = fs.createWriteStream(path);

    const response = await axios(imageUrl, {
        method: 'GET',
        responseType: 'stream'
    })
    
    response.data.pipe(stream)
    
    return new Promise((resolve, reject) => {
        stream.on('finish', resolve)
        stream.on('error', reject)
    })

}

/**
 * Writes an episode's idv3 metadata to create content-coherent data
 * @param {String} artist - Show's name, mapped to the 'artist' field
 * @param {String} title - Episode's naem, mapped to the 'title' field
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
        const concatStream = concat(buff => coverBuffer = buff);
         
        readStream.on('error', (err) => reject(err));
        readStream.pipe(concatStream);
        
        const tags = {
            artist,
            title,
            comment,
            APIC: imagePath,
            TRCK: track,
            image: {
                mime: "png/jpeg",
                type: {
                  id: 3,
                  name: "front cover"
                },
                description: "front cover",
                imageBuffer: coverBuffer
            }
        }
    
        NodeID3.write(tags, episodePath, (err) => {
            debug('Metadata callback')
            if (err) reject(err);
            else resolve();
        });
    })
}

/**
 * Posts the actual audio file to Telegram
 * @param {String} episodePath The path to the downloaded episode file
 * @param {String} caption The Message attached to the audio file
 * @param {String} chat_id Telegram's chat id '@something'
 * @param {String} performer Name of the Channel
 * @param {String} title Title of the episode
 * @param {String|Integer} id The Id of the Episode
 */
const sendEpisodeToChannel = (episodePath, caption, chat_id, performer, title, id) => {
    debug(`Sending: ${id}`);

    const connectcionUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`;
    const destination = ENV === 'prod' ? chat_id : TEST_CHANNEL;

    const stream = fs.createReadStream(episodePath);

    const payload = {
        audio: stream,
        disable_notification: 'true',
        parse_mode: 'html',
        caption: caption,
        chat_id: destination,
        performer: performer,
        title: title
    }

    return requestP.post({
        url: connectcionUrl,
        formData: payload,
        json: true
    })
}

if (ENV === 'local') {
    main();
} else {
    new CronJob(CRON_MAIN, () => {
        main()
    }, null, true)
}
