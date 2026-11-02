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
| `teamId` | `$STORE.agent.teamId` | Filters the team list to the agent's own team. |
| `channelsStatesMap` | `$STORE.agent.channelsStatesMap` | Current status (granular state model). Required for the status display. |
| `taskMap` | `$STORE.agentContact.taskMap` | Restores the call panel if the page opens during a call. |

| Attribute | Values | Default |
|---|---|---|
| `team-dashboard` | `"true"` / `"false"` | `"true"` |
| `team-refresh-seconds` | number ≥ 15 | `30` |
| `theme` | `"dark"` / `"light"` | `"dark"` (agent can change in the widget) |
| `text-size` | `"100"` / `"125"` / `"150"` | `"100"` (agent can change in the widget) |

## Placement notes

- Cisco: widgets receive events only while mounted. A navigation page unmounts
  when the agent switches page. When the agent returns, the widget re-reads the
  status from `channelsStatesMap` and the active call from `taskMap`/`getTaskMap()`,
  so the display is correct again within a second.
- Keep the script URL stable. Cisco advises not to change a component's script
  URL; publish new versions to the same URL (see DEPLOYMENT.md).
- The `icon` value `stored-info` is taken from Cisco's own example. Any Momentum
  Design icon name can be used.
