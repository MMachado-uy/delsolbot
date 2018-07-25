const env           = require('dotenv').config().parsed
const parseString   = require('xml2js').parseString
const mysql         = require('mysql')
const eachOf        = require('async/eachOf')
const NodeID3       = require('node-id3')
const rimraf        = require('rimraf')
const { 
    createLogger, 
    format, 
    transports }    = require('winston')
const { 
    combine, 
    timestamp,
    printf }        = format


var CronJob         = require('cron').CronJob
var fs              = require('fs')
var request         = require('request')
var requestP        = require('request-promise-native')

const COVER = './assets/cover.jpg'
const DDIR  = './downloads/'

new CronJob('0 0 * * * *', () => {
    main()
}, null, true)

/**
 * Main Application logic
 */
function main() {
    cleanDownloads()
    .then(() => {
       return getRssList()  
    }).then(res => {
        if (res.length) {
            return getStoredPodcasts()
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
                    if (err) logger(false, `Some generic error situation going on here: ${err}`)
                })
            })
        } else {
            logger(false, 'No sources to retrieve')
        }
    }).catch(err => {
        logger(false, `Database connection error: ${err.message}`)
    })
}

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

function parseFeed(feed) {
    return new Promise((resolve, reject) => {
        let rawFeed = feed.item
        let parsedFeed = []
        let title = feed.title[0]

        for (let item of rawFeed) {
            let parsedItem = {
                title: item.title[0],
                desc: item.description[0],
                url: item.link[0],
                archivo: item.link[0].substring(item.link[0].lastIndexOf("/") + 1, item.link[0].lastIndexOf(".mp3"))
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

function sendFeedToTelegram(feed, channel) {
    return new Promise((resolve, reject) => {
        let feedTitle = feed.title
        let feedItems = feed.parsedFeed

        eachOf(feedItems, (value, key, callback) => {

            let content = `<b>${value.title}</b>\n${value.desc}`
            let folder = sanitizeContent(feedTitle)
            let episodePath = `${DDIR}${folder}/${sanitizeEpisode(value.title)}.mp3`

            if (content.length > 200) {
                content = content.substring(0, 197)
                content += '...'
            }

            downloadEpisode(value.url, episodePath, folder)
            .then((episodePath) => {
                return editMetadata(feedTitle, value.title, content, episodePath)
            }).then((episodePath) => {
                return sendEpisodeToChannel(episodePath, content, channel, feedTitle, value.title)
            }).then((file_id) => {
                logger(true, `${value.archivo} Uploaded`)
                return registerUpload(value.archivo, '', true, file_id)
            }).then(() => {
                callback()
            }).catch((err) => {

                logger(false, `${value.archivo} Failed to upload. ${err}`)
                registerUpload(value.archivo, err, false, '')
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
            chat_id,
            performer,
            title
        }
        
        let connectcionUrl   = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`

        requestP.post({
            url: connectcionUrl, 
            formData: payload,
            json: true
        }).then((res) => {
            fs.unlink(episodePath, err => {
                if (err) {
                    reject([`${performer} - ${title} sendEpisodeToChannel`, err])
                } else {
                    resolve(res.result.audio.file_id)
                }
            })
        }).catch(err => {
            fs.unlinkSync(episodePath)
            reject([`${performer} - ${title} sendEpisodeToChannel`, err.message])
        })
    })
}

function sanitizeEpisode(episodeTitle) {
    return episodeTitle.replace(new RegExp('/','g'),'-').trim()
}

function sanitizeContent(str) {
    if (typeof str !== 'string') {
        str = {
            nonstring: str
        }

        str = JSON.stringify(str)
    }
    return str
            .replace(/"/gi,'&quot;')
            .replace(/&/gi,'&amp;')
            .replace(/</gi,'&lt;')
            .replace(/>/gi,'&gt;')
            .replace(/'/gi,'')
            .replace(/ /gi,'_')
            .replace(/á/gi,'a')
            .replace(/é/gi,'e')
            .replace(/í/gi,'i')
            .replace(/ó/gi,'o')
            .replace(/ú/gi,'u')
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

/******************************************************************************/
/***********************************  LOGGER  *********************************/
/******************************************************************************/

/**
 * Logs the execution of the script
 * @param {boolean} error The execution status
 * @param {string} msg A message to output
 */
function logger(success, msg) {

    const customFormat = printf(options => {
        return `>>>>>>>>>> ${options.timestamp} - ${options.level.toUpperCase()} - ${options.message}`
    })

    let logger = createLogger({
        format: combine(
            timestamp(),
            customFormat
        ),
        transports: [
            new transports.Console(),
            new transports.File({filename: 'log.log'})
        ]
    })

    if (success || msg === 'Nothing to upload') {
        logger.log('info', msg)
    } else {
        logger.log('warn', msg)
    }
}

/******************************************************************************/
/******************************  DATABASE ACCESS  *****************************/
/******************************************************************************/

/**
 * Get a new database connection
 * @returns {Promise} A new database connection, or error message
 */
function getConnection() {
    return new Promise((resolve, reject) => {
        var con = mysql.createConnection({
            host     : env.DB_HOST,
            port     : env.DB_PORT,
            user     : env.DB_USER,
            password : env.DB_PASS,
            database : env.DB
        })

        con.connect(err => {
            if (err) {
                reject(['getConnection', err])
            } else {
                resolve(con)
            }
        })
    })
}

/**
 * Closes/destroys a database connection
 * @param {Object} con - A database connection to close/destroy
 */
function closeConnection(con) {
    con.destroy()
}

/**
 * Register in the database the upload response for each podcast
 * @param {string} archivo - Name of the file to register
 * @param {string} obs - A comment
 * @param {boolean} exito - The status of the upload
 * @param {string} fileId - The id returned by Telegram
 * @returns {Promise} The rows affected by the insert, or error message
 */
function registerUpload(archivo, obs = '', exito, fileId = '') {
    return new Promise((resolve, reject) => {
        
        exito = (exito ? 1 : 0)
        obs = sanitizeContent(obs)

        getConnection().then(con => {
            con.query({
                sql: 'INSERT INTO `podcasts` (archivo, obs, pudo_subir, file_id) VALUES (?, ?, ?, ?)',
                timeout: 40000,
                values: [archivo,  obs, exito, fileId]
            }, (err, results) => {
                closeConnection(con)
                if (err) {
                    reject([`${archivo} registerUpload`, err])
                } else {
                    resolve(results)
                }
            })
        }).catch(err => {
            reject([`${archivo} getConnection`, err])
        })
    })
}

/**
 * Get the RSS sources list
 * @returns {Promise} The list of RSS sources url's, or error message
 */
function getRssList() {
    return new Promise((resolve, reject) => {
        getConnection().then(con => {
            con.query({
                sql: 'SELECT url, channel FROM `sources`',
                timeout: 40000
            }, (err, results) => {
                closeConnection(con)

                if (err) {
                    reject(['getRssList', err])
                } else {
                    resolve(results)
                }
            })
        })
    })
}

/**
 * Get a single podcast upload status
 * @param {string} name - The filename of the podcast to search
 * @returns {Promise} The row representation of the status of the given podcast, or error message
 */
function getPodcastByName(name) {
    return new Promise((resolve, reject) => {
        getConnection().then(con => {
            con.query({
                sql: 'SELECT * FROM `podcasts` WHERE `archivo` = ?',
                timeout: 40000,
                values: [name]
            }, (err, results) => {
                closeConnection(con)

                if (err) {
                    reject(['getPodcastByName', err])
                } else {
                    resolve(results)
                }
            })
        })
    })
}

/**
 * Get the list of the failed uploads
 * @returns {Promise} The list of the uploads rejected by Telegram, or error message
 */
function getFailedPodcasts() {
    return new Promise((resolve, reject) => {
        getConnection().then(con => {
            con.query({
                sql: 'SELECT * FROM `podcasts` WHERE `pudo_subir` = 0',
                timeout: 40000
            }, (err, results) => {
                closeConnection(con)

                if (err) {
                    reject(['getFailedPodcasts', err])
                } else {
                    resulve(results)
                }
            })
        })
    })
}

/**
 * Get the identifiers for the podcasts
 * @returns {Promise} The stored podcasts, or error message
 */
function getStoredPodcasts() {
    return new Promise((resolve, reject) => {
        getConnection().then(con => {
            con.query({
                sql: 'SELECT id, archivo FROM `podcasts`',
                timeout: 40000,
            }, (err, results) => {
                closeConnection(con)

                if (err) {
                    reject(['getStoredPodcasts', err])
                } else {
                    resolve(results)
                }
            })
        })
    })
}
