/**
 * "MY CURRENT CALL" panel: large customer number, direction, queue, status,
 * and an END CALL button. Ending always needs a second, explicit
 * "Yes, end call" press; Escape or Cancel backs out.
 */
import { h, setText } from './dom.js';
import { STRINGS } from '../i18n/strings.js';

/** Read phone numbers digit by digit: "+46 46 123" -> "plus 4 6, 4 6, 1 2 3". */
export function spokenNumber(n) {
  const s = String(n || '').trim();
  if (!/^[+\d\s().-]+$/.test(s)) return s; // not a phone number (e.g. an email for digital channels)
  const groups = s
    .replace(/^\+/, '')
    .split(/[\s().-]+/)
    .filter(Boolean)
    .map((g) => g.split('').join(' '));
  return (s.startsWith('+') ? 'plus ' : '') + groups.join(', ');
}

export function createCurrentCall({ onEnd = () => {}, onCancel = () => {} } = {}) {
  const empty = h('p', { class: 'call-empty', text: STRINGS.noCall });
  const number = h('p', { class: 'call-number' });
  const dir = h('span', { class: 'badge badge-dir' });
  const state = h('span', { class: 'badge badge-state' });
  const queue = h('dd', { class: 'call-queue' });
  const ani = h('dd');
  const dnis = h('dd');
  const others = h('p', { class: 'call-others', hidden: true });
  const error = h('p', { class: 'call-error', hidden: true, text: STRINGS.callInfoUnavailable });

  const endBtn = h('button', { type: 'button', class: 'call-end-btn', text: STRINGS.endCall });
  const endYes = h('button', { type: 'button', class: 'call-end-btn call-end-yes', text: STRINGS.endCallYes });
  const endNo = h('button', { type: 'button', class: 'small-btn call-end-no', text: STRINGS.cancel });
  const endConfirm = h(
    'div',
    { class: 'call-end-confirm', role: 'group', 'aria-label': STRINGS.endCallQuestion, hidden: true },
    h('p', { class: 'call-end-question', 'aria-hidden': 'true', text: STRINGS.endCallQuestion }),
    endYes,
    endNo,
  );
  const endNote = h('p', { class: 'call-end-note', hidden: true });
  const actions = h('div', { class: 'call-actions', hidden: true }, endBtn, endConfirm, endNote);
  let current = null; // call shown now
  let confirming = false;
  let endable = false;

  function showConfirm(on) {
    confirming = on && endable;
    endBtn.hidden = confirming;
    endConfirm.hidden = !confirming;
  }
  function cancel() {
    showConfirm(false);
    endBtn.focus();
    onCancel();
  }
  endBtn.addEventListener('click', () => {
    showConfirm(true);
    endYes.focus();
  });
  endYes.addEventListener('click', () => {
    const call = current;
    showConfirm(false);
    if (call) onEnd(call);
  });
  endNo.addEventListener('click', cancel);
  endConfirm.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    }
  });

  const active = h(
    'div',
    { class: 'call-active', hidden: true },
    h('p', { class: 'call-number-label', text: STRINGS.customerNumber }),
    number,
    h('p', { class: 'call-badges' }, dir, state),
    actions,
    h(
      'dl',
      { class: 'call-details' },
      h('div', { class: 'call-row call-row-queue' }, h('dt', { text: STRINGS.queue }), queue),
      h('div', { class: 'call-row' }, h('dt', { text: STRINGS.callerNumber }), ani),
      h('div', { class: 'call-row' }, h('dt', { text: STRINGS.dialledNumber }), dnis),
    ),
    others,
  );

  const el = h(
    'section',
    { class: 'panel panel-call', 'aria-labelledby': 'awx-h-call' },
    h('h2', { id: 'awx-h-call', class: 'panel-title', text: STRINGS.myCall }),
    empty,
    active,
    error,
  );

  /**
   * @param {object} snap ContactService snapshot
   * @param {{canEnd?:boolean, pending?:boolean}} [opts] canEnd: the profile allows ending calls
   */
  function update(snap, opts = {}) {
    const c = snap && snap.primary;
    error.hidden = !(snap && snap.error);
    empty.hidden = !!c;
    active.hidden = !c;
    const sameCall = c && current && c.interactionId === current.interactionId;
    current = c || null;
    if (!sameCall) confirming = false;
    endable = !!c && !!opts.canEnd && c.callState === 'CONNECTED' && (c.mediaType === 'telephony' || !c.mediaType);
    const wasFocused = endConfirm.contains(endConfirm.getRootNode().activeElement);
    actions.hidden = !c || !opts.canEnd || !(endable || opts.pending);
    endBtn.disabled = !!opts.pending;
    setText(endBtn, opts.pending ? STRINGS.endCallPending : STRINGS.endCall);
    showConfirm(confirming && !opts.pending);
    if (wasFocused && !confirming && !endBtn.hidden) endBtn.focus();
    if (!c) return;
    const shown = c.customerNumber || STRINGS.unknownNumber;
    setText(number, shown);
    number.setAttribute('aria-label', c.customerNumber ? spokenNumber(c.customerNumber) : shown);
    setText(dir, c.direction === 'OUTBOUND' ? STRINGS.outbound : c.direction === 'INBOUND' ? STRINGS.inbound : '');
    dir.hidden = !c.direction;
    state.dataset.callState = c.callState;
    setText(state, STRINGS.callState[c.callState] || c.callState);
    setText(queue, c.queue || STRINGS.unknownQueue);
    setText(ani, c.ani || '—');
    setText(dnis, c.dnis || '—');
    others.hidden = !snap.others;
    setText(others, snap.others ? STRINGS.otherInteractions(snap.others) : '');
  }

  return { el, update };
}
