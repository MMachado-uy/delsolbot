const { processItem } = require('./process-item');

describe('lib/process-item', () => {
    let db;
    let sendToTelegram;
    let logSpy;
    let errorSpy;

    /**
     * Factory for a realistic RSS item shape. The item.link ends in .mp3 so
     * getIdFromItem produces a predictable id.
     * @param {Partial<{link: string, channel: string, channelId: number, title: string}>} overrides
     * @returns {object}
     */
    const makeItem = (overrides = {}) => ({
        link: 'https://example.com/ep/123.mp3',
        channel: '@current',
        channelId: 1,
        title: 'Episode 123',
        content: 'Description',
        itunes: { image: 'https://example.com/cover.jpg' },
        ...overrides
    });

    /**
     * Factory for a stored podcasts row as returned by db.getPodcastById.
     * @param {Partial<{channel: string, pudo_subir: number | boolean, file_id: string}>} overrides
     * @returns {object}
     */
    const makeStoredRow = (overrides = {}) => ({
        id: 1,
        archivo: '123',
        obs: '',
        pudo_subir: 1,
        fecha_procesado: '2026-04-21 12:00:00',
        file_id: 'FID-xyz',
        channel: '@some',
        ...overrides
    });

    beforeEach(() => {
        db = { getPodcastById: jest.fn() };
        sendToTelegram = jest.fn().mockResolvedValue(undefined);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    describe('fresh upload path — stored is empty', () => {
        it('calls sendToTelegram(item, title) when no prior row exists', async () => {
            db.getPodcastById.mockResolvedValue([]);
            const item = makeItem();

            await processItem(item, 'Podcast Title', { db, sendToTelegram });

            expect(sendToTelegram).toHaveBeenCalledWith(item, 'Podcast Title');
            expect(sendToTelegram).toHaveBeenCalledTimes(1);
        });

        it('does NOT set forwardFiles on the item when no prior uploads exist', async () => {
            db.getPodcastById.mockResolvedValue([]);
            const item = makeItem();

            await processItem(item, 'Podcast Title', { db, sendToTelegram });

            expect(item.forwardFiles).toBeUndefined();
        });
    });

    describe('skip path — already uploaded to this channel', () => {
        it('does NOT call sendToTelegram when a successful row exists for the same channel', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 1, file_id: 'FID-same-channel' })
            ]);

            await processItem(makeItem(), 'Podcast Title', { db, sendToTelegram });

            expect(sendToTelegram).not.toHaveBeenCalled();
        });

        it('treats pudo_subir=1 as a truthy success flag (mysql bit storage)', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 1, file_id: 'F' })
            ]);

            await processItem(makeItem(), 'T', { db, sendToTelegram });
            expect(sendToTelegram).not.toHaveBeenCalled();
        });

    });

    describe('retry path — prior attempts failed on this channel (Defect #2 fix)', () => {
        it('retries when a single pudo_subir=0 row exists for this channel (1/3 used)', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' })
            ]);

            await processItem(makeItem(), 'T', { db, sendToTelegram });
            expect(sendToTelegram).toHaveBeenCalledTimes(1);
        });

        it('retries when a single row with empty file_id exists for this channel', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 1, file_id: '' })
            ]);

            await processItem(makeItem(), 'T', { db, sendToTelegram });
            expect(sendToTelegram).toHaveBeenCalledTimes(1);
        });

        it('retries when 2 prior failures exist (within 3-attempt budget)', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' })
            ]);

            await processItem(makeItem(), 'T', { db, sendToTelegram });
            expect(sendToTelegram).toHaveBeenCalledTimes(1);
        });

        it('does NOT retry when 3 prior failures exist on this channel (budget exhausted)', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' })
            ]);

            await processItem(makeItem(), 'T', { db, sendToTelegram });
            expect(sendToTelegram).not.toHaveBeenCalled();
        });

        it('does NOT retry when 4+ prior failures exist on this channel', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' })
            ]);

            await processItem(makeItem(), 'T', { db, sendToTelegram });
            expect(sendToTelegram).not.toHaveBeenCalled();
        });

        it('counts failures only for THIS channel (other-channel rows do not consume budget)', async () => {
            // 2 failures on @current + 2 failures on @other → only @current count matters
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@other', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@other', pudo_subir: 0, file_id: '' })
            ]);

            await processItem(makeItem(), 'T', { db, sendToTelegram });
            expect(sendToTelegram).toHaveBeenCalledTimes(1);
        });

        it('logs an observable abandonment message when budget is exhausted', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' }),
                makeStoredRow({ channel: '@current', pudo_subir: 0, file_id: '' })
            ]);

            await processItem(makeItem(), 'T', { db, sendToTelegram });

            // A single observable log line that ops/maintainer can grep for.
            const allLogOutput = errorSpy.mock.calls.flat().concat(logSpy.mock.calls.flat()).join(' ');
            expect(allLogOutput).toMatch(/retry budget exhausted|abandon/iu);
        });
    });

    describe('forward path — uploaded to another channel', () => {
        it('sets item.forwardFiles to all successful file_ids from OTHER channels', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@other-a', file_id: 'FID-A' }),
                makeStoredRow({ channel: '@other-b', file_id: 'FID-B' })
            ]);
            const item = makeItem({ channel: '@current' });

            await processItem(item, 'T', { db, sendToTelegram });

            expect(item.forwardFiles).toEqual(['FID-A', 'FID-B']);
            expect(sendToTelegram).toHaveBeenCalledWith(item, 'T');
        });

        it('excludes rows from the forward list when pudo_subir is falsy', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@other', pudo_subir: 1, file_id: 'FID-good' }),
                makeStoredRow({ channel: '@other', pudo_subir: 0, file_id: 'FID-failed' })
            ]);
            const item = makeItem();

            await processItem(item, 'T', { db, sendToTelegram });

            expect(item.forwardFiles).toEqual(['FID-good']);
        });

        it('excludes rows with empty file_id from the forward list', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@other', file_id: 'FID-real' }),
                makeStoredRow({ channel: '@other-empty', file_id: '' })
            ]);
            const item = makeItem();

            await processItem(item, 'T', { db, sendToTelegram });

            expect(item.forwardFiles).toEqual(['FID-real']);
        });

        it('skip takes precedence over forward when BOTH same-channel and other-channel rows exist', async () => {
            db.getPodcastById.mockResolvedValue([
                makeStoredRow({ channel: '@current', file_id: 'FID-here' }),
                makeStoredRow({ channel: '@other', file_id: 'FID-elsewhere' })
            ]);
            const item = makeItem({ channel: '@current' });

            await processItem(item, 'T', { db, sendToTelegram });

            expect(sendToTelegram).not.toHaveBeenCalled();
            expect(item.forwardFiles).toBeUndefined();
        });
    });

    describe('error handling — swallowed, never throws', () => {
        it('catches db.getPodcastById rejection and logs it without rethrowing', async () => {
            db.getPodcastById.mockRejectedValue(new Error('MySQL connection lost'));

            await expect(processItem(makeItem(), 'T', { db, sendToTelegram })).resolves.toBeUndefined();

            expect(errorSpy).toHaveBeenCalled();
            expect(sendToTelegram).not.toHaveBeenCalled();
        });

        it('catches sendToTelegram rejection and logs it without rethrowing', async () => {
            db.getPodcastById.mockResolvedValue([]);
            sendToTelegram.mockRejectedValue(new Error('Telegram 500'));

            await expect(processItem(makeItem(), 'T', { db, sendToTelegram })).resolves.toBeUndefined();

            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('CHARACTERIZATION OF PRODUCTION DEFECTS', () => {
        // These tests pin current (defective) behavior so future fixes change
        // these assertions deliberately, not accidentally.
        //
        // Discovery from this characterization exercise: the two defects named
        // in the PRD turn out to arise from disjoint DB states at the start
        // of the next cron tick. The mapping below is the honest attribution,
        // which differs from the PRD's initial framing.

        describe('Defect #1 — Duplicate re-upload', () => {
            // Trigger: at cron tick N, sendToTelegram posts to Telegram (succeeds)
            // but BOTH the success INSERT and the fallback-on-error INSERT fail
            // (double failure). At cron tick N+1, stored is empty, and
            // processItem calls sendToTelegram again. Subscriber sees a dupe.
            //
            // Requires a full DB-write failure, not just the success INSERT
            // failing — otherwise Defect #2 applies instead (see below).

            it('when the prior tick left no DB row at all (both INSERTs failed), re-calls sendToTelegram', async () => {
                db.getPodcastById.mockResolvedValue([]);

                await processItem(makeItem(), 'T', { db, sendToTelegram });

                expect(sendToTelegram).toHaveBeenCalledTimes(1);
            });
        });

        // Defect #2 (missed episode from a single-or-few prior failures) is now
        // FIXED via the retry-with-budget logic in the "retry path" describe
        // block above. The remaining abandonment case — budget exhausted after
        // 3+ failures — is deliberate and covered by those tests. This is an
        // intentional product behavior: permanently-broken items should not
        // hammer Telegram every cron tick forever.
    });
});
