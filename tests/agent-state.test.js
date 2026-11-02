import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentStateService, parseChannelStateMessage } from '../src/services/agent-state.js';
import { DISPLAY } from '../src/utils/status-mapper.js';
import { fakeAdapter, channelEvent } from './helpers.js';

let adapter;
let svc;
let notices;

beforeEach(() => {
  vi.useFakeTimers();
  adapter = fakeAdapter();
  svc = new AgentStateService({ adapter });
  notices = [];
  svc.notices.subscribe((n) => notices.push(n));
  svc.setAgentId('agent-1');
  svc.start();
});

afterEach(() => {
  svc.stop();
  vi.useRealTimers();
});

describe('parseChannelStateMessage', () => {
  it('accepts the flat event payload and the wrapped stateChangeV2 response', () => {
    expect(parseChannelStateMessage(channelEvent('Available')).detail.agentState).toBe('Available');
    expect(parseChannelStateMessage({ data: channelEvent('Idle') }).detail.agentState).toBe('Idle');
    expect(parseChannelStateMessage({ foo: 1 })).toBeNull();
  });
});

describe('reading state', () => {
  it('starts in loading and shows an error if Webex never reports a state', () => {
    expect(svc.state.display).toBe(DISPLAY.LOADING);
    vi.advanceTimersByTime(7000);
    expect(svc.state.phase).toBe('error');
    expect(svc.state.display).toBe(DISPLAY.ERROR);
  });

  it('reads STORE.agent.channelsStatesMap (epoch seconds)', () => {
    svc.setChannelsStatesMap({ telephony: { agentState: 'Available', auxCodeId: '0', stateChangeTimestamp: 1757579405 } });
    expect(svc.state).toMatchObject({ phase: 'ok', display: DISPLAY.READY, since: 1757579405000 });
  });

  it('shows OFFLINE when other channels exist but not telephony', () => {
    svc.setChannelsStatesMap({ chat: { agentState: 'Available' } });
    expect(svc.state.display).toBe(DISPLAY.OFFLINE);
  });

  it('ignores an empty map (Desktop still starting)', () => {
    svc.setChannelsStatesMap({});
    expect(svc.state.display).toBe(DISPLAY.LOADING);
  });

  it('updates on external state change events and names the idle reason', () => {
    svc.setAuxCodes([{ id: 'lunch-id', name: 'Lunch' }]);
    adapter.emit('eAgentChannelStateChanged', channelEvent('Idle', 'lunch-id'));
    expect(svc.state).toMatchObject({ display: DISPLAY.NOT_READY, reasonName: 'Lunch' });
    expect(notices.at(-1)).toMatchObject({ kind: 'external', display: DISPLAY.NOT_READY });
  });

  it('ignores other channels and other agents', () => {
    adapter.emit('eAgentChannelStateChanged', channelEvent('Available', '0', Date.now(), { channelType: 'chat' }));
    adapter.emit('eAgentChannelStateChanged', channelEvent('Available', '0', Date.now(), { agentId: 'someone-else' }));
    expect(svc.state.display).toBe(DISPLAY.LOADING);
  });

  it('ignores stale updates older than the shown state', () => {
    const now = Date.now();
    adapter.emit('eAgentChannelStateChanged', channelEvent('Available', '0', now));
    svc.setChannelsStatesMap({ telephony: { agentState: 'Idle', auxCodeId: 'x', stateChangeTimestamp: Math.floor((now - 60000) / 1000) } });
    expect(svc.state.display).toBe(DISPLAY.READY);
  });

  it('learns the agent id from events when the layout did not pass it', () => {
    const s2 = new AgentStateService({ adapter });
    s2.start();
    adapter.emit('eAgentChannelStateChanged', channelEvent('Available'));
    expect(s2.agentId).toBe('agent-1');
    s2.stop();
  });
});

describe('changing state', () => {
  beforeEach(() => {
    svc.setChannelsStatesMap({ telephony: { agentState: 'Idle', auxCodeId: 'nr', stateChangeTimestamp: 1 } });
  });

  it('sends the documented stateChangeV2 payload for READY', async () => {
    adapter.stateChangeV2.mockResolvedValue({ data: channelEvent('Available') });
    await svc.requestChange({ state: 'Available', auxCodeId: '0', label: 'READY', reason: 'Available' });
    expect(adapter.stateChangeV2).toHaveBeenCalledWith({
      channelType: ['telephony'],
      state: 'Available',
      auxCodeId: '0',
      reason: 'Available',
      agentId: 'agent-1',
    });
  });

  it('sends Idle with the real aux code id', async () => {
    adapter.stateChangeV2.mockResolvedValue({ data: channelEvent('Idle', 'lunch-id') });
    await svc.requestChange({ state: 'Idle', auxCodeId: 'lunch-id', label: 'LUNCH', reason: 'Lunch' });
    expect(adapter.stateChangeV2.mock.calls[0][0]).toMatchObject({ state: 'Idle', auxCodeId: 'lunch-id', reason: 'Lunch' });
  });

  it('does not show the requested state before Webex confirms it', async () => {
    let resolve;
    adapter.stateChangeV2.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = svc.requestChange({ state: 'Available', auxCodeId: '0', label: 'READY' });
    expect(svc.state.display).toBe(DISPLAY.NOT_READY);
    expect(svc.state.pending).toMatchObject({ label: 'READY' });
    // Confirmation arrives as an event before the promise resolves.
    adapter.emit('eAgentChannelStateChanged', channelEvent('Available', '0', Date.now()));
    expect(svc.state.display).toBe(DISPLAY.READY);
    expect(svc.state.pending).toBeNull();
    expect(notices.at(-1).kind).toBe('confirmed');
    resolve({});
    await p;
  });

  it('reports failure when the SDK rejects, and keeps the real state', async () => {
    adapter.stateChangeV2.mockRejectedValue(new Error('Agent not allowed'));
    const r = await svc.requestChange({ state: 'Available', auxCodeId: '0', label: 'READY' });
    expect(r.ok).toBe(false);
    expect(svc.state).toMatchObject({ display: DISPLAY.NOT_READY, pending: null, lastError: 'Agent not allowed' });
    expect(notices.at(-1)).toMatchObject({ kind: 'failed', label: 'READY' });
  });

  it('treats an undefined response (service unavailable) as a failure', async () => {
    adapter.stateChangeV2.mockResolvedValue(undefined);
    const r = await svc.requestChange({ state: 'Available', auxCodeId: '0', label: 'READY' });
    expect(r).toMatchObject({ ok: false, reason: 'NO_SERVICE' });
  });

  it('warns when Webex resolves but never confirms', async () => {
    adapter.stateChangeV2.mockResolvedValue({ type: 'Something' });
    await svc.requestChange({ state: 'Available', auxCodeId: '0', label: 'READY' });
    expect(svc.state.pending).not.toBeNull();
    vi.advanceTimersByTime(9000);
    expect(svc.state.pending).toBeNull();
    expect(svc.state.unconfirmed).toBe('READY');
    expect(svc.state.display).toBe(DISPLAY.NOT_READY);
    expect(notices.at(-1).kind).toBe('unconfirmed');
  });

  it('refuses to send without an agent id', async () => {
    const s2 = new AgentStateService({ adapter });
    const r = await s2.requestChange({ state: 'Available', auxCodeId: '0', label: 'READY' });
    expect(r.reason).toBe('NO_AGENT_ID');
    expect(adapter.stateChangeV2).not.toHaveBeenCalled();
  });

  it('ignores a second click while a request is pending', async () => {
    adapter.stateChangeV2.mockReturnValue(new Promise(() => {}));
    svc.requestChange({ state: 'Available', auxCodeId: '0', label: 'READY' });
    const r = await svc.requestChange({ state: 'Idle', auxCodeId: 'x', label: 'BREAK' });
    expect(r.reason).toBe('BUSY');
    expect(adapter.stateChangeV2).toHaveBeenCalledTimes(1);
  });
});

describe('cleanup', () => {
  it('removes its event listener on stop', () => {
    expect(adapter.listenerCount('eAgentChannelStateChanged')).toBe(1);
    svc.stop();
    expect(adapter.listenerCount('eAgentChannelStateChanged')).toBe(0);
  });
});
