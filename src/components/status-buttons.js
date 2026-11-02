/**
 * Always-visible, large status buttons.
 *
 * Buttons use aria-disabled instead of the disabled attribute while a
 * request is running, so keyboard focus is never thrown away. The current
 * state is shown with aria-pressed, a thick outline and the word "CURRENT"
 * (not colour alone).
 */
import { h, setText } from './dom.js';
import { STRINGS } from '../i18n/strings.js';
import { DISPLAY } from '../utils/status-mapper.js';
import { AVAILABLE_AUX_CODE } from '../services/agent-state.js';

// Plain text glyphs (no colour emoji) so they follow the button's text colour.
const TONE_ICON = { ready: '✔', notready: '✖', lunch: '◐', break: '❚❚', admin: '▤' };

// Above this many idle codes the buttons switch to a denser grid (each still at least 60px tall).
export const MANY_CODES = 6;

/** Build the list of button definitions from the tenant's idle codes. */
export function buildButtonDefs(idleCodes) {
  const defs = [{ key: 'ready', label: STRINGS.readyButton, state: 'Available', auxCodeId: AVAILABLE_AUX_CODE, tone: 'ready', reason: 'Available' }];
  for (const c of idleCodes || []) {
    defs.push({ key: `idle-${c.id}`, label: c.name.toUpperCase(), state: 'Idle', auxCodeId: c.id, tone: c.tone, reason: c.name });
  }
  return defs;
}

export function createStatusButtons({ onSelect }) {
  const group = h('div', { class: 'state-buttons', role: 'group', 'aria-labelledby': 'awx-h-buttons' });
  const note = h('p', { class: 'buttons-note', hidden: true });
  const el = h(
    'section',
    { class: 'panel panel-buttons', 'aria-labelledby': 'awx-h-buttons' },
    h('h2', { id: 'awx-h-buttons', class: 'panel-title', text: STRINGS.changeStatus }),
    group,
    note,
  );

  let defs = [];
  let buttons = new Map();
  let lastState = null;
  let enabled = false;

  function setDefs(nextDefs) {
    // Keep focus on the same button if it still exists after a rebuild.
    const focusedKey = el.getRootNode && el.getRootNode().activeElement && el.getRootNode().activeElement.dataset
      ? el.getRootNode().activeElement.dataset.key
      : undefined;
    defs = nextDefs;
    buttons = new Map();
    group.replaceChildren();
    group.dataset.density = defs.length - 1 > MANY_CODES ? 'many' : 'few';
    for (const d of defs) {
      const current = h('span', { class: 'btn-current', text: '' });
      const btn = h(
        'button',
        { type: 'button', class: `state-btn tone-${d.tone}${d.key === 'ready' ? ' state-btn-ready' : ''}`, 'data-key': d.key, 'aria-pressed': 'false' },
        h('span', { class: 'btn-icon', 'aria-hidden': 'true', text: TONE_ICON[d.tone] || '✖' }),
        h('span', { class: 'btn-label', text: d.label }),
        current,
      );
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-disabled') === 'true') return;
        onSelect(d);
      });
      group.append(btn);
      buttons.set(d.key, { btn, current, def: d });
    }
    if (focusedKey && buttons.has(focusedKey)) buttons.get(focusedKey).btn.focus();
    if (lastState) update(lastState);
  }

  function isCurrent(d, s) {
    if (s.phase !== 'ok') return false;
    if (d.state === 'Available') return s.display === DISPLAY.READY;
    return s.display === DISPLAY.NOT_READY && s.auxCodeId === d.auxCodeId;
  }

  function update(s) {
    lastState = s;
    for (const { btn, current, def } of buttons.values()) {
      const cur = isCurrent(def, s);
      const pending = !!(s.pending && s.pending.state === def.state && s.pending.auxCodeId === def.auxCodeId);
      btn.setAttribute('aria-pressed', String(cur));
      btn.classList.toggle('is-current', cur);
      btn.classList.toggle('is-pending', pending);
      btn.setAttribute('aria-disabled', String(!enabled || !!s.pending));
      if (pending) btn.setAttribute('aria-busy', 'true');
      else btn.removeAttribute('aria-busy');
      setText(current, cur ? 'CURRENT' : pending ? '…' : '');
    }
  }

  function setEnabled(v, message = '') {
    enabled = !!v;
    note.hidden = !message;
    setText(note, message);
    if (lastState) update(lastState);
    else for (const { btn } of buttons.values()) btn.setAttribute('aria-disabled', String(!enabled));
  }

  return { el, setDefs, update, setEnabled };
}
