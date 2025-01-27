require('dotenv').config();

const { logError } = require('../lib/helpers');

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
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
     * Executes a database query with provided parameters.
     * @param {string} query - SQL query to execute.
     * @param {Array} params - Parameters for the query.
     * @returns {Promise<any>} Query result.
     */
    async executeQuery(query, params = []) {
        try {
            this.con = await pool.getConnection();
            const [rows] = await this.con.execute(query, params);

            return rows;
        } catch (err) {
            logError(`Database query failed: ${query} - Params: ${params}`, err);
            throw err;
        } finally {
            if (this.con) {
                this.con.release();
                this.con = null;
            }
        }
    }

    /**
     * Registers a podcast upload in the database.
     * @param {Object} data - Podcast upload data.
     * @returns {Promise<any>} Insert result.
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
        const channelId = channel ? await this.getChannelId(channel) : null;
        const query = `
            INSERT INTO podcasts 
            (archivo, obs, pudo_subir, file_id, destino, title, caption, url, msg_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
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

        return this.executeQuery(query, params);
    }

    /**
     * Retrieves the RSS sources list.
     * @returns {Promise<Array>} List of RSS sources.
     */
    async getRssList() {
        const query = 'SELECT url, channel, nombre FROM sources';

        return this.executeQuery(query);
    }

    /**
     * Retrieves a podcast episode by its ID.
     * @param {string} id - Podcast ID.
     * @returns {Promise<Array>} Podcast details.
     */
    async getPodcastById(id) {
        const query = `
            SELECT 
                p.id, p.archivo, p.obs, p.pudo_subir, p.fecha_procesado, 
                p.file_id, s.channel 
            FROM podcasts AS p 
            JOIN sources AS s ON s.id = p.destino 
            WHERE p.archivo = ?
        `;

        return this.executeQuery(query, [id]);
    }

    /**
     * Retrieves the list of failed podcast uploads.
     * @returns {Promise<Array>} List of failed uploads.
     */
    async getFailedPodcasts() {
        const query = 'SELECT * FROM podcasts WHERE pudo_subir = 0';

        return this.executeQuery(query);
    }

    /**
     * Retrieves the list of stored podcasts.
     * @returns {Promise<Array>} List of stored podcasts.
     */
    async getStoredPodcasts() {
        const query = 'SELECT id, archivo FROM podcasts';

        return this.executeQuery(query);
    }

    /**
     * Retrieves the channel ID by its name.
     * @param {string} channel - Channel name.
     * @returns {Promise<number>} Channel ID.
     */
    async getChannelId(channel) {
        const query = 'SELECT id FROM sources WHERE channel = ?';
        const rows = await this.executeQuery(query, [channel]);

        return rows[0]?.id || null;
    }
};
