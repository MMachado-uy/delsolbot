---
stepsCompleted:
  [
    'step-01-init',
    'step-02-discovery',
    'step-02b-vision',
    'step-02c-executive-summary',
    'step-03-success',
    'step-04-journeys',
    'step-05-domain-skipped',
    'step-06-innovation-skipped',
    'step-07-project-type',
    'step-08-scoping',
    'step-09-functional',
    'step-10-nonfunctional',
    'step-11-polish',
  ]
inputDocuments:
  - '_bmad-output/project-context.md'
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 1
classification:
  projectType: 'integration-service / background-worker (closest CSV: api_backend)'
  domain: 'general (media/podcasts)'
  complexity: 'medium'
  projectContext: 'brownfield-mature'
  productionNotes:
    - '6 years in production'
    - '~2,000 subscribers'
    - 'Backwards compatibility with existing DB history is a hard constraint'
    - 'Visible improvements allowed when justified by the migration cost'
workflowType: 'prd'
---

# Product Requirements Document — delsolbot

**Author:** Mauri
**Date:** 2026-04-21

## Executive Summary

delsolbot is a 6-year-old Node.js integration service that polls RSS feeds for Uruguayan radio station podcasts, downloads each episode, applies ID3 metadata, splits files exceeding Telegram's 50MB bot-upload limit, and publishes them to per-source Telegram channels serving ~2,000 subscribers. The system runs as a cron-driven daemon with MySQL-backed state tracking file_id reuse, upload success, and multi-channel forward relationships.

This PRD does not define a new product; it defines an **improvement initiative** on an existing production system. The goal is to transform delsolbot from a career-study artifact — where each feature change is "an adventure" because the codebase predates the maintainer's understanding of async/await — into a codebase that invites change instead of punishing it, without interrupting service to current subscribers.

The initiative has two interlocking outcomes:

1. **Engineering.** Characterization tests to ≥80% coverage; removal of antipatterns catalogued in `_bmad-output/project-context.md`; Node.js 24 and dependency upgrades (including removal of unused `winston` and `xml2js`, retirement of legacy `mysql` v2, relocation of `nodemon`); a revised architecture with clear separation of concerns; a CI/CD pipeline enforcing lint, test, and coverage gates; and resolution of two concrete production defects — occasional missed episodes and duplicate re-uploads caused by Telegram-succeeds-but-DB-insert-fails race conditions.

2. **Learning.** The initiative is the maintainer's hands-on canvas for modern engineering practice — tests-first refactoring on a real codebase with real users, AI-assisted development (this PRD is itself a product of that collaboration), and modern tooling (Jest 30, ESLint 9 flat config, GitHub Actions). Success is measured in concepts practiced, not only coverage percentage.

### What Makes This Special

delsolbot is simultaneously a **production system** and a **personal learning artifact** — a combination that shapes every scope decision. Commercial refactors optimize for team velocity and risk-averse incrementalism; greenfield learning projects optimize for rewriting at will. This initiative sits between both: real users give learning real stakes, while the absence of a commercial deadline permits experimentation, deliberate visible improvements (not just invisible refactors), and latitude to change anything — including schema, id derivation, logging approach, and the raw-axios Telegram integration — provided the migration cost is justified by the improvement.

Nothing in the existing codebase is untouchable; every component is evaluated by cost-of-change versus value-of-change. The initiative uses modern AI-assisted development as a first-class methodology rather than an afterthought.

## Project Classification

- **Project Type:** Integration service / background-worker (Node.js daemon; closest PRD-taxonomy match: `api_backend`, with the caveat that delsolbot consumes Telegram's API rather than exposing one).
- **Domain:** General — media / podcast redistribution. Low regulatory surface; no PII beyond Telegram channel identifiers.
- **Complexity:** **Medium** — driven by brownfield constraints (6 years of production history, active DB rows, ~2K subscribers) and the absence of any existing test safety net, rather than by domain regulation.
- **Project Context:** **Brownfield-mature.** Existing working system at v2.9.1; no tests; ESLint configured but currently broken under ESLint 9 flat-config expectations; Jest 30.3.0 framework just scaffolded with a single smoke test.

## Success Criteria

### Subscriber Success

The initiative succeeds for subscribers if the service becomes measurably more reliable without a single channel going silent or losing subscribers during the work.

- **Zero silent channels.** Every existing Telegram channel continues to receive new episodes throughout the refactor epics. No channel goes dark for more than one cron cycle attributable to refactor work.
- **Duplicate-upload defect resolved.** Currently, when a Telegram upload succeeds but the DB `INSERT` fails, the bot re-uploads the same episode on the next run. Success: a failing test reproduces this race, the fix passes, and no duplicate re-uploads are observed in a 30-day post-deploy monitoring window.
- **Missed-episode defect resolved.** Currently, the bot occasionally skips episodes. Success: root cause identified and fixed with a regression test. No skips observed in a 30-day post-deploy monitoring window.
- **No subscriber complaints.** Since the current baseline is "no complaints," the initiative must not *introduce* any. Any subscriber-reported regression attributable to the refactor is a P0 rollback trigger.

### Maintainer / Learning Success

Replaces the template's "Business Success" — this is a personal project with no commercial metrics.

- **Confidence measure.** Maintainer self-reports at initiative close: "I can add a new feature to this codebase without dread." Gate: explicit subjective sign-off at retrospective.
- **Concepts practiced.** The initiative delivers hands-on experience in characterization testing on legacy code, AI-assisted development workflow (BMad method), Node.js major-version migration, ESLint 9 flat-config migration, dependency-upgrade strategy under npm audit debt, clean-architecture refactoring, and CI/CD pipeline authoring in GitHub Actions.
- **Reusable artifacts.** The `.github/workflows/` config, Jest setup, and test patterns become templates the maintainer can lift into other projects.
- **No commercial-style metrics apply.** There are no revenue, ARR, CAC, or growth targets.

### Technical Success

- **Test coverage:** Line coverage from the current 6.94% baseline to **≥80%**. Branch coverage from 0% to **≥70%**. `coverageThreshold` enforced in `jest.config.js` and in CI.
- **Zero declared-but-unused dependencies.** `winston`, `xml2js`, and legacy `mysql` v2 removed (or, in winston's case, actually adopted if structured logging lands). `nodemon` relocated to `devDependencies`.
- **Runtime modernization.** Node.js upgraded from 20.x to **24.x**. All remaining dependencies at latest stable compatible versions. `npm audit` shows **zero high and zero critical** findings post-upgrade (currently 4 high, 1 critical).
- **Two production defects fixed.** Each has a failing characterization test on master *before* the fix commit, and green tests *after*.
- **Antipatterns addressed.** Every antipattern catalogued in `_bmad-output/project-context.md` is either removed, or explicitly retained with a documented rationale. No silent carry-forward.
- **Lint pipeline works.** ESLint 9 flat-config migrated. `npm run lint` green on master.
- **Architecture has clear seams.** `app.js` reduced from ~330 lines of mixed responsibilities to an entry-point and wiring module. Dedicated services for feed ingestion, Telegram publishing, audio pipeline, persistence, and configuration.
- **CI/CD pipeline green on master.** GitHub Actions runs on every push and PR: lint → test → coverage-gate. Deploy automation is out of MVP scope but the workflow structure must be ready to extend.

### Measurable Outcomes

| Metric                          | Baseline (2026-04-21)               | Target                     | Gate                         |
|---------------------------------|-------------------------------------|----------------------------|------------------------------|
| Line coverage                   | 6.94%                               | ≥80%                       | `jest --coverage` in CI      |
| Branch coverage                 | 0%                                  | ≥70%                       | `jest --coverage` in CI      |
| `npm audit` high + critical     | 4 high, 1 critical                  | 0 high, 0 critical         | CI step                      |
| Declared-but-unused deps        | 2–3 (winston, xml2js, legacy mysql) | 0                          | PR review on dep changes     |
| Lint run                        | Broken (ESLint 9 flat-config gap)   | Green                      | `npm run lint` in CI         |
| `app.js` LOC                    | ~330                                | ≤100 (entry + wiring only) | PR review                    |
| Subscriber-visible regressions  | 0 (baseline)                        | 0 (must not increase)      | 30-day post-deploy window    |
| Duplicate re-upload occurrences | "sometimes"                         | 0 in 30-day window         | Log inspection post-deploy   |
| Missed-episode occurrences      | "sometimes"                         | 0 in 30-day window         | Log inspection post-deploy   |

## Product Scope

### MVP — Minimum Viable Initiative

The initiative is meaningful only if all of the following ship. Non-negotiable, sequenced in execution order:

1. **Characterization Test Suite (Epic 1)** — ≥80% coverage, two named defects reproduced by failing tests. Prerequisite to every downstream epic.
2. **Defect Fixes (folded into Epic 2)** — duplicate re-upload and missed-episode root causes fixed, failing tests pass.
3. **Dependency & Runtime Modernization (Epic 4)** — Node 24, latest-stable deps, unused-dep removal. Intentionally sequenced early so the rest of the work happens on a supported runtime with current tooling. ESLint 9 flat-config migration included.
4. **Antipattern Removal & Clean Code (Epic 2)** — every antipattern in project-context.md addressed.
5. **CI/CD Pipeline (Epic 5)** — GitHub Actions with lint, test, coverage-gate. Deploy automation deferred.

### Growth — Post-MVP Enhancements

- **Revised Architecture (Epic 3)** — structural refactor of `app.js` into services. Done after the MVP epics because it's the highest-risk work and benefits most from the full test safety net and clean dependency baseline.
- **Coverage threshold ratchet** — raise the gate from 80% → 85% → 90% as tests mature.
- **Deploy automation in CI** — extend the workflow to deploy-on-tag or scheduled deploy.
- **Structured logging adoption** — replace the `lib/helpers` log trio with a real logger (winston becomes used instead of orphaned), JSON-formatted output, log levels.
- **Documentation refresh** — README updated for the new architecture; JSDoc Spanish→English consolidation.
- **ESLint ruleset modernization** — adopt `@eslint/js` / Airbnb-base as a foundation instead of the hand-rolled `eslint:recommended` + ~80 overrides.

### Vision — Aspirational

- Multi-instance / multi-tenant deployment so others can self-host.
- Web dashboard for admins (channel health, upload history, manual-requeue UI).
- Expanded source support beyond RSS (YouTube podcasts, direct uploads).
- Full observability stack: metrics, alerts, error tracking integration.
- Publish as an npm package / Docker image for community reuse.

### Out of Scope (explicit non-goals)

To prevent drift:

- Building any UI (web dashboard, admin panel, subscriber portal).
- Exposing any HTTP API.
- Multi-tenant / multi-instance capability.
- Supporting additional source types beyond RSS.
- Migrating from CommonJS to ES Modules.
- Changing the deployment target (Linux host + cron stays).
- Rewriting in TypeScript. Not ruled out for a future initiative; explicitly not this one.
- Replacing MySQL with a different database.
- Scaling for more than the current subscriber count.

## User Journeys

> **Template adaptation.** delsolbot has no UI; subscribers consume audio passively from Telegram, and the maintainer interacts via git/CLI. The richest "journeys" here are **system execution flows**, not human narratives. This section combines two human personas, one AI-collaborator operational pattern, and three system journeys that inform functional requirements.

### Persona 1 — Ana, the Commute Listener (Subscriber)

Ana lives in Montevideo. She subscribes to three Telegram channels delsolbot publishes. She never interacts with the bot directly — she just opens Telegram on the bus.

- **Opening scene.** 07:45 on a Tuesday. Ana boards the 103 bus, opens Telegram, navigates to her three subscribed channels. The top post in each is yesterday's episode, already played.
- **Rising action.** By 08:10, as she's walking the last block to work, a new audio post appears in one of the channels — "🔊 Aguante los Pibes — episode 2026-04-21." She taps it. Telegram streams the audio inline; she doesn't download.
- **Climax.** The episode plays smoothly from start to finish. The caption gives her the episode title and description, enough context to know whether to listen now or save for tomorrow.
- **Resolution.** She listens on the walk home. Over six years of subscribing, she has never thought about delsolbot. That's the point: the bot is **invisibly reliable** — the only thing she'd notice is if it stopped working.

**Requirements this reveals:** prompt delivery after RSS update; captions with useful context; zero duplicate posts; zero silent channels.

### Persona 2 — Mauri, the Maintainer-Learner

Mauri built delsolbot six years ago, before he understood async/await. Today he wants to add a feature — maybe a new RSS source, maybe a caption format tweak.

**Current state (the "adventure"):** Open `app.js`, 330 lines. Read `main → processFeed → processItem → sendToTelegram`. Remember the forward-vs-upload branch. Remember the splitter. Search for where captions are built. Make the change, unsure if anything is broken — there are no tests. Run the bot in `NODE_ENV=local` with `TEST_CHANNEL` set, watch the logs, and hope. Deploy. Refresh the test channel. It worked. This time. Mild anxiety lingers until the next subscriber says nothing.

**Target state (post-initiative):** Open the repo. Modules have clear seams: `lib/feed`, `lib/telegram`, `lib/audio`, `controllers/db`. Find the caption builder in one file, touch 10 lines. Run `npm test`. Green. Open a PR. GitHub Actions runs lint, tests, coverage-gate. All green. Merge. Deploy. The change works the first time because the tests are trustworthy. No anxiety.

**Requirements this reveals:** clear module seams; trustworthy test safety net; CI that catches regressions automatically; documentation that captures *why*.

### Persona 3 — Claude, the AI Agent Collaborator

AI agents (this one, future ones, Codex, others) are first-class contributors per the maintainer's vision.

- Opens the repo, reads `_bmad-output/project-context.md` first.
- Uses BMad skills to scope work (PRD, architecture, create-story, dev-story).
- Writes code that follows the documented conventions.
- Runs lint + tests locally before proposing changes.
- Surfaces uncertainty rather than guessing.

**Requirements this reveals:** project-context.md must stay current; conventions must be consistent and testable; the test suite is the agent's safety net — agents can't "just try the bot in local mode and see."

### System Journey A — RSS Feed Polling (Happy Path)

Runs on every cron tick for every configured source.

1. Cron fires `main()` per `CRON_MAIN` schedule.
2. `DbController.getRssList()` returns N sources.
3. For each source, `processFeed(rssSource)` pulls the feed via `rss-parser`.
4. For each item: `processItem(item, title)`.
5. `DbController.getPodcastById(itemId)` returns historical rows across all channels.
6. **Decision:** already uploaded to *this* channel → skip. Already uploaded to *another* channel → forward path. Neither → fresh upload.
7. Fresh: download MP3 → split if >50MB → write ID3 tags → upload each part to Telegram → register each upload in DB.
8. Between sources: `pause(1000)` to ease Telegram rate limits.
9. Finally: `cleanDownloads(DDIR)` wipes the working directory.

### System Journey B — Forward Path (Multi-Channel Reuse)

When an episode already exists on another channel, reuse its Telegram `file_id`.

1. Steps 1–5 from Journey A.
2. At step 6, `priorUploads` has entries for other channels.
3. For each prior upload, build the caption (with `(Parte N)` if multi-part) and pass the `file_id` string to `sendEpisodeToChannel`.
4. Telegram accepts the `file_id` in the `audio` form field; no byte transfer.
5. Each forward registers in DB with the new `file_id` (forwards can produce a different `file_id` on re-post).

### System Journey C — Failure Recovery

**Defect 1: Duplicate re-upload.** Current: Telegram upload succeeds, `registerUpload` fails (network blip, MySQL timeout). Exception is logged. Next tick, `getPodcastById` returns no row, bot re-uploads, subscriber sees a duplicate. Target: `registerUpload` retries with backoff, OR a reconciliation step detects the prior `message_id`, OR DB insert happens before Telegram send in a two-phase pattern. Mechanism chosen in architecture epic.

**Defect 2: Missed episode.** Cause unconfirmed. Hypotheses: (a) RSS transient failure + swallowed `processFeed` exception; (b) stale DB query; (c) `getIdFromItem` deriving a different id than last time. Root-cause determination is part of Epic 1. Target: cause identified, reproduction test added, fix verified, 30-day window observes zero skips.

## Integration-Service Specific Requirements

> **Template adaptation.** The `api_backend` CSV template assumes an API is *exposed*. delsolbot does not expose any API; it *consumes* Telegram's Bot API and RSS feeds, and *owns* a MySQL schema. The sections below reframe each required CSV category for a consumer + stateful-worker service.

### Project-Type Overview

delsolbot is a **cron-driven integration service** — a Node.js daemon that does three things on every tick: pulls RSS feeds from configured sources (consumer), downloads/transforms/publishes MP3 episodes to Telegram (consumer), and maintains MySQL-backed state for idempotency and multi-channel forward reuse (owner). No endpoints are exposed. No HTTP server runs.

### Consumed APIs

| API                          | Methods used                                   | Trust boundary | Versioning strategy                                |
|------------------------------|------------------------------------------------|----------------|----------------------------------------------------|
| **Telegram Bot API**         | `POST /bot{TOKEN}/sendAudio` (primary)         | External       | None today. Breakage caught at runtime.            |
| **RSS feeds** (per source)   | `GET` via `rss-parser` (1 feed URL per source) | External       | None. Feed XML schema assumed stable.              |
| **MP3/ID3v2 + cover images** | Feed-embedded URLs + static `assets/cover.jpg` | External data  | None. Graceful fallback to static cover on error.  |
| **MySQL 8.x**                | Parameterized queries via `mysql2/promise`     | Owned          | Schema versioned via `database/update_NNN.sql`.    |

**Initiative implications:** wrap each external API in a dedicated client module (`lib/telegram/client.js`, `lib/feed/client.js`) with tight contracts. Contract tests freeze the response shape expected at the trust boundary. The raw-axios calls currently in `app.js` move into the Telegram client and are unit-tested with mocked axios.

### Authentication Model

| Subject                | Mechanism                                           | Storage        | Rotation policy                               |
|------------------------|-----------------------------------------------------|----------------|-----------------------------------------------|
| Telegram Bot           | Bot token in URL (`/bot{BOT_TOKEN}/...`)            | `.env` var     | Manual; never rotated in practice             |
| MySQL                  | User/password (`DB_USER`, `DB_PASS`)                | `.env` var     | Manual                                        |
| Outbound HTTP (RSS)    | None (public feeds)                                 | —              | —                                             |
| Inbound (to delsolbot) | N/A — no inbound surface                            | —              | —                                             |

**Initiative implications:** BOT_TOKEN must never be logged — reinforced by a contract test. Environment variables move from direct `process.env.X` reads to a single `lib/config.js` module that validates required vars at startup and fails fast.

### Data Schemas

**1. RSS item schema** (what we read from feeds after `rss-parser`): `items[].link` (stable episode id source, currently ends in `.mp3`); `items[].title`; `items[].content` (HTML in caption); `items[].itunes.image` (string or object, fallback to static cover). Validate with `validateRssItem(item)` — skip malformed items without crashing `processFeed`.

**2. Telegram API response schema** (what we read back from `sendAudio`): `data.ok === true` (currently unchecked); `data.result.audio.file_id` → `podcasts.file_id`; `data.result.message_id` → `podcasts.msg_id`. Contract test freezes this shape.

**3. MySQL schema (owned).** Current state — do not reshape without a migration plan (6 years of prod data):

```sql
-- sources: RSS source catalog
id INT PK AUTO_INCREMENT
url VARCHAR(120) NOT NULL          -- feed URL
channel VARCHAR(120) NOT NULL      -- Telegram channel id or @handle
nombre VARCHAR(80)                  -- human-friendly name (Spanish column)

-- podcasts: upload history per (episode × channel)
id INT PK AUTO_INCREMENT
archivo VARCHAR(15) NOT NULL       -- episode id from getIdFromItem (hard constraint)
title VARCHAR(120)
caption TEXT
url VARCHAR(120)
obs VARCHAR(255)                    -- observations / error notes (Spanish column)
pudo_subir BOOLEAN                  -- success flag (Spanish column: "could upload")
msg_id VARCHAR(20)                  -- Telegram message_id
fecha_procesado TIMESTAMP           -- processed date (Spanish column)
file_id VARCHAR(120)                -- Telegram file_id
destino INT NOT NULL                -- FK → sources.id (Spanish column)
```

Spanish column names stay; migration cost exceeds rename value. `pudo_subir` is the primary dupe-check flag — architecture epic reconciles how it interacts with the duplicate-upload defect fix.

### Error Handling Contracts

| Boundary                            | Failure modes                                        | Current behavior                 | Target behavior                                          |
|-------------------------------------|------------------------------------------------------|----------------------------------|----------------------------------------------------------|
| Telegram `sendAudio` 4xx            | invalid token, chat not found, file too large        | Log, continue loop               | Typed error; upload skipped; DB records failure reason   |
| Telegram `sendAudio` 429            | rate limit exceeded, has `retry_after`               | Log, continue loop (loses send)  | Backoff + retry up to N times; if still fails, DB record |
| Telegram `sendAudio` 5xx            | Telegram outage                                      | Log, continue loop               | Backoff + retry; persist pending state for next tick     |
| RSS fetch timeout                   | feed host down                                       | Exception bubbles, processFeed dies | Per-feed try/catch, skip feed, log, continue loop     |
| MySQL `INSERT` failure              | pool exhaustion, timeout, transient network          | Log; next tick re-uploads (bug)  | Retry-to-exhaustion OR reconciliation (Epic 3 decision)  |
| ffmpeg probe/split failure          | corrupt MP3, binary not on PATH                      | Exception bubbles                | Log, skip episode, mark in DB so next tick doesn't retry |
| node-id3 `write` returns `false`    | write failed silently                                 | Ignored (return not checked)     | Check return, log, abort upload for that episode          |

### Rate Limits (outbound)

| Target          | Documented limit                                     | Our current handling              | Target handling                                   |
|-----------------|------------------------------------------------------|-----------------------------------|---------------------------------------------------|
| Telegram Bot API| ~30 messages/second global; ~20/minute per channel   | `pause(1000)` between feed loops  | Per-call delay + proper `retry_after` honoring    |
| RSS sources     | No documented limits; courtesy expected              | No throttling (1 fetch/source/tick) | Unchanged — current frequency is polite        |
| MySQL pool      | 10-connection limit (self-imposed)                   | `finally { release }` on every query | Unchanged — pattern is already correct          |

### Implementation Considerations

- **Node runtime:** target Node.js 24.x LTS. Migration is part of Epic 4.
- **Module system:** CommonJS stays. No ES modules migration in scope.
- **Package manager:** npm. `package-lock.json` is currently `.gitignore`d — reconsider during Epic 4 since ignoring lockfiles means non-reproducible installs.
- **Deployment target:** Linux host under an external supervisor. `ffmpeg` and `ffprobe` must be on PATH.
- **State:** All state in MySQL. Downloads directory is ephemeral and cleaned each tick.

## Scoping Strategy & Sequencing Rationale

The MVP / Growth / Vision lists live in **Product Scope** above. This section captures the *why* — MVP philosophy, epic sequencing rationale, risks, and known unknowns.

### MVP Philosophy: risk-reduction, not concept-validation

Most MVPs optimize for "prove this concept works." This project's concept has been working for 6 years. This MVP optimizes for something else: **reduce the risk of breaking what works while modernizing the stack**.

Strategic principle: **every epic must either (a) make the codebase safer to change, or (b) happen under the safety net built by Epic 1.** No epic ships without a corresponding test gate. No refactor of `app.js` begins before characterization tests for what `app.js` currently does. No Node 24 upgrade merges before the test suite runs green on 24.

This rules out the common failure mode for brownfield modernization: yak-shaving into a partial refactor that broke three things no one tested for.

**Resource model:** solo maintainer plus AI agents (Claude via BMad method). No team coordination overhead. No deadline. Permits a deliberate, slow-and-safe sequence a commercial project often can't afford.

### Epic Sequencing Rationale

| Position | Epic                     | Why here                                                                                                                                                |
|----------|--------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1        | Test Suite               | **Everything else depends on it.** Without characterization tests, no subsequent epic can verify it didn't regress behavior.                            |
| 2        | Defect Fixes             | Folded into Epic 2 because each defect fix needs a failing test from Epic 1 and the target semantics for DB/retry from Epic 3 thinking.                 |
| 3        | Dependency Modernization | **Before refactor, not after.** Refactoring on Node 20.x when we're moving to 24.x means doing work twice. Node 24 may surface latent bugs — find via tests first. |
| 4        | Antipattern Removal      | Safe once Epic 1 is in place. Groups well with Epic 2 defect fixes since both touch the same files.                                                     |
| 5        | CI/CD Pipeline           | Last in MVP because it codifies gates that all prior epics have proven green locally. Adding CI earlier conflates failure signals.                      |
| —        | Revised Architecture     | **Growth, not MVP.** Biggest-risk work; benefits most from full safety net and modernized tooling. Attempting it earlier means debugging a refactor without a complete test suite *and* on a deprecated runtime. |

### Risk Mitigation Strategy

**Technical risks**

| Risk                                                           | Likelihood | Impact  | Mitigation                                                                                                                                               |
|----------------------------------------------------------------|------------|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Dep upgrade breaks behavior silently                           | Medium     | High    | Epic 1 delivers ≥80% coverage *before* Epic 4 upgrades land. Each upgrade PR runs the full test suite.                                                  |
| Node 24 has incompatibility with `fluent-ffmpeg` or `mysql2`   | Low-Med    | Medium  | Test suite runs on Node 24 in CI from Epic 5 onward. If a dep blocks the upgrade: pin, patch, or swap.                                                  |
| Characterization tests "memorize bugs"                          | Medium     | Medium  | For the two named defects, write *failing* tests asserting correct behavior. Be explicit in review which tests capture bug-as-feature.                   |
| ESLint 9 flat-config migration touches every rule              | High       | Low     | ESLint is already broken; no regression possible. Migration lands in Epic 4 as a dedicated story.                                                        |
| Architecture epic (Growth) introduces subtle regressions       | High       | High    | Full test suite required green throughout. Refactor in small PRs, one module at a time. Rollback plan per PR.                                           |
| Mocks diverge from real Telegram API shape                     | Medium     | Medium  | At least one integration-style test against a recorded real-Telegram response fixture, refreshed periodically.                                          |

**Subscriber-impact risks** (replaces "market risk")

| Risk                                            | Likelihood | Impact | Mitigation                                                                                                                                              |
|-------------------------------------------------|------------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| Refactor causes a channel to go silent          | Low        | High   | CI gates on every merge; deploy only from green master; manual smoke-test after deploy (one tick in `NODE_ENV=local` with `TEST_CHANNEL`).               |
| Refactor causes duplicate posts                 | Medium     | Medium | Duplicate-upload defect fix is an MVP deliverable — initiative can't ship without it.                                                                   |
| Caption format accidentally changes             | Medium     | Low    | Characterization tests pin the caption format. Intentional format changes must update the test deliberately.                                            |
| `file_id` reuse logic breaks                    | Low        | High   | Journey B is covered by dedicated tests in Epic 1. Changes to the forward path flagged in PR template.                                                  |

**Resource risks**

| Risk                                          | Likelihood | Impact | Mitigation                                                                                                                                              |
|-----------------------------------------------|------------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| Solo maintainer loses interest mid-initiative | Medium     | Medium | Each MVP epic ships *independent* value. If Epic 3 (Growth) is never done, MVP still ships tests + fixes + upgrades + CI.                              |
| Time gap between sessions loses context       | Medium     | Low    | Strong artifact trail (PRD, architecture doc, epics, per-story context files) lets AI agents re-hydrate without re-discovery.                           |
| AI collaboration quality degrades              | Low        | Medium | project-context.md is the contract. Stale context is a P1 issue.                                                                                        |

### Known Unknowns

Deferred decisions, flagged so they don't sneak in as premature commitments:

- **Root cause of "missed episode" defect.** Three hypotheses in Journey C. Resolution is part of Epic 1 characterization.
- **Telegram rate-limit backoff strategy.** Exponential vs `retry_after`-driven, max retries, dead-letter behavior — architecture-epic decision.
- **Duplicate-upload fix approach.** Retry-to-exhaustion, reconciliation loop, or two-phase pattern — architecture-epic decision.
- **Whether `package-lock.json` becomes committed.** Decision during Epic 4 dep-cleanup.
- **Whether `winston` stays as dead code or gets adopted** for structured logging. If Growth structured-logging lands, winston is used; otherwise removed in Epic 4.
- **ESLint ruleset direction** (keep hand-rolled 80-rule config vs adopt a community base). Decision during Epic 4 migration.
- **Deploy automation in CI.** Decision during or after Epic 5, based on how painful manual deploy feels.

## Functional Requirements

> **Capability contract.** Every capability this initiative delivers must trace to an FR below. Tagging convention:
> - **[P]** Preserved — current production behavior the initiative must not break.
> - **[N]** New — capability the initiative introduces.
> - **[F]** Fix — explicit correction of known-broken current behavior.

### Feed Ingestion

- **FR1 [P]:** The system can poll N configured RSS sources (stored in the `sources` MySQL table) on a cron schedule defined by the `CRON_MAIN` environment variable.
- **FR2 [P]:** The system can parse an RSS feed into a normalized list of items exposing `link`, `title`, `content`, and `itunes.image`.
- **FR3 [P]:** The system can derive a stable episode identifier from an RSS item's `link` (historically: path tail with `.mp3` stripped). This identifier is load-bearing and stored in `podcasts.archivo`.
- **FR4 [N]:** The system can skip an individual malformed RSS item (missing `link`, non-string where string expected) with a logged warning, without aborting processing of the surrounding feed.
- **FR5 [F]:** The system can continue processing remaining feeds when one feed fetch fails (currently: an exception in `processFeed` can abort the surrounding tick).

### Audio Acquisition & Transformation

- **FR6 [P]:** The system can download an MP3 episode from a feed-provided URL to a per-channel working directory.
- **FR7 [P]:** The system can download a cover image from a feed-provided URL; falling back to a static `assets/cover.jpg` when the image URL is missing or non-string.
- **FR8 [P]:** The system can write ID3v2 tags (artist, title, comment, track, front-cover image) to a downloaded MP3 file.
- **FR9 [P]:** The system can split an MP3 file exceeding 50MB into sequential parts by detecting silence regions and cutting at the closest silence within 10 seconds of the ideal split time, falling back to the ideal time when no silence is near.
- **FR10 [P]:** The system can clean the working directory at the end of each cron tick regardless of outcome.
- **FR11 [N]:** The system can detect when `ffmpeg` or `ffprobe` binaries are missing from PATH and fail with a clear, actionable error at startup rather than at first use.

### Telegram Publishing

- **FR12 [P]:** The system can upload an audio file to a Telegram channel via `POST /bot{TOKEN}/sendAudio` with caption, performer, title, and HTML parse mode.
- **FR13 [P]:** The system can forward a previously-uploaded episode to a new channel by passing its Telegram `file_id` as the audio payload, avoiding re-upload of bytes.
- **FR14 [P]:** The system can handle multi-part episodes by iterating parts, adding `(Parte N)` prefix to captions, and recording each part separately.
- **FR15 [P]:** The system can route all outbound posts to `TEST_CHANNEL` when `NODE_ENV !== 'prod'`, overriding the per-source channel.
- **FR16 [N]:** The system can validate the Telegram API response shape (`data.ok === true`, `data.result.audio.file_id`, `data.result.message_id`) and produce a typed error when the shape does not match expectations.
- **FR17 [N]:** The system can retry a `429 Too Many Requests` response from Telegram, honoring the `retry_after` hint, up to a configurable retry budget.
- **FR18 [N]:** The system can retry a transient 5xx response from Telegram with exponential backoff up to a configurable retry budget.

### State Management & Idempotency

- **FR19 [P]:** The system can record each upload attempt in the `podcasts` table with file, observation, success flag, Telegram `file_id`, destination channel, title, caption, URL, and Telegram `message_id`.
- **FR20 [P]:** The system can query upload history for a given episode identifier across all channels to decide whether to skip, forward, or upload fresh.
- **FR21 [P]:** The system can maintain a single `mysql2/promise` connection pool with at most 10 concurrent connections, acquired and released per query.
- **FR22 [F]:** The system can guarantee that a successful Telegram upload *always* produces a corresponding `podcasts` row, even under transient MySQL write failure. (Resolves duplicate-re-upload defect; mechanism is an architecture decision.)
- **FR23 [F]:** The system can detect and not re-upload an episode that was actually delivered in a prior tick but missed a DB record. (Secondary safety net for duplicate prevention.)
- **FR24 [F]:** The system can avoid silently skipping episodes when an RSS feed is transiently unavailable or when `getIdFromItem` derivation changes for the same underlying episode. (Resolves missed-episode defect; requires root cause determination in Epic 1.)

### Configuration & Environment

- **FR25 [N]:** The system can validate all required environment variables (`BOT_TOKEN`, `DB_HOST`, `DB_USER`, `DB_PASS`, `DB`, `CRON_MAIN`, `NODE_ENV`, `TEST_CHANNEL` when non-prod) at startup and fail fast with a clear message when any are missing or malformed.
- **FR26 [P]:** The system can be run immediately (bypassing the cron schedule) when `NODE_ENV=local`.
- **FR27 [N]:** The system can be configured with retry budgets, rate-limit pause durations, and Telegram file-size threshold via environment variables (currently hardcoded as `pause(1000)` and `TELEGRAM_THRESHOLD = 50`), with safe defaults preserving current behavior.

### Logging & Observability

- **FR28 [P]:** The system can emit timestamped `info` logs (`log`), `error` logs (`logError`), and debug-gated logs (`debug`, enabled by truthy `DEBUG` env var).
- **FR29 [N]:** The system can scrub the Telegram bot token from any URL that appears in logged output.
- **FR30 [N]:** The system can emit a summary log at the end of each cron tick: number of feeds processed, episodes uploaded, episodes forwarded, episodes skipped, errors encountered.

### Quality Assurance (Testing)

- **FR31 [N]:** The repository provides a Jest test suite runnable via `npm test`, with coverage reporting via `npm run test:coverage`.
- **FR32 [N]:** The test suite achieves ≥80% line coverage and ≥70% branch coverage on `app.js`, `controllers/**/*.js`, and `lib/**/*.js`, enforced via `coverageThreshold`.
- **FR33 [N]:** The test suite includes a failing regression test for each named defect (duplicate re-upload, missed episode) that passes once the defect is fixed.
- **FR34 [N]:** The test suite can run without network access, without a real MySQL instance, and without real `ffmpeg` or `ffprobe` binaries, using mocked boundaries.
- **FR35 [N]:** The test suite includes at least one contract test per external boundary (Telegram API response shape, RSS item shape) that would fail if the external contract changes.

### Code Quality & Maintainability

- **FR36 [N]:** The repository provides a working lint command via `npm run lint` that exits green on master under ESLint 9 flat-config.
- **FR37 [N]:** Every antipattern catalogued in `_bmad-output/project-context.md` is either removed or explicitly retained with a documented rationale in project-context or the PR.
- **FR38 [N]:** `app.js` is reduced to an entry-point and wiring module of ≤100 lines; orchestration and external-client logic moves to dedicated `lib/` modules.
- **FR39 [N]:** Declared-but-unused dependencies (`winston`, `xml2js`) are either removed from `package.json` or actually adopted. Legacy `mysql` v2 is removed. `nodemon` is relocated to `devDependencies`.

### Build, Runtime & Dependencies

- **FR40 [N]:** The system runs on Node.js 24.x LTS.
- **FR41 [N]:** All remaining dependencies are at their latest stable compatible versions at the time of merge.
- **FR42 [N]:** `npm audit` reports zero high-severity and zero critical-severity vulnerabilities against the initiative's final dependency set.

### Continuous Integration

- **FR43 [N]:** The repository provides a GitHub Actions workflow that runs on every push and pull request, executing lint, test, and coverage-gate steps in sequence.
- **FR44 [N]:** The CI workflow fails if `npm run lint` fails, if any test fails, or if coverage falls below the configured threshold.
- **FR45 [N]:** The CI workflow runs on Node.js 24.x, matching the production runtime.
- **FR46 [N]:** The CI workflow is structured such that a deploy stage can be added later without restructuring (MVP does not include deploy automation).

### Documentation & Agent-Collaboration Support

- **FR47 [P]:** Every exported function and class method carries a JSDoc block with `@param` and `@returns`.
- **FR48 [N]:** `_bmad-output/project-context.md` is kept current with the final post-initiative state of conventions, antipatterns, and architectural decisions. Stale context is a P1 issue.
- **FR49 [N]:** `README.md` is updated to reflect the new directory structure, npm scripts, Node 24 requirement, and CI badge.
- **FR50 [N]:** Every MVP epic produces a per-epic retrospective note (captured via `bmad-retrospective`) summarizing what was built, what was learned, and what deferred.

## Non-Functional Requirements

> **Selective scope.** Scalability, Accessibility, and Integration are deliberately omitted — no growth mandate, no UI, and integration concerns are already covered in project-type requirements.

### Performance

- **NFR-P1:** A cron tick processing 3 feed sources with no new episodes completes in under 30 seconds, including RSS fetches and the `pause(1000)` between feeds.
- **NFR-P2:** Upload of a typical single-part episode (≤50MB, ~30–60 min of audio) to Telegram completes within 60 seconds on a baseline 10 Mbps upstream connection.
- **NFR-P3:** A published episode appears in its Telegram channel within two cron ticks of its RSS publication (first tick: detection + upload; second tick: worst-case retry window for a 5xx).
- **NFR-P4:** The full test suite (unit-level, fully mocked) runs in under 10 seconds on a baseline development machine. If the suite grows past this, it splits into fast/slow tiers — fast tier remains the CI gate.

### Security

- **NFR-S1:** `BOT_TOKEN` is never emitted in any log line, stack trace, error message, or CI workflow output. A contract test asserts this against URL-containing log paths.
- **NFR-S2:** `DB_PASS` is never emitted in any log line, stack trace, or error message. Direct `logError(error)` calls that might print mysql2 error objects with credentials must be scrubbed upstream.
- **NFR-S3:** All SQL queries are parameterized via `mysql2/promise` `con.execute(query, params)`. String interpolation of dynamic values into SQL is prohibited and enforced by code review.
- **NFR-S4:** `.env` files are never committed. `.env.example` is the only env file in the repo and contains only `replaceme` placeholders.
- **NFR-S5:** External data (RSS feed content, `itunes.image` URL, episode title) that reaches an HTML-parsed Telegram caption is HTML-escaped via `sanitizeContent` before interpolation. Feed-provided HTML in `content` is the single exception, trusted as feed markup.
- **NFR-S6:** The repository's dependency set reports zero high-severity and zero critical-severity findings from `npm audit`. Findings below that threshold are reviewed per-release but not auto-blocked.
- **NFR-S7:** File paths derived from external data (channel name, episode title) pass through `sanitizeFilename` or `sanitizeEpisode` before use as filesystem path components.

### Reliability

- **NFR-R1:** The service runs continuously under an external process supervisor. An uncaught exception inside a cron tick does not crash the process; it is logged and the next cron tick proceeds normally.
- **NFR-R2:** Recovery from transient Telegram failures (429, 5xx) completes within at most two cron ticks for the affected episode, assuming Telegram recovers within that window.
- **NFR-R3:** Recovery from transient MySQL write failures does not result in duplicate Telegram uploads on the subsequent tick. (Contract for the fix to FR22.)
- **NFR-R4:** A malformed or transiently unavailable single RSS source does not block processing of the other sources in the same tick.
- **NFR-R5:** The service operates correctly across MySQL pool saturation events: when `connectionLimit: 10` is reached, subsequent queries wait for connection release rather than failing, consistent with `mysql2/promise` default behavior.
- **NFR-R6:** Over a 30-day post-deploy monitoring window for the initiative's final release, observed duplicate-re-upload and missed-episode occurrences are zero.

### Maintainability

- **NFR-M1:** Test coverage enforced at ≥80% lines and ≥70% branches via `coverageThreshold` in `jest.config.js`. CI fails the build on any regression below these thresholds.
- **NFR-M2:** No single source file exceeds 250 lines (excluding JSDoc and blank lines). `app.js` additionally targets ≤100 lines post-refactor (FR38).
- **NFR-M3:** Cyclomatic complexity per function does not exceed 10 (enforced by ESLint `complexity: error`, which is already configured; validated to stay green after refactor).
- **NFR-M4:** No new commit introduces a new ESLint rule disable without a `// reason:` comment explaining the justification.
- **NFR-M5:** `_bmad-output/project-context.md` is updated whenever (a) a new convention is introduced, (b) an antipattern is removed or retained, or (c) an architectural decision changes. Stale context is treated as a P1 issue per FR48.
- **NFR-M6:** The repository can be cloned and set up for local testing in under 10 minutes on a baseline developer machine, following `README.md` instructions alone. "Set up" means: install deps, run lint green, run tests green.
- **NFR-M7:** An AI agent with no prior context on the repo can produce a working change to the codebase by reading only `README.md` and `_bmad-output/project-context.md`, plus the target file(s). Validated by the post-initiative retrospective.

### Observability

- **NFR-O1:** Every cron tick emits a start log, per-source start/finish logs (current behavior preserved), and an end-of-tick summary log per FR30.
- **NFR-O2:** Every error path emits `logError` with enough context to identify the affected episode (`archivo`/`itemId`), the affected channel, and the operation that failed.
- **NFR-O3:** A single episode's lifecycle can be reconstructed by grepping logs for its episode identifier. No log line about an episode omits the identifier.
- **NFR-O4:** `DEBUG=1` produces enough detail to diagnose a failed upload without additional code instrumentation. `DEBUG=0` (default) emits only `log` and `logError` output.
- **NFR-O5:** Log output is suitable for piping to a file or journald without modification. No interactive terminal assumptions (colors, cursor control).
