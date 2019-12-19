const env = require('dotenv').config().parsed

const { 
    log,
    sanitizeContent,
    sanitizeEpisode
}                  = require('./lib/helpers');
const TwController = require('./controllers/twitter.controller');
const DbController = require('./controllers/db.controller');

const parseString = require('xml2js').parseString;
const eachOf      = require('async/eachOf');
const NodeID3     = require('node-id3');
const rimraf      = require('rimraf');
const CronJob     = require('cron').CronJob;
const fs          = require('fs');
const request     = require('request');
const requestP    = require('request-promise-native');
const axios       = require('axios');

const COVER = './assets/cover.jpg'
const DDIR  = './downloads/'
const CRON  = process.env.CRON;
const ENV   = process.env.NODE_ENV;
const DB    = new DbController();

if (ENV === 'prod') {
    new CronJob(CRON, () => {
        main()
    }, null, true)
} else {
    main();
}

/**
 * Main Application logic
 */
async function main() {
    TwCli = new TwController(
        process.env.TWITTER_CONSUMER_KEY,
        process.env.TWITTER_CONSUMER_SECRET,
        process.env.TWITTER_ACCESS_TOKEN_KEY,
        process.env.TWITTER_ACCESS_TOKEN_SECRET
    );

    try {
        await cleanDownloads();
    } catch (error) {
        log('Error while cleaning Downloads folder.',error);
    }

    const rssList = await DB.getRssList();

    if (rssList.length) {
        const storedPodcasts = await DB.getStoredPodcasts();

        for (const rssUrl of rssList) {
            let { url, channel } = rssUrl

            try {
                let feed = await getFeed(url);
                feed = await ignoreUploadedPodcasts(feed, storedPodcasts);
    
                const parsedFeed = parseFeed(feed)
    
                if (!!parsedFeed.length) {
                    await sendFeedToTelegram(parsedFeed, channel)
                } else {
                    log(`${title} parseFeed`, 'Nothing to upload');
                }
            } catch (error) {
                log('Error getting feeds.', error);
            }
        }
    } else {
        log('No sources to retrieve.')
    }
}

/**
 * Obtener la lista de episodios del feed
 * @param {string} rssUri - The url of the RSS Feed
 * @returns {Promise}
 */
const getFeed = async rssUri => {
    return new Promise((resolve, reject) => {
        try {
            const response = await axios.get(rssUri);
    
            if (!!response) {
                parseString(response, (err, result) => {
                    if (err) reject(['getFeed' + rssUri, err]);
                    else resolve(result.rss.channel[0]);
                })
            } else {
                reject('getFeed', `Feed ${rssUri} did not return any feeds`);
            }
        } catch (error) {
            reject('getFeed', `Could not retrieve feeds from \n${rssUri}\n${error}`);
        }
    })
}

/**
 * Filtra los episodios ya procesados en ejecuciones anteriores.
 * @param {Object} feed - El RSS feed parseado con todos los episodios
 * @param {Object} storedPodcasts - Los episodios ya procesados y guardados en la BD
 * @returns {Promise}
 */
const ignoreUploadedPodcasts = async (feed, storedPodcasts) => {
    return new Promise((resolve, reject) => {
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

        if (feed.item.length) {
            resolve(feed);
        } else {
            resolve(feed);
        }
    })
}

/**
 * Procesa el feed filtrado y lo convierte a un formato mas conveniente
 * @param {Object} feed - El Feed sin los episodios ya procesados con anterioridad y el resto de la metadata
 * @returns {Promise}
 */
function parseFeed(feed) {
    let rawFeed = feed.item
    let parsedFeed = []
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

        parsedFeed.push(parsedItem)
    }

    return {title,parsedFeed}
}

/**
 * Toma un feed de un canal especifico y lo envia a Telegram y Twitter
 * @param {Object} feed - Los episodios para el canal actual, con la metadata filtrada
 * @param {String} channel - El nombre del canal que se esta procesando
 * @returns {Promise}
 */
const sendFeedToTelegram = async (feed, channel) => {
    return new Promise((resolve, reject) => {
        let { title: feedTitle, parsedFeed: feedItems } = feed;

        while (!!feedItems.length) {
            const feedItem = feedItems.pop();
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

            downloadEpisode(url, episodePath, folder)
            .then((episodePath) => {
                return editMetadata(feedTitle, title, content, episodePath)
            }).then((episodePath) => {
                return sendEpisodeToChannel(episodePath, content, channel, feedTitle, title)
            }).then((res) => {
                Logger.log(true, `${archivo} Uploaded`)

                message_id = res.message_id

                return DB.registerUpload(archivo, '', true, res.file_id)
            }).then(() => {
                return downloadImage(imagen, episodePath, folder)
            }).then((imagePath) =>{
                if (ENV === 'prod') {
                    return TwCli.tweetit(message_id, imagePath, title, channel)
                } else {
                    return new Promise(resolve => {
                        resolve();
                    });
                }
            }).then(() => {
                callback()
            }).catch((err) => {
                Logger.log(false, `${archivo} Failed to upload. ${err}`)
                DB.registerUpload(archivo, err, false, '')
                .then(err => {
                    callback(err)
                }).catch(err => {
                    callback(err)
                })
            })
        }

        eachOf(feedItems, (value, key, callback) => {

            let { title, desc, url, archivo, imagen } = value;
            let content = `<b>${title}</b>\n${desc}`
            let folder = sanitizeContent(feedTitle)
            let episodePath = `${DDIR}${folder}/${sanitizeEpisode(title)}.mp3`
            let message_id = ''
            let imagePath;

            if (content.length > 200) {
                content = content.substring(0, 197)
                content += '...'
            }

            downloadEpisode(url, episodePath, folder)
            .then((episodePath) => {
                return editMetadata(feedTitle, title, content, episodePath)
            }).then((episodePath) => {
                return sendEpisodeToChannel(episodePath, content, channel, feedTitle, title)
            }).then((res) => {
                Logger.log(true, `${archivo} Uploaded`)

                message_id = res.message_id

                return DB.registerUpload(archivo, '', true, res.file_id)
            }).then(() => {
                return downloadImage(imagen, episodePath, folder)
            }).then((imagePath) =>{
                if (ENV === 'prod') {
                    return TwCli.tweetit(message_id, imagePath, title, channel)
                } else {
                    return new Promise(resolve => {
                        resolve();
                    });
                }
            }).then(() => {
                callback()
            }).catch((err) => {
                Logger.log(false, `${archivo} Failed to upload. ${err}`)
                DB.registerUpload(archivo, err, false, '')
                .then(err => {
                    callback(err)
                }).catch(err => {
                    callback(err)
                })
            })
        }, err => {
            if (err) {
                reject([`${feedTitle} sendFeedToTelegram`, err])
            } else {
                resolve()
            }
        })
    })
}

/**
 * Decarga un episodio al servidor para luego procesar su metadata
 * @param {String} episodeUrl - La url del episodio a descargar
 * @param {String} episodePath - La ruta local donde almacenarlo
 * @param {String} folder - El nombre de la carpeta a descargar
 * @returns {Promise} La ruta local del episodio
 */
async function downloadEpisode(episodeUrl, episodePath, folder) {
    return new Promise((resolve, reject) => {

        if (!fs.existsSync(`${DDIR}${folder}`)) {
            fs.mkdirSync(`${DDIR}${folder}`)
        }

        let stream = fs.createWriteStream(episodePath)

        request.get(episodeUrl, (error, response, body) => {
            if (!error) {
                stream.close()
                resolve(episodePath)
            } else {
                reject([`${episodeUrl} downloadEpisode`, `Connection error: ${error}`])
            }
        })
        .pipe(stream)
    })
}

/**
 * Descarga la imagen asociada al episodio, a adjuntar en Twitter
 * @param {String} imageUrl - La url de la imagen a descargar
 * @param {String} imagePath - La ruta local donde almacenarla
 * @param {String} folder - El nombre de la carpeta a descargar
 * @returns {Promise} La ruta local de la imagen
 */
async function downloadImage(imageUrl, imagePath, folder) {
    return new Promise((resolve, reject) => {

        if (!fs.existsSync(`${DDIR}${folder}`)) fs.mkdirSync(`${DDIR}${folder}`);

        if (imageUrl === '') {
            resolve(COVER)
        } else {
            request.head(imageUrl, (err, res, body) => {
                if (!err) {
                    request(imageUrl)
                    .pipe(fs.createWriteStream(imagePath))
                    .on('close', () => resolve(imagePath));
                } else {
                    reject([`${imageUrl} downloadImage`, `Connection error: ${error}`]);
                }
            });
        }
    })
}

/**
 * Writes an episode's idv3 metadata to create content-coherent data
 * @param {String} artist - Show's name, mapped to the 'artist' field
 * @param {String} title - Episode's naem, mapped to the 'title' field
 * @param {String} comment - Episode's description, mapped to the 'comment' field
 * @param {String} episodePath -The episode's path
 */
async function editMetadata(artist, title, comment, episodePath) {
    return new Promise((resolve, reject) => {
        let tags = {
            artist,
            title,
            comment,
            APIC: COVER
        }

        NodeID3.write(tags, episodePath, (err, buffer) => {
            if (!err) resolve(episodePath);
            else reject([`${artist} - ${title} editMetadata`, err]);
        })
    })
}

async function sendEpisodeToChannel(episodePath, caption, chat_id, performer, title) {
    return new Promise ((resolve, reject) => {
        const payload = {
            audio: fs.createReadStream(episodePath),
            disable_notification: 'true',
            parse_mode: 'html',
            caption,
            chat_id: ENV === 'prod' ? chat_id : process.env.TEST_CHANNEL,
            performer,
            title
        }

        let connectcionUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`

        try {
            const response = await axios({
                method: 'post',
                url: connectcionUrl,
                data: payload
            })

            fs.unlink(episodePath, err => {
                if (err) log([`${performer} - ${title} sendEpisodeToChannel`, err]);
                else return { file_id: response.result.audio.file_id, message_id: response.result.message_id };
            })
        } catch(err) {
            fs.unlinkSync(episodePath);
            reject([`${performer} - ${title} sendEpisodeToChannel`, err.message]);
        }
        requestP.post({
            url: connectcionUrl,
            formData: payload,
            json: true
        }).then((res) => {
        }).catch(err => {
            fs.unlinkSync(episodePath);
            reject([`${performer} - ${title} sendEpisodeToChannel`, err.message]);
        })
    })
}

async function cleanDownloads() {
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
