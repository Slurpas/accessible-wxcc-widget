/**
 * Tracks the agent's current interactions from Desktop contact events.
 *
 * Field paths follow Cisco's documented payloads (Contact Events page and
 * STORE.agentContact.taskMap):
 *   data.interaction.callProcessingDetails.ani / dnis / virtualTeamName
 *   data.interaction.contactDirection.type   (INBOUND | OUTBOUND)
 *   data.interaction.outboundType            (OUTDIAL | COURTESY_CALLBACK | CAMPAIGN | null)
 *   data.interaction.state                   (new, connected, consult, conference, wrapUp, ...)
 *   data.interaction.media[*].isHold
 *
 * Privacy: call data is kept only in memory, only while the interaction is
 * active, and is never logged, stored or sent anywhere.
 */
import { Emitter } from '../utils/cleanup.js';
import { log } from '../utils/logger.js';

export const CALL_STATE = Object.freeze({
  RINGING: 'RINGING',
  CONNECTED: 'CONNECTED',
  ON_HOLD: 'ON_HOLD',
  CONSULTING: 'CONSULTING',
  CONFERENCE: 'CONFERENCE',
  WRAP_UP: 'WRAP_UP',
  ENDED: 'ENDED',
  UNKNOWN: 'UNKNOWN',
});

/** Events that carry an interaction and only need an upsert. */
const UPSERT_EVENTS = [
  'eAgentContact',
  'eAgentContactAssigned',
  'eAgentContactAniUpdated',
  'eAgentConsultCreated',
  'eAgentConsulting',
  'eAgentConsultEnded',
  'eAgentConsultConferenced',
  'eAgentConsultConferenceEnded',
  'eContactOwnerChanged',
];

function str(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object' && 'value' in v) return str(v.value); // callAssociatedData entries
  return String(v).trim();
}

function first(...vals) {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return '';
}

/** Unwrap an SDK event into {interactionId, interaction, ...}. Accepts {data:{...}} or the inner object. */
export function unwrapContactEvent(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const body = msg.data && typeof msg.data === 'object' && (msg.data.interaction || msg.data.interactionId) ? msg.data : msg;
  const interaction = body.interaction && typeof body.interaction === 'object' ? body.interaction : null;
  const interactionId = first(body.interactionId, interaction && interaction.interactionId);
  if (!interactionId) return null;
  return { body, interaction, interactionId };
}

function isAnyMediaOnHold(interaction) {
  const media = interaction && interaction.media;
  if (!media || typeof media !== 'object') return null;
  const entries = Object.values(media).filter((m) => m && typeof m === 'object');
  if (entries.length === 0) return null;
  const main = entries.find((m) => m.mType === 'mainCall') || entries[0];
  return main.isHold === true;
}

/** Map interaction.state (+ hold flag) to a CALL_STATE value. */
export function mapInteractionState(rawState, onHold) {
  const s = String(rawState || '').toLowerCase().replace(/[\s_-]/g, '');
  if (s === 'wrapup' || s === 'wrapping') return CALL_STATE.WRAP_UP;
  if (s === 'ended' || s === 'terminated' || s === 'closed') return CALL_STATE.ENDED;
  if (onHold === true) return CALL_STATE.ON_HOLD;
  switch (s) {
    case 'new':
    case 'offered':
    case 'ringing':
    case 'alerting':
      return CALL_STATE.RINGING;
    case 'connected':
    case 'active':
      return CALL_STATE.CONNECTED;
    case 'hold':
    case 'held':
      return CALL_STATE.ON_HOLD;
    case 'consult':
    case 'consulting':
      return CALL_STATE.CONSULTING;
    case 'conference':
    case 'conferencing':
      return CALL_STATE.CONFERENCE;
    default:
      return CALL_STATE.UNKNOWN;
  }
}

/**
 * Extract the display fields from an interaction object.
 * For an inbound call the customer is the ANI; for an outdial the customer
 * is the DNIS (the number the agent dialled) and the ANI is the company's
 * outdial caller ID.
 */
export function extractCallInfo(interaction, previous = null) {
  const i = interaction || {};
  const cpd = i.callProcessingDetails || {};
  const cad = i.callAssociatedDetails || {};
  const cadata = i.callAssociatedData || {};

  const ani = first(cpd.ani, cad.ani, cadata.ani, i.ani, previous && previous.ani);
  const dnis = first(cpd.dnis, cad.dnis, cadata.dnis, previous && previous.dnis);
  const queue = first(cpd.virtualTeamName, cad.virtualTeamName, cadata.virtualTeamName, previous && previous.queue);
  const dirRaw = first(i.contactDirection && i.contactDirection.type, previous && previous.directionRaw).toUpperCase();
  const outboundType = first(i.outboundType, previous && previous.outboundType);
  const outbound = dirRaw === 'OUTBOUND' || (!!outboundType && dirRaw !== 'INBOUND');
  const hold = isAnyMediaOnHold(i);
  const onHold = hold === null ? !!(previous && previous.onHold) : hold;
  const rawState = first(i.state, previous && previous.rawState);

  return {
    interactionId: first(i.interactionId, previous && previous.interactionId),
    mediaType: first(i.mediaType, previous && previous.mediaType).toLowerCase(),
    ani,
    dnis,
    customerNumber: outbound ? dnis || ani : ani,
    queue,
    directionRaw: dirRaw,
    direction: outbound ? 'OUTBOUND' : dirRaw === 'INBOUND' ? 'INBOUND' : '',
    outboundType,
    rawState,
    onHold,
    callState: mapInteractionState(rawState, onHold),
  };
}

export class ContactService {
  constructor({ adapter, now = () => Date.now() }) {
    this.adapter = adapter;
    this.now = now;
    this.calls = new Map(); // interactionId -> info (in memory only)
    this.changes = new Emitter();
    this.notices = new Emitter(); // {kind:'new'|'state'|'ended', call}
    this.error = '';
    this._unsubs = [];
  }

  start() {
    const on = (name, fn) => {
      try {
        this._unsubs.push(this.adapter.onContactEvent(name, fn));
      } catch (err) {
        log.warn(`Could not subscribe to ${name}`, err);
      }
    };
    on('eAgentOfferContact', (m) => this.upsert(m, { ringing: true }));
    for (const name of UPSERT_EVENTS) on(name, (m) => this.upsert(m));
    on('eAgentContactHeld', (m) => this.upsert(m, { hold: true }));
    on('eAgentContactUnHeld', (m) => this.upsert(m, { hold: false }));
    on('eAgentWrapup', (m) => this.upsert(m, { wrapUp: true }));
    on('eAgentContactEnded', (m) => this.ended(m));
    on('eAgentContactWrappedUp', (m) => this.remove(m));
    on('eAgentOfferContactRona', (m) => this.remove(m));
    on('eAgentCtqCancelled', (m) => this.upsert(m));
    this.restoreFromDesktop();
  }

  stop() {
    for (const off of this._unsubs.splice(0)) off();
    this.calls.clear();
    this.changes.clear();
    this.notices.clear();
  }

  /** If the widget mounts during a call, rebuild the call list from Desktop's task map. */
  async restoreFromDesktop() {
    try {
      const map = await this.adapter.getTaskMap();
      this.setTaskMap(map);
    } catch (err) {
      log.warn('getTaskMap failed', err);
    }
  }

  /**
   * Accepts STORE.agentContact.taskMap: a Map, a Map-like observable (has
   * values()), or a plain object of tasks.
   */
  setTaskMap(taskMap) {
    if (!taskMap || typeof taskMap !== 'object') return;
    const tasks = typeof taskMap.values === 'function' && !Array.isArray(taskMap) ? [...taskMap.values()] : Object.values(taskMap);
    const liveIds = new Set();
    let understood = 0;
    for (const task of tasks) {
      const ev = unwrapContactEvent(task);
      if (!ev || !ev.interaction) continue;
      understood += 1;
      if (ev.interaction.isTerminated === true && !this._isWrapUpState(ev.interaction)) continue;
      liveIds.add(ev.interactionId);
      this._store(ev.interactionId, extractCallInfo(ev.interaction, this.calls.get(ev.interactionId)), false);
    }
    // Desktop's task map is authoritative: drop calls it no longer lists, but only
    // when every entry was understood, so an unexpected shape never blanks the panel.
    if (understood === tasks.length) {
      for (const id of [...this.calls.keys()]) if (!liveIds.has(id)) this.calls.delete(id);
    }
    this.error = '';
    this.changes.emit(this.snapshot());
  }

  upsert(msg, flags = {}) {
    const ev = unwrapContactEvent(msg);
    if (!ev) return;
    const prev = this.calls.get(ev.interactionId);
    let info = ev.interaction ? extractCallInfo(ev.interaction, prev) : prev ? { ...prev } : null;
    if (!info) return; // event without interaction for a call we don't know
    if (ev.body.ani) info.ani = str(ev.body.ani) || info.ani; // eAgentContactAniUpdated carries top-level ani
    if (info.direction !== 'OUTBOUND') info.customerNumber = info.ani;
    if (flags.hold !== undefined) info.onHold = flags.hold;
    if (flags.wrapUp) info.rawState = 'wrapUp';
    if (flags.ringing && !info.rawState) info.rawState = 'new';
    info.callState = mapInteractionState(info.rawState, info.onHold);
    this._store(ev.interactionId, info, true);
  }

  /** Call ended: keep it in WRAP-UP if the agent still has to wrap up, else remove. */
  ended(msg) {
    const ev = unwrapContactEvent(msg);
    if (!ev) return;
    const prev = this.calls.get(ev.interactionId);
    if (!prev) return;
    const interaction = ev.interaction || {};
    const needsWrapUp = this._isWrapUpState(interaction) || this._agentMustWrapUp(interaction);
    if (needsWrapUp) {
      this._store(ev.interactionId, { ...extractCallInfo(interaction, prev), rawState: 'wrapUp', callState: CALL_STATE.WRAP_UP }, true);
    } else {
      this.remove(msg);
    }
  }

  remove(msg) {
    const ev = unwrapContactEvent(msg);
    if (!ev || !this.calls.has(ev.interactionId)) return;
    const call = this.calls.get(ev.interactionId);
    this.calls.delete(ev.interactionId);
    this.changes.emit(this.snapshot());
    this.notices.emit({ kind: 'ended', call });
  }

  /** Primary call (telephony first, most recent) plus count of others. */
  snapshot() {
    const all = [...this.calls.values()].sort((a, b) => (b._updated || 0) - (a._updated || 0));
    const primary = all.find((c) => c.mediaType === 'telephony' || c.mediaType === '') || all[0] || null;
    return { primary, others: primary ? all.length - 1 : 0, error: this.error };
  }

  _isWrapUpState(interaction) {
    return mapInteractionState(interaction && interaction.state) === CALL_STATE.WRAP_UP;
  }

  _agentMustWrapUp(interaction) {
    const parts = interaction && interaction.participants;
    if (!parts || typeof parts !== 'object') return false;
    return Object.values(parts).some((p) => p && p.pType === 'Agent' && p.isWrapUp === true);
  }

  _store(id, info, notify) {
    const prev = this.calls.get(id);
    const next = { ...info, interactionId: id, _updated: this.now() };
    this.calls.set(id, next);
    this.error = '';
    this.changes.emit(this.snapshot());
    if (!notify) return;
    if (!prev) this.notices.emit({ kind: 'new', call: next });
    else if (prev.callState !== next.callState) this.notices.emit({ kind: 'state', call: next });
  }
}
