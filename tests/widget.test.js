/**
 * UI tests in jsdom. The Desktop SDK adapter is replaced by the mock
 * adapter, so these tests never touch the Cisco SDK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockAdapter } from '../src/mock/mock-desktop.js';

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
    expect(qa('h2').map((h) => h.textContent)).toEqual(['My status', 'Change status', 'My current call', 'My team']);
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
