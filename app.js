const env           = require('dotenv').config().parsed;
const axios         = require('axios');
const parseString   = require('xml2js').parseString;
const util          = require('util');
const mysql         = require('mysql');
const eachOf        = require('async/eachOf');

var connection;

getFeed()
.then((feed) => {
    return ignoreUploadedPodcasts(feed)
}).then((feed) =>{
    return parseFeed(feed)
}).then((feed) => {
    sendFeedToTelegram(feed)
}).catch((error) => {
    console.log(Date().toLocaleString() + ' >>>>>>> ' + error)
})

function getFeed(rssUri) {
    return new Promise(function (resolve, reject) {
        axios.get('https://www.delsol.uy/feed/notoquennada')
        .then(function(response) {
            parseString(response.data, (err, result) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(result.rss.channel[0])
                }
            })
        })
    })
}

function ignoreUploadedPodcasts(feed) {
    return new Promise((resolve, reject) => {
        getStoredPodcasts()
        .then((storedPodcasts) => {
            for (let sp of storedPodcasts) {
                for (let i = 0; i < feed.item.length; i++) {
                    let archivoFeed = feed.item[i].link[0].substring(feed.item[i].link[0].lastIndexOf("/") + 1, feed.item[i].link[0].lastIndexOf(".mp3"));
                    if (sp.archivo == archivoFeed) {
                        feed.item.splice(i, 1);
                    }
                }
            }
            
            resolve(feed)
        }).catch((error) => {
            reject(error);
        })
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

function sendFeedToTelegram(feed) {
    return new Promise((resolve, reject) => {
        let feedTitle = feed.title;
        let feedItems = feed.parsedFeed;

        eachOf(feedItems, (value, key, callback) => {

            let content = 
                `<b>${value.title}</b>\n${value.desc}`
            content = content.substring(0, 197)
            
            if (content.length == 197) {
                content += '...'
            }
            content = encodeURI(content)

            let connectcionUrl   = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio?`;
            connectcionUrl      += `chat_id=${env.CHANNEL}&`;
            connectcionUrl      += `audio=${value.url}&`;
            connectcionUrl      += `disable_notification=true&`;
            connectcionUrl      += `parse_mode=html&`;
            connectcionUrl      += `caption=${content}`;

            axios.post(connectcionUrl)
            .then((res)=> {
                callback()
                return registerUpload(value.archivo, '', true)
            }).catch((err) => {
                registerUpload(value.archivo, '', false)
                .then((err) => {

                    callback(err)
                })
            })
        }, (err) => {
            if (err) reject(err)
            resolve()
        })
    })
}

function getConnection() {
    return new Promise((resolve, reject) => {
        var con = mysql.createConnection({
            host     : env.DB_HOST,
            port     : env.DB_PORT,
            user     : env.DB_USER,
            password : env.DB_PASS,
            database : env.DB
        });
    
        con.connect((err) => {
            if (err) {
                reject(err);
            } else {
                resolve(con);
            }
        })
    })
}

function closeConnection(con) {
    con.destroy();
}

function registerUpload(archivo, obs, exito) {
    return new Promise((resolve, reject) => {
        getConnection().then((con) => {
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

function getRssList() {
    return new Promise((resolve, reject) => {
        getConnection().then((con) => {
            con.query({
                sql: 'SELECT url FROM `sources`',
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

function getPodcastByName(name) {
    return new Promise((resolve, reject) => {
        getConnection().then((con) => {
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

function getStoredPodcasts() {
    return new Promise((resolve, reject) => {
        getConnection().then((con) => {
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

function processTextMsg(rssItem) {
    return new Promise((resolve, reject) => {

    })
}