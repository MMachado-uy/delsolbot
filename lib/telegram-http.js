const https = require('https');
const http = require('http');

// Shared IPv4-only keep-alive agents + request timeout for every outbound HTTP
// call (Telegram uploads, the notifier, and feed/media downloads).
//
// DigitalOcean droplets frequently have a dead IPv6 route; Node's happy-eyeballs
// (autoSelectFamily) stalls on the broken AAAA path and surfaces as
// AggregateError [ETIMEDOUT] at connect time. Pinning family:4 sidesteps it.
// Kept dependency-free (only http/https) so helpers.js can require it without a
// circular import.

/**
 * Parse an env var as a positive integer, falling back when unset/invalid.
 * A zero or negative timeout would mean "no timeout" — never what we want here.
 * @param {string|undefined} raw - Raw env value.
 * @param {number} fallback - Default when raw is missing or not a positive int.
 * @returns {number}
 */
const parsePositiveInt = (raw, fallback) => {
    const parsed = Number.parseInt(raw, 10);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const httpsAgent = new https.Agent({ keepAlive: true, family: 4 });
const httpAgent = new http.Agent({ keepAlive: true, family: 4 });

// Per-request timeout (ms). Covers connect + time-to-first-byte; for streamed
// downloads axios clears it once response headers arrive, so it won't abort a
// long body transfer.
const TIMEOUT_MS = parsePositiveInt(process.env.TELEGRAM_TIMEOUT_MS, 120000);

module.exports = { httpsAgent, httpAgent, TIMEOUT_MS };
