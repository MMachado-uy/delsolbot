const env = require('dotenv').config().parsed

const parseString = require('xml2js').parseString;
const requestP    = require('request-promise-native');
const CronJob     = require('cron').CronJob;
const NodeID3     = require('node-id3');
const concat      = require('concat-stream');
const rimraf      = require('rimraf');
const axios       = require('axios');
const fs          = require('fs');

const { 
    log,
    sanitizeContent,
    sanitizeEpisode
}                  = require('./lib/helpers');
const TwController = require('./controllers/twitter.controller');
const DbController = require('./controllers/db.controller');

const TEST_CHANNEL = process.env.TEST_CHANNEL;

const COVER = './assets/cover.jpg'
const DDIR  = './downloads/'
const CRON  = process.env.CRON;
const ENV   = process.env.NODE_ENV;
const DB    = new DbController();

/**
 * Main Application logic
 */
async function main() {
    try {
        await cleanDownloads();
    } catch (error) {
        log('Error while cleaning Downloads folder.', error);
    }

    try {
        const rssList = await DB.getRssList();
    
        if (rssList.length) {
            const storedPodcasts = await DB.getStoredPodcasts();
    
            while (!!rssList.length) {
                const rssUrl = rssList.pop();
                const { url, channel } = rssUrl
    
                try {
                    let feed = await getFeed(url);
                    feed = ignoreUploadedPodcasts(feed, storedPodcasts);
        
                    const parsedFeed = parseFeed(feed)
        
                    if (!!parsedFeed.episodes.length) {
                        await sendFeedToTelegram(parsedFeed, channel)
                    } else {
                        log(`${channel} parseFeed`, 'Nothing to upload');
                    }
                } catch (error) {
                    log('Error getting feeds:', error);
                }
            }
        } else {
            log('No sources to retrieve.')
        }
    } catch (error) {
        log(`Error getting RSS list from Database`)
    }
}

/**
 * Obtener la lista de episodios del feed
 * @param {string} rssUri - The url of the RSS Feed
 * @returns {Promise}
 */
const getFeed = async rssUri => {
    return new Promise(async (resolve, reject) => {
        try {
            const response = await axios.get(rssUri);
        
            if (!!response.data) {
                parseString(response.data, (err, result) => {
                    if (err) reject(`getFeed ${rssUri}:\n${err}`);
                    else resolve(result.rss.channel[0]);
                })
            } else {
                reject(`getFeed Feed ${rssUri} did not return any feeds`);
            }
        } catch (error) {
            reject(error);
        }
    })
}

/**
 * Filtra los episodios ya procesados en ejecuciones anteriores.
 * @param {Object} feed - El RSS feed parseado con todos los episodios
 * @param {Object} storedPodcasts - Los episodios ya procesados y guardados en la BD
 * @returns {Promise}
 */
const ignoreUploadedPodcasts = (feed, storedPodcasts) => {
    for (let sp of storedPodcasts) {
        for (let i = 0; i < feed.item.length; i++) {
            const archivoFeed = feed.item[i]
                                    .link[0]
                                    .substring(feed.item[i].link[0].lastIndexOf("/") + 1,
                                    feed.item[i].link[0].lastIndexOf(".mp3"));

            if (sp.archivo == archivoFeed) {
                feed.item.splice(i, 1);
            }
        }
    }

    return feed;
}

/**
 * Procesa el feed filtrado y lo convierte a un formato mas conveniente
 * @param {Object} feed - El Feed sin los episodios ya procesados con anterioridad y el resto de la metadata
 * @returns {Object} A feed item consisting in the Feed title and its episodes
 */
const parseFeed = feed => {
    const rawFeed = feed.item
    let episodes = []
    let title = feed.title[0]

    for (let item of rawFeed) {
        let imagen = item['itunes:image'][0].$.href

        let parsedItem = {
            title: item.title[0],
            desc: item.description[0],
            url: item.link[0],
            archivo: item.link[0].substring(item.link[0].lastIndexOf("/") + 1, item.link[0].lastIndexOf(".mp3")),
            imagen
        }

        episodes.push(parsedItem)
    }

    return {title,episodes}
}

/**
 * Toma un feed de un canal especifico y lo envia a Telegram y Twitter
 * @param {Object} feed - Los episodios para el canal actual, con la metadata filtrada
 * @param {String} channel - El nombre del canal que se esta procesando
 */
const sendFeedToTelegram = async (feed, channel) => {
    let { title: feedTitle, episodes } = feed;

    while (!!episodes.length) {
        const feedItem = episodes.pop();
        let { title, desc, url, archivo, imagen } = feedItem;
        let content = `<b>${title}</b>\n${desc}`
        let folder = sanitizeContent(feedTitle)
        let episodePath = `${DDIR}${folder}/${sanitizeEpisode(title)}.mp3`
        let message_id = ''
        let imagePath;
        
        if (content.length > 200) {
            content = content.substring(0, 197)
            content += '...'
        }

        try {
            episodePath = await downloadEpisode(url, episodePath, folder);
            imagePath = await downloadImage(imagen, folder);
            
            await editMetadata(feedTitle, title, content, episodePath, imagePath, archivo);
            const telegramResponse = await sendEpisodeToChannel(episodePath, content, channel, feedTitle, title);
            
            log(`${archivo} Uploaded!`);

            message_id = telegramResponse.message_id;

            await DB.registerUpload(archivo, '', true, message_id, channel);

            if (ENV === 'prod') 
                await sendToTwitter(message_id, imagePath, title, channel);
        
        } catch(err) {
            log(`${archivo} Failed to upload. ${err.message}`)
            DB.registerUpload(archivo, err.message, false, '', channel)
        }
    }
}

const sendToTwitter = async (message_id, imagePath, title, channel) => {
    TwCli = new TwController();
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
    return new Promise(async (resolve, reject) => {
        if (!fs.existsSync(`${DDIR}${folder}`)) fs.mkdirSync(`${DDIR}${folder}`);

        const stream = fs.createWriteStream(episodePath);

        const response = await axios.get(episodeUrl, {responseType: 'stream'});
        response.data.pipe(stream);

        stream.on('finish', () => resolve(episodePath));
        stream.on('error', () => reject('downloadEpisode', `Unable to download episode\nEpisode url: ${episodeUrl}`));
    })
}

/**
 * Descarga la imagen asociada al episodio, a adjuntar en Twitter
 * @param {String} imageUrl - La url de la imagen a descargar
 * @param {String} folder - El nombre de la carpeta a descargar
 * @returns {Promise} La ruta local de la imagen
 */
const downloadImage = async (imageUrl, folder) => {
    return new Promise(async (resolve, reject) => {
        const downloadFolder = `${DDIR}${folder}`;

        if (!fs.existsSync(downloadFolder)) fs.mkdirSync(downloadFolder);
        
        if (!imageUrl) {
            resolve(COVER)
        } else {
            try {
                const imgName = imageUrl.split('/').pop();
                const stream = fs.createWriteStream(`${downloadFolder}/${imgName}`);
    
                const response = await axios.get(imageUrl, {responseType: 'stream'});
                response.data.pipe(stream);
        
                stream.on('finish', () => resolve(`${downloadFolder}/${imgName}`));
                stream.on('error', () => reject('downloadImage', `Unable to download cover image. Image url: ${imageUrl}`));
            } catch (error) {
                log(`Error downloading Image: ${imageUrl}\nError: ${error}`);
            }
        }
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
const editMetadata = async (artist, title, comment, episodePath, imagePath = COVER, track) => {
    return new Promise((resolve, reject) => {
        log('Started Metadating');
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
    
        NodeID3.write(tags, episodePath, (err, buffer) => {
            log('Metadata callback')
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
 */
const sendEpisodeToChannel = (episodePath, caption, chat_id, performer, title) => {
    const connectcionUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`;
    const destination = ENV === 'test' ? TEST_CHANNEL : chat_id;

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
    
    log(`Sending: ${episodePath}`)

    return requestP.post({
        url: connectcionUrl,
        formData: payload,
        json: true
    })
}

const cleanDownloads = () => {
    return new Promise((resolve, reject) => {
        rimraf(DDIR, err => {
            if (err) reject(['cleanDownloads', err]);
            else {
                fs.mkdir(DDIR, (err) => {
                    if (!err) resolve();
                    else reject(['cleanDownloads > mkdir', err]);
                })
            }
        })
    })
}

// if (ENV === 'prod') {
    new CronJob(CRON, () => {
        main()
    }, null, true)
// } else {
//     main();
// }
