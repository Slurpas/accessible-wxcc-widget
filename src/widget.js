/**
 * <accessible-wxcc-widget> — the Web Component loaded by Webex Contact Center Desktop.
 *
 * Inputs from the Desktop layout (see desktop-layout/example-layout.json):
 *   properties: agentId, teamId, channelsStatesMap, taskMap   ($STORE bindings)
 *   attributes: team-dashboard="false"     turn the team list off
 *               team-refresh-seconds="60"  team refresh interval (min 30)
 *               theme="dark|light"         default theme (user choice wins)
 *               text-size="100|125|150"    default text size (user choice wins)
 *
 * Each feature (status, call, team) runs independently: a failure in one
 * never stops the others, and the status buttons never depend on the
 * call or team features.
 */
import { connectDesktop, isInsideDesktop } from './services/desktop-sdk.js';
import { AgentStateService } from './services/agent-state.js';
import { loadIdleCodes } from './services/auxiliary-codes.js';
import { ContactService } from './services/contact-events.js';
import { TeamService } from './services/team-dashboard.js';
import { AudioNotifier } from './services/audio-notify.js';
import { createCurrentStatus } from './components/current-status.js';
import { createStatusButtons, buildButtonDefs } from './components/status-buttons.js';
import { createCurrentCall } from './components/current-call.js';
import { createTeamList } from './components/team-list.js';
import { h, setText } from './components/dom.js';
import { Disposer } from './utils/cleanup.js';
import { DISPLAY } from './utils/status-mapper.js';
import { log, errorReason } from './utils/logger.js';
import { STRINGS } from './i18n/strings.js';
import themesCss from './styles/themes.css?inline';
import mainCss from './styles/main.css?inline';
import a11yCss from './styles/accessibility.css?inline';

/* global __AWX_MOCK_ALLOWED__ */
const MOCK_ALLOWED = typeof __AWX_MOCK_ALLOWED__ !== 'undefined' && __AWX_MOCK_ALLOWED__;
const PREFS_KEY = 'accessible-wxcc-widget.prefs';
const TEXT_SIZES = ['100', '125', '150'];
const LAYOUT_PROPS = ['agentId', 'teamId', 'channelsStatesMap', 'taskMap'];

/** Only non-sensitive display preferences are stored (theme, text size). */
function readPrefs() {
  try {
    const p = JSON.parse(globalThis.localStorage.getItem(PREFS_KEY) || '{}');
    return {
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : undefined,
      textSize: TEXT_SIZES.includes(String(p.textSize)) ? String(p.textSize) : undefined,
    };
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  try {
    globalThis.localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: prefs.theme, textSize: prefs.textSize }));
  } catch {
    /* storage may be blocked; preferences are optional */
  }
}

export class AccessibleWxccWidget extends HTMLElement {
  static get observedAttributes() {
    return ['team-dashboard'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._props = { agentId: '', teamId: '', channelsStatesMap: null, taskMap: null };
    this._built = false;
    this._session = 0;
    this._services = {};
    this._disposer = new Disposer();
    this._audio = new AudioNotifier();
    this._connection = 'loading';
  }

  // ---- Layout properties ($STORE bindings). Setters forward live updates to the services. ----
  get agentId() { return this._props.agentId; }
  set agentId(v) {
    this._props.agentId = typeof v === 'string' ? v : '';
    const a = this._services.agent;
    if (a && this._props.agentId) {
      a.setAgentId(this._props.agentId);
      this._refreshButtonsEnabled();
    }
    if (this._services.team) this._services.team.setContext({ selfId: this._props.agentId });
  }

  get teamId() { return this._props.teamId; }
  set teamId(v) {
    this._props.teamId = v === undefined || v === null ? '' : String(v);
    if (this._services.team) this._services.team.setContext({ teamId: this._props.teamId });
  }

  get channelsStatesMap() { return this._props.channelsStatesMap; }
  set channelsStatesMap(v) {
    this._props.channelsStatesMap = v && typeof v === 'object' ? v : null;
    if (this._services.agent && this._props.channelsStatesMap) this._services.agent.setChannelsStatesMap(this._props.channelsStatesMap);
  }

  get taskMap() { return this._props.taskMap; }
  set taskMap(v) {
    this._props.taskMap = v || null;
    if (this._services.contacts && v) this._safe('call', () => this._services.contacts.setTaskMap(v));
  }

  // ---- Lifecycle ----
  connectedCallback() {
    // Desktop may assign properties before this element was upgraded.
    for (const p of LAYOUT_PROPS) {
      if (Object.prototype.hasOwnProperty.call(this, p)) {
        const v = this[p];
        delete this[p];
        this[p] = v;
      }
    }
    if (!this._built) this._build();
    this._applyPrefs();
    this._start();
  }

  disconnectedCallback() {
    this._stop();
  }

  attributeChangedCallback(name, oldV, newV) {
    if (name === 'team-dashboard' && oldV !== newV && this.isConnected && this._built) {
      this._stop();
      this._start();
    }
  }

  // ---- DOM ----
  _build() {
    const style = document.createElement('style');
    style.textContent = `${themesCss}\n${mainCss}\n${a11yCss}`;

    this._ui = {};
    const ui = this._ui;
    ui.polite = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    ui.assertive = h('div', { class: 'sr-only', role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' });
    ui.banner = h('p', { class: 'conn-banner', hidden: true });

    ui.themeBtn = h('button', { type: 'button', class: 'small-btn' });
    ui.themeBtn.addEventListener('click', () => this._toggleTheme());
    ui.sizeBtn = h('button', { type: 'button', class: 'small-btn' });
    ui.sizeBtn.addEventListener('click', () => this._cycleTextSize());
    ui.soundBtn = h('button', { type: 'button', class: 'small-btn', 'aria-pressed': 'false', text: STRINGS.soundOff });
    ui.soundBtn.addEventListener('click', () => this._toggleSound());

    ui.status = createCurrentStatus();
    ui.buttons = createStatusButtons({ onSelect: (def) => this._onSelectState(def) });
    ui.call = createCurrentCall();
    ui.team = createTeamList({ onRefresh: () => this._services.team && this._services.team.manualRefresh() });

    ui.root = h(
      'div',
      { class: 'awx-root', role: 'region', 'aria-label': STRINGS.widgetTitle },
      h(
        'div',
        { class: 'awx-grid' },
        h(
          'div',
          { class: 'awx-header' },
          h('p', { class: 'awx-title', text: STRINGS.widgetTitle }),
          h('div', { class: 'awx-settings', role: 'group', 'aria-label': STRINGS.settings }, ui.themeBtn, ui.sizeBtn, ui.soundBtn),
        ),
        ui.banner,
        h('div', { class: 'awx-top' }, ui.status.el, ui.buttons.el),
        h('div', { class: 'awx-lower' }, ui.call.el, ui.team.el),
      ),
      ui.polite,
      ui.assertive,
    );

    this.shadowRoot.replaceChildren(style, ui.root);
    this._built = true;
  }

  // ---- Start / stop ----
  async _start() {
    const session = ++this._session;
    const ui = this._ui;
    this._connection = 'loading';
    this._renderBanner();
    ui.status.update({ phase: 'loading', display: DISPLAY.LOADING });
    ui.buttons.setDefs(buildButtonDefs([]));
    ui.buttons.setEnabled(false);
    ui.call.update({ primary: null, others: 0 });
    ui.team.update(this._teamEnabled() ? { phase: 'loading', rows: [] } : { phase: 'disabled' }, false);

    let adapter;
    try {
      adapter = await this._createAdapter();
    } catch (err) {
      if (session !== this._session) return;
      this._connection = err && err.code === 'NOT_IN_DESKTOP' ? 'notInDesktop' : 'error';
      this._connectionError = errorReason(err);
      log.error('Desktop connection failed', err);
      ui.status.update({ phase: 'error', display: DISPLAY.ERROR });
      ui.team.update({ phase: 'unavailable', rows: [] }, false);
      this._renderBanner();
      return;
    }
    if (session !== this._session) {
      adapter.cleanup(); // unmounted while connecting
      return;
    }
    this._adapter = adapter;
    this._connection = adapter.mode === 'mock' ? 'mock' : 'connected';
    this._renderBanner();

    this._safe('status', () => this._startAgentState(adapter));
    this._safe('status', () => this._startAuxCodes(adapter, session));
    this._safe('call', () => this._startContacts(adapter));
    if (this._teamEnabled()) this._safe('team', () => this._startTeam(adapter));
    this._safe('connection', () => this._watchConnection(adapter));
  }

  _stop() {
    this._session += 1;
    for (const s of Object.values(this._services)) {
      try {
        s.stop();
      } catch {
        /* keep stopping the rest */
      }
    }
    this._services = {};
    this._disposer.dispose();
    clearTimeout(this._politeTimer);
    clearTimeout(this._assertiveTimer);
    if (this._adapter) {
      try {
        this._adapter.cleanup();
      } catch {
        /* ignore */
      }
      this._adapter = null;
    }
    this._audio.close();
    this._setSoundUi(false);
  }

  async _createAdapter() {
    if (isInsideDesktop()) return connectDesktop();
    if (MOCK_ALLOWED && this._mockRequested()) {
      const { createMockAdapter } = await import('./mock/mock-desktop.js');
      const adapter = createMockAdapter();
      this.mockControls = adapter.controls; // used by the dev harness
      return adapter;
    }
    return connectDesktop(); // throws NOT_IN_DESKTOP -> diagnostic message
  }

  _mockRequested() {
    if (this.getAttribute('mock') === 'true') return true;
    try {
      return new URLSearchParams(globalThis.location.search).get('mock') === '1';
    } catch {
      return false;
    }
  }

  // ---- Feature: agent state ----
  _startAgentState(adapter) {
    const agent = new AgentStateService({ adapter });
    this._services.agent = agent;
    agent.setAgentId(this._props.agentId || adapter.agentId || '');
    agent.changes.subscribe((s) => this._renderStatus(s));
    agent.notices.subscribe((n) => this._onStateNotice(n));
    agent.start();
    if (this._props.channelsStatesMap) agent.setChannelsStatesMap(this._props.channelsStatesMap);
    this._renderStatus(agent.state);
  }

  async _startAuxCodes(adapter, session) {
    const { codes, error } = await loadIdleCodes(adapter);
    if (session !== this._session) return;
    this._ui.buttons.setDefs(buildButtonDefs(codes));
    if (this._services.agent) this._services.agent.setAuxCodes(codes);
    this._auxError = error ? STRINGS.auxCodesUnavailable : '';
    this._refreshButtonsEnabled();
  }

  _onSelectState(def) {
    const agent = this._services.agent;
    if (!agent) return;
    agent.requestChange({ state: def.state, auxCodeId: def.auxCodeId, label: def.label, reason: def.reason });
  }

  _onStateNotice(n) {
    const label = (d) => STRINGS.status[d] || d;
    if (n.kind === 'confirmed' || n.kind === 'external') {
      const reason = n.reasonName && n.reasonName.toUpperCase() !== label(n.display) ? n.reasonName : '';
      this._announce(STRINGS.statusAnnounce(label(n.display), reason));
      if (n.kind === 'confirmed') this._audio.play('statusChanged');
    } else if (n.kind === 'failed') {
      this._announce(STRINGS.requestFailed(n.label, n.reason || ''), true);
      this._audio.play('failure');
    } else if (n.kind === 'unconfirmed') {
      this._announce(STRINGS.requestNotConfirmed(n.label), true);
      this._audio.play('failure');
    }
  }

  _renderStatus(s) {
    let view = s;
    if (this._connection === 'disconnected' && s.phase === 'ok') {
      // Never present possibly stale data as current.
      view = { ...s, phase: 'error', display: DISPLAY.ERROR, reasonName: `Last known: ${STRINGS.status[s.display] || s.display}` };
    }
    this._ui.status.update(view);
    this._ui.buttons.update(s);
    this._refreshButtonsEnabled();
  }

  _refreshButtonsEnabled() {
    const agent = this._services.agent;
    const connected = this._connection === 'connected' || this._connection === 'mock';
    const hasId = !!(agent && agent.agentId);
    let msg = '';
    if (!hasId && agent) msg = STRINGS.noAgentId;
    else if (this._auxError) msg = this._auxError;
    this._ui.buttons.setEnabled(connected && hasId, msg);
  }

  // ---- Feature: current call ----
  _startContacts(adapter) {
    const contacts = new ContactService({ adapter });
    this._services.contacts = contacts;
    contacts.changes.subscribe((snap) => this._ui.call.update(snap));
    contacts.notices.subscribe((n) => {
      const c = n.call;
      if (n.kind === 'new') {
        this._announce(STRINGS.callAnnounceNew(c.customerNumber || STRINGS.unknownNumber, c.queue));
        this._audio.play('newCall');
      } else if (n.kind === 'state') {
        this._announce(STRINGS.callAnnounceState(STRINGS.callState[c.callState] || c.callState));
      } else if (n.kind === 'ended') {
        this._announce(STRINGS.callAnnounceEnded);
      }
    });
    contacts.start();
    if (this._props.taskMap) contacts.setTaskMap(this._props.taskMap);
  }

  // ---- Feature: team dashboard (optional) ----
  _teamEnabled() {
    return this.getAttribute('team-dashboard') !== 'false';
  }

  _startTeam(adapter) {
    const team = new TeamService({ adapter, refreshSeconds: Number(this.getAttribute('team-refresh-seconds')) || 60 });
    this._services.team = team;
    let latestTeam = '';
    try {
      latestTeam = String((adapter.getLatestData() || {}).teamId || '');
    } catch {
      /* optional */
    }
    team.setContext({ teamId: this._props.teamId || latestTeam || adapter.teamId, selfId: this._props.agentId || adapter.agentId });
    team.changes.subscribe((s) => this._ui.team.update(s, team.isStale()));
    this._disposer.interval(() => this._ui.team.update(team.state, team.isStale()), 30000);
    team.start();
  }

  // ---- Connection monitoring ----
  _watchConnection(adapter) {
    const setConn = (c) => {
      if (this._connection === c) return;
      const was = this._connection;
      this._connection = c;
      this._renderBanner();
      if (this._services.agent) this._renderStatus(this._services.agent.state);
      if (c === 'disconnected') {
        this._announce(STRINGS.conn.disconnected, true);
        this._audio.play('connectionLost');
      } else if (was === 'disconnected') {
        this._announce(STRINGS.conn.connected);
        this._resync();
      }
    };
    const base = adapter.mode === 'mock' ? 'mock' : 'connected';
    this._disposer.listen(globalThis, 'offline', () => setConn('disconnected'));
    this._disposer.listen(globalThis, 'online', () => setConn(base));
    if (globalThis.navigator && globalThis.navigator.onLine === false) setConn('disconnected');

    // Desktop re-login after a network or session interruption: re-read everything.
    for (const ev of ['eAgentReloginSuccess', 'eAgentChannelReloginSuccess']) {
      try {
        this._disposer.add(adapter.onAgentStateEvent(ev, () => this._resync()));
      } catch {
        /* event not supported in this SDK version */
      }
    }
  }

  _resync() {
    const { contacts, team } = this._services;
    if (contacts) contacts.restoreFromDesktop();
    if (team) team.refresh();
    if (this._props.channelsStatesMap && this._services.agent) this._services.agent.setChannelsStatesMap(this._props.channelsStatesMap);
  }

  _renderBanner() {
    const b = this._ui.banner;
    const map = {
      loading: ['info', STRINGS.conn.loading],
      connected: null,
      mock: ['mock', STRINGS.conn.mock],
      disconnected: ['error', STRINGS.conn.disconnected],
      notInDesktop: ['warning', STRINGS.conn.notInDesktop],
      error: ['error', `${STRINGS.conn.error}: ${this._connectionError || ''}`],
    };
    const v = map[this._connection];
    b.hidden = !v;
    if (v) {
      b.dataset.kind = v[0];
      setText(b, v[1]);
    }
  }

  // ---- Announcements ----
  _announce(text, urgent = false) {
    const region = urgent ? this._ui.assertive : this._ui.polite;
    const key = urgent ? '_assertiveTimer' : '_politeTimer';
    // Clear first so the same message is announced again if repeated.
    region.textContent = '';
    clearTimeout(this[key]);
    this[key] = setTimeout(() => {
      region.textContent = text;
    }, 50);
  }

  // ---- Settings ----
  _applyPrefs() {
    const prefs = readPrefs();
    const theme = prefs.theme || (this.getAttribute('theme') === 'light' ? 'light' : 'dark');
    const size = prefs.textSize || (TEXT_SIZES.includes(this.getAttribute('text-size')) ? this.getAttribute('text-size') : '100');
    this.setAttribute('theme', theme);
    this.setAttribute('text-size', size);
    this._renderSettings();
  }

  _toggleTheme() {
    const next = this.getAttribute('theme') === 'light' ? 'dark' : 'light';
    this.setAttribute('theme', next);
    writePrefs({ theme: next, textSize: this.getAttribute('text-size') });
    this._renderSettings();
  }

  _cycleTextSize() {
    const cur = this.getAttribute('text-size') || '100';
    const next = TEXT_SIZES[(TEXT_SIZES.indexOf(cur) + 1) % TEXT_SIZES.length];
    this.setAttribute('text-size', next);
    writePrefs({ theme: this.getAttribute('theme'), textSize: next });
    this._renderSettings();
  }

  _toggleSound() {
    if (this._audio.enabled) this._audio.disable();
    else this._audio.enable();
    this._setSoundUi(this._audio.enabled);
  }

  _setSoundUi(on) {
    if (!this._ui) return;
    this._ui.soundBtn.setAttribute('aria-pressed', String(on));
    setText(this._ui.soundBtn, on ? STRINGS.soundOn : STRINGS.soundOff);
  }

  _renderSettings() {
    const theme = this.getAttribute('theme');
    // The button names the theme it switches TO; aria-pressed is not used to avoid a double meaning.
    setText(this._ui.themeBtn, theme === 'light' ? STRINGS.themeDark : STRINGS.themeLight);
    const size = this.getAttribute('text-size') || '100';
    setText(this._ui.sizeBtn, `${STRINGS.textSize}: ${STRINGS.textSizes[size]}`);
  }

  /** Run a feature step so its failure is contained to that feature. */
  _safe(feature, fn) {
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') r.catch((err) => this._featureFailed(feature, err));
    } catch (err) {
      this._featureFailed(feature, err);
    }
  }

  _featureFailed(feature, err) {
    log.error(`${feature} feature failed`, err);
    if (feature === 'call') this._ui.call.update({ primary: null, others: 0, error: 'FAILED' });
    if (feature === 'team') this._ui.team.update({ phase: 'unavailable', rows: [] }, false);
    if (feature === 'status') this._ui.status.update({ phase: 'error', display: DISPLAY.ERROR });
  }
}
