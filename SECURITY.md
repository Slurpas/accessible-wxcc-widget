# Security

## Model in one paragraph

The widget is a static JavaScript file. It has no server, no database, no login and no
credentials. Desktop loads it into the agent's already-authenticated Desktop page, and it
uses Cisco's Desktop SDK, which acts with the agent's own session and permissions.
It can only do what the agent can already do in Desktop: read their own state and calls,
change their own state, and list colleagues they may consult. It never asks for, reads or
stores an access token.

## Rules and how they are enforced

| Rule | How it is enforced |
|---|---|
| No client secrets, admin tokens, API keys | Nothing to configure. `tests/security.test.js` scans `src/`; `scripts/verify-bundle.mjs` scans the built file. Both run in CI. |
| No access token in the browser code | The widget never calls `Desktop.actions.getToken()` or binds `STORE.auth`. A test fails if anyone adds it. |
| No tokens or call data in localStorage/sessionStorage | Only `accessible-wxcc-widget.prefs` = `{theme, textSize}` is stored. A test fails on any other storage use. |
| No third-party analytics or network calls | No `fetch`/XHR/WebSocket/beacon in production code (tested). All Webex traffic goes through the Desktop SDK. |
| No customer data to GitHub | The repo holds code only. Mock data is fictitious. `.gitignore` excludes `.env*`, `secrets/`, `*.har`, `test-data/`. Never commit HAR files or screenshots with real numbers. |
| No full payloads in logs | `src/utils/logger.js` turns every object argument into `[object]` before writing. Only event names, error messages and counts are logged. Logs go to Desktop's own logger. |
| Call data only in memory, only while needed | `ContactService` keeps a `Map` of active interactions. Entries are deleted on wrap-up/end/RONA, and the whole map is cleared on unmount. |
| No HTML injection | All text from Webex is inserted with `textContent`. `innerHTML`/`eval` are forbidden by a test. |
| No admin privileges | Only agent-level SDK calls are used (see docs/API-AND-PERMISSIONS.md). |
| Mock mode cannot touch a real agent | The mock never imports the SDK. Inside Desktop the real adapter is always chosen. Production builds do not contain the mock (verified after every build). |

## Hosting security

- The published bundle contains **no secrets and no tenant data**, so public readability
  (e.g. GitHub Pages) does not leak anything except the source code itself. If the
  organisation does not want its widget code readable, host it on company-controlled
  static hosting with network restrictions (see DEPLOYMENT.md).
- Serve over **HTTPS only**, from a host the organisation controls or trusts. Anyone who
  can change the file at that URL can run code inside agents' Desktop sessions, so
  protect write access (branch protection, required reviews, `github-pages` environment
  approval, or equivalent controls on your CDN).
- `dist/build-info.json` records the SHA-384 of every build, so you can confirm the file
  being served is the one you approved:
  `curl -s <URL> | openssl dgst -sha384 -binary | openssl base64 -A`.

## Supply chain

- Runtime dependency: `@wxcc-desktop/sdk` (Cisco), pinned to an exact version. The lockfile
  is committed and CI uses `npm ci`.
- `npm audit` (2 Nov 2026) reports advisories in packages the SDK declares
  (`i18next-http-backend`, `uuid`, via `@uuip/unified-ui-platform-sdk`). The SDK's
  published `dist/index.js` is a self-contained webpack bundle. The vulnerable code paths
  (i18n HTTP backend URL building, `uuid` with caller-supplied buffers) are not used by
  this widget. Track Cisco SDK releases and re-run `npm audit` on each update.
- Dev tools (Vite, Vitest, jsdom) run only on the build machine and are not shipped.

## Review checklist (Phase 7 — done 2 Nov 2026)

- [x] Exposed secrets: none in source or bundle (automated scans).
- [x] Unnecessary permissions: agent-session SDK calls only; REST/admin APIs not used.
- [x] External tracking: none.
- [x] Persistent customer information: none; only theme/text-size stored.
- [x] Event cleanup: every SDK listener is removed on unmount (tested); timers cleared; shared SDK released when the last widget instance unmounts.
- [x] Status synchronisation: Webex is the source of truth; requested state never shown as confirmed (tested).
- [x] API assumptions: listed with fallbacks in README "Assumptions".
- [x] Accessible buttons: native `<button>`, ≥ 80 px tall, labels, `aria-pressed`, `aria-disabled` (keeps focus), visible focus ring.
- [x] Contrast: all colour pairs ≥ 4.5:1, body text ≥ 7:1 (automated test).

## Reporting a problem

Report suspected security issues to the Contact Center system owner. Do not open a public issue.
