require('dotenv').config();

const CronJob = require('cron').CronJob;

const DbController = require('./controllers/db.controller');
const DB = new DbController();
const { processItem } = require('./lib/process-item');
const { splitEpisode } = require('./lib/splitter');
const { createSendToTelegram } = require('./lib/telegram-publisher');
const {
    cleanDownloads,
    debug,
    getFeed,
    log,
    logError,
    pause
} = require('./lib/helpers');

const { CRON_MAIN, NODE_ENV: ENV } = process.env;
const DDIR = './downloads/';

const sendToTelegram = createSendToTelegram({ db: DB, splitEpisode });

const mainCron = new CronJob(CRON_MAIN, () => {
    main().catch(e => {
        logError(e);
    });
}, null);

/**
 * Main Application logic entry point.
 * Processes all RSS sources and handles podcast uploads.
 * @returns {Promise<void>}
 */
const main = async () => {
    try {
        const rssList = await DB.getRssList();
        debug(`Found ${rssList.length} rss sources`);

        for (const rssSource of rssList) {
            log(`Starting to process ${rssSource.channel}`);

            await processFeed(rssSource);
            await pause(1000);

            log(`Finished processing ${rssSource.channel}`);
        }
    } catch (error) {
        logError(`Error in main process: ${error}`);
    } finally {
        cleanDownloads(DDIR);
    }
}

/**
 * Processes a single RSS feed source.
 * @param {Object} rssSource - RSS source object with id, url, channel, nombre.
 * @returns {Promise<void>}
 */
const processFeed = async rssSource => {
    const feed = await getFeed(rssSource.url);
    feed.items.forEach(item => {
        item.channel = rssSource.channel;
        item.channelId = rssSource.id;
    });

    const { title } = feed;

    for (const item of feed.items) {
        await processItem(item, title, { db: DB, sendToTelegram });
    }
}

module.exports = { main, processFeed };

if (require.main === module) {
    if (ENV === 'local') {
        main().catch(e => {
            logError(e);
        });
    } else {
        mainCron.start();
    }
}
