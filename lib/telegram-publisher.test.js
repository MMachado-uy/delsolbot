jest.mock('axios', () => {
    const mock = jest.fn();
    mock.default = mock;

    return mock;
});

jest.mock('node-id3', () => ({
    Promise: { write: jest.fn().mockResolvedValue(true) }
}));

jest.mock('form-data', () => {
    // FormData's internals call `source.pause()` on stream-like args, which
    // our test-double read stream doesn't implement. Replace with a plain
    // stub that records appends so tests can assert the field shape.
    return jest.fn().mockImplementation(() => ({
        append: jest.fn()
    }));
});

jest.mock('./helpers', () => {
    const actual = jest.requireActual('./helpers');

    return {
        ...actual,
        getMedia: jest.fn().mockResolvedValue('/mocked/path')
    };
});

const EventEmitter = require('events');
const fs = require('fs');
const axios = require('axios');
const NodeID3 = require('node-id3').Promise;
const helpers = require('./helpers');
const { createSendToTelegram } = require('./telegram-publisher');

/**
 * Factory for a minimal read-stream-like test double — EventEmitter with a
 * destroy() spy. Used when sendEpisodeToChannel calls fs.createReadStream.
 * @returns {EventEmitter & { destroy: jest.Mock }}
 */
const makeReadStream = () => {
    const s = new EventEmitter();
    s.destroy = jest.fn();

    return s;
};

/**
 * Realistic RSS item shape after processFeed has annotated it with
 * channel and channelId.
 * @param {object} overrides
 * @returns {object}
 */
const makeItem = (overrides = {}) => ({
    title: 'Episode One',
    content: 'Episode description',
    link: 'https://source.example/eps/123.mp3',
    channel: '@current',
    channelId: 7,
    itunes: { image: 'https://source.example/covers/ep1.jpg' },
    ...overrides
});

/**
 * Builds a successful Telegram sendAudio response shape.
 * @param {{ file_id: string, message_id: number | string }} overrides
 * @returns {object}
 */
const makeTelegramSuccessResponse = ({ file_id = 'NEW-FID', message_id = 42 } = {}) => ({
    ok: true,
    result: {
        audio: { file_id },
        message_id
    }
});

describe('lib/telegram-publisher', () => {
    let db;
    let splitEpisode;
    let sendToTelegram;
    let logSpy;
    let errorSpy;
    let existsSyncSpy;
    let mkdirSyncSpy;
    let readFileSpy;
    let createReadStreamSpy;

    beforeEach(() => {
        db = { registerUpload: jest.fn().mockResolvedValue({ insertId: 1 }) };
        splitEpisode = jest.fn().mockResolvedValue(['/mocked/path']);
        sendToTelegram = createSendToTelegram({ db, splitEpisode });

        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
        readFileSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('cover-bytes'));
        createReadStreamSpy = jest.spyOn(fs, 'createReadStream').mockImplementation(() => makeReadStream());
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        existsSyncSpy.mockRestore();
        mkdirSyncSpy.mockRestore();
        readFileSpy.mockRestore();
        createReadStreamSpy.mockRestore();
    });

    describe('createSendToTelegram factory', () => {
        it('returns a function', () => {
            expect(typeof sendToTelegram).toBe('function');
        });
    });

    describe('forward path (reuses existing Telegram file_id)', () => {
        it('posts a single file_id and registers success', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse({ file_id: 'FORWARDED', message_id: 101 }) });
            const item = makeItem({ forwardFiles: ['PRIOR-FID'] });

            const result = await sendToTelegram(item, 'Podcast');

            expect(result).toBe(true);
            expect(axios).toHaveBeenCalledTimes(1);
            expect(db.registerUpload).toHaveBeenCalledWith(expect.objectContaining({
                archivo: '123',
                exito: true,
                fileId: 'FORWARDED',
                channelId: 7,
                message_id: 101
            }));
        });

        it('iterates multiple file_ids and adds "(Parte N)" caption prefix to each', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse() });
            const item = makeItem({ forwardFiles: ['FID-A', 'FID-B', 'FID-C'] });

            await sendToTelegram(item, 'Podcast');

            expect(axios).toHaveBeenCalledTimes(3);
            expect(db.registerUpload).toHaveBeenCalledTimes(3);
            const archivos = db.registerUpload.mock.calls.map(c => c[0].archivo);
            expect(archivos).toEqual(['123-1', '123-2', '123-3']);

            const captions = db.registerUpload.mock.calls.map(c => c[0].caption);
            expect(captions[0]).toContain('(Parte 1)');
            expect(captions[1]).toContain('(Parte 2)');
            expect(captions[2]).toContain('(Parte 3)');
        });

        it('continues remaining forward parts when one fails, recording the failure', async () => {
            axios
                .mockResolvedValueOnce({ data: makeTelegramSuccessResponse({ file_id: 'OK-A' }) })
                .mockRejectedValueOnce(Object.assign(new Error('forward failed'), {
                    response: { body: { description: 'Bad Request' } }
                }))
                .mockResolvedValueOnce({ data: makeTelegramSuccessResponse({ file_id: 'OK-C' }) });
            const item = makeItem({ forwardFiles: ['A', 'B', 'C'] });

            const result = await sendToTelegram(item, 'Podcast');

            expect(result).toBe(false); // any part failure → overall false
            expect(db.registerUpload).toHaveBeenCalledTimes(3);

            const successes = db.registerUpload.mock.calls.map(c => c[0].exito);
            expect(successes).toEqual([true, false, true]);
        });
    });

    describe('fresh upload path — single part', () => {
        beforeEach(() => {
            splitEpisode.mockResolvedValue(['/mocked/path']);
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse({ file_id: 'FRESH-FID', message_id: 99 }) });
        });

        it('downloads, splits, tags, uploads, and registers in that order', async () => {
            const item = makeItem();

            const result = await sendToTelegram(item, 'Podcast');

            expect(result).toBe(true);
            expect(helpers.getMedia).toHaveBeenCalled(); // downloadImage + downloadEpisode
            expect(splitEpisode).toHaveBeenCalled();
            expect(NodeID3.write).toHaveBeenCalled();
            expect(axios).toHaveBeenCalled();
            expect(db.registerUpload).toHaveBeenCalledWith(expect.objectContaining({
                archivo: '123',
                exito: true,
                fileId: 'FRESH-FID',
                channelId: 7,
                message_id: 99
            }));
        });

        it('does NOT add "(Parte N)" to caption when there is only one part', async () => {
            await sendToTelegram(makeItem(), 'Podcast');

            const caption = db.registerUpload.mock.calls[0][0].caption;
            expect(caption).not.toContain('Parte');
        });
    });

    describe('fresh upload path — multi-part (splitter returned >1 paths)', () => {
        it('iterates parts, adds "(Parte N)" to caption, registers each with archivo-N ids', async () => {
            splitEpisode.mockResolvedValue([
                '/mocked/path_(parte_1).mp3',
                '/mocked/path_(parte_2).mp3'
            ]);
            axios
                .mockResolvedValueOnce({ data: makeTelegramSuccessResponse({ file_id: 'P1', message_id: 10 }) })
                .mockResolvedValueOnce({ data: makeTelegramSuccessResponse({ file_id: 'P2', message_id: 11 }) });

            await sendToTelegram(makeItem(), 'Podcast');

            expect(db.registerUpload).toHaveBeenCalledTimes(2);
            const archivos = db.registerUpload.mock.calls.map(c => c[0].archivo);
            expect(archivos).toEqual(['123-1', '123-2']);
            // Note: caption stored is the BASE caption (without "(Parte N)") per current behavior —
            // only the forward path stores the prefixed caption. Fresh uploads store the base.
            const captions = db.registerUpload.mock.calls.map(c => c[0].caption);
            expect(captions[0]).not.toContain('Parte');
            expect(captions[1]).not.toContain('Parte');
        });

        it('a per-part upload failure now registers a failure row (Defect #1 fix) and continues with the next part', async () => {
            splitEpisode.mockResolvedValue([
                '/mocked/path_(parte_1).mp3',
                '/mocked/path_(parte_2).mp3'
            ]);
            axios
                .mockRejectedValueOnce(new Error('part 1 telegram failed'))
                .mockResolvedValueOnce({ data: makeTelegramSuccessResponse({ file_id: 'P2' }) });

            const result = await sendToTelegram(makeItem(), 'Podcast');

            expect(result).toBe(false);
            // Part 1: fallback registerUpload(exito=false) fires. Part 2: registerUpload(exito=true) fires.
            expect(db.registerUpload).toHaveBeenCalledTimes(2);
            expect(db.registerUpload.mock.calls[0][0].archivo).toBe('123-1');
            expect(db.registerUpload.mock.calls[0][0].exito).toBe(false);
            expect(db.registerUpload.mock.calls[1][0].archivo).toBe('123-2');
            expect(db.registerUpload.mock.calls[1][0].exito).toBe(true);
            expect(errorSpy).toHaveBeenCalled();
        });

        it('an ID3-write failure in editMetadata is caught, logged, registers a failure row, and the next part still runs', async () => {
            splitEpisode.mockResolvedValue([
                '/mocked/path_(parte_1).mp3',
                '/mocked/path_(parte_2).mp3'
            ]);
            NodeID3.write
                .mockRejectedValueOnce(new Error('id3 write failed'))
                .mockResolvedValueOnce(true);
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse({ file_id: 'OK' }) });

            const result = await sendToTelegram(makeItem(), 'Podcast');

            expect(result).toBe(false);
            // Part 1 fails at editMetadata (before Telegram post); fallback registerUpload records it.
            // Part 2 succeeds end-to-end.
            expect(axios).toHaveBeenCalledTimes(1); // only part 2 reached Telegram
            expect(db.registerUpload).toHaveBeenCalledTimes(2);
            expect(db.registerUpload.mock.calls[0][0].exito).toBe(false);
            expect(db.registerUpload.mock.calls[0][0].archivo).toBe('123-1');
            expect(db.registerUpload.mock.calls[1][0].exito).toBe(true);
            expect(db.registerUpload.mock.calls[1][0].archivo).toBe('123-2');
        });
    });

    describe('cover image fallback (downloadImage)', () => {
        it('does not call getMedia for the image when itunes.image is not a string', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse() });
            splitEpisode.mockResolvedValue(['/mocked/path']);
            const item = makeItem({ itunes: { image: { url: 'object-form' } } }); // object, not string

            await sendToTelegram(item, 'Podcast');

            // getMedia should be called only once — for the episode download, not the image
            // (downloadImage early-returns COVER when imageUrl is non-string).
            expect(helpers.getMedia).toHaveBeenCalledTimes(1);
        });

        it('calls getMedia for both image and episode when itunes.image is a string URL', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse() });
            splitEpisode.mockResolvedValue(['/mocked/path']);

            await sendToTelegram(makeItem(), 'Podcast');

            expect(helpers.getMedia).toHaveBeenCalledTimes(2);
        });
    });

    describe('outer catch — fatal failures before or during iteration', () => {
        it('registers a failure row and rethrows when the download itself fails', async () => {
            helpers.getMedia.mockRejectedValueOnce(new Error('image download failed'));

            await expect(sendToTelegram(makeItem(), 'Podcast'))
                .rejects.toThrow('image download failed');

            // Failure row registered with the bare episodeNumber (no part suffix)
            expect(db.registerUpload).toHaveBeenCalledWith(expect.objectContaining({
                archivo: '123',
                exito: false,
                fileId: '',
                channelId: 7
            }));
        });

        it('registers a failure row when splitEpisode fails and rethrows', async () => {
            helpers.getMedia.mockResolvedValue('/mocked/path');
            splitEpisode.mockRejectedValue(new Error('split failed'));

            await expect(sendToTelegram(makeItem(), 'Podcast'))
                .rejects.toThrow('split failed');
            expect(db.registerUpload).toHaveBeenCalledTimes(1);
            expect(db.registerUpload.mock.calls[0][0].exito).toBe(false);
        });
    });

    describe('sendEpisodeToChannel (exercised via outer function) — request contract', () => {
        it('POSTs to https://api.telegram.org/bot{BOT_TOKEN}/sendAudio', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse() });
            splitEpisode.mockResolvedValue(['/mocked/path']);

            await sendToTelegram(makeItem(), 'Podcast');

            const axiosConfig = axios.mock.calls[0][0];
            expect(axiosConfig.method).toBe('post');
            expect(axiosConfig.url).toMatch(/^https:\/\/api\.telegram\.org\/bot[^/]+\/sendAudio$/u);
        });

        it('includes maxContentLength: Infinity and maxBodyLength: Infinity (for large MP3 uploads)', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse() });
            splitEpisode.mockResolvedValue(['/mocked/path']);

            await sendToTelegram(makeItem(), 'Podcast');

            const axiosConfig = axios.mock.calls[0][0];
            expect(axiosConfig.maxContentLength).toBe(Infinity);
            expect(axiosConfig.maxBodyLength).toBe(Infinity);
        });

        it('uses multipart/form-data Content-Type', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse() });
            splitEpisode.mockResolvedValue(['/mocked/path']);

            await sendToTelegram(makeItem(), 'Podcast');

            expect(axios.mock.calls[0][0].headers['Content-Type']).toBe('multipart/form-data');
        });

        it('destroys the read stream when axios rejects (fresh upload path)', async () => {
            const stream = makeReadStream();
            createReadStreamSpy.mockReturnValue(stream);
            axios.mockRejectedValue(new Error('network down'));
            splitEpisode.mockResolvedValue(['/mocked/path']);

            await sendToTelegram(makeItem(), 'Podcast');
            // Error caught in per-part try/catch; registerUpload not called for the failed part
            expect(stream.destroy).toHaveBeenCalled();
        });
    });

    describe('Defect #1 fix — fallback INSERT on Telegram-success + DB-fail', () => {
        // Defect #1 mechanic (pre-fix): Telegram POST succeeds, but the
        // success INSERT fails. The per-part catch previously logged and
        // moved on with NO fallback. Result: Telegram had the message, DB
        // had no row, next cron tick saw stored=[] and produced a duplicate.
        //
        // Fix: add a fallback db.registerUpload({exito: false, ...}) inside
        // the per-part catch, mirroring the outer-catch pattern used for
        // download/split failures. After this fix:
        //   - A row with pudo_subir=0 exists on the next tick.
        //   - processItem's retry-with-budget logic (Defect #2 fix) then
        //     governs what happens: retry up to MAX_RETRY_ATTEMPTS times,
        //     then abandon.
        //   - Net: no duplicate, AND no silent abandonment without retries.

        it('when Telegram POST succeeds and the success INSERT fails, a fallback INSERT with exito=false is attempted', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse({ file_id: 'UPLOADED-TO-TELEGRAM' }) });
            splitEpisode.mockResolvedValue(['/mocked/path']);
            db.registerUpload
                .mockRejectedValueOnce(new Error('DB primary write failed'))
                .mockResolvedValueOnce({ insertId: 2 });

            const result = await sendToTelegram(makeItem(), 'Podcast');

            expect(result).toBe(false);
            expect(axios).toHaveBeenCalledTimes(1);
            expect(db.registerUpload).toHaveBeenCalledTimes(2);
            expect(db.registerUpload.mock.calls[0][0].exito).toBe(true);
            expect(db.registerUpload.mock.calls[1][0].exito).toBe(false);
            expect(db.registerUpload.mock.calls[1][0].archivo).toBe('123');
            expect(db.registerUpload.mock.calls[1][0].fileId).toBe('');
        });

        it('fallback INSERT records the original error in the `obs` column', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse() });
            splitEpisode.mockResolvedValue(['/mocked/path']);
            db.registerUpload
                .mockRejectedValueOnce(new Error('ER_LOCK_DEADLOCK: deadlock found'))
                .mockResolvedValueOnce({ insertId: 2 });

            await sendToTelegram(makeItem(), 'Podcast');

            expect(db.registerUpload.mock.calls[1][0].obs).toContain('deadlock');
        });

        it('when BOTH the success INSERT and the fallback INSERT fail, logs and continues without throwing', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse() });
            splitEpisode.mockResolvedValue(['/mocked/path']);
            db.registerUpload.mockRejectedValue(new Error('DB completely down'));

            const result = await sendToTelegram(makeItem(), 'Podcast');

            expect(result).toBe(false);
            expect(db.registerUpload).toHaveBeenCalledTimes(2);
            expect(errorSpy).toHaveBeenCalled();
            // No throw — the defect persists only in the truly catastrophic case (both writes fail).
        });

        it('for multi-part uploads, a DB failure on part 1 triggers its fallback, and part 2 still processes normally', async () => {
            axios.mockResolvedValue({ data: makeTelegramSuccessResponse({ file_id: 'UPLOADED' }) });
            splitEpisode.mockResolvedValue(['/mocked/p1.mp3', '/mocked/p2.mp3']);
            db.registerUpload
                .mockRejectedValueOnce(new Error('DB write failed for part 1')) // part 1 success attempt
                .mockResolvedValueOnce({ insertId: 100 })                        // part 1 fallback
                .mockResolvedValueOnce({ insertId: 101 });                       // part 2 success

            const result = await sendToTelegram(makeItem(), 'Podcast');

            expect(result).toBe(false);
            expect(axios).toHaveBeenCalledTimes(2);
            expect(db.registerUpload).toHaveBeenCalledTimes(3);
            const exitoValues = db.registerUpload.mock.calls.map(c => c[0].exito);
            expect(exitoValues).toEqual([true, false, true]);
        });
    });
});
