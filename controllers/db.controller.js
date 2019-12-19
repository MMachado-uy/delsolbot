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
     * @returns {Promise} The rows affected by the insert, or error message
     */
    registerUpload(archivo, obs = '', exito, fileId = '') {
        return new Promise((resolve, reject) => {

            exito = (exito ? 1 : 0);
            obs = parseResponse(obs);

            const con  = await this.getConnection();
            con.query({
                sql: 'INSERT INTO `podcasts` (archivo, obs, pudo_subir, file_id) VALUES (?, ?, ?, ?)',
                timeout: 40000,
                values: [archivo,  obs, exito, fileId]
            }, (err, results) => {
                this.closeConnection(con);

                if (err) {
                    reject([`${archivo} registerUpload`, err]);
                } else {
                    resolve(results);
                }
            })
        }).catch(err => {
            reject([`${archivo} getConnection`, err]);
        })
    }

    /**
     * Get the RSS sources list
     * @returns {Promise} The list of RSS sources url's, or error message
     */
    getRssList() {
        return new Promise((resolve, reject) => {
            const con = await this.getConnection();
            con.query({
                sql: 'SELECT url, channel FROM `sources`',
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
     * Get a single podcast upload status
     * @param {string} name - The filename of the podcast to search
     * @returns {Promise} The row representation of the status of the given podcast, or error message
     */
    getPodcastByName(name) {
        return new Promise((resolve, reject) => {
            const con = await this.getConnection();
            con.query({
                sql: 'SELECT * FROM `podcasts` WHERE `archivo` = ?',
                timeout: 40000,
                values: [name]
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
        return new Promise((resolve, reject) => {
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
        return new Promise((resolve, reject) => {
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
}
