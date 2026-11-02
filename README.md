# Accessible WXCC Widget

A high-contrast, screen-reader friendly agent panel for **Cisco Webex Contact Center Desktop**,
built for a visually impaired agent/supervisor.

It shows, in very large type:

1. **MY STATUS**: the agent's current telephony status (READY, NOT READY + reason, BUSY, WRAP-UP …).
2. **CHANGE STATUS**: always-visible, colour-coded buttons: READY plus one button per Idle/Not Ready reason configured in the tenant.
3. **MY CURRENT CALL**: customer number, direction, queue name and call status.
4. **MY TEAM** (optional): colleagues who are Ready or Not Ready, filtered to the agent's own team.

No server, no database, no extra login, no stored credentials. The widget is one static
JavaScript file that Desktop loads, and it talks to Webex only through Cisco's official
Desktop SDK using the agent's existing Desktop session.

| Document | Contents |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Hosting options, publishing, Desktop Layout, updating, rollback |
| [SECURITY.md](SECURITY.md) | Security model, data handling, review checklist |
| [docs/API-AND-PERMISSIONS.md](docs/API-AND-PERMISSIONS.md) | Every Cisco API used, the permissions involved, limits |
| [docs/TESTING.md](docs/TESTING.md) | Automated test results and the manual tenant test plan |
| [desktop-layout/README.md](desktop-layout/README.md) | How to merge the widget into an existing layout |

---

## Quick start (for whoever maintains it)

Requirements: Node.js 20 or newer (only on the build machine, never in production).

```bash
npm ci            # install exact dependency versions
npm test          # run the unit tests (no Webex needed)
npm run dev       # open http://127.0.0.1:5199 — demo page with MOCK data
npm run build     # produce dist/accessible-wxcc-widget.js
npm run check     # tests + build + bundle verification (what CI runs)
```

The demo page (`npm run dev`) has buttons to simulate calls, status changes, failures and
network loss. It is clearly labelled **MOCK**, and mock mode does not exist in the production
build at all, so it cannot affect a real agent.

## Project layout

```text
src/
  index.js                  registers <accessible-wxcc-widget>
  widget.js                 the Web Component: lifecycle, layout, announcements, settings
  services/
    desktop-sdk.js          the ONLY file that touches the Cisco SDK (lazy-loaded, shared)
    agent-state.js          current state + stateChangeV2 + eAgentChannelStateChanged
    auxiliary-codes.js      Idle/Not Ready codes from fetchPaginatedAuxCodes
    contact-events.js       current call from contact events + task map
    team-dashboard.js       optional team list via buddyAgentsV2
    audio-notify.js         optional short tones (off by default)
  components/               status panel, buttons, call panel, team list (plain DOM)
  styles/                   themes.css (colours), main.css (layout), accessibility.css
  utils/                    status mapping, logger (privacy-safe), cleanup helpers
  i18n/strings.js           every visible text in one file (easy to translate)
  mock/mock-desktop.js      demo-only fake Desktop (compiled out of production)
dev/index.html              demo harness for `npm run dev`
tests/                      unit, UI, contrast and security tests (Vitest + jsdom)
desktop-layout/             Desktop Layout fragment + merge instructions
scripts/verify-bundle.mjs   post-build checks (no mock code, no secrets, size)
.github/workflows/build.yml CI: test, build, verify, optional GitHub Pages deploy
```

---

## Technical decision record (Phase 1 research)

Research done on 2 November 2026 against Cisco's current documentation and the installed
SDK package `@wxcc-desktop/sdk@3.0.1` (the latest on npm, published 15 July 2026).
Because the SDK ships without its payload type definitions, signatures were checked in
three places: Cisco's documentation pages, the SDK's `.d.ts` method signatures, and the SDK's
own runtime validation code.

### Verified facts

| # | Topic | Finding | Source |
|---|---|---|---|
| 1 | Package | `@wxcc-desktop/sdk` is the current package; `@agentx/*` packages are deprecated. | Get Started page |
| 2 | Init | `await Desktop.config.init({ widgetName, widgetProvider })` (object form required since SDK 2.0); `Desktop.config.cleanup()` is **not** called: in SDK 3.0.1 it permanently drops the service reference, so a remounted widget could no longer change state ("SERVICE is not defined..."). The SDK stays initialised for the page; unmount removes only our listeners. | Get Started page, `config-jsapi.d.ts` |
| 3 | Runs only in Desktop | The SDK reads the global `AGENTX_SERVICE` when it is first evaluated, and importing it outside Desktop throws `ReferenceError`. **Decision:** check for the global first and only then lazy-load the SDK, so outside Desktop the widget shows a diagnostic message instead. Verified by building a probe bundle. | SDK bundle, probe test |
| 4 | Web Component | Desktop places widgets inside nested Shadow DOM; a custom element with its own Shadow DOM is recommended. Layout keys: `comp`, `script`, `properties`, `attributes`, `wrapper`. | Custom Widgets page, Help article ng08gqeb |
| 5 | Granular state | With granular state control, read `STORE.agent.channelsStatesMap`, listen for `eAgentChannelStateChanged`, change with `stateChangeV2`. The global `subStatus` and the `updated` event are **not valid** in this model. | Agent State page, SDK Reference notes |
| 6 | `stateChangeV2` | `{ channelType: string[], state, auxCodeId, reason?, agentId }`. The SDK validates channelType ∈ telephony/chat/email/social and non-empty `state`/`auxCodeId`. Available uses `auxCodeId "0"`. Resolves to the new `agentChannelStateDetail` per channel, or `undefined` if the service is unavailable. | Agent State page, SDK validator |
| 7 | State values | `agentState`: Available, Idle, Engaged, WrapUp (RONA documented as a system state). STORE timestamps are **epoch seconds**; SDK/event timestamps are **epoch milliseconds**. | Widget Data page |
| 8 | Aux codes | `Desktop.agentConfigJsApi.fetchPaginatedAuxCodes({ workType: "IDLE_CODE", page, pageSize })` → `{ meta: { totalPages }, data: [{ id, name, isSystem, isDefault }] }`. `getIdleCodes()` deprecated since Jan 2025. | Agent State page, SDK validator |
| 9 | Agent identity | `agentId` comes from `$STORE.agent.agentId` (layout property). `latestData` has `agentProfileID`, `teamId`, `teamName` but no `agentId`. | Widget Data page, `agent-state-info-jsapi.d.ts` |
| 10 | Team ID | `$STORE.agent.teamId` and `latestData.teamId` both exist. | Widget Data page |
| 11 | Contact events | Payloads are `{ data: { interactionId, interaction } }`. Fields: `interaction.callProcessingDetails.ani / dnis / virtualTeamName`, `interaction.contactDirection.type`, `interaction.outboundType`, `interaction.state`, `interaction.media[*].isHold`. | Contact Events page |
| 12 | Restore after mount | `Desktop.actions.getTaskMap()` returns the agent's current tasks; `$STORE.agentContact.taskMap` is also bindable. Cisco notes widgets only receive events **while mounted**. | Call Control page, Contact Events page |
| 13 | Buddy agents | `Desktop.agentContact.buddyAgentsV2({ data })` runs on the agent's own Desktop session, so no token or admin rights are needed. SDK 3.0.1 validates `agentProfileId` (UUID), `mediaType` and `state ∈ {Available, Idle, RONA}`. Response: `data.agentList`. | SDK validator, Consultation page |
| 14 | REST Buddy Agents List | `POST /v1/agents/buddyList` requires an OAuth token with `cjp:user` scope. Calling it from the widget would mean handling a token in the browser. **Not used.** | API reference, A–Z Agents blog |

### Decisions

- **Vanilla JavaScript + Vite, no framework.** One self-contained IIFE bundle (`dist/accessible-wxcc-widget.js`, ~350 KB of which ~310 KB is Cisco's SDK). No runtime dependencies other than the SDK.
- **Status = Webex's truth.** A clicked state is shown as "Requesting READY…" and becomes the big status only when Webex reports it (event, STORE update, or the `stateChangeV2` response that carries `agentChannelStateDetail`). If nothing confirms within 8 seconds, the widget says so.
- **BUSY and WRAP-UP come from Webex's channel state** (`Engaged`, `WrapUp`), not guessed from call events.
- **Status buttons are built from the tenant's aux codes.** System codes (e.g. RONA) are excluded. Colours are chosen from the code name (lunch → orange, break/fika → yellow, admin/meeting → blue, others → red); text is always shown.
- **Team dashboard uses `buddyAgentsV2`**, the least-privileged option. It is optional (`team-dashboard="false"`), polls at most every 60 s (minimum 30 s) only while visible, and keeps the last good list marked "CONNECTION ERROR" on failure. It never shows anyone as OFFLINE because a request failed.
- **Features are isolated.** Status, call and team each start separately; a failure in one is shown in that panel only.
- **Mock mode is a separate module** that the production build removes completely (checked by `verify-bundle.mjs`).

### Assumptions (to confirm in the tenant during the pilot)

| # | Assumption | How the widget behaves if wrong | Pilot test |
|---|---|---|---|
| A1 | The tenant uses granular state (`channelsStatesMap` is populated). | Status shows "STATUS NOT VERIFIED" after 6 s, with a log hint about the binding. | T2 |
| A2 | `buddyAgentsV2` entries include `teamId` and `agentName`. Cisco's Web SDK `BuddyDetails` lists `agentId, agentName, dn, siteId, state, teamId`. | Without `teamId` the list is unfiltered and the widget says so; names fall back to `firstName lastName` or DN. | T13 |
| A3 | Cisco's page shows `channelName` for `buddyAgentsV2`; SDK 3.0.1 validates `mediaType`. Both are sent. | If rejected, the team panel shows CONNECTION ERROR; status and call keep working. | T13 |
| A4 | The agent profile's ID is a UUID (SDK validation). Older tenants may show non-UUID IDs in examples. | Team panel shows "not available"; no request is made. | T13 |
| A5 | Interaction `state` values include `new`, `connected`, `consult`, `conference`, `wrapUp`. | Unknown values display as IN PROGRESS. | T7–T9 |
| A6 | On outdial calls the customer number is the DNIS. | Both ANI and DNIS are always shown, labelled. | T8 |

### Known limitations

- **Team list is not a full roster.** Webex returns only agents who are Available or Idle and within the agent profile's buddy/consult scope. Colleagues on a call, in wrap-up or logged out are not listed (the panel says this). A complete roster with BUSY/WRAP-UP/OFFLINE needs the Agents Activities / real-time reporting APIs with an OAuth token and suitable scopes. That means a backend or token handling and is **not built** (see docs/API-AND-PERMISSIONS.md for options).
- **Desktop disconnect detection** uses the browser's online/offline events plus Desktop's re-login events. The SDK exposes no "socket lost" event, so a server-side outage without a network drop shows up as failed status requests rather than a banner.
- **Telephony channel only** in V1. The channel is a constructor parameter, so chat/email can be added later.
- **Call history is not implemented.** It is optional in the specification, and persisting call data would need an approved design.
- **Localisation:** English UI text; everything is in `src/i18n/strings.js` for translation (e.g. Swedish).
