# Desktop Layout integration

`example-layout.json` is a **fragment**, not a complete layout. Do not import it
on its own and do not replace your production layout with it. Merge the single
navigation entry into a copy of the layout your agents already use.

Schema reference: Cisco "Create custom desktop layout"
(https://help.webex.com/en-us/article/ng08gqeb) and "Widget Data and Desktop Layout"
(https://developer.webex.com/webex-contact-center/docs/desktop-widget-data-layout).

## Steps (Control Hub)

1. Control Hub → Contact Center → Desktop Layouts → open the layout assigned to
   the pilot team → **download** the current JSON. Keep this file as your rollback copy.
2. Make a copy, and in the copy's agent section add the navigation entry from
   `example-layout.json` to the existing `"navigation": [ ... ]` array of the
   `area` object. Leave everything else unchanged.
   Optional: also add the `headless` block (see "Recent calls" below). If the
   layout already has a `headless` area, add only the `accessible-recorder`
   widget to its `widgets` and to its `layout.areas`.
3. The `script` URL already points to the GitHub Pages build. If you host the bundle
   elsewhere, change it to that URL (see DEPLOYMENT.md).
4. If another page is already `"isDefaultLandingPage": true`, decide which one
   should open first. For the visually impaired agent, making this page the
   landing page is recommended.
5. Validate the JSON (Control Hub validates on upload), upload it as a **new**
   layout, e.g. "Accessible pilot", and assign it **only to the pilot team**.
6. The agent signs out of Desktop and back in (layouts load at sign-in).

Rollback: assign the team back to the original layout.

## What each binding does

| Property | STORE path | Used for |
|---|---|---|
| `agentId` | `$STORE.agent.agentId` | Required by `stateChangeV2`. Without it the status buttons are disabled. |
| `teamId` | `$STORE.agent.teamId` | Filters the team list to the agent's own team (live list and buddy-list fallback). |
| `channelsStatesMap` | `$STORE.agent.channelsStatesMap` | Current status (granular state model). Required for the status display. |
| `taskMap` | `$STORE.agentContact.taskMap` | Restores the call panel if the page opens during a call. |
| `isOutboundEnabledForAgent` | `$STORE.agent.isOutboundEnabledForAgent` | "Call back" is hidden when outdial is off for the agent. |
| `isOutboundEnabledForTenant` | `$STORE.agent.isOutboundEnabledForTenant` | Same, for the tenant. |
| `outDialEp` | `$STORE.agent.outDialEp` | Outdial entry point used by "Call back". Without it "Call back" is hidden. |

The three outdial bindings are optional: the widget falls back to the same values
in the SDK's agent data.

| Attribute | Values | Default |
|---|---|---|
| `team-dashboard` | `"true"` / `"false"` | `"true"` |
| `team-refresh-seconds` | number ≥ 15, only for the buddy-list fallback (the live list needs no polling) | `30` |
| `call-history` | `"true"` / `"false"` | `"true"` |
| `mode` | `"recorder"` (headless area only) | — |
| `theme` | `"dark"` / `"light"` | `"dark"` (agent can change in the widget) |
| `text-size` | `"100"` / `"125"` / `"150"` | `"100"` (agent can change in the widget) |

## Recent calls

The "Recent calls" panel lists the agent's calls in this Desktop session (up to
25, newest first): number, IN / OUT / MISSED, time, talk time and queue. It is
kept in memory only. It is not saved in the browser and is gone when Desktop is
reloaded or the agent signs out.

"Call back" starts a normal Desktop outdial (`Desktop.dialer.startOutdial`) with
the agent's own outdial entry point, after a second "Call now" press. It is
disabled during a call and hidden when outdial is not enabled for the agent.
Desktop applies the same rules as its own dial pad.

The visible widget only sees calls while its page is open. The optional
`headless` block runs a hidden copy (`mode="recorder"`) that records calls while
the agent is on other Desktop pages. It shows nothing and changes nothing.

## Placement notes

- Cisco: widgets receive events only while mounted. A navigation page unmounts
  when the agent switches page. When the agent returns, the widget re-reads the
  status from `channelsStatesMap` and the active call from `taskMap`/`getTaskMap()`,
  so the display is correct again within a second.
- Keep the script URL stable. Cisco advises not to change a component's script
  URL; publish new versions to the same URL (see DEPLOYMENT.md).
- The `icon` value `stored-info` is taken from Cisco's own example. Any Momentum
  Design icon name can be used.
