require('dotenv').config();

const mysql = require('mysql').createPool({
    connectionLimit: 1000,
    connectTimeout: 60 * 60 * 1000,
    acquireTimeout: 60 * 60 * 1000,
    timeout: 60 * 60 * 1000,
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB
});

module.exports = class Db {
    constructor() {
        this.con = null;
    }

    /**
     * Get a new database connection
     * @returns {Promise} A new database connection, or error message
     */
    async openConnection() {
        return new Promise((resolve, reject) => {
            mysql.getConnection((err, con) => {
                if (err) {
                    reject([
                        'openConnection',
                        err
                    ])
                } else {
                    this.con = con;

                    resolve(con);
                }
            });
        });
    }

    /**
     * Closes/destroys a database connection
     * @param {Object} con - A database connection to close/destroy
     */
    closeConnection() {
        if (this.con !== null) {
            this.con.release();
            this.con = null;
        }
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
    async registerUpload(
        archivo, 
        obs = '', 
        exito, 
        fileId = '', 
        channel = '', 
        title = '', 
        caption = '', 
        url = '',
        msg_id = ''
    ) {
        let channelId = null;
        if (channel !== '') channelId = await this.getChannelId(channel);

        await this.openConnection();

        return new Promise((resolve, reject) => {
            try {
                this.con.query({
                    sql: 'INSERT INTO `podcasts` (archivo, obs, pudo_subir, file_id, destino, title, caption, url, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    timeout: 40000,
                    values: [
                        archivo,
                        obs,
                        exito ? 1 : 0,
                        fileId,
                        channelId,
                        title,
                        caption,
                        url,
                        msg_id
                    ]
                }, (err, results) => {
                    this.closeConnection();

                    if (err) {
                        reject([
                            `${archivo} registerUpload`,
                            err
                        ]);
                    } else {
                        resolve(results);
                    }
                })
            } catch (error) {
                this.closeConnection();
                reject(error)
            }
        })
    }

    /**
     * Get the RSS sources list
     * @returns {Promise} The list of RSS sources url's, or error message
     */
    async getRssList() {
        await this.openConnection();

        return new Promise((resolve, reject) => {
            this.con.query({
                sql: 'SELECT url, channel, nombre FROM `sources`',
                timeout: 40000
            }, (err, results) => {
                this.closeConnection();

                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    /**
     * Get a single podcast episode
     * @param {string} id - The filename of the podcast to search
     * @returns {Promise} The row representation of the status of the given podcast, or error message
     */
    async getPodcastById(id) {
        await this.openConnection();

        return new Promise((resolve, reject) => {
            this.con.query({
                sql: 'SELECT p.id, p.archivo, p.obs, p.pudo_subir, p.fecha_procesado, p.file_id, s.channel FROM `podcasts` AS p, `sources` AS s WHERE p.archivo = ? AND s.id = p.destino',
                timeout: 40000,
                values: [id]
            }, (err, results) => {
                this.closeConnection();

                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    /**
     * Get the list of the failed uploads
     * @returns {Promise} The list of the uploads rejected by Telegram, or error message
     */
    async getFailedPodcasts() {
        await this.openConnection();

        return new Promise((resolve, reject) => {
            this.con.query({
                sql: 'SELECT * FROM `podcasts` WHERE `pudo_subir` = 0',
                timeout: 40000
            }, (err, results) => {
                this.closeConnection();

                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    /**
     * Get the identifiers for the podcasts
     * @returns {Promise} The stored podcasts, or error message
     */
    async getStoredPodcasts() {
        await this.openConnection();

        return new Promise((resolve, reject) => {
            this.con.query({
                sql: 'SELECT id, archivo FROM `podcasts`',
                timeout: 40000
            }, (err, results) => {
                this.closeConnection();

                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    async getChannelId(channel) {
        await this.openConnection();

        return new Promise((resolve, reject) => {
            this.con.query({
                sql: 'SELECT id FROM sources WHERE channel = ?',
                timeout: 40000,
                values: [channel]
            }, (err, results) => {
                this.closeConnection();

                if (err) {
                    reject(err);
                } else {
                    resolve(results[0].id);
                }
            });
        });
    }
};
