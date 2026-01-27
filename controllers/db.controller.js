const config = require("../lib/config");

const { logError } = require("../lib/helpers");

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    connectionLimit: config.CONNECTION_LIMIT,
    connectTimeout: config.CONNECT_TIMEOUT,
    host: config.DB_HOST,
    user: config.DB_USER,
    password: config.DB_PASS,
    database: config.DB
});

/**
 * Database controller for podcast operations.
 */
module.exports = class Db {
    /**
     * Initializes a new database controller instance.
     */
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
     * @param {string} data.archivo - File name or episode identifier.
     * @param {string} [data.obs] - Observations or notes.
     * @param {boolean} data.exito - Upload success status.
     * @param {string} [data.fileId] - Telegram file ID.
     * @param {string} [data.channel] - Channel name.
     * @param {string} [data.title] - Episode title.
     * @param {string} [data.caption] - Episode caption.
     * @param {string} [data.url] - Episode URL.
     * @param {string|number} [data.message_id] - Telegram message ID.
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
     * @returns {Promise<Array<{url: string, channel: string, nombre: string}>>} List of RSS sources.
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
               OR p.archivo LIKE CONCAT(?,'-%')
        `;

        return this.executeQuery(query, [id, id]);
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
     * @returns {Promise<Array<{id: number, archivo: string}>>} List of stored podcasts.
     */
    async getStoredPodcasts() {
        const query = 'SELECT id, archivo FROM podcasts';

        return this.executeQuery(query);
    }

    /**
     * Retrieves the channel ID by its name.
     * @param {string} channel - Channel name.
     * @returns {Promise<number|null>} Channel ID or null if not found.
     */
    async getChannelId(channel) {
        const query = 'SELECT id FROM sources WHERE channel = ?';
        const rows = await this.executeQuery(query, [channel]);

        return rows[0]?.id || null;
    }
};
