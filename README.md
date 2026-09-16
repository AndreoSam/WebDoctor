# WebDoctor v3.8

WebDoctor v2.0 turns the experimental QA engine into a persistent project workflow.

## New in v2.0
- Every completed website scan is saved locally in `data/scan-history.json`.
- Verified projects expose **Scan History**.
- **Compare Latest Scans** compares the newest scan with the previous scan.
- Regression report shows health-score change, issue-count change, fixed findings, new findings and unchanged findings.
- Existing verification, Browser QA, Form QA, safe simulation and Capacity Lab remain available.

## Run
```bash
npm install
npx playwright install chromium
npm start
```
Open http://localhost:3000

For regression, run the same verified website scan at least twice, then click **Compare Latest Scans**.

## v2.1 — Project dashboard navigation
- Adds a project summary card for the active scanned website.
- Reorganizes the long report into Overview, Issues, Browser QA, Deep QA, Capacity and Regression tabs.
- Keeps all v2.0 scan history, regression, verification, Form QA and Capacity Lab behavior intact.


## v2.3 — Dashboard polish
- Fixes the Current Project health card so it reads the actual scan health score.
- Uses the scan timestamp rather than the current render time in the project summary.
- Keeps project navigation sticky on desktop with stronger active-tab treatment.
- Compacts the large marketing hero after a scan so the project dashboard becomes the visual focus.
- Preserves all v2.1 QA, verification, capacity, history and regression behavior.


## v2.3 — AI Investigator

Adds a free local evidence-based investigation engine. It does not require an OpenAI, Gemini, or other paid API key. Select a WebDoctor finding (or the top findings) to get likely cause, impact, prioritized remediation, code/config examples where useful, and explicit retest steps. The engine clearly labels diagnosis confidence and does not claim access to private server-side implementation details.


## v3.7 Monitoring & Action Center
Adds a focused project action center with current health, high-priority findings, changes since the prior scan, quick retest/investigation/regression/report actions, and lightweight success/error toast feedback.


## v3.7 Website Watch
Verified projects can configure hourly, daily, or weekly monitoring. Due checks run while the Node server is online, with last/next run status and health-change signals. Monitoring remains local and zero-cost; production deployments can pair the app with a scheduler/cron that keeps the service available.


## v3.7 Monitoring alerts
Website Watch now persists project-scoped monitoring events in `data/monitoring-events.json`, surfaces unread badges, severity-aware alerts, a monitoring timeline, acknowledgement controls, and shortcuts to investigation, regression comparison, and the client Health Report.


## v3.7.1 Smarter monitoring alerts
- Routine successful checks are stored but do not increase unread badges.
- Persistent high-priority findings no longer create duplicate HIGH alerts on every run.
- HIGH alerts are created for newly introduced high-priority findings.
- Resolved issues and health recovery create RESOLVED timeline events.
- Timeline uses NEW, ONGOING and RESOLVED state chips.


## v3.8 Alert reconciliation
- Unread badges count only unresolved NEW actionable alerts.
- Recovery/resolution checks automatically acknowledge matching earlier alerts.
- Timeline filters: All, Active, Resolved, Checks.
- Routine checks remain history and never inflate actionable counts.


## v3.8 — External Notifications
Verified projects can optionally send actionable monitoring events to a public HTTPS webhook. WebDoctor sends NEW alerts and, when enabled, RESOLVED/recovery events. Private/local destinations are blocked, delivery has a 10-second timeout, and an optional shared secret is sent in the `X-WebDoctor-Secret` header. Configuration is stored locally in `data/notification-settings.json`.
