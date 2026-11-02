/**
 * The big "MY STATUS" panel. Colour + icon + text, never colour alone.
 * This panel is not a live region itself; announcements go through the
 * widget's live regions so they are spoken exactly once.
 */
import { h, setText, formatTime } from './dom.js';
import { ICONS, DISPLAY } from '../utils/status-mapper.js';
import { STRINGS } from '../i18n/strings.js';

export function createCurrentStatus() {
  const icon = h('span', { class: 'status-icon', 'aria-hidden': 'true' });
  const label = h('span', { class: 'status-label' });
  const reason = h('span', { class: 'status-reason' });
  const card = h('div', { class: 'status-card', 'data-status': DISPLAY.LOADING }, icon, h('span', { class: 'status-text' }, label, reason));
  const help = h('p', { class: 'status-help' });
  const since = h('p', { class: 'status-since' });
  const request = h('p', { class: 'status-request', hidden: true });

  const el = h(
    'section',
    { class: 'panel panel-status', 'aria-labelledby': 'awx-h-status' },
    h('h2', { id: 'awx-h-status', class: 'panel-title', text: STRINGS.myStatus }),
    card,
    help,
    since,
    request,
  );

  function update(s) {
    const key = s.phase === 'error' && s.display === DISPLAY.ERROR ? DISPLAY.ERROR : s.display;
    card.dataset.status = key;
    setText(icon, ICONS[key] || '?');
    setText(label, STRINGS.status[key] || key);
    setText(reason, s.reasonName && s.reasonName.toUpperCase() !== (STRINGS.status[key] || '') ? s.reasonName : '');
    setText(help, STRINGS.statusHelp[key] || '');
    setText(since, s.phase === 'ok' && s.since ? STRINGS.since(formatTime(s.since)) : '');

    let msg = '';
    let kind = '';
    if (s.pending) {
      msg = STRINGS.requesting(s.pending.label);
      kind = 'pending';
    } else if (s.lastError && s.lastError !== 'NO_STATE_DATA') {
      msg = s.lastError;
      kind = 'error';
    } else if (s.unconfirmed) {
      msg = STRINGS.requestNotConfirmed(s.unconfirmed);
      kind = 'warning';
    }
    request.hidden = !msg;
    request.dataset.kind = kind;
    setText(request, msg);
  }

  return { el, update };
}
