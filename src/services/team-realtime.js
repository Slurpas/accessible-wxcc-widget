/**
 * Live team data from Desktop's real-time channel (Desktop.rtdwc, the same
 * feed Desktop's own supervisor views use). It runs on the agent's own
 * Desktop session: no token, no server, nothing stored.
 *
 * Datasets (names and fields seen with the team probe, Nov 2026):
 *  - wxcc.rtd.agentchanneltypestatus: one item per logged-in agent and
 *    channel: agentId, agentName, channelType, state ("Available", "Idle",
 *    ...), idleCodeId, idleCodeName, teamId, teamName.
 *  - wxcc.rtd.agentchannelstatus: the agent's current contact
 *    (interactionId, contactStatus), used to show BUSY / WRAP-UP when the
 *    channel state alone does not say so.
 * Each update carries datasetValues: [{key, operation, data}]. Items with a
 * delete/remove operation, or a logged-out state, leave the list.
 *
 * The dataset is not documented by Cisco for widgets, so everything here is
 * defensive: unknown states are shown as UNKNOWN with Webex's own word, never
 * guessed, and any failure lets the caller fall back to the buddy list.
 */
import { DISPLAY, compareTeamMembers, mapAgentState } from '../utils/status-mapper.js';

export const DATASET_STATES = 'wxcc.rtd.agentchanneltypestatus';
export const DATASET_CONTACTS = 'wxcc.rtd.agentchannelstatus';
const CHANNEL = 'telephony';
const REMOVE_RE = /delete|remove/i;
const LOGGED_OUT_RE = /^(logged ?out|logout|offline)$/i;

function str(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function itemsOf(msg) {
  if (!msg || typeof msg !== 'object') return [];
  const list = Array.isArray(msg.datasetValues) ? msg.datasetValues : Array.isArray(msg) ? msg : [];
  return list.filter((i) => i && typeof i === 'object' && i.data && typeof i.data === 'object');
}

function isTelephony(d) {
  return !d.channelType || str(d.channelType).toLowerCase() === CHANNEL;
}

/**
 * Apply one real-time update to a Map(key -> data). Returns true when
 * something changed.
 */
export function applyUpdate(map, msg) {
  let changed = false;
  for (const item of itemsOf(msg)) {
    const d = item.data;
    if (!isTelephony(d) || !str(d.agentId)) continue;
    const key = str(item.key) || `${str(d.agentId)}:${CHANNEL}`;
    if (REMOVE_RE.test(str(item.operation)) || LOGGED_OUT_RE.test(str(d.state))) {
      changed = map.delete(key) || changed;
    } else {
      map.set(key, d);
      changed = true;
    }
  }
  return changed;
}

/** BUSY / WRAP-UP from the agent's current contact, or '' when there is none. */
function contactDisplay(c) {
  if (!c || !str(c.interactionId)) return '';
  const s = str(c.contactStatus).toLowerCase().replace(/[\s_-]/g, '');
  if (!s || /ended|closed|terminated|abandoned/.test(s)) return '';
  return /wrap/.test(s) ? DISPLAY.WRAP_UP : DISPLAY.BUSY;
}

/**
 * Rows for the team list: own team only (when teamId is known), self
 * excluded, READY first.
 */
export function mapRealtimeAgents(states, contacts, { teamId, selfId, codeNames = new Map() }) {
  const busyByAgent = new Map();
  for (const c of contacts.values()) {
    const d = contactDisplay(c);
    if (d) busyByAgent.set(str(c.agentId), d);
  }
  const byId = new Map();
  for (const a of states.values()) {
    const id = str(a.agentId);
    if (!id || id === selfId) continue;
    if (teamId && str(a.teamId) !== String(teamId)) continue;
    let display = mapAgentState(a.state);
    const fromContact = busyByAgent.get(id);
    if (fromContact && (display === DISPLAY.READY || display === DISPLAY.UNKNOWN)) display = fromContact;
    let reason = '';
    if (display === DISPLAY.NOT_READY) reason = str(a.idleCodeName) || codeNames.get(str(a.idleCodeId)) || '';
    if (display === DISPLAY.UNKNOWN) reason = str(a.state);
    byId.set(id, { id, name: str(a.agentName) || 'Unknown agent', teamId: str(a.teamId), teamName: str(a.teamName), display, reason });
  }
  const rows = [...byId.values()].sort(compareTeamMembers);
  return { rows, teamFilterApplied: !!teamId, readyCount: rows.filter((r) => r.display === DISPLAY.READY).length };
}

function close(sub) {
  try {
    if (typeof sub === 'function') sub();
    else if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe();
    else if (sub && typeof sub.close === 'function') sub.close();
  } catch {
    /* already closed */
  }
}

/**
 * Subscribes to both datasets and keeps them in memory. onChange() is
 * called after every update; onError(err) once if the state feed fails.
 */
export class RealtimeTeamFeed {
  constructor({ adapter, onChange, onError }) {
    this.adapter = adapter;
    this.onChange = onChange;
    this.onError = onError;
    this.states = new Map();
    this.contacts = new Map();
    this.hasData = false;
    this._subs = [];
    this._stopped = false;
  }

  async start() {
    const sub = (datasetName, map, required) =>
      this.adapter.subscribeRealtime({
        datasetName,
        update: (msg) => {
          if (this._stopped) return;
          if (required) this.hasData = true;
          if (applyUpdate(map, msg) || required) this.onChange();
        },
        error: (err) => {
          if (!this._stopped && required) this.onError(err);
        },
      });
    // The state feed is required; the contact feed only refines BUSY/WRAP-UP.
    this._subs.push(await sub(DATASET_STATES, this.states, true));
    try {
      this._subs.push(await sub(DATASET_CONTACTS, this.contacts, false));
    } catch {
      /* optional */
    }
    if (this._stopped) this.stop();
  }

  stop() {
    this._stopped = true;
    for (const s of this._subs.splice(0)) close(s);
  }
}
