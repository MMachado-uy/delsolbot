require('dotenv').config();

const mysql = require('mysql2/promise').createPool({
    connectionLimit: 100,
    connectTimeout: 60 * 60 * 1000,
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
        this.con = await mysql.getConnection();
    }

    /**
     * Closes/destroys a database connection
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
    async registerUpload({
        archivo, 
        obs = '', 
        exito, 
        fileId = '', 
        channel = '', 
        title = '', 
        caption = '', 
        url = '',
        message_id = ''
    }) {
        let channelId = null;
        if (channel !== '') channelId = await this.getChannelId(channel);

        await this.openConnection();

        const query = 'INSERT INTO `podcasts` (archivo, obs, pudo_subir, file_id, destino, title, caption, url, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
        const params = [
            archivo,
            obs,
            exito ? 1 : 0,
            fileId,
            channelId,
            title,
            caption,
            url,
            message_id
        ];

        try {
            const [rows] = await this.con.execute(query, params);

            return rows;
        } catch (err) {
            this.closeConnection();
            throw err;
        }
    }

    /**
     * Get the RSS sources list
     * @returns {Promise} The list of RSS sources url's, or error message
     */
    async getRssList() {
        await this.openConnection();
        const [rows] = await this.con.execute('SELECT url, channel, nombre FROM `sources`');

        return rows;
    }

    /**
     * Get a single podcast episode
     * @param {string} id - The filename of the podcast to search
     * @returns {Promise} The row representation of the status of the given podcast, or error message
     */
    async getPodcastById(id) {
        await this.openConnection();

        const query = 'SELECT p.id, p.archivo, p.obs, p.pudo_subir, p.fecha_procesado, p.file_id, s.channel FROM `podcasts` AS p, `sources` AS s WHERE p.archivo = ? AND s.id = p.destino';
        const [rows] = await this.con.execute(query, [id]);

        return rows;
    }

    /**
     * Get the list of the failed uploads
     * @returns {Promise} The list of the uploads rejected by Telegram, or error message
     */
    async getFailedPodcasts() {
        await this.openConnection();

        const [rows] = await this.con.execute('SELECT * FROM `podcasts` WHERE `pudo_subir` = 0');

        return rows;
    }

    /**
     * Get the identifiers for the podcasts
     * @returns {Promise} The stored podcasts, or error message
     */
    async getStoredPodcasts() {
        await this.openConnection();

        const [rows] = await this.con.execute('SELECT id, archivo FROM `podcasts`');

        return rows;
    }

    async getChannelId(channel) {
        await this.openConnection();

        const [rows] = await this.con.execute('SELECT id FROM sources WHERE channel = ?', [channel]);

        return rows[0].id;
    }
};
