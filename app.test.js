jest.mock('cron', () => ({
    CronJob: jest.fn().mockImplementation(() => ({ start: jest.fn() }))
}));

jest.mock('./controllers/db.controller', () => {
    const mockInstance = {
        getRssList: jest.fn(),
        getPodcastById: jest.fn(),
        registerUpload: jest.fn(),
        getFailedPodcasts: jest.fn(),
        getStoredPodcasts: jest.fn()
    };
    const MockDb = jest.fn(() => mockInstance);
    MockDb.__mockInstance = mockInstance;

    return MockDb;
});

jest.mock('./lib/process-item', () => ({
    processItem: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('./lib/telegram-publisher', () => {
    const sendToTelegramFn = jest.fn();
    return {
        createSendToTelegram: jest.fn(() => sendToTelegramFn),
        __sendToTelegramFn: sendToTelegramFn
    };
});

jest.mock('./lib/splitter', () => ({
    splitEpisode: jest.fn()
}));

jest.mock('./lib/helpers', () => {
    const actual = jest.requireActual('./lib/helpers');

    return {
        ...actual,
        getFeed: jest.fn(),
        cleanDownloads: jest.fn().mockResolvedValue(undefined),
        pause: jest.fn().mockResolvedValue(undefined)
    };
});

const cron = require('cron');
const Db = require('./controllers/db.controller');
const helpers = require('./lib/helpers');
const processItemModule = require('./lib/process-item');
const telegramPublisher = require('./lib/telegram-publisher');
const { main, processFeed } = require('./app');

const mockDb = Db.__mockInstance;
const sendToTelegramFn = telegramPublisher.__sendToTelegramFn;

// Capture module-load-time state BEFORE clearMocks (per jest.config.js) wipes
// it before the first test. These factories were invoked exactly once, when
// app.js required its dependencies at the top of the file.
const dbConstructorCalls = Db.mock.calls.slice();
const cronJobCalls = cron.CronJob.mock.calls.slice();
const cronInstance = cron.CronJob.mock.results[0].value;
const createSendToTelegramCalls = telegramPublisher.createSendToTelegram.mock.calls.slice();

describe('app.js', () => {
    let logSpy;
    let errorSpy;

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    describe('module-load wiring', () => {
        it('instantiates exactly one DbController at module load', () => {
            expect(dbConstructorCalls).toHaveLength(1);
        });

        it('creates exactly one CronJob at module load, driven by CRON_MAIN env var', () => {
            expect(cronJobCalls).toHaveLength(1);
            const [schedule, callback] = cronJobCalls[0];
            // schedule is whatever process.env.CRON_MAIN was; we only verify shape
            expect(typeof schedule === 'string' || schedule === undefined).toBe(true);
            expect(typeof callback).toBe('function');
        });

        it('calls createSendToTelegram once with the DB instance and splitEpisode', () => {
            expect(createSendToTelegramCalls).toHaveLength(1);
            const deps = createSendToTelegramCalls[0][0];
            expect(deps).toHaveProperty('db');
            expect(deps).toHaveProperty('splitEpisode');
            expect(deps.db).toBe(mockDb);
        });

        it('does NOT auto-start cron or main() when required from a test (require.main guard)', () => {
            // If the guard were missing, jest's require would have triggered either
            // main() or mainCron.start() at module load — easily visible via spy.
            expect(cronInstance.start).not.toHaveBeenCalled();
            expect(mockDb.getRssList).not.toHaveBeenCalled();
        });

        it('cron callback invokes main() and attaches .catch(logError) for uncaught rejections', async () => {
            const cronCallback = cronJobCalls[0][1];
            // Stub main indirectly via mockDb to verify the callback actually runs main.
            mockDb.getRssList.mockRejectedValue(new Error('cron-tick DB error'));

            // Callback is synchronous-looking but invokes main().catch(...) — fire it.
            cronCallback();
            // Give the catch a microtask to run
            await new Promise(resolve => setImmediate(resolve));

            expect(mockDb.getRssList).toHaveBeenCalled();
            // The .catch(logError) path logged the error — no uncaught rejection.
            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('main', () => {
        it('processes every rss source returned by getRssList', async () => {
            mockDb.getRssList.mockResolvedValue([
                { id: 1, url: 'https://a/feed.xml', channel: '@a', nombre: 'A' },
                { id: 2, url: 'https://b/feed.xml', channel: '@b', nombre: 'B' }
            ]);
            helpers.getFeed.mockResolvedValue({ items: [], title: 'Feed' });

            await main();

            expect(mockDb.getRssList).toHaveBeenCalledTimes(1);
            expect(helpers.getFeed).toHaveBeenCalledTimes(2);
            expect(helpers.getFeed).toHaveBeenNthCalledWith(1, 'https://a/feed.xml');
            expect(helpers.getFeed).toHaveBeenNthCalledWith(2, 'https://b/feed.xml');
        });

        it('pauses 1000ms between sources to ease outbound rate limiting', async () => {
            mockDb.getRssList.mockResolvedValue([
                { id: 1, url: 'u1', channel: '@a', nombre: 'A' },
                { id: 2, url: 'u2', channel: '@b', nombre: 'B' }
            ]);
            helpers.getFeed.mockResolvedValue({ items: [], title: 'T' });

            await main();

            expect(helpers.pause).toHaveBeenCalledTimes(2);
            expect(helpers.pause).toHaveBeenCalledWith(1000);
        });

        it('cleans downloads in the finally block on the happy path', async () => {
            mockDb.getRssList.mockResolvedValue([]);

            await main();

            expect(helpers.cleanDownloads).toHaveBeenCalledTimes(1);
            expect(helpers.cleanDownloads).toHaveBeenCalledWith('./downloads/');
        });

        it('cleans downloads even when getRssList fails — does not rethrow', async () => {
            mockDb.getRssList.mockRejectedValue(new Error('DB unreachable'));

            await expect(main()).resolves.toBeUndefined();

            expect(helpers.cleanDownloads).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalled();
        });

        it('cleans downloads even when a feed fetch throws inside the iteration', async () => {
            mockDb.getRssList.mockResolvedValue([
                { id: 1, url: 'https://broken', channel: '@a', nombre: 'A' }
            ]);
            helpers.getFeed.mockRejectedValue(new Error('feed timeout'));

            await expect(main()).resolves.toBeUndefined();

            expect(helpers.cleanDownloads).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalled();
        });

        it('handles an empty rss source list without iterating', async () => {
            mockDb.getRssList.mockResolvedValue([]);

            await main();

            expect(helpers.getFeed).not.toHaveBeenCalled();
            expect(helpers.pause).not.toHaveBeenCalled();
            expect(processItemModule.processItem).not.toHaveBeenCalled();
        });
    });

    describe('processFeed', () => {
        it('annotates each feed item with the source channel and channelId', async () => {
            helpers.getFeed.mockResolvedValue({
                title: 'My Podcast',
                items: [
                    { link: 'https://x/ep1.mp3', title: 'Ep 1', content: 'desc1' },
                    { link: 'https://x/ep2.mp3', title: 'Ep 2', content: 'desc2' }
                ]
            });

            await processFeed({ id: 7, url: 'https://x/feed', channel: '@chan', nombre: 'MP' });

            expect(processItemModule.processItem).toHaveBeenCalledTimes(2);
            const firstItem = processItemModule.processItem.mock.calls[0][0];
            const secondItem = processItemModule.processItem.mock.calls[1][0];
            expect(firstItem.channel).toBe('@chan');
            expect(firstItem.channelId).toBe(7);
            expect(secondItem.channel).toBe('@chan');
            expect(secondItem.channelId).toBe(7);
        });

        it('passes the feed title as the second argument to processItem', async () => {
            helpers.getFeed.mockResolvedValue({
                title: 'Podcast Title Here',
                items: [{ link: 'https://x/1.mp3', title: 't', content: 'c' }]
            });

            await processFeed({ id: 1, url: 'u', channel: '@c', nombre: 'n' });

            expect(processItemModule.processItem.mock.calls[0][1]).toBe('Podcast Title Here');
        });

        it('passes injected deps { db, sendToTelegram } as the third argument to processItem', async () => {
            helpers.getFeed.mockResolvedValue({
                title: 'T',
                items: [{ link: 'https://x/1.mp3', title: 't', content: 'c' }]
            });

            await processFeed({ id: 1, url: 'u', channel: '@c', nombre: 'n' });

            const deps = processItemModule.processItem.mock.calls[0][2];
            expect(deps.db).toBe(mockDb);
            expect(deps.sendToTelegram).toBe(sendToTelegramFn);
        });

        it('processes feed items sequentially (awaits each processItem before starting the next)', async () => {
            const callOrder = [];
            processItemModule.processItem.mockImplementation(async (item) => {
                callOrder.push(`start:${item.title}`);
                await new Promise(resolve => setImmediate(resolve));
                callOrder.push(`end:${item.title}`);
            });

            helpers.getFeed.mockResolvedValue({
                title: 'T',
                items: [
                    { link: 'a.mp3', title: 'A', content: 'c' },
                    { link: 'b.mp3', title: 'B', content: 'c' }
                ]
            });

            await processFeed({ id: 1, url: 'u', channel: '@c', nombre: 'n' });

            expect(callOrder).toEqual(['start:A', 'end:A', 'start:B', 'end:B']);
        });

        it('propagates getFeed rejections to the caller (main catches them)', async () => {
            helpers.getFeed.mockRejectedValue(new Error('RSS parse error'));

            await expect(processFeed({ id: 1, url: 'u', channel: '@c', nombre: 'n' }))
                .rejects.toThrow('RSS parse error');

            expect(processItemModule.processItem).not.toHaveBeenCalled();
        });
    });
});
