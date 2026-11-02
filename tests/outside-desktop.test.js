/**
 * Real adapter module, no mocks: outside Desktop the widget must show a
 * diagnostic instead of crashing, and must never fall back to mock mode
 * (mock mode is compiled out of production and test builds).
 */
import { describe, it, expect } from 'vitest';
import { isInsideDesktop, connectDesktop } from '../src/services/desktop-sdk.js';
await import('../src/index.js');

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('outside Webex Desktop', () => {
  it('detects that Desktop is absent', () => {
    expect(isInsideDesktop()).toBe(false);
    expect(isInsideDesktop({ AGENTX_SERVICE: {} })).toBe(true);
  });

  it('connectDesktop rejects with NOT_IN_DESKTOP without importing the SDK', async () => {
    await expect(connectDesktop()).rejects.toMatchObject({ code: 'NOT_IN_DESKTOP' });
  });

  it('shows a clear diagnostic and disabled buttons, even with mock="true"', async () => {
    const el = document.createElement('accessible-wxcc-widget');
    el.setAttribute('mock', 'true');
    document.body.append(el);
    await wait();
    const sr = el.shadowRoot;
    expect(sr.querySelector('.conn-banner').textContent).toContain('only works inside Webex Contact Center Desktop');
    expect(sr.querySelector('.status-label').textContent).toBe('STATUS NOT VERIFIED');
    expect(sr.querySelector('[data-key="ready"]').getAttribute('aria-disabled')).toBe('true');
    expect(el.mockControls).toBeUndefined();
    el.remove();
  });
});
