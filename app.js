const env           = require('dotenv').config().parsed;
const axios         = require('axios');
const parseString   = require('xml2js').parseString;
const mysql         = require('mysql');
const eachOf        = require('async/eachOf');
const NodeID3       = require('node-id3')

var CronJob         = require('cron').CronJob;
var winston         = require('winston');
var fs              = require('fs');
var request         = require('request');
var requestP        = require('request-promise-native');
var http            = require('http');
var querystring     = require('querystring');
var FormData        = require('form-data');
var mm              = require('musicmetadata');

const COVER = './assets/cover_mundial.jpg'

/**
 * https://core.telegram.org/bots/api#sendaudio
 */

// new CronJob('0 0 * * * *', () => {
//     getFeed()
//     .then((feed) => {
//         return ignoreUploadedPodcasts(feed)
//     }).then((feed) =>{
//         return parseFeed(feed)
//     }).then((feed) => {
//         sendFeedToTelegram(feed)
//     }).catch((error) => {
//         logger(false, error)
//     })
// }, null, true)

// new CronJob('0 0 * * * *', () => {

//     main()

// }, null, true)

// request.get('http://cdn.dl.uy/solmp3/6652.mp3',(error, response, body) => {
//     if (!error) {

//         let tags = {
//             artist: 'Del Sol Test',
//             title: 'Track de prueba',
//             comment: 'blabla',
//             APIC: './assets/cover_mundial.jpg'
//         }

//         NodeID3.write(tags, 'downloads/coso.mp3', (err, buffer) => {
//             let meta = NodeID3.read('downloads/coso.mp3')
//             console.log(meta)

//             let payload = {
//                 audio: fs.createReadStream('downloads/coso.mp3'),
//                 caption: `Finished`,
//                 chat_id: `@delsoltest`
//             }
    
//             let connectcionUrl   = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`;
    
//             requestP.post({
//                 url:connectcionUrl, 
//                 formData: payload
//             })
//             .then(() => {
    
//                 fs.unlinkSync('downloads/coso.mp3');
//             })
//             .catch(err => {
//                 logger(false, `Failed to upload. Response: ${body}`)
//             })
//         })

//     } else {
//         logger(false, `Failed to upload. Response: ${body}`)
//     }
// })
// .pipe(fs.createWriteStream('downloads/coso.mp3'))

main()

/**
 * Main Application logic
 */
function main() {
    getRssList()
    .then(res => {
        if (res.length) {
            return getStoredPodcasts()
            .then(storedPodcasts => {

                eachOf(res, (value, key, callback) => {
                    let { url, channel } = value;

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
    })
    .catch(err => {
        logger(false, `Database connection error: ${err.message}`)
    })
}

function getFeed(rssUri) {
    return new Promise(function (resolve, reject) {
        axios.get(rssUri)
        .then(response => {
            if (response) {
                parseString(response.data, (err, result) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve(result.rss.channel[0])
                    }
                })
            } else {
                reject('Unable to fetch feed')
            }
        })
    })
}

function ignoreUploadedPodcasts(feed, storedPodcasts) {
    return new Promise((resolve, reject) => {
        for (let sp of storedPodcasts) {
            for (let i = 0; i < feed.item.length; i++) {
                let archivoFeed = feed.item[i].link[0].substring(feed.item[i].link[0].lastIndexOf("/") + 1, feed.item[i].link[0].lastIndexOf(".mp3"));
                if (sp.archivo == archivoFeed) {
                    feed.item.splice(i, 1);
                }
            }
        }

        if (feed.item.length) {
            resolve(feed);
        } else {
            reject('Nothing to upload')
        }
    })
}

function parseFeed(feed) {
    return new Promise((resolve, reject) => {
        let rawFeed = feed.item;
        let parsedFeed = [];
        let title = feed.title[0];

        for (let item of rawFeed) {
            let parsedItem = {
                title: item.title[0],
                desc: item.description[0],
                url: item.link[0],
                archivo: item.link[0].substring(item.link[0].lastIndexOf("/") + 1, item.link[0].lastIndexOf(".mp3"))
            }

            parsedFeed.push(parsedItem);
        }

        if (parsedFeed.length) {
            resolve({title,parsedFeed});
        } else {
            reject('Nothing to upload')
        }
    })
}

function sendFeedToTelegram(feed, channel) {
    return new Promise((resolve, reject) => {
        let feedTitle = feed.title;
        let feedItems = feed.parsedFeed;

        eachOf(feedItems, (value, key, callback) => {

            let content = `<b>${sanitizeContent(value.title)}</b>\n${sanitizeContent(value.desc)}`
            let episodePath = `downloads/${sanitizeEpisode(value.title)}.mp3`

            if (content.length > 200) {
                content = content.substring(0, 197)
                content += '...'
            }

            downloadEpisode(value.url, episodePath)
            .then((episodePath) => {
                return editMetadata(feedTitle, value.title, content, episodePath)
            }).then((episodePath) => {
                return sendEpisodeToChannel(episodePath, content, channel, feedTitle, value.title)
            }).then(() => {
                logger(true, `${value.archivo} Uploaded`)
                return registerUpload(value.archivo, '', true)
            }).then(() => {
                callback()
            }).catch((err) => {
                logger(false, `${value.archivo} Failed to upload. ${err}`)
                registerUpload(value.archivo, '', false)
                .then(err => {
                    callback(err)
                })
                .catch(err => {
                    callback(err)
                })
            })

        }, err => {
            if (err) reject(err)
            resolve()
        })
    })
}

function downloadEpisode(episodeUrl, episodePath) {
    return new Promise((resolve, reject) => {
        let stream = fs.createWriteStream(episodePath)

        console.log("episodePath downloadEpisode ", episodePath)
        request.get(episodeUrl, (error, response, body) => {
            if (!error) {
                stream.close();
                resolve(episodePath)
            } else {
                reject('Connection error')
            }
        })
        .pipe(stream)
    })
}

function editMetadata(artist, title, comment, episodePath) {
    return new Promise((resolve, reject) => {
        console.log("episodePath editMetadata ", episodePath);
        let tags = {
            artist,
            title,
            comment,
            APIC: COVER
        }

        console.log("tags ", tags);
        console.log("episodePath ", episodePath);
        NodeID3.write(tags, episodePath, (err, buffer) => {
            if (!err) {
                resolve(episodePath)
            } else {
                reject()
            }
        })
    })
}

function sendEpisodeToChannel(episodePath, caption, chat_id, performer, title) {
    return new Promise ((resolve, reject) => {
        console.log("episodePath sendEpisodeToChannel ", episodePath);
        
        console.log("fs.createReadStream(episodePath) ", typeof fs.createReadStream(episodePath));
        let payload = {
            audio: fs.createReadStream(episodePath),
            disable_notification: 'true',
            parse_mode: 'html',
            caption,
            chat_id: '@delsoltest',
            performer,
            title
        }
        
        let connectcionUrl   = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`;
        console.log("episodePath ", typeof episodePath);
        console.log("payload ", typeof payload);
        console.log("connectcionUrl ", typeof connectcionUrl);

        requestP.post({
            url: connectcionUrl, 
            formData: payload,
            json: true
        }).then(() => {
            fs.unlink(episodePath, err => {
                if (err) {
                    reject(err)
                } else {
                    resolve()
                }
            })
        }).catch(err => {
            reject(err)
        })
    })
}

function sanitizeEpisode(episodeTitle) {
    return episodeTitle.replace(new RegExp('/','g'),'-').trim()
}

function sanitizeContent(episodeContent) {
    return episodeContent
            .replace(new RegExp('"','g'),'&quot;')
            .replace(new RegExp('&','g'),'&amp;')
            .replace(new RegExp('<','g'),'&lt;')
            .replace(new RegExp('>','g'),'&gt;')
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
    let timestamp = new Date().toUTCString()

    let logger = new (winston.Logger)({
        transports: [
            new winston.transports.Console({
                timestamp: function() {
                    return timestamp;
                },
                formatter: function(options) {
                    return `>>>>>>>>>> ${options.timestamp()} - ${options.level.toUpperCase()} - ${options.message}`;
                }
            }),
            new winston.transports.File({
                filename: 'log.log',
                timestamp: function() {
                    return timestamp;
                },
                formatter: function(options) {
                    return `>>>>>>>>>> ${options.timestamp()} - ${options.level.toUpperCase()} - ${options.message}`;
                },
                json: false
            })
        ]
    });

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
        });

        con.connect(err => {
            if (err) {
                reject(err);
            } else {
                resolve(con);
            }
        })
    })
}

/**
 * Closes/destroys a database connection
 * @param {Object} con - A database connection to close/destroy
 */
function closeConnection(con) {
    con.destroy();
}

/**
 * Register in the database the upload response for each podcast
 * @param {string} archivo - Name of the file to register
 * @param {string} obs - A comment
 * @param {boolean} exito - The status of the upload
 * @returns {Promise} The rows affected by the insert, or error message
 */
function registerUpload(archivo, obs, exito) {
    return new Promise((resolve, reject) => {
        getConnection().then(con => {
            con.query({
                sql: 'INSERT INTO `podcasts` (archivo, obs, pudo_subir) VALUES (?, ?, ?)',
                timeout: 40000,
                values: [archivo, obs, exito]
            }, (err, results) => {
                closeConnection(con)

                if (err) {
                    reject(err)
                } else {
                    resolve(results)
                }
            })
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
                    reject(err)
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
                    reject(err)
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
                    reject(err)
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
                    reject(err)
                } else {
                    resolve(results)
                }
            })
        })
    })
}
