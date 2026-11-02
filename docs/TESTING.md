# Testing

## 1. Automated tests (no Webex needed)

```bash
npm test          # all unit/UI tests
npm run check     # tests + production build + bundle verification
```

### Results: 2 Nov 2026, Node 24.13, Vitest 5.1, jsdom 30.1

**11 test files, 135 tests, all passed.**

| File | Tests | Covers |
|---|---|---|
| `status-mapper.test.js` | 15 | Webex state → display mapping, unknown values never guessed, seconds/ms timestamps, team sort order |
| `auxiliary-codes.test.js` | 13 | Aux-code mapping (system codes excluded, default first, real IDs kept), colour rules, pagination with the documented payload, fallback, never-reject |
| `agent-state.test.js` | 18 | Loading → error timeout, STORE map, OFFLINE, external changes, other channel/agent ignored, stale updates ignored, exact `stateChangeV2` payloads, **requested state not shown before confirmation**, rejection, `undefined` response, unconfirmed timeout, no agentId, double-click guard, listener cleanup |
| `contact-events.test.js` | 17 | ANI/DNIS/queue extraction, outdial customer number, CAD fallback, hold, full lifecycle offer → connected → ANI update → hold → wrap-up → cleared, RONA, restore from task map (incl. Map-like observable; unknown shapes never blank the panel), multiple interactions, memory cleared on stop |
| `team-dashboard.test.js` | 10 | Team filter, self excluded, unfiltered case (logged, not shown), Available + Idle requests, no request without a UUID profile, **failure keeps last list and never marks OFFLINE**, failure response type, refresh limits (default 30 s, min 15 s), refresh on return to the tab, stale flag, timer cleanup |
| `widget.test.js` | 18 | Whole Web Component with the mock adapter: rendering, headings in reading order (status, call, buttons, team), dense grid for many idle codes, "updates automatically" text, aria-pressed, pending → confirmed + live announcement, **focus not stolen**, failure announced assertively, disabled without agentId, external change, call lifecycle and spoken number, team filter/counts, team off by attribute, **team failure does not affect status buttons**, offline → "STATUS NOT VERIFIED", theme/text-size preferences (only prefs stored), unmount cleanup + remount, properties set before upgrade |
| `desktop-sdk.test.js` | 2 | Real adapter with a fake SDK: unmount + remount keeps `stateChangeV2` working, `Desktop.config.cleanup()` never called, only own listeners removed |
| `team-probe.test.js` | 6 | Read-only team probe: buddy counts, real-time dataset results and data shapes; **no names, e-mail, numbers, IDs or tokens in the report**; every subscription closed; no state change; works without Desktop |
| `outside-desktop.test.js` | 3 | Real adapter: outside Desktop shows a diagnostic, buttons disabled, mock **not** used even with `mock="true"` |
| `contrast.test.js` | 26 | WCAG contrast of every colour pair in both themes: chips ≥ 4.5:1, body text ≥ 7:1, borders/focus ≥ 3:1 |
| `security.test.js` | 7 | No secrets, no direct network calls, no token access, storage only for prefs, no innerHTML/eval, no third-party URLs, logger strips payloads |

Bundle verification (`scripts/verify-bundle.mjs`) passed: 350 KiB, no mock/demo code, no
secret patterns, styles inlined. A smoke test that loads the **production bundle** in a page
without Desktop confirmed it registers the element and shows the "only works inside Webex
Contact Center Desktop" message without throwing.

### Visual checks done in the demo harness

- Narrow (320 px), medium (600 px), two-column (900 px) and three-column (1400 px) containers, also with 17 long idle-code names (`dev/?codes=many`); dark and light themes; text
  size 100 % and 150 %. No horizontal scrolling at 320 px with Extra large text.
- Pending/confirmed/failed status flows, call lifecycle, offline/online, unmount/remount.

## 2. Manual tests in a Webex Contact Center tenant (pilot)

Prerequisites: layout assigned to a **test agent** first, then the pilot agent; a test
queue and entry point you can call; a second agent for team tests; NVDA or JAWS on the PC.

Record results in the table (Pass/Fail + notes). Never put real customer numbers in notes.

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| T1 | Widget loads | Sign in to Desktop, open "My Status" page | No error banner. Status appears within ~2 s. | |
| T2 | Status read correctly | Compare with the Desktop header state selector | Same state; NOT READY shows the reason name. | |
| T3 | READY button | Press READY | "Requesting READY…" then big green READY; header selector also Ready; screen reader says "Your status is now READY". | |
| T4 | NOT READY buttons | Press each reason button | Red NOT READY + correct reason; header matches. | |
| T5 | Aux codes mapped | Compare buttons with the desktop profile's idle codes | One button per non-system code, exact names. | |
| T6 | External change | Change state from the Desktop header (and have a supervisor change it) | Widget updates by itself within ~1 s. | |
| T7 | Incoming call | Call the test entry point while READY | Panel shows RINGING, then CONNECTED, number, INBOUND, queue name; status BUSY. | |
| T8 | Outbound call | Make an outdial | OUTBOUND; customer number = dialled number; queue/outdial queue shown. | |
| T9 | Hold / ANI / consult | Hold, unhold; if available, transfer/consult | ON HOLD then CONNECTED; consult shows CONSULTING. | |
| T10 | Call ends | Customer hangs up; complete wrap-up | WRAP-UP while wrapping; panel clears to "No active call" after wrap-up. | |
| T11 | Mid-call reload | During a call, switch page away and back, or reload Desktop | Call panel and status restored. | |
| T12 | Disconnect | Unplug network / disable Wi-Fi for 30 s, then reconnect | Banner "CONNECTION LOST", status "STATUS NOT VERIFIED", then back to normal. | |
| T13 | Team list | Second agent in same team toggles Ready/Not Ready | Row updates within 30 s by itself (the panel says "Updates automatically every 30 seconds"); "Refresh now" is optional. Agents of other teams not shown. | |
| T14 | Keyboard | Tab through all controls; Enter/Space activate | Visible yellow focus ring; logical order; focus stays on the button after a state change. | |
| T15 | Screen reader | NVDA/JAWS: browse headings (H key), activate buttons, take a call | Headings "My status", "Change status", "My current call", "My team"; button names and "pressed" state read; status and call changes announced once; team refreshes are silent. | |
| T16 | Failure handling | Temporarily remove an idle code from the profile, sign in again | Remaining codes shown; READY always works. | |
| T17 | Widget reload safety | Upload a new bundle version to the same URL, reload Desktop | New version loads (check `build-info.json`), nothing breaks. | |

If T1 fails with "STATUS NOT VERIFIED" after ~6 s, check that the layout binds
`$STORE.agent.channelsStatesMap` (desktop-layout/README.md) and that the tenant uses
granular state.
