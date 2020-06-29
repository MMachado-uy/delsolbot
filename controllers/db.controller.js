const mysql = require('mysql')
const {
    parseResponse
} = require('../utils');

module.exports = class Db {

    /**
     * Get a new database connection
     * @returns {Promise} A new database connection, or error message
     */
    async getConnection() {
        return new Promise((resolve, reject) => {
            var con = mysql.createConnection({
                host     : process.env.DB_HOST,
                port     : process.env.DB_PORT,
                user     : process.env.DB_USER,
                password : process.env.DB_PASS,
                database : process.env.DB
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
    closeConnection(con) {
        con.destroy();
    }

    /**
     * Register in the database the upload response for each podcast
     * @param {string} archivo - Name of the file to register
     * @param {string} obs - A comment
     * @param {boolean} exito - The status of the upload
     * @param {string} fileId - The id returned by Telegram
     * @param {string} channel - The channel this audio was uploaded to
     * @returns {Promise} The rows affected by the insert, or error message
     */
    registerUpload(archivo, obs = '', exito, fileId = '', channel = '') {
        return new Promise(async (resolve, reject) => {
            try {
                obs = parseResponse(obs);
                let channelId = null;
                
                if (channel !== '') {
                    channelId = await this.getChannelId(channel);
                }
                    
                const con  = await this.getConnection();
                con.query({
                    sql: 'INSERT INTO `podcasts` (archivo, obs, pudo_subir, file_id, destino) VALUES (?, ?, ?, ?, ?)',
                    timeout: 40000,
                    values: [
                        archivo, 
                        obs, 
                        exito ? 1 : 0, 
                        fileId, 
                        channelId
                    ]
                }, (err, results) => {
                    this.closeConnection(con);
                    
                    if (err) {
                        reject([`${archivo} registerUpload`, err]);
                    } else {
                        resolve(results);
                    }
                })
            } catch (error) {
                reject(error)
            }
        })
    }

    /**
     * Get the RSS sources list
     * @returns {Promise} The list of RSS sources url's, or error message
     */
    getRssList() {
        return new Promise(async (resolve, reject) => {
            const con = await this.getConnection();
            con.query({
                sql: 'SELECT url, channel, nombre FROM `sources`',
                timeout: 40000
            }, (err, results) => {
                this.closeConnection(con);

                if (err) {
                    reject(['getRssList', err]);
                } else {
                    resolve(results);
                }
            })
        })
    }

    /**
     * Get a single podcast episode
     * @param {string} id - The filename of the podcast to search
     * @returns {Promise} The row representation of the status of the given podcast, or error message
     */
    getPodcastById(id) {
        return new Promise(async (resolve, reject) => {
            const con = await this.getConnection();
            con.query({
                sql: 'SELECT p.id, p.archivo, p.obs, p.pudo_subir, p.fecha_procesado, p.file_id, s.channel FROM `podcasts` AS p, `sources` AS s WHERE p.archivo = ? AND s.id = p.destino',
                timeout: 40000,
                values: [id]
            }, (err, results) => {
                this.closeConnection(con);

                if (err) {
                    reject(['getPodcastByName', err]);
                } else {
                    resolve(results);
                }
            })
        })
    }

    /**
     * Get the list of the failed uploads
     * @returns {Promise} The list of the uploads rejected by Telegram, or error message
     */
    getFailedPodcasts() {
        return new Promise(async (resolve, reject) => {
            const con = await this.getConnection();
            con.query({
                sql: 'SELECT * FROM `podcasts` WHERE `pudo_subir` = 0',
                timeout: 40000
            }, (err, results) => {
                this.closeConnection(con);

                if (err) {
                    reject(['getFailedPodcasts', err]);
                } else {
                    resolve(results);
                }
            })
        })
    }

    /**
     * Get the identifiers for the podcasts
     * @returns {Promise} The stored podcasts, or error message
     */
    getStoredPodcasts() {
        return new Promise(async (resolve, reject) => {
            const con = await this.getConnection();
            con.query({
                sql: 'SELECT id, archivo FROM `podcasts`',
                timeout: 40000,
            }, (err, results) => {
                this.closeConnection(con);

                if (err) {
                    reject(['getStoredPodcasts', err]);
                } else {
                    resolve(results);
                }
            })
        })
    }

    getChannelId(channel) {
        return new Promise(async (resolve, reject) => {
            const con = await this.getConnection();
            
            con.query({
                sql: 'SELECT id FROM sources WHERE channel = ?',
                timeout: 40000,
                values: [channel]
            }, (err, results) => {
                this.closeConnection(con);
                
                if (err) {
                    reject(['getChannelId', err]);
                } else {
                    resolve(results[0].id);
                }
            })
        })
    }
}
