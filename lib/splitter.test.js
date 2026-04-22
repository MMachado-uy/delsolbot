jest.mock('fluent-ffmpeg', () => {
    const EventEmitter = require('events');

    const pendingConfigs = [];
    const instances = [];

    /**
     * Build a chainable ffmpeg-like test double. Every chaining method returns
     * the same instance; `on` registers via EventEmitter; `run` emits queued
     * stderr lines followed by the configured end/error event.
     * @param {{stderrLines: string[], result: string | {error: Error}}} config
     * @returns {EventEmitter & Record<string, jest.Mock>}
     */
    const makeInstance = (config) => {
        const instance = new EventEmitter();
        instance.__stderrLines = config.stderrLines;
        instance.__result = config.result;
        instance.audioFilter = jest.fn().mockReturnValue(instance);
        instance.format = jest.fn().mockReturnValue(instance);
        instance.output = jest.fn().mockReturnValue(instance);
        instance.audioCodec = jest.fn().mockReturnValue(instance);
        instance.setStartTime = jest.fn().mockReturnValue(instance);
        instance.setDuration = jest.fn().mockReturnValue(instance);
        instance.run = jest.fn(() => {
            for (const line of instance.__stderrLines) {
                instance.emit('stderr', line);
            }
            if (instance.__result === 'end') {
                instance.emit('end');
            } else if (instance.__result && instance.__result.error) {
                instance.emit('error', instance.__result.error);
            }
        });

        return instance;
    };

    const factory = jest.fn((filePath) => {
        const config = pendingConfigs.shift() || { stderrLines: [], result: 'end' };
        const instance = makeInstance(config);
        instance.filePath = filePath;
        instances.push(instance);

        return instance;
    });
    factory.ffprobe = jest.fn();

    factory.__instances = instances;
    factory.__pendingConfigs = pendingConfigs;
    factory.__reset = () => {
        instances.length = 0;
        pendingConfigs.length = 0;
    };
    factory.__queueInstance = (stderrLines, result) => {
        pendingConfigs.push({ stderrLines, result });
    };

    return factory;
});

const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { splitEpisode } = require('./splitter');

const FIFTY_ONE_MB = 51 * 1024 * 1024;
const TEN_MB = 10 * 1024 * 1024;
const TWO_HUNDRED_MB = 200 * 1024 * 1024;
const ONE_MB = 1024 * 1024;

describe('lib/splitter', () => {
    let statSyncSpy;
    let logSpy;
    let errorSpy;

    beforeEach(() => {
        ffmpeg.__reset();
        ffmpeg.mockClear();
        ffmpeg.ffprobe.mockReset();
        statSyncSpy = jest.spyOn(fs, 'statSync');
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        statSyncSpy.mockRestore();
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    describe('splitEpisode', () => {
        describe('under-threshold files', () => {
            it('returns [filePath] unchanged when file size ≤ 50MB (threshold)', async () => {
                statSyncSpy.mockReturnValue({ size: TEN_MB });

                const result = await splitEpisode('/tmp/show.mp3', 'show');

                expect(result).toEqual(['/tmp/show.mp3']);
                expect(ffmpeg).not.toHaveBeenCalled();
                expect(ffmpeg.ffprobe).not.toHaveBeenCalled();
            });

            it('returns [filePath] when size is exactly at 50MB threshold', async () => {
                statSyncSpy.mockReturnValue({ size: 50 * 1024 * 1024 });

                const result = await splitEpisode('/tmp/edge.mp3', 'edge');

                expect(result).toEqual(['/tmp/edge.mp3']);
            });

            it('uses default outputBase="output" when second arg omitted', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: FIFTY_ONE_MB + ONE_MB })
                    .mockReturnValue({ size: 25 * 1024 * 1024 });
                ffmpeg.ffprobe.mockImplementation((_f, cb) => cb(null, { format: { duration: 600 } }));
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');

                const result = await splitEpisode('/tmp/unnamed.mp3');

                expect(result).toEqual([
                    '/tmp/output_(parte_1).mp3',
                    '/tmp/output_(parte_2).mp3'
                ]);
            });
        });

        describe('over-threshold files — split path', () => {
            /**
             * Queue ffmpeg.ffprobe to resolve with a given duration.
             * @param {number} duration - Duration in seconds.
             */
            const queueDuration = (duration) => {
                ffmpeg.ffprobe.mockImplementation((_filePath, cb) => {
                    cb(null, { format: { duration } });
                });
            };

            it('spawns silencedetect + one split per part, returns part paths', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: 102 * 1024 * 1024 }) // initial: 102MB → 3 parts
                    .mockReturnValue({ size: 30 * 1024 * 1024 }); // per-part size check

                queueDuration(3600);
                ffmpeg.__queueInstance(['silence_start: 1200.5', 'silence_end: 1201.0'], 'end');
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');

                const result = await splitEpisode('/tmp/long.mp3', 'long');

                expect(result).toEqual([
                    '/tmp/long_(parte_1).mp3',
                    '/tmp/long_(parte_2).mp3',
                    '/tmp/long_(parte_3).mp3'
                ]);
                expect(ffmpeg).toHaveBeenCalledTimes(4);
                expect(ffmpeg.ffprobe).toHaveBeenCalledTimes(1);
            });

            it('snaps to silence midpoint when within 10s of the ideal cut', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: FIFTY_ONE_MB + ONE_MB }) // ~52MB → 2 parts
                    .mockReturnValue({ size: 25 * 1024 * 1024 });

                queueDuration(600); // idealPartDuration = 300s
                ffmpeg.__queueInstance([
                    'silence_start: 297.0',
                    'silence_end: 299.0'
                ], 'end');
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');

                await splitEpisode('/tmp/show.mp3', 'show');

                const part2Instance = ffmpeg.__instances[2];
                expect(part2Instance.setStartTime).toHaveBeenCalledWith(298);
            });

            it('falls back to ideal cut when no silence is within 10s', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: FIFTY_ONE_MB + ONE_MB })
                    .mockReturnValue({ size: 25 * 1024 * 1024 });

                queueDuration(600);
                ffmpeg.__queueInstance([
                    'silence_start: 49.0',
                    'silence_end: 51.0',
                    'silence_start: 549.0',
                    'silence_end: 551.0'
                ], 'end');
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');

                await splitEpisode('/tmp/show.mp3', 'show');

                const part2Instance = ffmpeg.__instances[2];
                expect(part2Instance.setStartTime).toHaveBeenCalledWith(300);
            });

            it('propagates ffprobe error as an Error with "Error obteniendo la duración del audio" prefix', async () => {
                statSyncSpy.mockReturnValue({ size: FIFTY_ONE_MB + ONE_MB });
                ffmpeg.ffprobe.mockImplementation((_filePath, cb) => {
                    cb(new Error('probe failed'));
                });

                await expect(splitEpisode('/tmp/x.mp3', 'x'))
                    .rejects.toThrow(/Error obteniendo la duración del audio: probe failed/u);
                expect(errorSpy).toHaveBeenCalled();
            });

            it('propagates silencedetect ffmpeg error', async () => {
                statSyncSpy.mockReturnValue({ size: FIFTY_ONE_MB + ONE_MB });
                queueDuration(600);
                ffmpeg.__queueInstance([], { error: new Error('codec missing') });

                await expect(splitEpisode('/tmp/x.mp3', 'x'))
                    .rejects.toThrow(/Error detectando silencios: codec missing/u);
            });

            it('rejects with "Archivo resultante corrupto" when a part file is under 0.1MB', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: FIFTY_ONE_MB + ONE_MB })
                    .mockReturnValue({ size: 50 * 1024 }); // 0.048MB per part — below corruption threshold

                queueDuration(600);
                ffmpeg.__queueInstance([], 'end'); // silencedetect
                ffmpeg.__queueInstance([], 'end'); // part 1 (will fail size check)

                await expect(splitEpisode('/tmp/x.mp3', 'x'))
                    .rejects.toThrow(/Archivo resultante corrupto/u);
            });

            it('uses audioCodec("copy") on every split output (no re-encoding)', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: FIFTY_ONE_MB + ONE_MB })
                    .mockReturnValue({ size: 25 * 1024 * 1024 });
                queueDuration(600);
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');

                await splitEpisode('/tmp/x.mp3', 'x');

                expect(ffmpeg.__instances[1].audioCodec).toHaveBeenCalledWith('copy');
                expect(ffmpeg.__instances[2].audioCodec).toHaveBeenCalledWith('copy');
            });

            it('silencedetect pass uses audioFilter(silencedetect=n=-30dB:d=0.5), format("null"), output("-")', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: FIFTY_ONE_MB + ONE_MB })
                    .mockReturnValue({ size: 25 * 1024 * 1024 });
                queueDuration(600);
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');

                await splitEpisode('/tmp/x.mp3', 'x');

                expect(ffmpeg.__instances[0].audioFilter).toHaveBeenCalledWith('silencedetect=n=-30dB:d=0.5');
                expect(ffmpeg.__instances[0].format).toHaveBeenCalledWith('null');
                expect(ffmpeg.__instances[0].output).toHaveBeenCalledWith('-');
            });

            it('propagates a splitPart ffmpeg error', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: FIFTY_ONE_MB + ONE_MB })
                    .mockReturnValue({ size: 25 * 1024 * 1024 });
                queueDuration(600);
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], { error: new Error('encoding lost') });

                await expect(splitEpisode('/tmp/x.mp3', 'x'))
                    .rejects.toThrow('encoding lost');
            });

            it('first part starts at 0 (no setStartTime guard); last part has no end (setDuration not called)', async () => {
                statSyncSpy
                    .mockReturnValueOnce({ size: FIFTY_ONE_MB + ONE_MB })
                    .mockReturnValue({ size: 25 * 1024 * 1024 });
                queueDuration(600);
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');
                ffmpeg.__queueInstance([], 'end');

                await splitEpisode('/tmp/x.mp3', 'x');

                // Part 1 (instance 1) starts at 0 but setStartTime IS called because splitter
                // unconditionally calls setStartTime(start) when start !== null — 0 is not null.
                expect(ffmpeg.__instances[1].setStartTime).toHaveBeenCalledWith(0);
                // Part 1 has setDuration (it's not the last part)
                expect(ffmpeg.__instances[1].setDuration).toHaveBeenCalled();
                // Part 2 (last) has no setDuration — end is null
                expect(ffmpeg.__instances[2].setDuration).not.toHaveBeenCalled();
            });
        });
    });
});
