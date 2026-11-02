/**
 * Optional team dashboard.
 *
 * Data source: Desktop.agentContact.buddyAgentsV2 — the same request Desktop
 * makes when an agent opens the consult/transfer list. It runs on the
 * agent's own Desktop session: no extra login, no token handling, no admin
 * rights.
 *
 * Verified limitations (see docs/API-AND-PERMISSIONS.md):
 *  - Only agents in state Available or Idle are returned (one request per state).
 *    Agents who are Engaged, in Wrap-up or logged out are NOT returned.
 *  - The list is the agent profile's "buddy" scope (who you may consult),
 *    not an authoritative team roster. We filter by the current teamId when
 *    entries carry a teamId.
 *  - Failure never marks anyone OFFLINE: the last good list is kept and
 *    flagged as a connection error.
 */
import { Emitter } from '../utils/cleanup.js';
import { DISPLAY, compareTeamMembers, mapBuddyState } from '../utils/status-mapper.js';
import { log, errorReason } from '../utils/logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MIN_REFRESH_SECONDS = 15;
export const DEFAULT_REFRESH_SECONDS = 30;
const MANUAL_REFRESH_GAP_MS = 10000;

/** Build a display name from the fields Cisco has used across versions. */
function nameOf(a) {
  const full = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
  return String(a.agentName || a.name || full || a.dn || 'Unknown agent').trim();
}

/** Normalise buddy agents into rows, filtered to the team when possible. */
export function mapBuddyAgents(lists, { teamId, selfId }) {
  const byId = new Map();
  let entriesWithTeam = 0;
  let total = 0;
  for (const { state, agents } of lists) {
    for (const a of agents || []) {
      if (!a || !a.agentId) continue;
      total += 1;
      if (a.teamId !== undefined && a.teamId !== null && a.teamId !== '') entriesWithTeam += 1;
      byId.set(String(a.agentId), {
        id: String(a.agentId),
        name: nameOf(a),
        teamId: a.teamId === undefined || a.teamId === null ? '' : String(a.teamId),
        teamName: a.teamName ? String(a.teamName) : '',
        display: mapBuddyState(a.state, state),
      });
    }
  }
  const teamFilterApplied = !!teamId && total > 0 && entriesWithTeam === total;
  let rows = [...byId.values()].filter((r) => r.id !== selfId);
  if (teamFilterApplied) rows = rows.filter((r) => r.teamId === String(teamId));
  rows.sort(compareTeamMembers);
  return {
    rows,
    teamFilterApplied,
    readyCount: rows.filter((r) => r.display === DISPLAY.READY).length,
  };
}

export class TeamService {
  constructor({ adapter, refreshSeconds = DEFAULT_REFRESH_SECONDS, now = () => Date.now() }) {
    this.adapter = adapter;
    this.refreshMs = Math.max(MIN_REFRESH_SECONDS, Number(refreshSeconds) || DEFAULT_REFRESH_SECONDS) * 1000;
    this.now = now;
    this.changes = new Emitter();
    this.teamId = '';
    this.selfId = '';
    this._timer = null;
    this._inFlight = null;
    this._lastManual = 0;
    this.state = {
      phase: 'loading', // loading | ok | error | unavailable
      rows: [],
      readyCount: 0,
      teamFilterApplied: false,
      lastSuccess: 0,
      error: '',
      refreshSeconds: this.refreshMs / 1000,
    };
    // Coming back to the Desktop tab: update at once if the list is older than one interval.
    this._onVisible = () => {
      if (document.visibilityState === 'visible' && this.now() - this.state.lastSuccess >= this.refreshMs) this.refresh();
    };
  }

  setContext({ teamId, selfId }) {
    if (typeof teamId === 'string' && teamId) this.teamId = teamId;
    if (typeof selfId === 'string' && selfId) this.selfId = selfId;
  }

  start() {
    this.refresh();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisible);
    this._timer = setInterval(() => {
      // Only poll while someone can see it; Chrome throttles hidden tabs anyway.
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') this.refresh();
    }, this.refreshMs);
  }

  stop() {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisible);
    clearInterval(this._timer);
    this._timer = null;
    this.changes.clear();
  }

  /** Manual refresh from the button, rate-limited. */
  manualRefresh() {
    if (this.now() - this._lastManual < MANUAL_REFRESH_GAP_MS) return this._inFlight || Promise.resolve();
    this._lastManual = this.now();
    return this.refresh();
  }

  isStale() {
    return this.state.lastSuccess > 0 && this.now() - this.state.lastSuccess > this.refreshMs * 2.5;
  }

  refresh() {
    if (this._inFlight) return this._inFlight;
    this._inFlight = this._load().finally(() => {
      this._inFlight = null;
    });
    return this._inFlight;
  }

  async _load() {
    let profileId = '';
    try {
      profileId = String((this.adapter.getLatestData() || {}).agentProfileID || '');
    } catch {
      /* handled below */
    }
    if (!UUID_RE.test(profileId)) {
      // The SDK validates agentProfileId as a UUID; without it the request cannot be made.
      this._set({ phase: 'unavailable', error: 'NO_PROFILE_ID' });
      return;
    }
    try {
      const lists = [];
      for (const state of ['Available', 'Idle']) {
        const res = await this.adapter.buddyAgentsV2({
          agentProfileId: profileId,
          // SDK 3.0.1 validates `mediaType`; Cisco's page shows `channelName`. Both name the channel.
          mediaType: 'telephony',
          channelName: 'telephony',
          state,
        });
        const data = res && (res.data || res);
        if (!data || !Array.isArray(data.agentList)) {
          throw new Error(data && data.type ? String(data.type) : 'No buddy agent data returned');
        }
        lists.push({ state, agents: data.agentList });
      }
      const mapped = mapBuddyAgents(lists, { teamId: this.teamId, selfId: this.selfId });
      const returned = lists.reduce((n, l) => n + l.agents.length, 0);
      if (returned > 0 && !mapped.teamFilterApplied && !this._warnedUnfiltered) {
        this._warnedUnfiltered = true; // for admins (Desktop logs), not shown to the agent
        log.warn('Team filter not applied: buddy agents returned without teamId or no teamId bound');
      }
      this._set({ phase: 'ok', ...mapped, lastSuccess: this.now(), error: '' });
    } catch (err) {
      log.warn('buddyAgentsV2 failed', err);
      // Keep the last known rows; the UI marks them as a connection error.
      this._set({ phase: 'error', error: errorReason(err) });
    }
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.changes.emit(this.state);
  }
}
