const env           = require('dotenv').config().parsed;
const axios         = require('axios');
const parseString   = require('xml2js').parseString;
const mysql         = require('mysql');
const eachOf        = require('async/eachOf');
var CronJob         = require('cron').CronJob;
var winston         = require('winston');

new CronJob('0 0 * * * *', () => {

    main()

}, null, true)

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
                        return ignoreUploadedPodcasts(feed)
                    }).then(feed => {
                        return parseFeed(feed)
                    }).then(feed => {
                        sendFeedToTelegram(feed, channel)
                    }).catch((error) => {
                        callback(error)
                    })

                    callback()
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

function ignoreUploadedPodcasts(feed) {
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

            let content = `<b>${value.title}</b>\n${value.desc}`

            if (content.length > 200) {
                content = content.substring(0, 197)
                content += '...'
            }
            content = encodeURI(content)

            let connectcionUrl   = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio?`;
            connectcionUrl      += `chat_id=${channel}&`;
            connectcionUrl      += `audio=${value.url}&`;
            connectcionUrl      += `performer=${encodeURI(feedTitle)}&`;
            connectcionUrl      += `title=${encodeURI(value.title)}&`;
            connectcionUrl      += `disable_notification=true&`;
            connectcionUrl      += `parse_mode=html&`;
            connectcionUrl      += `caption=${content}`;

            axios.post(connectcionUrl)
            .then(res => {
                callback()

                logger(true, `${value.archivo} Uploaded`)
                return registerUpload(value.archivo, '', true)
            }).catch(err => {
                logger(false, `${value.archivo} Failed to upload. ${err.response.data.error_code} - ${err.response.data.description}`)
                registerUpload(value.archivo, '', false)
                .then(err => {

                    callback(err)
                })
            })
        }, err => {
            if (err) reject(err)
            resolve()
        })
    })
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////  LOGGER  //////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

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

////////////////////////////////////////////////////////////////////////////////
///////////////////////////////  DATABASE ACCESS  //////////////////////////////
////////////////////////////////////////////////////////////////////////////////

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
