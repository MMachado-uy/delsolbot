const env = require('dotenv').config().parsed

let Logger       = require('./controllers/logger.controller');
let TwController = require('./controllers/twitter.controller');
let DbController = require('./controllers/db.controller');
let Utils        = require('./utils');

const parseString = require('xml2js').parseString
const eachOf      = require('async/eachOf')
const NodeID3     = require('node-id3')
const rimraf      = require('rimraf')
var CronJob       = require('cron').CronJob
var fs            = require('fs')
var request       = require('request')
var requestP      = require('request-promise-native')

const COVER = './assets/cover.jpg'
const DDIR  = './downloads/'
const ENV   = process.env.ENV;
const CRON  = process.env.CRON;
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
function main() {
    TwCli = new TwController(
        process.env.TWITTER_CONSUMER_KEY,
        process.env.TWITTER_CONSUMER_SECRET,
        process.env.TWITTER_ACCESS_TOKEN_KEY,
        process.env.TWITTER_ACCESS_TOKEN_SECRET
    );

    cleanDownloads()
    .then(() => {
       return DB.getRssList()
    }).then(res => {
        if (res.length) {
            return DB.getStoredPodcasts()
            .then(storedPodcasts => {

                eachOf(res, (value, key, callback) => {
                    let { url, channel } = value

                    getFeed(url)
                    .then(feed => {
                        return ignoreUploadedPodcasts(feed, storedPodcasts)
                    }).then(feed => {
                        return parseFeed(feed)
                    }).then(feed => {
                        return sendFeedToTelegram(feed, channel)
                    }).then(() => {
                        callback()
                    }).catch((error) => {
                        callback(error)
                    })

                }, err => {
                    if (err) Logger.log(false, `Some generic error situation going on here: ${err}`)
                })
            })
        } else {
            Logger.log(false, 'No sources to retrieve')
        }
    }).catch(err => {
        Logger.log(false, `Database connection error: ${err.message}`)
    })
}

/**
 * Obtener la lista de episodios del feed
 * @param {string} rssUri - The url of the RSS Feed
 * @returns {Promise}
 */
function getFeed(rssUri) {
    return new Promise((resolve, reject) => {

        requestP(rssUri)
        .then(response => {

            if (response) {
                parseString(response, (err, result) => {
                    if (err) {
                        reject(['getFeed' + rssUri, err])
                    } else {
                        resolve(result.rss.channel[0])
                    }
                })
            } else {
                reject(['getFeed', 'Unable to fetch feed'])
            }
        })
    })
}

/**
 * Filtra los episodios ya procesados en ejecuciones anteriores.
 * @param {Object} feed - El RSS feed parseado con todos los episodios
 * @param {Object} storedPodcasts - Los episodios ya procesados y guardados en la BD
 * @returns {Promise}
 */
function ignoreUploadedPodcasts(feed, storedPodcasts) {
    return new Promise((resolve, reject) => {
        for (let sp of storedPodcasts) {
            for (let i = 0; i < feed.item.length; i++) {
                let archivoFeed = feed.item[i].link[0].substring(feed.item[i].link[0].lastIndexOf("/") + 1, feed.item[i].link[0].lastIndexOf(".mp3"))

                if (sp.archivo == archivoFeed) {
                    feed.item.splice(i, 1)
                }
            }
        }

        if (feed.item.length) {
            resolve(feed)
        } else {
            resolve(feed)
        }
    })
}

/**
 * Procesa el feed filtrado y lo convierte a un formato mas conveniente
 * @param {Object} feed - El Feed sin los episodios ya procesados con anterioridad y el resto de la metadata
 * @returns {Promise}
 */
function parseFeed(feed) {
    return new Promise((resolve, reject) => {
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

        if (parsedFeed.length) {
            resolve({title,parsedFeed})
        } else {
            reject([`${title} parseFeed`, 'Nothing to upload'])
        }
    })
}

/**
 * Toma un feed de un canal especifico y lo envia a Telegram y Twitter
 * @param {Object} feed - Los episodios para el canal actual, con la metadata filtrada
 * @param {String} channel - El nombre del canal que se esta procesando
 * @returns {Promise}
 */
function sendFeedToTelegram(feed, channel) {
    return new Promise((resolve, reject) => {
        let feedTitle = feed.title
        let feedItems = feed.parsedFeed

        eachOf(feedItems, (value, key, callback) => {

            let { title, desc, url, archivo, imagen } = value;
            let content = `<b>${title}</b>\n${desc}`
            let folder = Utils.sanitizeContent(feedTitle)
            let episodePath = `${DDIR}${folder}/${Utils.sanitizeEpisode(title)}.mp3`
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
                return TwCli.tweetit(message_id, imagePath, title, channel)
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
function downloadEpisode(episodeUrl, episodePath, folder) {
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
function downloadImage(imageUrl, imagePath, folder) {
    return new Promise((resolve, reject) => {

        if (!fs.existsSync(`${DDIR}${folder}`)) {
            fs.mkdirSync(`${DDIR}${folder}`)
        }

        if (imageUrl === '') {
            resolve(COVER)
        } else {
            request.head(uri, (err, res, body) => {
                if (!err) {
                    request(uri)
                    .pipe(fs.createWriteStream(filename))
                    .on('close', resolve(imagePath));
                } else {
                    reject([`${imageUrl} downloadImage`, `Connection error: ${error}`]);
                }
            });
        }
    })
}

/**
 * Procesa la metadata idv3 de un episodio para generar datos coherentes con su contenido
 * @param {String} artist - El nombre del Programa, a popular el campo 'artista'
 * @param {String} title - El nombre del episodio, a popular el campo 'title'
 * @param {String} comment - La descripcion del episodio, a popular el campo 'comment'
 * @param {String} episodePath - La ruta completa donde esta guardado el episodio
 */
function editMetadata(artist, title, comment, episodePath) {
    return new Promise((resolve, reject) => {
        let tags = {
            artist,
            title,
            comment,
            APIC: COVER
        }

        NodeID3.write(tags, episodePath, (err, buffer) => {
            if (!err) {
                resolve(episodePath)
            } else {
                reject([`${artist} - ${title} editMetadata`, err])
            }
        })
    })
}

function sendEpisodeToChannel(episodePath, caption, chat_id, performer, title) {
    return new Promise ((resolve, reject) => {
        let payload = {
            audio: fs.createReadStream(episodePath),
            disable_notification: 'true',
            parse_mode: 'html',
            caption,
            chat_id: ENV === 'prod' ? chat_id : process.env.TEST_CHANNEL,
            performer,
            title
        }

        let connectcionUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`

        requestP.post({
            url: connectcionUrl,
            formData: payload,
            json: true
        }).then((res) => {
            fs.unlink(episodePath, err => {
                if (err) {
                    reject([`${performer} - ${title} sendEpisodeToChannel`, err])
                } else {
                    resolve({ file_id: res.result.audio.file_id, message_id: res.result.message_id })
                }
            })
        }).catch(err => {
            fs.unlinkSync(episodePath)
            reject([`${performer} - ${title} sendEpisodeToChannel`, err.message])
        })
    })
}

function cleanDownloads() {
    return new Promise((resolve, reject) => {
        rimraf(DDIR, (err) => {
            if (err) {
                reject(['cleanDownloads', err])
            } else {
                fs.mkdirSync(DDIR)
                resolve()
            }
        })
    })
}
