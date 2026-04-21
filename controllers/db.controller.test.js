jest.mock('mysql2/promise', () => {
    const mockPool = { getConnection: jest.fn() };
    return {
        createPool: jest.fn(() => mockPool),
        __mockPool: mockPool
    };
});

const mysql = require('mysql2/promise');
const Db = require('./db.controller');

const { __mockPool: mockPool } = mysql;

// Snapshot module-load-time state BEFORE clearMocks (jest.config.js) wipes it
// for the first test. createPool is invoked exactly once, when db.controller.js
// requires mysql2/promise at the top.
const poolCreationCalls = mysql.createPool.mock.calls.slice();

/**
 * Normalize whitespace in a SQL string so query shape comparisons
 * aren't defeated by template-literal indentation.
 * @param {string} sql - The SQL string to normalize.
 * @returns {string} Single-spaced, trimmed SQL.
 */
const normalizeSql = (sql) => sql.replace(/\s+/gu, ' ').trim();

describe('controllers/db.controller', () => {
    let mockConnection;
    let errorSpy;

    beforeEach(() => {
        mockConnection = {
            execute: jest.fn(),
            release: jest.fn()
        };
        mockPool.getConnection.mockReset().mockResolvedValue(mockConnection);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    describe('pool creation', () => {
        it('creates exactly one pool at module load with expected config shape', () => {
            expect(poolCreationCalls).toHaveLength(1);
            const config = poolCreationCalls[0][0];
            expect(config).toMatchObject({
                connectionLimit: 10,
                connectTimeout: 30 * 1000
            });
            // host/user/password/database come from process.env at module load; we only
            // verify the keys are present, not their values (env-dependent).
            expect(config).toHaveProperty('host');
            expect(config).toHaveProperty('user');
            expect(config).toHaveProperty('password');
            expect(config).toHaveProperty('database');
        });
    });

    describe('executeQuery', () => {
        it('acquires a connection, calls execute, releases, and returns rows', async () => {
            const fakeRows = [{ id: 1 }, { id: 2 }];
            mockConnection.execute.mockResolvedValue([fakeRows, {}]);

            const db = new Db();
            const result = await db.executeQuery('SELECT * FROM x WHERE id = ?', [42]);

            expect(mockPool.getConnection).toHaveBeenCalledTimes(1);
            expect(mockConnection.execute).toHaveBeenCalledWith('SELECT * FROM x WHERE id = ?', [42]);
            expect(mockConnection.release).toHaveBeenCalledTimes(1);
            expect(result).toEqual(fakeRows);
        });

        it('defaults params to an empty array when omitted', async () => {
            mockConnection.execute.mockResolvedValue([[], {}]);
            const db = new Db();

            await db.executeQuery('SELECT 1');

            expect(mockConnection.execute).toHaveBeenCalledWith('SELECT 1', []);
        });

        it('releases the connection even when execute throws, then rethrows', async () => {
            const boom = new Error('deadlock detected');
            mockConnection.execute.mockRejectedValue(boom);

            const db = new Db();
            await expect(db.executeQuery('UPDATE x SET y = 1', [])).rejects.toThrow('deadlock detected');

            expect(mockConnection.release).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalled();
        });

        it('does NOT call release when getConnection itself fails (no conn to release)', async () => {
            mockPool.getConnection.mockReset().mockRejectedValue(new Error('pool exhausted'));

            const db = new Db();
            await expect(db.executeQuery('SELECT 1')).rejects.toThrow('pool exhausted');

            expect(mockConnection.release).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('registerUpload', () => {
        const expectedSql = normalizeSql(`
            INSERT INTO podcasts
            (archivo, obs, pudo_subir, file_id, destino, title, caption, url, msg_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        beforeEach(() => {
            mockConnection.execute.mockResolvedValue([{ insertId: 1 }, {}]);
        });

        it('issues the canonical INSERT INTO podcasts statement', async () => {
            const db = new Db();
            await db.registerUpload({ archivo: '123', exito: true });

            const [sql] = mockConnection.execute.mock.calls[0];
            expect(normalizeSql(sql)).toBe(expectedSql);
        });

        it('maps all fields to positional params in the canonical column order', async () => {
            const db = new Db();
            await db.registerUpload({
                archivo: 'ep-01',
                obs: 'note',
                exito: true,
                fileId: 'FID',
                channelId: 7,
                title: 'Title',
                caption: 'Cap',
                url: 'https://u',
                message_id: 'M1'
            });

            const [, params] = mockConnection.execute.mock.calls[0];
            expect(params).toEqual(['ep-01', 'note', 1, 'FID', 7, 'Title', 'Cap', 'https://u', 'M1']);
        });

        it('coerces exito=true to 1 and exito=false to 0', async () => {
            const db = new Db();

            await db.registerUpload({ archivo: 'a', exito: true });
            expect(mockConnection.execute.mock.calls[0][1][2]).toBe(1);

            await db.registerUpload({ archivo: 'b', exito: false });
            expect(mockConnection.execute.mock.calls[1][1][2]).toBe(0);
        });

        it('applies defaults when optional fields are omitted', async () => {
            const db = new Db();
            await db.registerUpload({ archivo: 'only-required', exito: false });

            const [, params] = mockConnection.execute.mock.calls[0];
            // Order: archivo, obs, exito, fileId, channelId, title, caption, url, message_id
            expect(params).toEqual(['only-required', '', 0, '', null, '', '', '', '']);
        });
    });

    describe('getRssList', () => {
        it('issues a SELECT against the sources table for the expected columns', async () => {
            const rows = [{ id: 1, url: 'u', channel: '@c', nombre: 'n' }];
            mockConnection.execute.mockResolvedValue([rows, {}]);

            const db = new Db();
            const result = await db.getRssList();

            const [sql, params] = mockConnection.execute.mock.calls[0];
            expect(normalizeSql(sql)).toBe('SELECT id, url, channel, nombre FROM sources');
            expect(params).toEqual([]);
            expect(result).toEqual(rows);
        });
    });

    describe('getPodcastById', () => {
        it('queries podcasts with a JOIN to sources using archivo = ? OR archivo LIKE CONCAT(?, \'-%\')', async () => {
            mockConnection.execute.mockResolvedValue([[], {}]);

            const db = new Db();
            await db.getPodcastById('ep-42');

            const [sql, params] = mockConnection.execute.mock.calls[0];
            const normalized = normalizeSql(sql);
            expect(normalized).toContain('FROM podcasts AS p');
            expect(normalized).toContain('JOIN sources AS s ON s.id = p.destino');
            expect(normalized).toContain("WHERE p.archivo = ? OR p.archivo LIKE CONCAT(?,'-%')");
            expect(normalized).toContain('ORDER BY LENGTH(p.archivo), p.archivo');
            expect(params).toEqual(['ep-42', 'ep-42']);
        });

        it('passes the id twice (plain match + multipart prefix match)', async () => {
            mockConnection.execute.mockResolvedValue([[], {}]);

            const db = new Db();
            await db.getPodcastById('20260421');

            expect(mockConnection.execute.mock.calls[0][1]).toEqual(['20260421', '20260421']);
        });
    });

    describe('getFailedPodcasts', () => {
        it('selects all columns from podcasts where pudo_subir = 0', async () => {
            mockConnection.execute.mockResolvedValue([[], {}]);

            const db = new Db();
            await db.getFailedPodcasts();

            const [sql, params] = mockConnection.execute.mock.calls[0];
            expect(normalizeSql(sql)).toBe('SELECT * FROM podcasts WHERE pudo_subir = 0');
            expect(params).toEqual([]);
        });
    });

    describe('getStoredPodcasts', () => {
        it('selects id and archivo from podcasts', async () => {
            mockConnection.execute.mockResolvedValue([[], {}]);

            const db = new Db();
            await db.getStoredPodcasts();

            const [sql, params] = mockConnection.execute.mock.calls[0];
            expect(normalizeSql(sql)).toBe('SELECT id, archivo FROM podcasts');
            expect(params).toEqual([]);
        });
    });

    describe('parameterization contract', () => {
        it('every method calls execute with params as an array (never string-interpolated SQL)', async () => {
            mockConnection.execute.mockResolvedValue([[], {}]);
            const db = new Db();

            await db.getRssList();
            await db.getPodcastById('x');
            await db.getFailedPodcasts();
            await db.getStoredPodcasts();
            await db.registerUpload({ archivo: 'a', exito: true });

            for (const call of mockConnection.execute.mock.calls) {
                expect(Array.isArray(call[1])).toBe(true);
                // And the SQL must contain at least one `?` if params are non-empty — positional placeholders only.
                if (call[1].length > 0) {
                    expect(call[0]).toMatch(/\?/u);
                }
            }
        });
    });
});
