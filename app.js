require('dotenv').config();

const CronJob = require('cron').CronJob;

const DbController = require('./controllers/db.controller');
const DB = new DbController();
const { processItem } = require('./lib/process-item');
const { splitEpisode } = require('./lib/splitter');
const { createSendToTelegram } = require('./lib/telegram-publisher');
const { notifyAdmin, buildDailySummary, formatCrashAlert } = require('./lib/notifier');
const {
    cleanDownloads,
    debug,
    getFeed,
    log,
    logError,
    pause
} = require('./lib/helpers');

// CRON_SUMMARY defaults to 00:00 UTC daily; the 24h window aligns to the
// calendar-day boundary. Override in env to change the delivery time.
const { CRON_MAIN, CRON_SUMMARY = '0 0 * * *', NODE_ENV: ENV } = process.env;
const SUMMARY_WINDOW_HOURS = 24;
const DDIR = './downloads/';

const sendToTelegram = createSendToTelegram({ db: DB, splitEpisode });

// Guard against overlapping ticks: a run with large uploads + retries can exceed
// the cron interval, and two concurrent main() runs would race on the same
// episode (duplicate uploads) and let one run's cleanDownloads() delete files
// the other is mid-upload on. Skip a tick if the previous run is still going.
let mainRunning = false;
const mainCron = new CronJob(CRON_MAIN, () => {
    if (mainRunning) {
        log('Previous run still in progress; skipping this tick');

        return;
    }

    mainRunning = true;
    main()
        .catch(e => logError(e))
        .finally(() => { mainRunning = false; });
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

/**
 * Build and DM the daily operator summary of the last 24h of activity. On any
 * failure (e.g. DB unreachable) it still tries to alert the operator, so a
 * sustained outage surfaces once a day rather than silently.
 * @returns {Promise<void>}
 */
const sendDailySummary = async () => {
    try {
        const rows = await DB.getActivitySince(SUMMARY_WINDOW_HOURS);
        await notifyAdmin(buildDailySummary(rows));
        log('Daily summary sent');
    } catch (error) {
        logError(`Daily summary failed: ${error.message}`);
        await notifyAdmin(`⚠️ DelSolBot daily summary could not be generated:\n${error.message}`);
    }
};

module.exports = { main, processFeed, sendDailySummary };

if (require.main === module) {
    // Severe-crash alerting: only the process-level escape hatches are treated
    // as "crashes". Per-tick failures inside main() are handled (logged, cron
    // retries next tick) and surface in the daily digest, not as immediate DMs.
    const onFatal = (label) => async (error) => {
        logError(`${label}:`, error);
        await notifyAdmin(formatCrashAlert(error));
        // The process is in an undefined state; exit so pm2 restarts it cleanly
        // rather than limping on. This is the intended use of process.exit.
        // eslint-disable-next-line no-process-exit
        process.exit(1);
    };
    process.on('uncaughtException', onFatal('Uncaught exception'));
    process.on('unhandledRejection', onFatal('Unhandled rejection'));

    if (ENV === 'local') {
        main().catch(e => {
            logError(e);
        });
    } else {
        // Created here (not at module scope) so test-time `require` of app.js
        // instantiates exactly one CronJob — the main tick.
        const summaryCron = new CronJob(CRON_SUMMARY, () => {
            sendDailySummary().catch(e => logError(e));
        }, null);

        mainCron.start();
        summaryCron.start();
    }
}
