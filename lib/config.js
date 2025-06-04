const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    TEST_CHANNEL: process.env.TEST_CHANNEL,
    CRON_MAIN: process.env.CRON_MAIN || process.env.CRON,
    NODE_ENV: process.env.NODE_ENV || process.env.ENV,
    DEBUG: process.env.DEBUG === 'true' || process.env.DEBUG === '1',
    DB_HOST: process.env.DB_HOST,
    DB_USER: process.env.DB_USER,
    DB_PASS: process.env.DB_PASS,
    DB: process.env.DB,
    DB_PORT: process.env.DB_PORT,
    CONNECTION_LIMIT: Number(process.env.DB_CONNECTION_LIMIT) || 100,
    CONNECT_TIMEOUT: Number(process.env.DB_CONNECT_TIMEOUT) || 60 * 60 * 1000,
    TELEGRAM_THRESHOLD: Number(process.env.TELEGRAM_THRESHOLD) || 50,
    MAX_DISTANCE_FROM_SILENCE: Number(process.env.MAX_DISTANCE_FROM_SILENCE) || 10
};
