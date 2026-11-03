/**
 * "RECENT CALLS" panel: calls from this Desktop session, newest first, each
 * with a large "Call back" button. Dialling always needs a second, explicit
 * "Call now" press; Escape or Cancel backs out. Updates are silent for screen
 * readers (no live region); the widget announces dialling results itself.
 */
import { h, setText, formatTime } from './dom.js';
import { spokenNumber } from './current-call.js';
import { STRINGS } from '../i18n/strings.js';

function kindOf(e, activeIds) {
  if (activeIds.has(e.id) && !e.endedAt) return 'NOW';
  if (e.missed) return 'MISSED';
  return e.direction === 'OUTBOUND' ? 'OUT' : 'IN';
}

const KIND_TEXT = { NOW: () => STRINGS.historyActive, MISSED: () => STRINGS.historyMissed, OUT: () => STRINGS.historyOut, IN: () => STRINGS.historyIn };

export function createHistoryList({ onDial, onCancel = () => {} }) {
  const status = h('p', { class: 'history-status', hidden: true });
  const list = h('ul', { class: 'history-list', 'aria-labelledby': 'awx-h-history' });
  const el = h(
    'section',
    { class: 'panel panel-history', 'aria-labelledby': 'awx-h-history' },
    h('div', { class: 'panel-head' }, h('h2', { id: 'awx-h-history', class: 'panel-title', text: STRINGS.recentCalls })),
    status,
    list,
  );

  let view = { entries: [], activeIds: new Set(), canDial: false, dialAllowed: false, blockedMsg: '', unavailableMsg: '' };
  let confirmId = '';

  function focusKey(key) {
    const target = list.querySelector(`[data-focus="${key}"]`);
    if (target && !target.disabled) target.focus();
  }

  function cancel(id) {
    confirmId = '';
    render();
    focusKey(`back:${id}`);
    onCancel();
  }

  function row(e) {
    const kind = kindOf(e, view.activeIds);
    const shown = e.number || STRINGS.unknownNumber;
    const spoken = e.number ? spokenNumber(e.number) : shown;
    const time = formatTime(e.startedAt);
    const dur = e.endedAt && e.connectedAt ? STRINGS.duration(e.endedAt - e.connectedAt) : '';
    const info = h(
      'div',
      { class: 'history-info', role: 'group', 'aria-label': STRINGS.historyRowLabel(STRINGS.historyDirection[kind], spoken, time, dur) },
      h('span', { class: 'history-kind', 'data-kind': kind, 'aria-hidden': 'true', text: KIND_TEXT[kind]() }),
      h('span', { class: 'history-number', 'aria-hidden': 'true', text: shown }),
      h('span', { class: 'history-meta', 'aria-hidden': 'true', text: [time, dur].filter(Boolean).join(' · ') }),
    );

    let action = null;
    if (view.dialAllowed && e.number && kind !== 'NOW') {
      if (confirmId === e.id && view.canDial) {
        const yes = h('button', { type: 'button', class: 'history-call-now', 'data-focus': `yes:${e.id}`, text: STRINGS.callNow });
        const no = h('button', { type: 'button', class: 'small-btn history-cancel', 'data-focus': `no:${e.id}`, text: STRINGS.cancel });
        yes.addEventListener('click', () => {
          confirmId = '';
          onDial(e);
        });
        no.addEventListener('click', () => cancel(e.id));
        action = h(
          'div',
          { class: 'history-confirm', role: 'group', 'aria-label': STRINGS.confirmDial(spoken) },
          h('p', { class: 'history-question', 'aria-hidden': 'true', text: STRINGS.confirmDial(shown) }),
          yes,
          no,
        );
        action.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            cancel(e.id);
          }
        });
      } else {
        const back = h('button', {
          type: 'button',
          class: 'small-btn history-back',
          'data-focus': `back:${e.id}`,
          'aria-label': STRINGS.callBackLabel(spoken),
          text: STRINGS.callBack,
        });
        back.disabled = !view.canDial;
        back.addEventListener('click', () => {
          confirmId = e.id;
          render();
          focusKey(`yes:${e.id}`);
        });
        action = back;
      }
    }
    return h('li', { class: 'history-row', 'data-kind': kind }, info, action);
  }

  function render() {
    const root = el.getRootNode && el.getRootNode();
    const active = root && root.activeElement;
    const key = active && list.contains(active) ? active.dataset.focus : '';

    if (!view.canDial) confirmId = '';
    let msg = '';
    if (view.entries.length && !view.dialAllowed) msg = view.unavailableMsg || '';
    else if (view.entries.length && !view.canDial) msg = view.blockedMsg;
    status.hidden = !msg;
    setText(status, msg);
    list.replaceChildren(...(view.entries.length ? view.entries.map(row) : [h('li', { class: 'history-empty', text: STRINGS.historyEmpty })]));
    if (key) focusKey(key);
  }

  /**
   * @param {{entries:object[], activeIds:Set<string>, canDial:boolean, dialAllowed:boolean, blockedMsg?:string}} v
   */
  function update(v) {
    view = { ...view, ...v };
    render();
  }

  function setHidden(hidden) {
    el.hidden = hidden;
  }

  return { el, update, setHidden };
}
