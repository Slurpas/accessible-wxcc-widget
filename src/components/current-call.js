/**
 * "MY CURRENT CALL" panel: large customer number, direction, queue, status.
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

export function createCurrentCall() {
  const empty = h('p', { class: 'call-empty', text: STRINGS.noCall });
  const number = h('p', { class: 'call-number' });
  const dir = h('span', { class: 'badge badge-dir' });
  const state = h('span', { class: 'badge badge-state' });
  const queue = h('dd', { class: 'call-queue' });
  const ani = h('dd');
  const dnis = h('dd');
  const others = h('p', { class: 'call-others', hidden: true });
  const error = h('p', { class: 'call-error', hidden: true, text: STRINGS.callInfoUnavailable });

  const active = h(
    'div',
    { class: 'call-active', hidden: true },
    h('p', { class: 'call-number-label', text: STRINGS.customerNumber }),
    number,
    h('p', { class: 'call-badges' }, dir, state),
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

  function update(snap) {
    const c = snap && snap.primary;
    error.hidden = !(snap && snap.error);
    empty.hidden = !!c;
    active.hidden = !c;
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
