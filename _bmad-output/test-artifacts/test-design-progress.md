---
workflowStatus: 'paused-awaiting-prerequisites'
totalSteps: 5
stepsCompleted: []
lastStep: 'step-01-detect-mode'
nextStep: './steps-c/step-02-load-context.md'
lastSaved: '2026-04-21'
---

# Test Design — Paused

## Pause reason

Prerequisites not met. System-Level mode requires PRD + ADR/architecture; Epic-Level mode requires epic + stories with acceptance criteria. Neither exists yet.

## Blocking dependencies

- PRD for the "general improvement initiative" (tests >80%, remove antipatterns, clean code, revised architecture)
- (Optional) Architecture doc once PRD scope is fixed

## Resume conditions

Resume this workflow once `_bmad-output/planning-artifacts/prd.md` exists. Re-enter via `[R] Resume` mode in `bmad-testarch-test-design`.

## Session context

- Project: delsolbot (brownfield Node.js Telegram bot, CommonJS, Jest 30.3.0)
- Prior session established `project-context.md` and Jest framework with 1 smoke test
- User intent: characterize existing behavior to ≥80% coverage before refactoring
