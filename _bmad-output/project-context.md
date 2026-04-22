---
project_name: 'delsolbot'
user_name: 'Mauri'
date: '2026-04-21'
sections_completed:
  [
    'technology_stack',
    'language_rules',
    'framework_rules',
    'testing_rules',
    'code_quality_rules',
    'workflow_rules',
    'dont_miss_rules',
  ]
status: 'complete'
optimized_for_llm: true
existing_patterns_found: 15
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Runtime:** Node.js 24.x LTS, CommonJS only (`require`/`module.exports` — no ES modules). Enforced via `engines.node: ">=24.0.0"` in `package.json`. CI runs on Node 24.x only.
- **Scheduler:** `cron` ^3.5.0 — use `CronJob` from the `cron` package
- **HTTP Client:** `axios` ^1.7.9 — used for all HTTP, including Telegram Bot API (no wrapper library)
- **Telegram API:** Raw HTTP calls to `https://api.telegram.org/bot{BOT_TOKEN}/{method}` via axios; multipart uploads use the `form-data` ^4.0.1 package
- **RSS Parser:** `rss-parser` ^3.13.0
- **Database:** `mysql2` ^3.12.0 — import from `mysql2/promise`, use the singleton connection pool defined in `controllers/db.controller.js`. Do NOT instantiate new pools per file. `mysql` ^2.18.1 is a legacy dep — do not use in new code.
- **Audio Splitting:** `fluent-ffmpeg` ^2.1.3 — requires both `ffmpeg` AND `ffprobe` binaries on system PATH (ffprobe is used for duration probing)
- **ID3 Tagging:** `node-id3` ^0.2.6 — import as `require('node-id3').Promise` for async API. `write()` returns a boolean (not the written data). Do NOT upgrade past 0.x without verifying API compatibility.
- **Date/Time:** `luxon` ^3.5.0 — use `DateTime` from `luxon`
- **Env Vars:** `dotenv` ^16.4.7 — call `require('dotenv').config()` at the top of each entry file. All required vars are documented in `.env.example`.
- **File System:** Node.js built-in `fs` and `fs/promises` (no `fs-extra`); use `fs/promises` for new async code. `path` and `stream` are also native built-ins.
- **Linting:** ESLint ^9.19.0 — config in `.eslintrc.json` (extends `eslint:recommended` + strict custom rules). Key enforced rules: `no-var`, `no-console`, `require-jsdoc`, `prefer-template`, `no-param-reassign`.
- **Testing:** Jest ^30.3.0 — `testEnvironment: node`, CommonJS. Config at `jest.config.js` (collects coverage from `app.js` + `controllers/**` + `lib/**`; ignores `downloads/`, `manual_queue/`, `_bmad*`, `database/`; `clearMocks: true`, `restoreMocks: true`; reporters: text, text-summary, html, lcov). Scripts: `npm test`, `npm run test:watch`, `npm run test:coverage`. Mocking strategy: `jest.mock()` at module boundary; no DI framework — but constructor-style test doubles (see splitter tests) and injected collaborators (see process-item tests) are used where helpful. Mock hard-to-test boundaries: `mysql2/promise`, `axios`, `fluent-ffmpeg`, `node-id3`, `rss-parser`, and `fs`. Current suite: 102 tests across 4 files, whole suite runs in ≈1.5s.

### Declared-but-Unused Dependencies (do not import)

- `winston` ^3.17.0 — declared in `dependencies` but imported nowhere. Logging goes through `log` / `logError` / `debug` in `lib/helpers.js`. Do not add `winston` imports.
- `xml2js` ^0.6.2 — declared but imported nowhere. `rss-parser` handles all XML parsing. Do not import.
- `nodemon` ^3.1.9 — only used by `npm run dev`; belongs in `devDependencies` conceptually.
- `mysql` ^2.18.1 — legacy; use only `mysql2/promise` via the singleton pool in `controllers/db.controller.js`.

### Knowledge & Docs Layout

- `docs/` resolves as the `project_knowledge` path but is currently empty. Agents should not expect pre-existing knowledge documents there.
- Planning artifacts live in `_bmad-output/planning-artifacts/`, implementation artifacts in `_bmad-output/implementation-artifacts/`, test artifacts in `_bmad-output/test-artifacts/`.

## Critical Implementation Rules

### Language-Specific Rules (CommonJS / Node.js)

- **Module system:** CommonJS only. Use `require(...)` / `module.exports`. Never introduce `import`/`export` syntax or `.mjs` files. `package.json` has no `"type": "module"`.
- **Function style:** Module-level functions are declared as arrow-function consts (`const fn = async (...) => { ... }`) and bundled into `module.exports = { fn, ... }` at the bottom of the file. Class methods in `db.controller.js` use standard method syntax. Do not switch to `function` declarations unless editing an existing `function`-style file.
- **Async:** Always `async`/`await`. Do not chain `.then()`. Wrap `await` calls in `try`/`catch` where failures are recoverable, and rethrow after `logError(...)` where the caller needs to react.
- **Error handling:** Use `try`/`catch` with `logError(err)` from `lib/helpers`. Do not throw string literals (`no-throw-literal` is enforced). Let the top-level `main()` / cron handler catch and log. `consistent-return` is on — every branch of a function must either all return values or all not.
- **Equality:** `eqeqeq` is OFF, but `no-eq-null` is ON. Use `== null` / `!= null` only when intentionally checking for both `null` and `undefined`; prefer `===` / `!==` otherwise.
- **Template strings:** `prefer-template` enforced — no `'a' + b` concatenation.
- **Parameter mutation:** `no-param-reassign` enforced. If you must reassign (see `sanitizeContent`), add a targeted `// eslint-disable-next-line no-param-reassign` with a reason.
- **Variable declarations:** `no-var` enforced. `prefer-const` is off, so `let` is fine even when not reassigned. Do not introduce `var` in any file.
- **`process.env`:** Read directly at the top of the module (destructured: `const { BOT_TOKEN, CRON_MAIN } = process.env`). There is no central config module. Call `require('dotenv').config()` at the top of any entry-level file that reads env vars (see `app.js`, `lib/helpers.js`, `controllers/db.controller.js`).
- **Node built-ins:** Use `fs`, `fs/promises`, `path`, `stream` directly — no wrappers. Prefer `fs/promises` in new async code; legacy sync calls (`fs.existsSync`, `fs.mkdirSync`) exist in `app.js` and are acceptable to preserve but not to spread.
- **Regex:** `require-unicode-regexp` enforced — every `RegExp`/regex literal needs the `u` flag (see `/[¿?]/gu` in `lib/helpers.js`).
- **Globals:** `no-implicit-globals` enforced; do not rely on implicit global `this` at module scope.
- **Process exit:** `no-process-exit` enforced. Do not call `process.exit()`; let the cron run its course.
- **Sanctioned ESLint escape hatches** (do not remove without replacement):
  - `// eslint-disable-next-line no-console` in `lib/helpers.js` inside `log` and `logError` — these are the only allowed `console.*` calls in the project.
  - `// eslint-disable-next-line no-param-reassign` in `sanitizeContent` — deliberate coercion of a non-string param.

### Framework-Specific Rules

#### Cron Scheduling (`cron` package)

- Single `CronJob` instance in `app.js` driven by `CRON_MAIN` env var. Started with `.start()` in prod/default; in `NODE_ENV=local` the cron is bypassed entirely and `main()` is invoked once.
- Cron callback must wrap `main()` in `.catch(logError)` — uncaught rejections inside a cron tick are silently swallowed otherwise.
- `.env.example` also lists `CRON_CLEANUP` — not currently wired. If you add a second job, follow the same one-shot-on-local pattern.

#### Telegram Bot API (raw via `axios` + `form-data`)

- Endpoint pattern: `https://api.telegram.org/bot${BOT_TOKEN}/${method}`. No SDK/wrapper — do not introduce `node-telegram-bot-api`, `telegraf`, or similar.
- File uploads use `FormData` from `form-data` ^4.0.1 with `Content-Type: multipart/form-data` and `maxContentLength: Infinity`, `maxBodyLength: Infinity`.
- Audio upload: prefer reuse of existing Telegram `file_id` over re-uploading bytes. `sendEpisodeToChannel(episodePath, caption, chatId, performer, title, id, fileId)` — when `fileId` is non-null, pass the `file_id` string as the `audio` form field; when null, pass a `fs.createReadStream(episodePath)`.
- Test routing: `NODE_ENV !== 'prod'` redirects all sends to `TEST_CHANNEL`. Never hardcode a production channel for local runs — rely on this env switch.
- Response shape assumed: `data.result.audio.file_id` and `data.result.message_id`. Persist both to `podcasts.file_id` and `podcasts.msg_id`.
- Always `parse_mode=html` and `disable_notification=true` in outbound audio posts.

#### Database (`mysql2/promise` singleton pool in `controllers/db.controller.js`)

- **One pool, period.** Do not create a second pool in any file. Require the controller class and call methods, or — if you must run raw SQL — route through the pool-backed `executeQuery` method on an instance.
- `connectionLimit: 10`, `connectTimeout: 30s`. Do not raise these without checking MySQL server side.
- Connection lifecycle: `pool.getConnection()` → `con.execute(query, params)` → **always** `con.release()` in `finally`. When `getConnection` itself rejects, do NOT call release — there's no connection to release. The test suite asserts both paths.
- **Parameterized queries only.** Never string-interpolate values into SQL. All existing queries use `?` placeholders. Enforced by a contract test in `db.controller.test.js` that iterates every exported method and fails if any `execute` call is missing `?` placeholders when params are non-empty.
- Schema column names are in Spanish (`archivo`, `pudo_subir`, `fecha_procesado`, `destino`, `obs`, `msg_id`, `file_id`, `url`, `title`, `caption`, `nombre`). Do NOT rename them. Code uses English variable names that map to these Spanish columns in the SQL.
- Charset is `utf8mb4 / utf8mb4_bin` (see `update_005.sql`). New tables or column changes must match.
- Schema-evolution convention: one new numbered `database/update_NNN.sql` per change; do not mutate `schema.sql` retroactively.
- **Column order in `registerUpload`** is pinned by a characterization test: `archivo, obs, pudo_subir, file_id, destino, title, caption, url, msg_id`. Reorder at your peril.

#### Process-item orchestration (`lib/process-item.js`)

- Extracted from `app.js` as a surgical seam — takes `{ db, sendToTelegram }` as injected collaborators. This is the only function that decides *whether* to call sendToTelegram based on DB history.
- Used by `app.js`'s `processFeed` via `await processItem(item, title, { db: DB, sendToTelegram })`. The inline copy in `app.js` has been removed.
- Decision logic (characterized and test-pinned):
  - `alreadyUploaded` = any stored row with `pudo_subir && file_id && channel === item.channel` → skip.
  - `priorUploads` = rows with `pudo_subir && file_id && channel !== item.channel` → if non-empty, set `item.forwardFiles` and call sendToTelegram (forward path).
  - `stored.length === 0` → call sendToTelegram (fresh upload).
  - Otherwise → **silently do nothing** (see Defect #2 below).
- Errors from `db.getPodcastById` or `sendToTelegram` are caught and logged; the function never throws. `processFeed` keeps iterating.

#### RSS Parsing (`rss-parser`)

- `new Parser().parseURL(rssUri)` — wrapped in `getFeed(rssUri)` in `lib/helpers.js`. Always go through the helper.
- Feeds are expected to expose `items[]` with `link`, `title`, `content`, and `itunes.image`. `getIdFromItem(item)` derives the episode id from the tail of `item.link` (strips `.mp3`). Do not change that derivation without a migration plan — ids live in `podcasts.archivo` forever.
- **Query strings and fragments are NOT stripped** by `getIdFromItem`. A link like `foo.mp3?token=abc` produces id `foo?token=abc`. A change to strip them would break historical dedupe for items whose URLs happened to include query strings. Characterization test pins this.

#### Audio Pipeline (`fluent-ffmpeg` + `node-id3`)

- `TELEGRAM_THRESHOLD = 50` (MB) is Telegram's hard bot-upload limit. Splitter only activates when file size exceeds it.
- Silence detection tuning: `silencedetect=n=-30dB:d=0.5`, `MAX_DISTANCE_FROM_SILENCE = 10` seconds. Changing these affects split quality; treat them as product decisions, not refactors. Tests pin these exact parameters.
- `splitEpisode(filePath, outputBase)` returns `[filePath]` unchanged when under threshold — always iterate the returned array; never assume single-file.
- **`audioCodec('copy')` is enforced** on every split output — no re-encoding. Tests pin this. Changing to `libmp3lame` or similar would break the "no re-encoding" invariant and make splits re-quantize audio.
- **0.1MB corruption threshold** — `splitPart` rejects split outputs under 0.1MB as corrupt with error "Archivo resultante corrupto". Triggers when ffmpeg produces a near-empty file (usually bad seek).
- In `splitPart`, `if (start !== null)` is effectively dead — `splitEpisode` always passes numeric starts (including `0` for the first part). Safe to simplify if ever refactored.
- `node-id3`: import as `require('node-id3').Promise`. `write(tags, path)` returns a **boolean**, not the written tags — do not await its return value expecting a payload.

#### Logging (`lib/helpers` — not winston)

- Three levels: `log(...msgs)` (info), `logError(...msgs)` (stderr), `debug(...msgs)` (gated on `process.env.DEBUG` truthy). No `console.*` outside `lib/helpers.js`.
- All three accept variadic args and prefix with a Luxon timestamp `yyyyMMdd-HH:mm:ssZZZZ`. No structured logging, no log levels beyond the three above, no external log sinks.

### Testing Rules

- **Runner:** Jest ^30.2.0 with default config (`testEnvironment: node`, default `testMatch`). No `jest.config.*` exists yet — if one is added, prefer keeping defaults and only setting what's necessary (e.g. `testPathIgnorePatterns` for `downloads/`, `manual_queue/`, `_bmad*`).
- **Script:** Add `"test": "jest"` to `package.json` scripts when introducing the first test (currently absent).
- **File layout:** Place tests next to the subject using `*.test.js` suffix — e.g. `lib/helpers.test.js`, `controllers/db.controller.test.js`, `app.test.js`. Do not introduce a top-level `__tests__/` directory unless a test pulls across modules (then `__tests__/integration/`).
- **Naming:** `describe('<modulePath>', () => { describe('<functionName>', () => { it('<behavior>', ...) }) })`. One `describe` block per exported function.
- **Module-boundary mocking:** Use `jest.mock(...)` at module scope. Mock these boundaries by default (they make unit tests deterministic and don't require network / disk / binaries):
  - `mysql2/promise` — mock `createPool` to return `{ getConnection }` stubs
  - `axios` — mock `post`/`get`/default export
  - `fluent-ffmpeg` — mock the factory function and the `.ffprobe` property
  - `node-id3` — mock `.Promise.write` to return `true`
  - `fs` / `fs/promises` — mock `createReadStream`, `createWriteStream`, `promises.readFile`, `promises.rm`, `existsSync`, `mkdirSync`
  - `rss-parser` — mock the default export class
  - `form-data` — rarely needs mocking; the outbound payload shape matters more than the class internals
- **Do not mock `lib/helpers`** as a default. The sanitizers, `getIdFromItem`, `pathToTitle`, etc. are pure and should be exercised directly. Only mock `log`/`logError`/`debug` if asserting log output or silencing noise.
- **DB tests:** Unit-mock the pool per above. If an integration test is introduced later, it must spin up a real local MySQL (not mock) and run `database/schema.sql` + `update_*.sql` against it; never point integration tests at a shared/remote DB.
- **Telegram tests:** Never hit the real `api.telegram.org`. Assert on the axios call shape: URL (`/bot<token>/sendAudio`), method (`post`), form-data field presence (`audio`, `chat_id`, `caption`, `parse_mode`, `disable_notification`, `performer`, `title`).
- **Time / cron:** Use `jest.useFakeTimers()` when asserting cron callback behavior. Do not start a real `CronJob` in tests.
- **Env vars:** Stub via `process.env` in `beforeEach`/`afterEach` — restore the original snapshot. Do not rely on a real `.env`.
- **Fixtures:** Prefer inline object literals over fixture files. If RSS XML fixtures are ever needed, keep them in `__fixtures__/rss/*.xml` adjacent to the test that uses them.
- **Assertions:** Prefer `expect(fn).toHaveBeenCalledWith(...)` for boundary checks; use `expect(obj).toMatchObject({...})` when only asserting a subset of Telegram/DB payloads.
- **Coverage:** No threshold enforced yet. If one is set, start conservative (e.g. 60% lines) and ratchet upward; do not introduce a 90%+ gate without discussing.
- **What NOT to test:** third-party library internals (axios retries, mysql2 pool internals, ffmpeg output correctness); the cron scheduler firing (that's a `cron` package concern); anything requiring real `ffmpeg` / `ffprobe` binaries at CI time — those belong in a separate opt-in integration suite.

### Code Quality & Style Rules

#### Linting

- ESLint ^9.19.0 configured via `.eslintrc.json` (legacy JSON config, not flat config). Keep JSON format when editing.
- Always run `npx eslint .` before committing. No `lint` npm script currently defined — add `"lint": "eslint ."` if introducing one.
- Do not disable rules project-wide. Use line-level `// eslint-disable-next-line <rule>` sparingly, with a reason comment when the rule being disabled is non-obvious.

#### Key enforced rules (not exhaustive — see `.eslintrc.json`)

- `no-var`, `prefer-template`, `prefer-const` off (so `let` without reassign is fine).
- `no-console: error` — logging goes through `lib/helpers`.
- `no-process-env: off` — direct `process.env.X` reads are allowed (and expected).
- `require-jsdoc: error` — every function, method, and class needs a JSDoc block. No exceptions.
- `no-param-reassign`, `consistent-return`, `no-throw-literal`, `no-eq-null`, `no-implicit-globals`, `no-process-exit`, `no-nested-ternary`, `no-shadow`, `no-sequences`, `no-loop-func`, `no-duplicate-imports`.
- `require-unicode-regexp` — every regex literal / `RegExp` constructor needs the `u` flag.
- `no-magic-numbers: off` — inline numeric literals are fine, but prefer named constants when the intent isn't obvious.
- Formatting off or relaxed: `indent: off`, `quotes: off`, `semi: off`, `object-curly-spacing: off`, `max-len: off`. Do **not** reformat existing files wholesale — match the surrounding style in each file.
- `valid-jsdoc: off`, so tag types are not validated. Still, keep `@param` / `@returns` accurate.
- `sort-imports: error` — when adding new `require`s, keep them grouped (Node built-ins, then third-party, then local) and alphabetical within each group where practical (observed pattern in `app.js`, `lib/helpers.js`).

#### Naming conventions

- Files: lowercase kebab-case for multi-word names, `.controller.js` suffix for controllers (`db.controller.js`). Keep single-word module files lowercase (`helpers.js`, `splitter.js`, `app.js`).
- Functions / variables: `camelCase`. Classes / constructors: `PascalCase` (see the `Db` class in `db.controller.js`).
- Constants: `UPPER_SNAKE_CASE` when module-level and configuration-like (`TELEGRAM_THRESHOLD`, `MAX_DISTANCE_FROM_SILENCE`, `COVER`, `DDIR`). Regular `const` for normal values.
- Env var names: `UPPER_SNAKE_CASE`, read directly via `process.env.NAME` or destructured at top of file.

#### Documentation (JSDoc)

- Every exported function and every class method carries a JSDoc block with `@param` and `@returns`. Follow `lib/helpers.js` / `controllers/db.controller.js` as the canonical style.
- Short single-sentence description on the first line. Do not write multi-paragraph JSDoc.
- Mixed Spanish/English in existing JSDoc (see `lib/splitter.js` vs `lib/helpers.js`) is a known quirk per `README.md` ("todo el code es en espanglish"). For **new** code, prefer English. Do not retroactively translate existing comments as part of unrelated work.
- Inline comments: `spaced-comment: always` enforced (`// like this`, not `//like this`). `no-inline-comments: error` — place comments on their own line, not trailing a statement.
- `multiline-comment-style: separate-lines` — no `/* */` blocks for multi-line; stack `//` lines instead (except JSDoc, which uses `/** */`).

#### Code organization

- Directory layout:
  - `app.js` — entry point, cron wiring, `main` → `processFeed` → `sendToTelegram`. The `processItem` decision logic now lives in `lib/process-item.js` (extracted surgically for testability).
  - `controllers/` — class-based data-access layers (currently only `db.controller.js`).
  - `lib/` — utility and single-responsibility modules (`helpers.js`, `splitter.js`, `process-item.js`). Tests sit next to the subject as `*.test.js`.
  - `database/` — SQL only. `schema.sql`, `seed.sql`, numbered `update_NNN.sql`.
  - `assets/` — static images used as ID3 cover art.
  - `downloads/` — runtime-only working directory; cleaned by `cleanDownloads()`. Never commit contents.
  - `manual_queue/` — reserved for future manual-upload flow (currently empty).
  - `tools/` — reserved for one-off scripts (currently empty).
  - `coverage/` — generated by `npm run test:coverage`. Gitignored.
- New modules belong in one of the above. Do not introduce new top-level directories without a clear reason.
- Export shape: named exports via an object literal at the bottom of the file (`module.exports = { fnA, fnB };`). Class modules export the class directly (`module.exports = class Db { ... };`).

#### Known inconsistency (do not treat as drift)

- `lib/helpers.js` mixes 4-space and 2-space indentation (most functions 4, `pause` and `getFileSizeInMB` 2). `indent: off` allows this. If you touch one of those functions, match its existing indentation — do not reformat the whole file.

### Development Workflow Rules

#### Branching

- Default branch: **`master`** (not `main`). Do not rename or push to a `main` branch; it doesn't exist on the remote.
- Feature branch naming: short kebab-case, optionally prefixed with intent (`fix/`, `feature/`). Observed names: `splitter-fixes`, `file-splitter`, `add-duration`, `code-refactor`, `integration`, `fix/forward-messages`, `refactor-nueva-conexion`. Mixed English/Spanish is acceptable.
- AI-agent branches from OpenAI Codex use the `codex/<slug>` prefix. Preserve that prefix when an agent creates a branch; don't rename to human style.
- Dependabot branches follow its default `dependabot/npm_and_yarn/<pkg>-<ver>` — do not rename.

#### Commits

- Short, imperative one-liners in present tense. Title-cased first word is common but not required. Examples from the log: "Fix forwards", "Bump up version", "Update JSDoc and sanitizer", "Fix sanitizer", "Major refactor + splitter fix".
- No Conventional Commits prefix (`feat:`, `fix:`, `chore:`). Do not introduce them retroactively.
- Subject under ~60 characters. Body is rare; add one only when the "why" isn't obvious from the diff.
- Do not amend commits that have already been pushed or merged. New commit per change.

#### Pull Requests

- Merged via GitHub "Merge pull request #NN from ..." (merge commits, not squash). Keep that style — do not force squash-merge.
- Per `README.md`: "Pull Requests are welcome. Refactors and bugfixes only help us. But let's discuss them in an open Issue first." Open an issue before a non-trivial PR.
- No PR template exists (no `.github/` directory). A short description with intent + testing notes is enough. Do not introduce a formal template unless the maintainer asks.

#### Versioning & Releases

- Semver in `package.json` (currently `2.9.1`). Bumps land as their own commit (see "Bump up version"). Minor/patch bumps do not require a dedicated tag commit; there is no tag/release pipeline in place.
- No changelog file. Do not add one unless requested.

#### CI / Automation

- **No CI pipeline yet.** No `.github/workflows/`, no other CI config. Tests and lint are local-only. When introducing CI (PRD Epic 5), keep the config in `.github/workflows/` (GitHub-native).
- **Dependabot is active** on the remote. Treat its PRs as normal bumps — review, merge, re-run locally.
- **ESLint 9 flat-config migration is pending.** The existing `.eslintrc.json` is legacy format; ESLint 9 requires `eslint.config.js` by default. `npm run lint` currently fails with a config-not-found error. Either set `ESLINT_USE_FLAT_CONFIG=false`, pin eslint to ^8, or migrate to flat config (preferred long-term per PRD Epic 4).

#### Pre-commit discipline (manual, no hooks installed)

- Run `npm run lint` and `npm test` before pushing. No pre-commit hooks (husky/lefthook) are configured; this is discipline, not automation.
- The test suite is fast (≈1.5s at 102 tests). Running it pre-push is cheap.

#### Deployment

- Deployment procedure is not documented in-repo. Do not assume a CI/CD flow. The app is a long-running Node process (`node app.js`) driven by the `CRON_MAIN` schedule. Deployment is whatever the maintainer does outside the repo — do not write code that presumes otherwise (e.g. no `process.exit()`, no auto-restart logic, no PM2-specific assumptions).

### Critical Don't-Miss Rules

#### Anti-patterns (do NOT)

- **Do NOT instantiate a second `mysql2` pool.** There is exactly one, in `controllers/db.controller.js`. Adding another silently doubles connection consumption and can deadlock against `connectionLimit: 10`.
- **Do NOT import `winston` or `xml2js`.** Both are declared-but-unused. Logging is the `lib/helpers` trio; XML parsing is `rss-parser`. Adding those imports expands the surface area without reason.
- **Do NOT introduce a Telegram SDK** (`node-telegram-bot-api`, `telegraf`, etc). The direct `axios` + `form-data` approach is load-bearing and covers every case the bot needs.
- **Do NOT call `console.log/error/warn/debug`** outside `lib/helpers.js`. `no-console: error` will fail the lint; logging must go through `log` / `logError` / `debug`.
- **Do NOT call `process.exit()`.** `no-process-exit: error`. Let errors bubble; the cron tick will recover on the next schedule.
- **Do NOT rename Spanish DB columns** (`archivo`, `pudo_subir`, `fecha_procesado`, `destino`, `obs`, `msg_id`, `nombre`). They are the schema; the code maps English variable names to them deliberately. A rename would require a migration and break historical data lookups.
- **Do NOT change `getIdFromItem`'s derivation** (`item.link.split('/').pop().replace('.mp3','')`). That id is persisted in `podcasts.archivo` indefinitely. A change breaks duplicate detection and the forward-vs-upload decision in `processItem`.
- **Do NOT hardcode a production channel** for local testing. `NODE_ENV === 'prod'` gates production routing; anything else must route to `TEST_CHANNEL`.
- **Do NOT mutate `feedItem`** beyond the two intentional assignments in `processFeed` (`item.channel`, `item.channelId`) and the forward-path marker (`item.forwardFiles`). `no-param-reassign` will flag anything else.
- **Do NOT upload bytes when a `file_id` already exists** for that channel. `processItem` skips items already on the target channel and reuses `file_id`s across channels via the forward path. Rewriting to always re-upload wastes bandwidth and breaks Telegram's de-duplication.
- **Do NOT add retries/backoff inside `sendEpisodeToChannel`** without a plan. Telegram's rate limiting is real; the current approach is "fail, log, recover on next cron". Retry logic needs to know about 429s, `retry_after`, and partial-upload state in the DB.
- **Do NOT use `.then()` chains** in new code. Async/await only. Mixing the two within the same function is also discouraged.
- **Do NOT introduce ES modules** (`import`/`export`, `.mjs`, `"type": "module"`). The project is CommonJS top-to-bottom.

#### Edge cases that bit the codebase before

- **Forwarded audio in multi-part episodes.** A show may have been uploaded to channel A as 3 parts. When forwarding to channel B, iterate `forwardFiles` and re-caption `(Parte N)` — a single `file_id` only covers one part. See `sendToTelegram` forward branch.
- **Episode filename collisions across channels.** `${DDIR}${folderName}/${fileName}` — two channels publishing the same episode title would collide. Current code creates the folder per channel (`downloadFolder = ${DDIR}${folder}`), but the caller must pass the sanitized channel name, not the raw title.
- **`itunes.image` missing or non-string.** `downloadImage` falls back to `COVER` (`./assets/cover.jpg`) when `typeof imageUrl !== 'string'`. Preserve that guard — some feeds expose `image` as an object.
- **Silence-detection returning zero segments.** `calculateSplitTimes` falls back to the `idealTime` if no silence is within `MAX_DISTANCE_FROM_SILENCE`. Splitting at a non-silent point is acceptable; refusing to split is not (upload would fail at 50MB).
- **`getMedia` stream errors.** The write stream is `.destroy()`ed on axios failure, but the returned Promise only rejects on `stream.error` — an axios error before the pipe starts is rethrown synchronously. Don't simplify the two-path error handling without understanding both.
- **Empty `downloads/` on cold start.** `cleanDownloads` calls `fs.promises.readdir` and tolerates ENOENT by catching and logging — safe to call unconditionally.

#### Characterization findings (discovered via the test suite — do not silently "fix")

These are current behaviors pinned by tests. A change here requires an explicit, documented decision plus a migration plan for existing data.

- **`sanitizeContent` double-escapes `"`**. Replacement order is `"` → `&quot;` first, then `&` → `&amp;`, so the ampersand inside `&quot;` gets re-escaped to `&amp;quot;`. Telegram captions that have round-tripped through this are already encoded this way. A "fix" would break rendering of historical captions and forwarded messages. Characterization test: `lib/helpers.test.js > sanitizeContent > double-escapes double quotes`.
- **`sanitizeEpisode.trim()` is effectively dead for spaced input.** Space-to-underscore runs before `.trim()`, so leading/trailing spaces become underscores that `.trim()` cannot remove. Only tabs/newlines survive long enough to be trimmed.
- **`getIdFromItem` does not strip query strings or fragments.** `foo.mp3?token=abc` produces id `foo?token=abc`. Load-bearing — 6 years of `podcasts.archivo` rows derived this way.
- **`debug()` captures `DEBUG` at module-load only.** Because `require('dotenv').config()` runs at the top of `helpers.js`, every re-require re-reads `.env` — meaning `jest.isolateModules` must also mock dotenv if you want to force the DEBUG-off path deterministically in a test.
- **`splitter.js` line 160 has an unreachable branch.** `if (start !== null)` can never be false via the public `splitEpisode` API, because `splitTimes` always contains numeric entries. Branch coverage is 96.29% because of this one dead branch. Safe to simplify by removing the check if ever refactored.

#### Security rules

- **Never log `BOT_TOKEN`, `DB_PASS`, or any `process.env` contents.** `debug({ item })` is fine because `item` is RSS-sourced; `debug(process.env)` is not.
- **SQL:** parameterized queries only (`?` placeholders via `con.execute`). No string interpolation, no template-literal assembly.
- **Telegram:** the bot token sits in the URL (`/bot${BOT_TOKEN}/...`) — do not log that URL. If you add request logging, strip the token from the path.
- **File paths from external data:** always sanitize via `sanitizeFilename(channelName)` before using as a directory component. The feed's `title` is not trusted — see `sanitizeEpisode`.
- **HTML in captions:** Telegram uses `parse_mode=html`; the `title` is embedded in `<b>...</b>`. If you add fields from the feed into the caption, HTML-escape them (`sanitizeContent` handles `&"<>`). `content` is already expected to be trusted feed markup.
- **Do not commit `.env`.** The repo has `.env.example` only; `.env` should be `.gitignore`'d (verify on first change to env vars).

#### Performance gotchas

- **`pool.getConnection` + missing `release`.** Every query in `db.controller.js` uses `finally { con.release() }`. New methods must do the same or the pool will hit `connectionLimit` and stall.
- **Sequential feed processing.** `processFeed` iterates items with `for (const item of ...) { await processItem(...) }` — serial by design (to avoid Telegram rate limits). Do not parallelize with `Promise.all` without addressing throttling.
- **`pause(1000)` between feeds.** In `main()`. Crude but effective rate-limit spacer. Don't remove unless you add proper backoff.
- **`ffmpeg` spawning.** Each `splitEpisode` call spawns at least two child processes (silencedetect + per-part split). For a 3-part episode that's 1 probe + 1 silence-detect + 3 splits = 5 processes. Keep this in mind when sizing the host.
- **Large-file memory:** axios is configured `maxContentLength: Infinity, maxBodyLength: Infinity`. Streams are used for downloads and uploads — do not `fs.readFile` an MP3 into memory before posting.

#### Platform / cross-OS caveats

- Path concat uses both `path.join` (safer) and raw `${DDIR}${folder}` strings (risky on Windows). The codebase is Linux-targeted (see README "Node 20+" + `dbset.sh` shell script). Do not assume Windows support.
- `database/dbset.sh` is a Bash script — keep schema scripts POSIX-compatible.

### Production Defects — Corrected Attribution

The PRD (`planning-artifacts/prd.md`) lists two production defects. Characterization tests for `lib/process-item.js` have **corrected the cause attribution** — the PRD's initial framing was incomplete. Treat the following as the ground truth; the PRD will be updated in a follow-up session.

Both defects trace to DB state at the start of the next cron tick. They are **disjoint**, mutually exclusive based on whether the prior tick produced a row for (channel, episode) or none at all:

| DB state at next tick | `alreadyUploaded` | `priorUploads` | `stored.length === 0` | Effect |
|---|---|---|---|---|
| No row at all | false | empty | **true** | Re-call sendToTelegram → **duplicate** (Defect #1) |
| `pudo_subir=0` row, same channel | false | empty | false | **Nothing happens** → **abandoned** (Defect #2) |
| `pudo_subir=1 + file_id`, same channel | **true** | empty | false | Skip (correct) |
| `pudo_subir=1 + file_id`, other channel | false | non-empty | false | Forward (correct) |

**Defect #1 — Duplicate re-upload.** Requires **both** the success INSERT and the fallback-on-error INSERT to fail (catastrophic DB outage). Rare in practice. Once it triggers, the subscriber sees a duplicate post on the next tick.

**Defect #2 — Missed episode.** Any row exists for (channel, episode) with `pudo_subir=0` or empty `file_id`. Neither the `alreadyUploaded` guard nor the `priorUploads` filter matches, and `stored.length > 0` defeats the fresh-upload short-circuit. The episode is **never retried**. This is not a "root cause unknown" defect as the PRD initially suggested — it's a design fact. More common than Defect #1.

**Fix shape** (to be implemented in `lib/process-item.js`):
- Defect #2: add a "retry-if-all-prior-attempts-failed" branch. Guarded by a per-episode retry budget stored in the `podcasts` row (or an `intentos` column added via `update_006.sql`) so permanently-broken items don't hammer Telegram forever.
- Defect #1: fix lives in `sendToTelegram` (where the success INSERT happens post-Telegram-success). Candidates: retry-to-exhaustion on DB insert, a Telegram-message-delete compensator on DB failure, or a pre-write idempotency check. Architecture-epic decision; out of current session scope.

---

## Usage Guidelines

**For AI Agents**

- Read this file before implementing any code in `delsolbot`.
- Follow all rules exactly as documented. When in doubt, prefer the more restrictive option.
- If you discover a pattern worth documenting or a rule that's become obsolete, surface it in chat so the maintainer can update this file — don't silently edit rules as part of unrelated work.

**For Humans**

- Keep this file lean and focused on what agents actually trip on. If a rule becomes obvious to everyone, remove it.
- Update when the stack changes, when a new load-bearing pattern emerges, or when an incident reveals an unwritten rule.
- Re-run `bmad-generate-project-context` whenever the repo's shape shifts materially (new subsystem, framework swap, major refactor).

Last Updated: 2026-04-21 (session 2 — added characterization findings, corrected defect attribution, `lib/process-item.js` extraction, testing baseline at 58.44% project coverage with 102 tests)
