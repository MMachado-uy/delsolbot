const env           = require('dotenv').config().parsed;
const axios         = require('axios');
const parseString   = require('xml2js').parseString;
const util          = require('util');
const mysql         = require('mysql');

var connection;

getPodcastByName('coso')
.then((result) => {
    console.log('result: ', result)
}).catch((err) => {
    console.log('Error: ', err)
});

sendToTelegram()

/**
 * Calls the RSS sources and retrieves the current feed
 */
function getRss(rssUri) {
    return new Promise(function (resolve, reject) {
        axios.get('https://www.delsol.uy/feed/notoquennada')
        .then(function(response) {
            parseString(response.data, function(err, result) {
                console.log(util.inspect(result.rss.channel, false, null));
            });
        });
    });
}

function sendToTelegram(audioUri) {
    return new Promise((resolve, reject) => {
        let connectcionUrl   = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio?`;
        connectcionUrl      += `chat_id=${env.CHANNEL}&`;
        connectcionUrl      += `audio=https://cdn.dl.uy/solmp3/6065.mp3&`;
        connectcionUrl      += `disable_notification=true`;
        
        axios.post(connectcionUrl)
        .then((res) => {
            console.log("connectcionUrl ", connectcionUrl);
            console.log(res);
            resolve();
        }).catch((rej) => {
            reject();
            console.log('Rejection: ',rej.response.data)
        });
    });
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
        });
    });
}

function closeConnection(con) {
    con.destroy();
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
            });
        });
    });
}

function getPodcastByName(name) {
    return new Promise((resolve, reject) => {
        getConnection().then((con) => {
            con.query({
                sql: 'SELECT * FROM `podcasts` WHERE `archivo` = ?',
                timeout: 40000,
                values: [name]
            }, (err, results) => {
                closeConnection(con);

                if (err) {
                    reject(err)
                } else {
                    resolve(results)
                }
            });
        });
    });
}
