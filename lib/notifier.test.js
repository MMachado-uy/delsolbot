jest.mock('axios', () => {
    const mock = jest.fn();
    mock.default = mock;

    return mock;
});

const axios = require('axios');
const { notifyAdmin, buildDailySummary, formatCrashAlert } = require('./notifier');

/**
 * Factory for a podcasts activity row as returned by db.getActivitySince.
 * @param {Partial<{archivo: string, channel: string, obs: string, pudo_subir: number, file_id: string}>} overrides
 * @returns {object}
 */
const makeRow = (overrides = {}) => ({
    archivo: '123',
    title: 'Ep 123',
    obs: '',
    pudo_subir: 1,
    file_id: 'FID',
    channel: '@chan',
    fecha_procesado: '2026-06-18 10:00:00',
    ...overrides
});

describe('lib/notifier', () => {
    let errorSpy;
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        process.env.BOT_TOKEN = 'TEST-TOKEN';
        process.env.ADMIN_CHAT_ID = '999';
        axios.mockReset();
        axios.mockResolvedValue({ data: { ok: true } });
    });

    afterEach(() => {
        errorSpy.mockRestore();
        process.env = { ...ORIGINAL_ENV };
    });

    describe('notifyAdmin', () => {
        it('posts to the bot sendMessage endpoint with chat_id and HTML parse mode', async () => {
            const result = await notifyAdmin('hello');

            expect(result).toBe(true);
            expect(axios).toHaveBeenCalledTimes(1);
            const cfg = axios.mock.calls[0][0];
            expect(cfg.method).toBe('post');
            expect(cfg.url).toBe('https://api.telegram.org/botTEST-TOKEN/sendMessage');
            expect(cfg.data).toMatchObject({ chat_id: '999', text: 'hello', parse_mode: 'HTML' });
        });

        it('pins family:4 and a finite timeout (same hardening as uploads)', async () => {
            await notifyAdmin('hi');

            const cfg = axios.mock.calls[0][0];
            expect(cfg.httpsAgent?.options?.family).toBe(4);
            expect(cfg.timeout).toBeGreaterThan(0);
        });

        it('is a no-op (no request) when ADMIN_CHAT_ID is unset — feature disabled', async () => {
            delete process.env.ADMIN_CHAT_ID;

            const result = await notifyAdmin('nobody listening');

            expect(result).toBe(false);
            expect(axios).not.toHaveBeenCalled();
        });

        it('swallows its own delivery failure (returns false, logs, never throws)', async () => {
            axios.mockRejectedValue(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));

            const result = await notifyAdmin('will fail');

            expect(result).toBe(false);
            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('buildDailySummary', () => {
        it('reports all-clear when there are no failures', async () => {
            const msg = buildDailySummary([
                makeRow({ archivo: '1' }),
                makeRow({ archivo: '2' })
            ]);

            expect(msg).toContain('2 uploaded');
            expect(msg).toContain('0 episode(s) failed');
            expect(msg).toMatch(/All clear/u);
            expect(msg).not.toContain('<pre>');
        });

        it('lists failures in a <pre> code block with id, channel and obs', async () => {
            const msg = buildDailySummary([
                makeRow({ archivo: '59924', channel: '@LaMesa', pudo_subir: 0, file_id: '', obs: 'connect ETIMEDOUT' })
            ]);

            expect(msg).toContain('1 episode(s) failed');
            expect(msg).toContain('<pre>');
            expect(msg).toContain('59924');
            expect(msg).toContain('@LaMesa');
            expect(msg).toContain('connect ETIMEDOUT');
        });

        it('collapses repeated (episode, channel) failure rows into a single ×N line', async () => {
            const fail = { archivo: '59761', channel: '@Darwin', pudo_subir: 0, file_id: '', obs: 'ETIMEDOUT' };
            const msg = buildDailySummary([makeRow(fail), makeRow(fail), makeRow(fail)]);

            expect(msg).toContain('1 episode(s) failed');
            expect(msg).toContain('×3');
        });

        it('excludes a failure that later succeeded in the same window (recovered)', async () => {
            const msg = buildDailySummary([
                makeRow({ archivo: '500', channel: '@c', pudo_subir: 0, file_id: '', obs: 'transient' }),
                makeRow({ archivo: '500', channel: '@c', pudo_subir: 1, file_id: 'OK' })
            ]);

            expect(msg).toMatch(/All clear/u);
            expect(msg).toContain('1 uploaded');
        });

        it('HTML-escapes obs so error text cannot break the markup', async () => {
            const msg = buildDailySummary([
                makeRow({ pudo_subir: 0, file_id: '', obs: '<script> & "weird" >' })
            ]);

            expect(msg).toContain('&lt;script&gt; &amp;');
            expect(msg).not.toContain('<script>');
        });

        it('truncates to MAX_FAILURE_ROWS and notes the remainder', async () => {
            const rows = Array.from({ length: 45 }, (_, i) =>
                makeRow({ archivo: `e${i}`, channel: '@c', pudo_subir: 0, file_id: '', obs: 'x' }));

            const msg = buildDailySummary(rows);

            expect(msg).toContain('45 episode(s) failed');
            expect(msg).toContain('… +5 more');
        });

        it('defaults to an empty summary when called with no rows', async () => {
            const msg = buildDailySummary();

            expect(msg).toContain('0 uploaded');
            expect(msg).toMatch(/All clear/u);
        });
    });

    describe('formatCrashAlert', () => {
        it('includes the error message and a short escaped stack', async () => {
            const err = new Error('connect ECONNREFUSED 10.0.0.5:3306');
            const msg = formatCrashAlert(err);

            expect(msg).toMatch(/crashed/iu);
            expect(msg).toContain('ECONNREFUSED');
            expect(msg).toContain('<pre>');
        });

        it('handles a non-Error rejection reason', async () => {
            const msg = formatCrashAlert('plain string reason');

            expect(msg).toContain('plain string reason');
        });
    });
});
