/**
 * Recent calls for the current Desktop session.
 *
 * Built only from the contact events the widget already receives. The list
 * lives in memory in this script, not in the widget element, so it survives
 * switching Desktop pages (unmount/remount) and is shared by every instance
 * of the widget (for example a headless recorder plus the visible page).
 * It is gone when Desktop reloads or the agent signs out.
 *
 * Privacy: never written to browser storage, never logged, never
 * sent anywhere. Only number, direction, queue and times are kept; no
 * customer names or other interaction data.
 */
import { Emitter } from '../utils/cleanup.js';
import { CALL_STATE } from './contact-events.js';

export const MAX_ENTRIES = 25;

const DONE = new Set([CALL_STATE.WRAP_UP, CALL_STATE.ENDED]);
const TALKING = new Set([CALL_STATE.CONNECTED, CALL_STATE.ON_HOLD, CALL_STATE.CONSULTING, CALL_STATE.CONFERENCE]);

function isTelephony(call) {
  return !call.mediaType || call.mediaType === 'telephony';
}

/** An incoming call that ended before the agent was connected. */
function isMissed(e) {
  return e.direction !== 'OUTBOUND' && !e.connectedAt;
}

export class CallHistory {
  constructor({ now = () => Date.now(), max = MAX_ENTRIES } = {}) {
    this.now = now;
    this.max = max;
    this._entries = new Map(); // interactionId -> entry
    this.changes = new Emitter();
  }

  /** Newest first. Each entry: {id, number, direction, queue, startedAt, connectedAt, endedAt, missed}. */
  list() {
    return [...this._entries.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Add or update a call from a ContactService call info object. */
  upsert(call) {
    if (!call || !call.interactionId || !isTelephony(call)) return;
    const t = this.now();
    const prev = this._entries.get(call.interactionId);
    const next = prev ? { ...prev } : { id: call.interactionId, number: '', direction: '', queue: '', startedAt: t, connectedAt: 0, endedAt: 0, missed: false };
    if (call.customerNumber) next.number = call.customerNumber;
    if (call.direction) next.direction = call.direction;
    if (call.queue) next.queue = call.queue;
    if (TALKING.has(call.callState) && !next.connectedAt) next.connectedAt = t;
    if (DONE.has(call.callState) && !next.endedAt) {
      next.endedAt = t;
      next.missed = isMissed(next);
    }
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
    this._entries.set(call.interactionId, next);
    this._trim();
    this.changes.emit(this.list());
  }

  /** The call is gone from Desktop (wrapped up, RONA, ended without wrap-up). */
  finish(interactionId) {
    const e = this._entries.get(interactionId);
    if (!e || e.endedAt) return;
    const t = this.now();
    this._entries.set(interactionId, { ...e, endedAt: t, missed: isMissed(e) });
    this.changes.emit(this.list());
  }

  clear() {
    this._entries.clear();
    this.changes.emit([]);
  }

  _trim() {
    const all = this.list();
    for (const e of all.slice(this.max)) this._entries.delete(e.id);
  }
}

/** One history per Desktop page, shared by all widget instances. */
export const sessionHistory = new CallHistory();

/**
 * Feed a history from a ContactService. Calls this service saw that vanish
 * from its list are finished; calls it never saw are left to other recorders.
 * Returns an unsubscribe function.
 */
export function attachRecorder(contacts, history = sessionHistory) {
  const seen = new Set();
  const offChanges = contacts.changes.subscribe(() => {
    const live = new Set();
    for (const call of contacts.calls.values()) {
      live.add(call.interactionId);
      seen.add(call.interactionId);
      history.upsert(call);
    }
    for (const id of [...seen]) {
      if (!live.has(id)) {
        history.finish(id);
        seen.delete(id);
      }
    }
  });
  return () => offChanges();
}
