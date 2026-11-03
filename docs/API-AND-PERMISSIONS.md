# APIs and permissions

Every Webex call the widget makes goes through `src/services/desktop-sdk.js`.
All calls use the **agent's own Desktop session**. The widget holds no token, has no
OAuth client and needs no admin role.

## Calls used

| Call (SDK 3.0.1) | Purpose | Permission it acts with | If it fails |
|---|---|---|---|
| `Desktop.config.init({widgetName, widgetProvider})` | Start the SDK inside Desktop | Desktop session | Error banner; nothing else starts |
| `Desktop.agentStateInfo.latestData` | `agentProfileID`, `teamId`, fallback idle codes | Agent's own profile | Team list unavailable; idle-code fallback skipped |
| `Desktop.agentStateInfo.stateChangeV2({channelType:["telephony"], state, auxCodeId, reason, agentId})` | Change **own** telephony state | Same as the Desktop state menu | Red message + assertive announcement; displayed state unchanged |
| `Desktop.agentStateInfo` event `eAgentChannelStateChanged` | State changes (own and external) | Own events | — |
| `Desktop.agentStateInfo` events `eAgentReloginSuccess`, `eAgentChannelReloginSuccess` | Re-read data after Desktop reconnects | Own events | — |
| `Desktop.agentConfigJsApi.fetchPaginatedAuxCodes({workType:"IDLE_CODE", page, pageSize:100})` | Not Ready reasons for buttons (respects the desktop profile) | Agent's own profile | Falls back to profile idle codes; if none, only READY is shown with an explanation |
| `Desktop.actions.getTaskMap()` | Restore the call shown when the page opens mid-call | Own tasks | Call panel waits for the next event |
| `Desktop.agentContact` events: `eAgentOfferContact`, `eAgentContactAssigned`, `eAgentContact`, `eAgentContactAniUpdated`, `eAgentContactHeld`, `eAgentContactUnHeld`, `eAgentWrapup`, `eAgentContactEnded`, `eAgentContactWrappedUp`, `eAgentOfferContactRona`, `eAgentConsultCreated`, `eAgentConsulting`, `eAgentConsultEnded`, `eAgentConsultConferenced`, `eAgentConsultConferenceEnded`, `eContactOwnerChanged`, `eAgentCtqCancelled` | Current call panel | Own contacts | Call panel only |
| `Desktop.rtdwc.subscribe({datasetName, update, error})` for `wxcc.rtd.agentchanneltypestatus` and `wxcc.rtd.agentchannelstatus` | Live team list: every logged-in colleague, exact state, Not Ready reason, on a call / wrap-up | Desktop's real-time channel in the agent's session (undocumented for widgets) | Falls back to `buddyAgentsV2` polling (below) |
| `Desktop.agentContact.buddyAgentsV2({data:{agentProfileId, mediaType:"telephony", channelName:"telephony", state}})` ×2 (Available, Idle) | Team list fallback | Same list Desktop shows for consult/transfer | Team panel shows CONNECTION ERROR; other features unaffected |
| `Desktop.dialer.startOutdial({data:{entryPointId, destination, direction:"OUTBOUND", attributes:{}, mediaType:"telephony", outboundType:"OUTDIAL"}})` | "Call back" in Recent calls, only after the agent confirms | Same as Desktop's own outdial (agent's outdial entry point) | Assertive announcement; button available again |
| `Desktop.dialer` event `eOutdialFailed` | Report a failed call back | Own events | — |
| `Desktop.logger.createLogger(...)` | Write to Desktop's log collection | — | Falls back to console |

Layout STORE bindings (read-only, pushed by Desktop): `$STORE.agent.agentId`,
`$STORE.agent.teamId`, `$STORE.agent.channelsStatesMap`, `$STORE.agentContact.taskMap`,
`$STORE.agent.isOutboundEnabledForAgent`, `$STORE.agent.isOutboundEnabledForTenant`,
`$STORE.agent.outDialEp`.

**Recent calls** are built only from the contact events above and kept in memory
for the Desktop session (max 25, telephony only, number/direction/queue/times).
Nothing is written to browser storage, logged or sent anywhere. Webex keeps a
post-interaction history in Desktop (`Desktop.postInteractions.fetchTasks`), but
it is not documented for widgets; the probe only checks whether it answers
(`callHistory` in the report, counts and shape only).

**Not used:** `Desktop.actions.getToken()`, `STORE.auth.accessToken`, any REST API,
the deprecated `stateChange()`, `getIdleCodes()`, `buddyAgents()` and the global `subStatus`/`updated` event.

## Team dashboard: what the investigation found

| Question (spec §4.3) | Answer |
|---|---|
| Can the existing Desktop authentication be used? | **Yes**, through the SDK method `Desktop.agentContact.buddyAgentsV2`, which runs inside the agent's session. The REST endpoint `POST /v1/agents/buddyList` would need an OAuth bearer token with the `cjp:user` scope. |
| Callable from a custom Web Component? | Yes, via the SDK (this widget does it). |
| Permissions/scopes? | None beyond being a logged-in agent. REST alternative: `cjp:user`. |
| Available and Idle? | Yes. One request per state; `state` is required and must be `Available`, `Idle` or `RONA`. |
| Profile/team filtering? | The request is scoped by `agentProfileId`; Webex returns agents the profile allows for consult/transfer ("buddy teams" setting in the desktop profile). The widget then filters by `teamId`. |
| Complete roster? | **No.** Agents who are Engaged, in Wrap-up or logged out are not returned, and the list depends on the profile's consult settings. |

### To get a full roster later (needs approval, not built)

A complete team view with BUSY / WRAP-UP / OFFLINE needs real-time agent activity data
(e.g. Webex Contact Center "Agents Activities"/real-time statistics APIs or a supervisor
data feed). These require an OAuth token with reporting/admin scopes, which must not live in
an agent's browser. Possible designs, each needing an architecture and security review:

1. A small serverless function (e.g. Azure Function / AWS Lambda) holding a service-app
   token, exposing only "team X: names + states" to authenticated Desktop users.
2. Using a supervisor-oriented Desktop feature, if the pilot user is a supervisor and
   Cisco exposes team monitoring data through the Desktop SDK in a future release.

The team module is isolated (`team-dashboard.js` + `team-list.js`), so a new data source
only needs to provide `{ rows: [{id, name, display}], readyCount }`. The UI already
supports BUSY, WRAP-UP and OFFLINE rows.

### Investigation, Nov 2026: seeing every logged-in agent

| Source | All logged-in agents? | With the agent's own session? |
|---|---|---|
| `buddyAgentsV2` / REST `buddyList` | No. SDK accepts only `Available`, `Idle`, `RONA`; Cisco's reference says only Available or Idle agents are returned, also when `state` is omitted. | Yes |
| Get Agent Activities / Search API (`agentSession`) | Historical records with a time range, not a live view. | No: needs a token with organisation read scope (`cjp:config_read`). |
| Desktop real-time data (`Desktop.rtdwc` / `window.wxcc.rtdwc`) | Unknown: in the official SDK but undocumented (dataset names and entitlements). | Yes, if allowed |
| Server-side service with a Webex service app (agent state webhooks + snapshot) | Yes | Secret stays server-side; needs hosting and a security review. |

**Colleagues' Not Ready reason.** Cisco documents only `agentId`, `agentName`, `dn`,
`siteId`, `state` and `teamId` for buddy agents, so no reason is promised. If a
tenant's response carries a reason field (`idleCodeName`, `auxCodeId`, `idleCode`, …),
the team list shows it, resolving IDs with the idle codes the agent's own profile
already loads; otherwise it shows NOT READY. The probe's `reasonFieldsFound` says
which, if any, your tenant sends. Codes outside the agent's own profile cannot be
named without extra access.

**Team probe.** To find out whether the real-time channel works for a given user,
sign in to Desktop as that user, open DevTools (F12) → Console and run:

```js
await accessibleWxccProbe()
```

It is read-only (no state change, no token request, every subscription is closed
again) and the printed report contains only structure: key names, types, counts
and state words such as `Available`. No names, IDs, numbers, e-mail addresses or
tokens. Dataset names are guessed; to try the names Desktop itself uses, search
Desktop's sources in DevTools (Ctrl+Shift+F) for `datasetName` and pass them:
`await accessibleWxccProbe({ datasets: ['name1', 'name2'] })`.

Run it once as a supervisor and once as an ordinary agent; entitlements may differ.

Result, 3 Nov 2026 (probe v3, `agent_supervisor` user): all nine `wxcc.rtd.*`
datasets answered. `wxcc.rtd.agentchanneltypestatus` gives, per logged-in agent,
`state` (e.g. `Idle`), `idleCodeName` (e.g. `Lunch`) and `teamId`, which is enough
for an exact team list. Still to check: the same with an ordinary agent user.

**Live team list (built on this).** "My team" now subscribes to
`wxcc.rtd.agentchanneltypestatus` (states) and `wxcc.rtd.agentchannelstatus`
(current contact, for BUSY / WRAP-UP). It shows every logged-in colleague of the
agent's own team (by `teamId`, self excluded) with the exact state and reason, and
updates as soon as Webex pushes a change. Agents leave the list on a delete
operation or a logged-out state. Unknown state words are shown as UNKNOWN with
Webex's own word. If the feed is missing, rejects the subscription, reports an
error or sends nothing within 10 s, the widget falls back to polling
`buddyAgentsV2` every 30 s (Ready / Not Ready only), as before. Admins see the
reason in Desktop's logs.

## Configuration in Control Hub (for the pilot agent)

- Desktop profile: telephony channel enabled; the Idle codes you want as buttons
  assigned to the profile (the widget shows exactly those, excluding system codes).
- For the team list: in the desktop profile, enable consult/transfer to agents and include
  the agent's own team in the buddy teams.
- Desktop Layout with the bindings above (desktop-layout/README.md).
