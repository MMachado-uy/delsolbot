require('dotenv').config();

const https = require('https');
const axios = require('axios');

const { logError } = require('./helpers');

// Reuse the IPv4 pin from the upload hardening: the droplet's IPv6 route to
// api.telegram.org is dead, so a notification over the default happy-eyeballs
// path would ETIMEDOUT just like the uploads did. See lib/telegram-publisher.js.
const agent = new https.Agent({ keepAlive: true, family: 4 });
const TIMEOUT_MS = Number(process.env.TELEGRAM_TIMEOUT_MS) || 120000;

// Telegram caps a message body at 4096 chars; keep headroom for the header and
// the <pre> wrapper by bounding the number of failure rows we render.
const MAX_FAILURE_ROWS = 40;
const OBS_MAX_LEN = 70;

/**
 * Escape the three HTML-significant characters so arbitrary error text is safe
 * inside Telegram's HTML parse mode (notably inside <pre> blocks).
 * @param {*} value - Any value; coerced to string.
 * @returns {string} HTML-escaped string.
 */
const escapeHtml = (value) => String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');

/**
 * Best-effort direct message to the operator via the same bot. No-op when
 * ADMIN_CHAT_ID is unset (feature disabled). NEVER throws: its own failure must
 * not crash a run, and it must not recurse back into the alerting path.
 * @param {string} text - Message body (HTML parse mode).
 * @returns {Promise<boolean>} True when Telegram accepted the message.
 */
const notifyAdmin = async (text) => {
    const chatId = process.env.ADMIN_CHAT_ID;
    const botToken = process.env.BOT_TOKEN;

    if (!chatId) return false;

    try {
        await axios({
            method: 'post',
            url: `https://api.telegram.org/bot${botToken}/sendMessage`,
            data: {
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            },
            timeout: TIMEOUT_MS,
            httpsAgent: agent
        });

        return true;
    } catch (error) {
        logError(`notifyAdmin failed: ${error.code ?? error.message}`);

        return false;
    }
};

/**
 * Build the daily operator summary from a window of podcast activity rows
 * (as returned by DbController.getActivitySince). Successes and failures share
 * the success definition used elsewhere: pudo_subir truthy AND a non-empty
 * file_id. Failed rows that later succeeded in the same window are treated as
 * recovered and excluded from the "what failed" list.
 * @param {Array<{archivo: string, channel: string, obs: string, pudo_subir: any, file_id: string}>} [rows=[]]
 * @returns {string} HTML message body.
 */
const buildDailySummary = (rows = []) => {
    const uploadedRows = rows.filter(r => r.pudo_subir && r.file_id);
    const failedRows = rows.filter(r => !r.pudo_subir || !r.file_id);

    const keyOf = (r) => `${r.archivo}|${r.channel}`;
    const succeededKeys = new Set(uploadedRows.map(keyOf));

    // Collapse per-part / per-tick rows into one line per (episode, channel),
    // surfacing repeat counts so a stuck episode reads as "×3". Skip anything
    // that also succeeded in the window — it recovered, no action needed.
    const grouped = new Map();
    for (const r of failedRows) {
        const key = keyOf(r);
        if (succeededKeys.has(key)) continue;

        const entry = grouped.get(key);
        if (entry) entry.count += 1;
        else grouped.set(key, { archivo: r.archivo, channel: r.channel, obs: r.obs, count: 1 });
    }
    const failures = [...grouped.values()];

    const header = '<b>DelSolBot — daily summary</b>\n'
        + `✅ ${succeededKeys.size} uploaded · ⚠️ ${failures.length} episode(s) failed`;

    if (failures.length === 0) {
        return `${header}\n\n✅ All clear — no failures in the last 24h.`;
    }

    const lines = failures.slice(0, MAX_FAILURE_ROWS).map(f => {
        const obs = (f.obs || 'unknown error').replace(/\s+/gu, ' ').trim().slice(0, OBS_MAX_LEN);
        const times = f.count > 1 ? ` ×${f.count}` : '';

        return `${f.archivo}  ${f.channel}  ${obs}${times}`;
    });
    const more = failures.length > MAX_FAILURE_ROWS
        ? `\n… +${failures.length - MAX_FAILURE_ROWS} more`
        : '';

    return `${header}\n\nWhat failed (last 24h):\n<pre>${escapeHtml(lines.join('\n') + more)}</pre>`;
};

/**
 * Build a short, loud crash-alert body for process-level failures.
 * @param {Error|*} error - The thrown error / rejection reason.
 * @returns {string} HTML message body.
 */
const formatCrashAlert = (error) => {
    const message = error?.message ?? String(error);
    // Drop the first stack line (it repeats the message) and keep a few frames.
    const stack = (error?.stack ?? '').split('\n').slice(1, 4).join('\n').trim();
    const trace = stack ? `\n<pre>${escapeHtml(stack)}</pre>` : '';

    return `🚨 <b>DelSolBot crashed</b>\n${escapeHtml(message)}${trace}`;
};

module.exports = { notifyAdmin, buildDailySummary, formatCrashAlert };
