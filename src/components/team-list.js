/**
 * "MY TEAM" panel. One large row per colleague. Updates are silent for
 * screen readers (no live region) so refreshes never interrupt the agent;
 * the summary line can be read on demand.
 */
import { h, setText, formatTime } from './dom.js';
import { STRINGS } from '../i18n/strings.js';
import { ICONS } from '../utils/status-mapper.js';

export function createTeamList({ onRefresh }) {
  const summary = h('p', { class: 'team-summary' });
  const status = h('p', { class: 'team-status', hidden: true });
  const list = h('ul', { class: 'team-list', 'aria-labelledby': 'awx-h-team' });
  const refresh = h('button', { type: 'button', class: 'small-btn team-refresh', text: STRINGS.refresh });
  refresh.addEventListener('click', () => onRefresh());

  const el = h(
    'section',
    { class: 'panel panel-team', 'aria-labelledby': 'awx-h-team' },
    h('div', { class: 'panel-head' }, h('h2', { id: 'awx-h-team', class: 'panel-title', text: STRINGS.myTeam }), refresh),
    summary,
    status,
    list,
  );

  function renderRows(rows) {
    list.replaceChildren(
      ...rows.map((r) =>
        h(
          'li',
          { class: 'team-row', 'data-status': r.display },
          h('span', { class: 'team-indicator', 'aria-hidden': 'true', text: ICONS[r.display] || '?' }),
          h('span', { class: 'team-name', text: r.name }),
          h(
            'span',
            { class: 'team-state' },
            h('span', { text: STRINGS.status[r.display] || r.display }),
            r.reason ? h('span', { class: 'team-reason', text: r.reason }) : null,
          ),
        ),
      ),
    );
  }

  /** @param {object} s TeamService state, @param {boolean} stale */
  function update(s, stale) {
    if (s.phase === 'disabled') {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    refresh.hidden = s.phase === 'unavailable' || !!s.live;

    if (s.phase === 'unavailable') {
      setText(summary, STRINGS.teamUnavailable);
      status.hidden = true;
      renderRows([]);
      return;
    }

    if (s.phase === 'loading' && !s.lastSuccess) {
      setText(summary, STRINGS.teamLoading);
      status.hidden = true;
      return;
    }

    const counts = s.live ? STRINGS.teamCountsLive : STRINGS.teamCounts;
    setText(summary, s.lastSuccess ? counts(s.readyCount, s.rows.length) : '');
    let msg = '';
    let kind = '';
    if (s.phase === 'error') {
      msg = STRINGS.teamError(formatTime(s.lastSuccess));
      kind = 'error';
    } else if (stale) {
      msg = STRINGS.teamStale(formatTime(s.lastSuccess));
      kind = 'warning';
    } else if (s.lastSuccess && !s.live) {
      msg = STRINGS.teamUpdated(formatTime(s.lastSuccess), s.refreshSeconds);
      kind = 'info';
    }
    status.hidden = !msg;
    status.dataset.kind = kind;
    setText(status, msg);
    el.classList.toggle('is-stale', s.phase === 'error' || stale);

    if (s.lastSuccess && s.rows.length === 0) {
      list.replaceChildren(h('li', { class: 'team-empty', text: STRINGS.teamEmpty }));
    } else {
      renderRows(s.rows);
    }
  }

  return { el, update };
}
