/**
 * UI tests in jsdom. The Desktop SDK adapter is replaced by the mock
 * adapter, so these tests never touch the Cisco SDK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockAdapter } from '../src/mock/mock-desktop.js';
import { sessionHistory } from '../src/services/call-history.js';

let currentAdapter;
vi.mock('../src/services/desktop-sdk.js', () => ({
  isInsideDesktop: () => true,
  connectDesktop: async () => currentAdapter,
}));

await import('../src/index.js');

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let el;
const q = (s) => el.shadowRoot.querySelector(s);
const qa = (s) => [...el.shadowRoot.querySelectorAll(s)];

async function mount(attrs = {}, props = {}) {
  el = document.createElement('accessible-wxcc-widget');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.assign(el, props);
  document.body.append(el);
  await wait(60);
  return el;
}

beforeEach(() => {
  localStorage.clear();
  sessionHistory.clear();
  currentAdapter = createMockAdapter({ latencyMs: 5 });
});

afterEach(() => {
  el && el.remove();
  document.body.innerHTML = '';
});

describe('<accessible-wxcc-widget>', () => {
  it('registers the custom element with an open shadow root', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    expect(customElements.get('accessible-wxcc-widget')).toBeTruthy();
    expect(el.shadowRoot).toBeTruthy();
  });

  it('renders status, tenant aux-code buttons and headings', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    expect(q('.status-label').textContent).toBe('NOT READY');
    const labels = qa('.state-btn .btn-label').map((b) => b.textContent);
    expect(labels).toEqual(['READY', 'NOT READY', 'LUNCH', 'BREAK', 'ADMIN']); // RONA (system) excluded
    // Reading order: status, call, buttons, team (call info is never pushed below a long button list).
    expect(qa('h2').map((h) => h.textContent)).toEqual(['My status', 'My current call', 'Change status', 'Recent calls', 'My team']);
    expect(q('.state-buttons').dataset.density).toBe('few');
    expect(q('.state-btn').classList.contains('state-btn-ready')).toBe(true);
  });

  it('switches to a dense button grid for tenants with many idle codes', async () => {
    currentAdapter = createMockAdapter({ latencyMs: 5, manyCodes: true });
    await mount({}, { agentId: currentAdapter.agentId });
    expect(qa('.state-btn').length).toBe(18); // READY + 17 non-system codes
    expect(q('.state-buttons').dataset.density).toBe('many');
    expect(qa('.state-btn .btn-label').map((b) => b.textContent)).toContain('SYSTEM DOWNTIME - WAITING FOR IT SUPPORT');
  });

  it("shows a colleague's Not Ready reason when Webex provides it", async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    const erik = qa('.team-row').find((r) => r.textContent.includes('Demo Erik'));
    expect(erik.querySelector('.team-reason').textContent).toBe('Lunch');
    const johan = qa('.team-row').find((r) => r.textContent.includes('Demo Johan'));
    expect(johan.querySelector('.team-reason')).toBeNull();
    expect(johan.querySelector('.team-state').textContent).toBe('NOT READY');
  });

  it('tells the agent the team list updates by itself', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    expect(q('.team-status').textContent).toMatch(/^Updates automatically every 30 seconds\. Last updated /);
    expect(q('.team-refresh').textContent).toBe('Refresh now');
    expect(q('.panel-team').textContent).not.toMatch(/Webex lists|Team filter/);
  });

  it('marks the current state with aria-pressed and visible text', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    const current = qa('.state-btn').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('CURRENT');
  });

  it('shows pending, then the confirmed state, and announces it', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    q('[data-key="ready"]').click();
    await wait(1);
    expect(q('.status-label').textContent).toBe('NOT READY');
    expect(q('.status-request').textContent).toContain('Requesting READY');
    await wait(80);
    expect(q('.status-label').textContent).toBe('READY');
    expect(q('.status-request').hidden).toBe(true);
    expect(q('[role="status"]').textContent).toContain('Your status is now READY');
  });

  it('keeps focus on the clicked button (no focus stealing)', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    const btn = q('[data-key="ready"]');
    btn.focus();
    btn.click();
    await wait(80);
    expect(el.shadowRoot.activeElement).toBe(btn);
  });

  it('announces a failed change assertively and keeps the real state', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    currentAdapter.controls.failNextStateChange();
    q('[data-key="ready"]').click();
    await wait(80);
    expect(q('.status-label').textContent).toBe('NOT READY');
    expect(q('.status-request').dataset.kind).toBe('error');
    expect(q('[role="alert"]').textContent).toContain('Could not change to READY');
  });

  it('disables buttons (aria-disabled) and explains when no agent id is known', async () => {
    currentAdapter.agentId = '';
    await mount();
    expect(q('[data-key="ready"]').getAttribute('aria-disabled')).toBe('true');
    expect(q('.buttons-note').textContent).toContain('Agent identity');
  });

  it('follows external state changes', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    currentAdapter.controls.setExternalState('Idle', currentAdapter.controls.idleCodes[1].id);
    await wait();
    expect(q('.status-label').textContent).toBe('NOT READY');
    expect(q('.status-reason').textContent).toBe('Lunch');
  });

  it('shows and clears call information through the call lifecycle', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    currentAdapter.controls.incomingCall({ ani: '+46 46 123 456', queue: 'Technical Support EMEA' });
    await wait();
    expect(q('.call-number').textContent).toBe('+46 46 123 456');
    expect(q('.call-number').getAttribute('aria-label')).toBe('plus 4 6, 4 6, 1 2 3, 4 5 6');
    expect(q('.call-queue').textContent).toBe('Technical Support EMEA');
    expect(q('.badge-state').textContent).toBe('RINGING');
    currentAdapter.controls.answer();
    await wait();
    expect(q('.badge-state').textContent).toBe('CONNECTED');
    expect(q('.status-label').textContent).toBe('BUSY');
    currentAdapter.controls.endCall();
    await wait();
    expect(q('.badge-state').textContent).toBe('WRAP-UP');
    currentAdapter.controls.wrapUp();
    await wait();
    expect(q('.call-active').hidden).toBe(true);
    expect(q('.call-empty').hidden).toBe(false);
  });

  it('team list: filtered to own team, counts shown', async () => {
    await mount({}, { agentId: currentAdapter.agentId, teamId: currentAdapter.teamId });
    await wait(80);
    const names = qa('.team-name').map((n) => n.textContent);
    expect(names).not.toContain('Other Team Agent (mock)');
    expect(names[0]).toMatch(/Anna|Maria/);
    expect(q('.team-summary').textContent).toBe('2 ready · 4 logged in and listed');
  });

  it('team list can be turned off by attribute', async () => {
    await mount({ 'team-dashboard': 'false' }, { agentId: currentAdapter.agentId });
    expect(q('.panel-team').hidden).toBe(true);
    expect(currentAdapter.controls).toBeTruthy();
  });

  it('team failure does not affect status buttons', async () => {
    currentAdapter.buddyAgentsV2 = async () => {
      throw new Error('denied');
    };
    await mount({}, { agentId: currentAdapter.agentId });
    await wait(50);
    expect(q('.team-status').textContent).toContain('CONNECTION ERROR');
    q('[data-key="ready"]').click();
    await wait(80);
    expect(q('.status-label').textContent).toBe('READY');
  });

  it('marks status as not verified while the browser is offline', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    window.dispatchEvent(new Event('offline'));
    await wait();
    expect(q('.status-label').textContent).toBe('STATUS NOT VERIFIED');
    expect(q('.status-reason').textContent).toBe('Last known: NOT READY');
    expect(q('.conn-banner').textContent).toContain('CONNECTION LOST');
    window.dispatchEvent(new Event('online'));
    await wait();
    expect(q('.status-label').textContent).toBe('NOT READY');
  });

  it('switches theme and text size and stores only those preferences', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    expect(el.getAttribute('theme')).toBe('dark');
    const [themeBtn, sizeBtn] = qa('.awx-settings .small-btn');
    themeBtn.click();
    sizeBtn.click();
    expect(el.getAttribute('theme')).toBe('light');
    expect(el.getAttribute('text-size')).toBe('125');
    expect(Object.keys(localStorage)).toEqual(['accessible-wxcc-widget.prefs']);
    expect(JSON.parse(localStorage.getItem('accessible-wxcc-widget.prefs'))).toEqual({ theme: 'light', textSize: '125' });
  });

  it('cleans up all SDK listeners on unmount and can remount', async () => {
    const cleanup = vi.spyOn(currentAdapter, 'cleanup');
    await mount({}, { agentId: currentAdapter.agentId });
    el.remove();
    expect(cleanup).toHaveBeenCalledTimes(1);
    currentAdapter = createMockAdapter({ latencyMs: 5 });
    document.body.append(el);
    await wait(60);
    expect(q('.status-label').textContent).toBe('NOT READY');
  });

  it('lists finished calls under Recent calls, newest first', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    expect(q('.history-empty').textContent).toContain('No calls yet');
    currentAdapter.controls.incomingCall({ ani: '+46 46 123 456' });
    await wait();
    expect(q('.history-kind').textContent).toBe('NOW');
    expect(q('.history-back')).toBeNull(); // no call back for the call in progress
    currentAdapter.controls.answer();
    currentAdapter.controls.endCall();
    currentAdapter.controls.wrapUp();
    await wait();
    currentAdapter.controls.incomingCall({ ani: '+46 70 000 11 22' });
    await wait();
    currentAdapter.controls.endCall();
    currentAdapter.controls.wrapUp();
    await wait();
    expect(qa('.history-number').map((n) => n.textContent)).toEqual(['+46 70 000 11 22', '+46 46 123 456']);
    expect(qa('.history-kind').map((n) => n.textContent)).toEqual(['MISSED', 'IN']);
    expect(q('.history-info').getAttribute('aria-label')).toMatch(/^Missed call, plus 4 6, 7 0/);
  });

  it('keeps recent calls when Desktop switches pages (remount)', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    currentAdapter.controls.incomingCall({ ani: '+46 46 123 456' });
    currentAdapter.controls.answer();
    currentAdapter.controls.endCall();
    currentAdapter.controls.wrapUp();
    await wait();
    el.remove();
    currentAdapter = createMockAdapter({ latencyMs: 5 });
    document.body.append(el);
    await wait(60);
    expect(qa('.history-number').map((n) => n.textContent)).toEqual(['+46 46 123 456']);
  });

  async function finishedCall(ani = '+46 46 123 456') {
    currentAdapter.controls.incomingCall({ ani });
    currentAdapter.controls.answer();
    currentAdapter.controls.endCall();
    currentAdapter.controls.wrapUp();
    await wait();
  }

  it('call back asks first, then dials with the documented outdial payload', async () => {
    const dial = vi.spyOn(currentAdapter, 'startOutdial');
    await mount({}, { agentId: currentAdapter.agentId });
    await finishedCall();
    const back = q('.history-back');
    expect(back.getAttribute('aria-label')).toBe('Call back plus 4 6, 4 6, 1 2 3, 4 5 6');
    back.focus();
    back.click();
    expect(dial).not.toHaveBeenCalled();
    expect(q('.history-question').textContent).toBe('Call +46 46 123 456 now?');
    expect(el.shadowRoot.activeElement).toBe(q('.history-call-now'));
    q('.history-call-now').click();
    expect(dial).toHaveBeenCalledTimes(1);
    expect(dial.mock.calls[0][0]).toEqual({
      entryPointId: currentAdapter.getLatestData().outDialEp,
      destination: '+4646123456',
      direction: 'OUTBOUND',
      attributes: {},
      mediaType: 'telephony',
      outboundType: 'OUTDIAL',
    });
    await wait(80);
    expect(q('.call-number').textContent).toBe('+4646123456');
    expect(q('.history-kind').textContent).toBe('NOW');
  });

  it('Cancel and Escape back out without dialling and return focus', async () => {
    const dial = vi.spyOn(currentAdapter, 'startOutdial');
    await mount({}, { agentId: currentAdapter.agentId });
    await finishedCall();
    q('.history-back').click();
    q('.history-cancel').click();
    expect(q('.history-confirm')).toBeNull();
    expect(el.shadowRoot.activeElement).toBe(q('.history-back'));
    q('.history-back').click();
    q('.history-call-now').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q('.history-confirm')).toBeNull();
    expect(dial).not.toHaveBeenCalled();
  });

  it('call back is disabled during a call and hidden when outdial is not allowed', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    await finishedCall();
    currentAdapter.controls.incomingCall({ ani: '+46 70 000 11 22' });
    await wait();
    expect(qa('.history-back').every((b) => b.disabled)).toBe(true);
    expect(q('.history-status').textContent).toContain('no active call');
    el.isOutboundEnabledForAgent = false;
    expect(q('.history-back')).toBeNull();
  });

  it('announces a failed outdial assertively and allows a new try', async () => {
    await mount({}, { agentId: currentAdapter.agentId });
    await finishedCall();
    currentAdapter.controls.failNextOutdial();
    q('.history-back').click();
    q('.history-call-now').click();
    await wait(80);
    expect(q('[role="alert"]').textContent).toContain('The call could not be started');
    expect(q('.history-back').disabled).toBe(false);
  });

  it('can turn recent calls off, and a recorder instance shows nothing', async () => {
    await mount({ 'call-history': 'false' }, { agentId: currentAdapter.agentId });
    expect(q('.panel-history').hidden).toBe(true);
    el.remove();
    await mount({ mode: 'recorder' });
    expect(el.shadowRoot.childNodes.length).toBe(0);
    currentAdapter.controls.incomingCall({ ani: '+46 46 123 456' });
    await wait();
    expect(sessionHistory.list()).toHaveLength(1);
  });

  it('accepts properties assigned before the element is upgraded', async () => {
    const pre = document.createElement('div');
    pre.innerHTML = '<accessible-wxcc-widget></accessible-wxcc-widget>';
    el = pre.firstElementChild;
    expect(el.agentId).toBe('');
    el.agentId = currentAdapter.agentId;
    document.body.append(pre);
    await wait(60);
    expect(q('[data-key="ready"]').getAttribute('aria-disabled')).toBe('false');
  });
});
