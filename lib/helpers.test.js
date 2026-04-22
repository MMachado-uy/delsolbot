jest.mock('axios', () => {
    const mockGet = jest.fn();
    return {
        default: { get: mockGet },
        get: mockGet
    };
});

jest.mock('rss-parser', () => {
    return jest.fn().mockImplementation(() => ({
        parseURL: jest.fn()
    }));
});

const EventEmitter = require('events');
const fs = require('fs');
const Path = require('path');
const axios = require('axios');
const Parser = require('rss-parser');

const {
    cleanDownloads,
    debug,
    getFeed,
    getFileSizeInMB,
    getIdFromItem,
    getMedia,
    getTimestamp,
    log,
    logError,
    pathToTitle,
    pause,
    sanitizeContent,
    sanitizeEpisode,
    sanitizeFilename
} = require('./helpers');

describe('lib/helpers', () => {
    describe('pathToTitle', () => {
        it('strips directory and .mp3 extension', () => {
            expect(pathToTitle('/tmp/foo/bar_baz.mp3')).toBe('bar baz');
        });

        it('replaces all underscores with spaces', () => {
            expect(pathToTitle('a_b_c_d.mp3')).toBe('a b c d');
        });

        it('handles paths with no directory', () => {
            expect(pathToTitle('just_a_file.mp3')).toBe('just a file');
        });

        it('leaves non-.mp3 extensions intact', () => {
            expect(pathToTitle('bar.txt')).toBe('bar.txt');
        });

        it('returns empty string for empty input', () => {
            expect(pathToTitle('')).toBe('');
        });
    });

    describe('getIdFromItem', () => {
        // Golden-file tests — these episode id derivations are load-bearing.
        // DB rows from 6 years of production depend on this exact derivation.
        // Changing any of these asserted outputs requires a DB migration plan.
        const goldenCases = [
            {
                name: 'simple podcast URL with .mp3',
                link: 'https://radiodelsol.com.uy/podcasts/aguante/2026-04-21-ep123.mp3',
                id: '2026-04-21-ep123'
            },
            {
                name: 'URL without .mp3 extension',
                link: 'https://example.com/podcast/episode-42',
                id: 'episode-42'
            },
            {
                name: 'URL with query string (query becomes part of id)',
                link: 'https://cdn.example.com/audio/show.mp3?token=abc',
                id: 'show?token=abc'
            },
            {
                name: 'URL with fragment (fragment becomes part of id)',
                link: 'https://example.com/file.mp3#chapter-1',
                id: 'file#chapter-1'
            },
            {
                name: 'URL with trailing slash produces empty id',
                link: 'https://example.com/podcast/',
                id: ''
            },
            {
                name: 'filename-only id with numeric pattern',
                link: 'https://host/20260421.mp3',
                id: '20260421'
            }
        ];

        goldenCases.forEach(({ name, link, id }) => {
            it(name, () => {
                expect(getIdFromItem({ link })).toBe(id);
            });
        });

        it('only strips the first .mp3 occurrence (not subsequent)', () => {
            expect(getIdFromItem({ link: 'https://x/a.mp3.mp3' })).toBe('a.mp3');
        });
    });

    describe('sanitizeEpisode', () => {
        it('strips accents from Spanish characters', () => {
            expect(sanitizeEpisode('áéíóúñ')).toBe('aeioun');
        });

        it('removes question marks (Spanish opening and closing)', () => {
            expect(sanitizeEpisode('¿Cómo estás?')).toBe('Como_estas');
        });

        it('replaces spaces with underscores', () => {
            expect(sanitizeEpisode('hola mundo')).toBe('hola_mundo');
        });

        it('replaces forward slashes with hyphens', () => {
            expect(sanitizeEpisode('a/b/c')).toBe('a-b-c');
        });

        it('removes colons', () => {
            expect(sanitizeEpisode('Titulo: subtitulo')).toBe('Titulo_subtitulo');
        });

        it('removes straight double quotes', () => {
            expect(sanitizeEpisode('"quoted"')).toBe('quoted');
        });

        it('removes straight single quotes', () => {
            expect(sanitizeEpisode("it's a test")).toBe('its_a_test');
        });

        it('converts leading/trailing spaces to underscores before trim (trim is effectively dead for spaced input)', () => {
            // Space-to-underscore runs before .trim(); trim only catches tabs/newlines.
            expect(sanitizeEpisode('  hola  ')).toBe('__hola__');
        });

        it('trims leading/trailing tabs and newlines (which survive the space replacement)', () => {
            expect(sanitizeEpisode('\t\nhola\t\n')).toBe('hola');
        });

        it('chains all replacements together on a realistic title', () => {
            expect(sanitizeEpisode('¿Qué pasó en la Música? 2026/04/21'))
                .toBe('Que_paso_en_la_Musica_2026-04-21');
        });
    });

    describe('sanitizeFilename', () => {
        it('strips accents', () => {
            expect(sanitizeFilename('Música')).toBe('Musica');
        });

        it('replaces spaces with underscores', () => {
            expect(sanitizeFilename('hola mundo')).toBe('hola_mundo');
        });

        it('removes characters outside [a-zA-Z0-9_-]', () => {
            expect(sanitizeFilename('a.b!c@d#e')).toBe('abcde');
        });

        it('preserves underscores', () => {
            expect(sanitizeFilename('foo_bar')).toBe('foo_bar');
        });

        it('preserves hyphens', () => {
            expect(sanitizeFilename('foo-bar')).toBe('foo-bar');
        });

        it('preserves digits', () => {
            expect(sanitizeFilename('file123')).toBe('file123');
        });

        it('chains all replacements on a realistic channel name', () => {
            expect(sanitizeFilename('Aguante los Pibes!')).toBe('Aguante_los_Pibes');
        });
    });

    describe('sanitizeContent', () => {
        it('escapes ampersand', () => {
            expect(sanitizeContent('a & b')).toContain('&amp;');
        });

        it('escapes less-than and greater-than', () => {
            expect(sanitizeContent('<p>')).toContain('&lt;');
            expect(sanitizeContent('<p>')).toContain('&gt;');
        });

        it('double-escapes double quotes — " → &quot; → &amp;quot; because & replacement runs after "', () => {
            // Characterization of current behavior: replacement order is " first, & second,
            // so the & inside &quot; gets re-escaped. This is load-bearing in Telegram
            // captions that round-trip through this function; do not "fix" without a migration.
            expect(sanitizeContent('"hello"')).toBe('&amp;quot;hello&amp;quot;');
        });

        it('removes single quotes entirely', () => {
            expect(sanitizeContent("it's")).not.toContain("'");
        });

        it('replaces spaces with underscores', () => {
            expect(sanitizeContent('hello world')).toBe('hello_world');
        });

        it('strips accented vowels', () => {
            expect(sanitizeContent('café música')).toBe('cafe_musica');
        });

        it('coerces non-string input via JSON.stringify', () => {
            expect(sanitizeContent(42)).toBe('42');
        });

        it('coerces objects via JSON.stringify and then applies the double-escape chain', () => {
            // JSON.stringify({a: 1}) === '{"a":1}'; each " becomes &quot; then each & becomes &amp;
            expect(sanitizeContent({ a: 1 })).toBe('{&amp;quot;a&amp;quot;:1}');
        });

        it('chains HTML escape, accent strip, and space replacement in order', () => {
            expect(sanitizeContent('Café & té')).toBe('Cafe_&amp;_te');
        });
    });

    describe('getTimestamp', () => {
        // Luxon's ZZZZ token emits a short zone name like 'GMT-3' or 'UTC' or 'EST',
        // not a numeric offset. Format is timezone-dependent; we only characterize the
        // date-time prefix and that the zone suffix is non-empty.
        const dateTimePrefix = /^\d{8}-\d{2}:\d{2}:\d{2}/u;
        const zoneSuffix = /^\d{8}-\d{2}:\d{2}:\d{2}.+$/u;

        it('begins with yyyyMMdd-HH:mm:ss', () => {
            expect(getTimestamp()).toMatch(dateTimePrefix);
        });

        it('has a non-empty zone suffix after the seconds', () => {
            expect(getTimestamp()).toMatch(zoneSuffix);
        });

        it('returns a string', () => {
            expect(typeof getTimestamp()).toBe('string');
        });

        it('reflects the current moment (two calls are monotonically non-decreasing)', () => {
            const first = getTimestamp();
            const second = getTimestamp();
            // Lexicographic comparison works because yyyyMMdd-HH:mm:ss prefix is sortable
            expect(second >= first).toBe(true);
        });
    });

    describe('pause', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('resolves only after the specified timeout elapses', async () => {
            const promise = pause(1000);
            let resolved = false;
            promise.then(() => { resolved = true; });

            // Advance by less than the timeout — should not have resolved
            jest.advanceTimersByTime(500);
            await Promise.resolve();
            expect(resolved).toBe(false);

            // Advance the remainder — should resolve
            jest.advanceTimersByTime(500);
            await Promise.resolve();
            expect(resolved).toBe(true);
        });

        it('resolves with undefined (no value passed)', async () => {
            const promise = pause(10);
            jest.advanceTimersByTime(10);
            await expect(promise).resolves.toBeUndefined();
        });
    });

    describe('getFileSizeInMB', () => {
        it('returns the file size divided by 1024 * 1024', () => {
            const spy = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 2 * 1024 * 1024 });
            expect(getFileSizeInMB('/tmp/anyfile')).toBe(2);
            expect(spy).toHaveBeenCalledWith('/tmp/anyfile');
            spy.mockRestore();
        });

        it('returns a fractional MB for sub-megabyte files', () => {
            const spy = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 524288 });
            expect(getFileSizeInMB('/tmp/half-mb')).toBe(0.5);
            spy.mockRestore();
        });

        it('rethrows errors from fs.statSync after logging', () => {
            const spy = jest.spyOn(fs, 'statSync').mockImplementation(() => {
                throw new Error('ENOENT');
            });
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

            expect(() => getFileSizeInMB('/missing')).toThrow('ENOENT');
            expect(errorSpy).toHaveBeenCalled();

            spy.mockRestore();
            errorSpy.mockRestore();
        });
    });

    describe('log and logError', () => {
        it('log prints a timestamp prefix and the arguments to console.log', () => {
            const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
            log('hello', 'world');
            expect(spy).toHaveBeenCalledTimes(1);

            const [prefix, ...rest] = spy.mock.calls[0];
            expect(prefix).toMatch(/^\[\d{8}-\d{2}:\d{2}:\d{2}.+\]$/u);
            expect(rest).toEqual(['hello', 'world']);

            spy.mockRestore();
        });

        it('logError prints a timestamp prefix and the arguments to console.error', () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            logError('boom', new Error('x'));
            expect(spy).toHaveBeenCalledTimes(1);

            const [prefix, ...rest] = spy.mock.calls[0];
            expect(prefix).toMatch(/^\[\d{8}-\d{2}:\d{2}:\d{2}.+\]$/u);
            expect(rest[0]).toBe('boom');
            expect(rest[1]).toBeInstanceOf(Error);

            spy.mockRestore();
        });
    });

    describe('debug', () => {
        // DEBUG is a module-load-time constant: const DEBUG = !!+process.env.DEBUG
        // Our default Jest run has DEBUG unset, so the imported `debug` is a no-op.
        // To test the enabled path we re-require the module with DEBUG set, via jest.isolateModules.

        it('does NOT call console.log when DEBUG is unset/falsy at module load', () => {
            // helpers.js calls `require('dotenv').config()` at top, which repopulates
            // process.env.DEBUG from the .env file on every (re-)require. To force the
            // falsy path deterministically, mock dotenv to a no-op and delete the env
            // var inside an isolated module scope.
            const originalDebug = process.env.DEBUG;
            const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
            try {
                jest.isolateModules(() => {
                    jest.doMock('dotenv', () => ({ config: jest.fn() }));
                    delete process.env.DEBUG;
                    const reloaded = require('./helpers');
                    reloaded.debug('should be silent');
                });
                expect(spy).not.toHaveBeenCalled();
            } finally {
                process.env.DEBUG = originalDebug;
                spy.mockRestore();
            }
        });

        it('DOES call console.log when DEBUG=1 at module load (via isolateModules)', () => {
            const originalDebug = process.env.DEBUG;
            const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
            try {
                process.env.DEBUG = '1';
                jest.isolateModules(() => {
                    const reloaded = require('./helpers');
                    reloaded.debug('visible');
                });
                expect(spy).toHaveBeenCalled();
                const [prefix, message] = spy.mock.calls[0];
                expect(prefix).toMatch(/^\[.+\]$/u);
                expect(message).toBe('visible');
            } finally {
                process.env.DEBUG = originalDebug;
                spy.mockRestore();
            }
        });
    });

    describe('cleanDownloads', () => {
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

        it('calls fs.promises.rm for each entry returned by readdir', async () => {
            const readdirSpy = jest.spyOn(fs.promises, 'readdir')
                .mockResolvedValue([{ name: 'a' }, { name: 'b' }]);
            const rmSpy = jest.spyOn(fs.promises, 'rm')
                .mockResolvedValue(undefined);

            await cleanDownloads('/downloads');

            expect(readdirSpy).toHaveBeenCalledWith('/downloads', { withFileTypes: true });
            expect(rmSpy).toHaveBeenCalledTimes(2);
            expect(rmSpy).toHaveBeenNthCalledWith(1, Path.join('/downloads', 'a'), { recursive: true, force: true });
            expect(rmSpy).toHaveBeenNthCalledWith(2, Path.join('/downloads', 'b'), { recursive: true, force: true });

            readdirSpy.mockRestore();
            rmSpy.mockRestore();
        });

        it('resolves without throwing when the directory does not exist (ENOENT)', async () => {
            const readdirSpy = jest.spyOn(fs.promises, 'readdir')
                .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

            await expect(cleanDownloads('/missing')).resolves.toBeUndefined();
            expect(errorSpy).toHaveBeenCalled();

            readdirSpy.mockRestore();
        });

        it('logs "Downloads cleared!" on the successful path', async () => {
            const readdirSpy = jest.spyOn(fs.promises, 'readdir').mockResolvedValue([]);

            await cleanDownloads('/empty');
            // First log is "Cleaning downloads", last is "Downloads cleared!"
            const lastCallMessage = logSpy.mock.calls[logSpy.mock.calls.length - 1][1];
            expect(lastCallMessage).toBe('Downloads cleared!');

            readdirSpy.mockRestore();
        });
    });

    describe('getFeed', () => {
        it('constructs a new Parser and calls parseURL with the given URI', async () => {
            const parseURL = jest.fn().mockResolvedValue({ items: [{ title: 'x' }] });
            Parser.mockImplementation(() => ({ parseURL }));

            const result = await getFeed('https://example.com/feed.xml');

            expect(Parser).toHaveBeenCalled();
            expect(parseURL).toHaveBeenCalledWith('https://example.com/feed.xml');
            expect(result).toEqual({ items: [{ title: 'x' }] });
        });

        it('propagates parseURL rejections', async () => {
            const parseURL = jest.fn().mockRejectedValue(new Error('feed unreachable'));
            Parser.mockImplementation(() => ({ parseURL }));

            await expect(getFeed('https://bad.example/feed')).rejects.toThrow('feed unreachable');
        });
    });

    describe('getMedia', () => {
        /**
         * Factory for a minimal stream-like test double implementing the subset
         * of the interface getMedia touches: .pipe(), .on(), .destroy().
         * @returns {EventEmitter & { pipe: jest.Mock, destroy: jest.Mock }}
         */
        const makeMockStream = () => {
            const emitter = new EventEmitter();
            emitter.pipe = jest.fn().mockImplementation(dest => dest);
            emitter.destroy = jest.fn();

            return emitter;
        };

        it('resolves with the resolved path when the write stream emits "finish"', async () => {
            const writeStream = makeMockStream();
            const dataStream = makeMockStream();

            const createWriteStreamSpy = jest.spyOn(fs, 'createWriteStream')
                .mockReturnValue(writeStream);
            axios.default.get.mockResolvedValue({ data: dataStream });

            const promise = getMedia('https://media/foo.mp3', '/tmp/foo.mp3');

            // Give the microtask queue a chance to resolve the axios.get await
            await new Promise(setImmediate);

            writeStream.emit('finish');
            await expect(promise).resolves.toBe(Path.resolve('/tmp/foo.mp3'));
            expect(dataStream.pipe).toHaveBeenCalledWith(writeStream);

            createWriteStreamSpy.mockRestore();
        });

        it('rejects and destroys the write stream when the write stream emits "error"', async () => {
            const writeStream = makeMockStream();
            const dataStream = makeMockStream();

            const createWriteStreamSpy = jest.spyOn(fs, 'createWriteStream')
                .mockReturnValue(writeStream);
            axios.default.get.mockResolvedValue({ data: dataStream });

            const promise = getMedia('https://media/bar.mp3', '/tmp/bar.mp3');

            await new Promise(setImmediate);

            const err = new Error('disk full');
            writeStream.emit('error', err);
            await expect(promise).rejects.toThrow('disk full');
            expect(writeStream.destroy).toHaveBeenCalled();

            createWriteStreamSpy.mockRestore();
        });

        it('rejects and destroys the write stream when axios.get fails before piping', async () => {
            const writeStream = makeMockStream();
            const createWriteStreamSpy = jest.spyOn(fs, 'createWriteStream')
                .mockReturnValue(writeStream);
            axios.default.get.mockRejectedValue(new Error('network unreachable'));

            await expect(getMedia('https://bad/x.mp3', '/tmp/x.mp3'))
                .rejects.toThrow('network unreachable');
            expect(writeStream.destroy).toHaveBeenCalled();

            createWriteStreamSpy.mockRestore();
        });
    });
});
