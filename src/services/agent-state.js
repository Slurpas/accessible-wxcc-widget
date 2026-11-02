/**
 * Current agent state for one channel (telephony by default), using the
 * granular-state model documented by Cisco:
 *
 *   read   STORE.agent.channelsStatesMap[channel]   (layout property, epoch seconds)
 *   listen Desktop.agentStateInfo "eAgentChannelStateChanged" (epoch milliseconds)
 *   change Desktop.agentStateInfo.stateChangeV2({channelType, state, auxCodeId, reason, agentId})
 *
 * Webex is always the source of truth. A requested state is shown as
 * "Requesting…" and only becomes the displayed state once Webex reports it.
 */
import { Emitter } from '../utils/cleanup.js';
import { DISPLAY, mapAgentState, toMillis } from '../utils/status-mapper.js';
import { log, errorReason } from '../utils/logger.js';

export const AVAILABLE_AUX_CODE = '0';
const CONFIRM_TIMEOUT_MS = 8000;
const INITIAL_READ_TIMEOUT_MS = 6000;

/** Extract {channelType, agentId, detail} from an event or stateChangeV2 response. */
export function parseChannelStateMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  // stateChangeV2 responses wrap the body in `data`; the event example is flat. Accept both.
  const body = msg.agentChannelStateDetail ? msg : msg.data && msg.data.agentChannelStateDetail ? msg.data : null;
  if (!body) return null;
  return {
    channelType: body.channelType,
    agentId: body.agentId,
    detail: body.agentChannelStateDetail,
  };
}

export class AgentStateService {
  /**
   * @param {object} opts
   * @param {object} opts.adapter      Desktop or mock adapter
   * @param {string} [opts.channel]    channel type, default "telephony"
   * @param {(fn:Function, ms:number)=>any} [opts.setTimer]
   * @param {(id:any)=>void} [opts.clearTimer]
   */
  constructor({ adapter, channel = 'telephony', setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.adapter = adapter;
    this.channel = channel;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.changes = new Emitter();
    this.notices = new Emitter(); // {kind:'confirmed'|'external'|'failed'|'unconfirmed', ...}
    this.auxNames = new Map();
    this.agentId = '';
    this._timers = new Set();
    this._unsubs = [];
    this.state = {
      phase: 'loading', // loading | ok | error
      display: DISPLAY.LOADING,
      agentState: '',
      auxCodeId: '',
      reasonName: '',
      since: 0,
      pending: null, // { label, state, auxCodeId, startedAt }
      lastError: '',
      unconfirmed: '',
    };
  }

  start() {
    this._unsubs.push(
      this.adapter.onAgentStateEvent('eAgentChannelStateChanged', (msg) => this.handleChannelEvent(msg)),
    );
    // Cisco documents channelsStatesMap on latestData too; use it if present while the layout property arrives.
    try {
      const latest = this.adapter.getLatestData() || {};
      if (latest.channelsStatesMap) this.setChannelsStatesMap(latest.channelsStatesMap, 'latestData');
    } catch {
      /* optional */
    }
    this._timer(() => {
      if (this.state.phase === 'loading') {
        this._set({ phase: 'error', display: DISPLAY.ERROR, lastError: 'NO_STATE_DATA' });
        log.warn('No channel state received; check that the layout binds $STORE.agent.channelsStatesMap');
      }
    }, INITIAL_READ_TIMEOUT_MS);
  }

  stop() {
    for (const off of this._unsubs.splice(0)) off();
    for (const id of this._timers) this.clearTimer(id);
    this._timers.clear();
    this.changes.clear();
    this.notices.clear();
  }

  setAgentId(id) {
    if (typeof id === 'string' && id) this.agentId = id;
  }

  /** Aux code id -> name, used to show the Not Ready reason. */
  setAuxCodes(codes) {
    this.auxNames = new Map((codes || []).map((c) => [String(c.id), c.name]));
    if (this.state.auxCodeId) this._set({ reasonName: this._reasonFor(this.state.agentState, this.state.auxCodeId) });
  }

  /** Called whenever Desktop pushes STORE.agent.channelsStatesMap into the widget. */
  setChannelsStatesMap(map, source = 'store') {
    if (!map || typeof map !== 'object') return;
    const keys = Object.keys(map);
    if (keys.length === 0) return; // still starting up
    const detail = map[this.channel];
    if (!detail) {
      // Other channels exist but not ours: the agent is not logged in on this channel.
      this._set({ phase: 'ok', display: DISPLAY.OFFLINE, agentState: '', auxCodeId: '', reasonName: '', since: 0 });
      return;
    }
    this.applyDetail(detail, source);
  }

  handleChannelEvent(msg) {
    const parsed = parseChannelStateMessage(msg);
    if (!parsed) return;
    if (parsed.channelType && parsed.channelType !== this.channel) return;
    if (this.agentId && parsed.agentId && parsed.agentId !== this.agentId) return;
    if (!this.agentId && parsed.agentId) this.setAgentId(parsed.agentId);
    this.applyDetail(parsed.detail, 'event');
  }

  /** Apply a channel state detail coming from Webex. Older updates are ignored. */
  applyDetail(detail, source) {
    if (!detail || typeof detail !== 'object') return;
    const since = toMillis(detail.stateChangeTimestamp);
    // Ignore updates older than what we show. STORE timestamps are whole seconds,
    // so allow one second of rounding before calling something stale.
    if (since && this.state.since && since + 1000 <= this.state.since) return;

    const agentState = String(detail.agentState || '');
    const auxCodeId = detail.auxCodeId === undefined || detail.auxCodeId === null ? '' : String(detail.auxCodeId);
    const display = mapAgentState(agentState);
    const changed = agentState !== this.state.agentState || auxCodeId !== this.state.auxCodeId;

    const next = {
      phase: 'ok',
      display,
      agentState,
      auxCodeId,
      reasonName: this._reasonFor(agentState, auxCodeId, detail.stateChangeReason),
      since: since || this.state.since || Date.now(),
      lastError: this.state.lastError === 'NO_STATE_DATA' ? '' : this.state.lastError,
    };

    const p = this.state.pending;
    if (p && this._matches(p, agentState, auxCodeId)) {
      next.pending = null;
      next.unconfirmed = '';
      next.lastError = '';
      this._set(next);
      this.notices.emit({ kind: 'confirmed', display, reasonName: next.reasonName });
      return;
    }
    if (!p && this.state.unconfirmed && changed) next.unconfirmed = '';
    this._set(next);
    if (changed && source !== 'initial') this.notices.emit({ kind: 'external', display, reasonName: next.reasonName });
  }

  /**
   * Ask Webex to change state.
   * @param {{state:'Available'|'Idle', auxCodeId:string, label:string, reason?:string}} target
   */
  async requestChange(target) {
    if (this.state.pending) return { ok: false, reason: 'BUSY' };
    if (!this.agentId) {
      this._fail(target.label, 'Agent identity not available.');
      return { ok: false, reason: 'NO_AGENT_ID' };
    }
    const pending = { label: target.label, state: target.state, auxCodeId: String(target.auxCodeId), startedAt: Date.now() };
    this._set({ pending, lastError: '', unconfirmed: '' });

    const payload = {
      channelType: [this.channel],
      state: target.state,
      auxCodeId: String(target.auxCodeId),
      reason: target.reason || target.label,
      agentId: this.agentId,
    };

    let res;
    try {
      res = await this.adapter.stateChangeV2(payload);
    } catch (err) {
      if (this.state.pending === pending) this._fail(target.label, errorReason(err));
      log.warn('stateChangeV2 rejected', err);
      return { ok: false, reason: 'REJECTED' };
    }
    if (this.state.pending !== pending) return { ok: true }; // already confirmed by event

    if (res === undefined || res === null) {
      // The SDK returns undefined when the Desktop service is not available.
      this._fail(target.label, 'Webex Desktop did not accept the request.');
      return { ok: false, reason: 'NO_SERVICE' };
    }
    if (res && (res.type === 'AgentChannelStateChangeFailed' || (res.data && /Failed$/.test(res.data.type || '')))) {
      this._fail(target.label, errorReason(res));
      return { ok: false, reason: 'FAILED' };
    }
    // A response carrying agentChannelStateDetail is Webex's own report of the new state.
    const parsed = parseChannelStateMessage(res);
    if (parsed && (!parsed.channelType || parsed.channelType === this.channel)) this.applyDetail(parsed.detail, 'response');

    if (this.state.pending === pending) {
      this._timer(() => {
        if (this.state.pending !== pending) return;
        this._set({ pending: null, unconfirmed: target.label });
        this.notices.emit({ kind: 'unconfirmed', label: target.label });
      }, CONFIRM_TIMEOUT_MS);
    }
    return { ok: true };
  }

  _matches(p, agentState, auxCodeId) {
    if (p.state.toLowerCase() !== agentState.toLowerCase()) return false;
    return p.state === 'Available' || p.auxCodeId === auxCodeId;
  }

  _reasonFor(agentState, auxCodeId, fallback) {
    if (mapAgentState(agentState) !== DISPLAY.NOT_READY) return '';
    return this.auxNames.get(auxCodeId) || (fallback && fallback !== 'Idle' ? String(fallback) : '');
  }

  _fail(label, reason) {
    this._set({ pending: null, lastError: reason || 'Unknown error' });
    this.notices.emit({ kind: 'failed', label, reason });
  }

  _timer(fn, ms) {
    const id = this.setTimer(() => {
      this._timers.delete(id);
      fn();
    }, ms);
    this._timers.add(id);
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.changes.emit(this.state);
  }
}
