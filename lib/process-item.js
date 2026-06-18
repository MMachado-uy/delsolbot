const { debug, getIdFromItem, log, logError } = require('./helpers');

// How many times processItem will re-try a (channel, episode) pair whose prior
// attempts have all failed. After this many failures, the episode is abandoned
// on that channel to prevent hammering Telegram for permanently-broken items.
// Each cron tick that reaches the retry path consumes one attempt by producing
// a new pudo_subir=0 or empty-file_id row in `podcasts`.
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Decide whether to skip, forward, retry, or upload an RSS feed item based on
 * historical DB state. Injects `db` and `sendToTelegram` so the function is
 * unit-testable at the module boundary.
 * @param {object} item - RSS feed item, augmented upstream with {channel, channelId}.
 * @param {string} title - Podcast / feed title used as Telegram performer field.
 * @param {object} deps - Injected collaborators.
 * @param {object} deps.db - DbController instance exposing `getPodcastById`.
 * @param {Function} deps.sendToTelegram - Async function (item, title) that performs
 *     the upload or forward and records the outcome in the DB.
 * @returns {Promise<void>}
 */
const processItem = async (item, title, { db, sendToTelegram }) => {
    const itemId = getIdFromItem(item);
    debug(`Processing item: ${itemId}`);

    try {
        const stored = await db.getPodcastById(itemId);
        debug({ stored });

        const alreadyUploaded = stored.some(r => r.pudo_subir && r.file_id && r.channel === item.channel);
        if (alreadyUploaded) {
            debug(`Skipping ${itemId}: already uploaded to ${item.channel}`);

            return;
        }

        // Count distinct ATTEMPTS, not failed rows. A multi-part episode inserts
        // one failed row per part ("id-1", "id-2", ...) on a single failed
        // attempt, so counting rows would exhaust the budget after one attempt.
        // Each attempt contributes at most one row per part label, so the
        // largest count for any single label is the true attempt count.
        const failedRows = stored.filter(r =>
            r.channel === item.channel && (!r.pudo_subir || !r.file_id)
        );
        const failuresByPart = failedRows.reduce((counts, r) => {
            counts.set(r.archivo, (counts.get(r.archivo) ?? 0) + 1);

            return counts;
        }, new Map());
        const priorAttemptsOnThisChannel = failuresByPart.size
            ? Math.max(...failuresByPart.values())
            : 0;

        if (priorAttemptsOnThisChannel >= MAX_RETRY_ATTEMPTS) {
            // Permanently-broken item: log once per tick at info level (stdout),
            // not error — re-logging every cron tick to stderr forever buries
            // real failures in the error stream.
            log(
                `Abandoning ${itemId} on ${item.channel}: retry budget exhausted `
                + `(${priorAttemptsOnThisChannel} prior attempts)`
            );

            return;
        }

        const priorUploads = stored.filter(r => r.pudo_subir && r.file_id && r.channel !== item.channel);
        const isForward = priorUploads.length > 0;

        if (isForward) item.forwardFiles = priorUploads.map(r => r.file_id);

        if (priorAttemptsOnThisChannel > 0) {
            log(
                `Retrying ${itemId} on ${item.channel} `
                + `(attempt ${priorAttemptsOnThisChannel + 1}/${MAX_RETRY_ATTEMPTS})`
            );
        }

        await sendToTelegram(item, title);
        debug('Sent!');

        log(`Done processing item: ${itemId}`);
    } catch (error) {
        logError(`Error processing item ${itemId}:`, error);
    }
};

module.exports = { processItem };
