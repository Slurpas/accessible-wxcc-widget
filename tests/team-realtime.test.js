import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyUpdate, mapRealtimeAgents, DATASET_STATES, DATASET_CONTACTS } from '../src/services/team-realtime.js';
import { TeamService, LIVE_FIRST_DATA_MS } from '../src/services/team-dashboard.js';
import { DISPLAY } from '../src/utils/status-mapper.js';
import { fakeAdapter, flush } from './helpers.js';

const PROFILE = '11111111-2222-4333-8444-555555555555';
const agent = (agentId, state, extra = {}) => ({ key: `${agentId}:t`, operation: 'UPDATE', data: { agentId, agentName: agentId.toUpperCase(), channelType: 'telephony', state, teamId: 'T1', ...extra } });
const msg = (...datasetValues) => ({ datasetName: DATASET_STATES, datasetValues, type: 'SubscriptionResponse' });

describe('real-time team mapping', () => {
  it('shows every logged-in colleague of the own team with the exact state and reason', () => {
    const states = new Map();
    applyUpdate(states, msg(agent('a', 'Available'), agent('b', 'Idle', { idleCodeName: 'Lunch' }), agent('c', 'Idle', { idleCodeId: 'c-9' }), agent('x', 'Available', { teamId: 'T2' }), agent('me', 'Idle')));
    const r = mapRealtimeAgents(states, new Map(), { teamId: 'T1', selfId: 'me', codeNames: new Map([['c-9', 'Meeting']]) });
    expect(r.rows.map((x) => [x.name, x.display, x.reason])).toEqual([
      ['A', DISPLAY.READY, ''],
      ['B', DISPLAY.NOT_READY, 'Lunch'],
      ['C', DISPLAY.NOT_READY, 'Meeting'],
    ]);
    expect(r.readyCount).toBe(1);
  });

  it('removes agents on delete or log-out and ignores other channels', () => {
    const states = new Map();
    applyUpdate(states, msg(agent('a', 'Available'), agent('b', 'Idle'), agent('chat', 'Available', { channelType: 'chat' })));
    applyUpdate(states, msg({ ...agent('a', 'Available'), operation: 'DELETE' }, agent('b', 'LoggedOut')));
    expect([...states.keys()]).toEqual([]);
  });

  it('uses the current contact for BUSY / WRAP-UP and keeps unknown states visible', () => {
    const states = new Map();
    const contacts = new Map();
    applyUpdate(states, msg(agent('a', 'Available'), agent('b', 'Available'), agent('c', 'Reserved')));
    applyUpdate(contacts, { datasetName: DATASET_CONTACTS, datasetValues: [
      { key: 'a1', data: { agentId: 'a', interactionId: 'i1', contactStatus: 'connected', channelType: 'telephony' } },
      { key: 'b1', data: { agentId: 'b', interactionId: 'i2', contactStatus: 'wrapup', channelType: 'telephony' } },
    ] });
    const rows = mapRealtimeAgents(states, contacts, { teamId: 'T1' }).rows;
    expect(rows.map((x) => [x.id, x.display, x.reason])).toEqual([
      ['a', DISPLAY.BUSY, ''],
      ['b', DISPLAY.WRAP_UP, ''],
      ['c', DISPLAY.UNKNOWN, 'Reserved'],
    ]);
  });

  it('ignores malformed updates', () => {
    const states = new Map();
    expect(applyUpdate(states, null)).toBe(false);
    expect(applyUpdate(states, { datasetValues: [null, { data: null }, { data: { state: 'Idle' } }] })).toBe(false);
  });
});

describe('TeamService with real-time data', () => {
  afterEach(() => vi.useRealTimers());

  function liveAdapter() {
    const subs = {};
    const closed = vi.fn();
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    adapter.subscribeRealtime = vi.fn(async ({ datasetName, update, error }) => {
      subs[datasetName] = { update, error };
      return { unsubscribe: closed };
    });
    return { adapter, subs, closed };
  }

  it('uses the live feed and does not poll the buddy list', async () => {
    const { adapter, subs } = liveAdapter();
    const svc = new TeamService({ adapter });
    svc.setContext({ teamId: 'T1', selfId: 'me' });
    svc.start();
    await flush();
    subs[DATASET_STATES].update(msg(agent('a', 'Idle', { idleCodeName: 'Training' })));
    expect(svc.state).toMatchObject({ phase: 'ok', live: true });
    expect(svc.state.rows[0]).toMatchObject({ name: 'A', reason: 'Training' });
    expect(adapter.buddyAgentsV2).not.toHaveBeenCalled();
    expect(svc.isStale()).toBe(false);
    svc.stop();
  });

  it('falls back to the buddy list when the feed errors', async () => {
    const { adapter, subs, closed } = liveAdapter();
    const svc = new TeamService({ adapter });
    svc.start();
    await flush();
    subs[DATASET_STATES].error(new Error('Not authorised'));
    await flush();
    expect(svc.mode).toBe('poll');
    expect(adapter.buddyAgentsV2).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
    svc.stop();
  });

  it('falls back when no real-time data arrives in time', async () => {
    vi.useFakeTimers();
    const { adapter } = liveAdapter();
    const svc = new TeamService({ adapter });
    svc.start();
    await vi.advanceTimersByTimeAsync(LIVE_FIRST_DATA_MS + 10);
    expect(svc.mode).toBe('poll');
    expect(adapter.buddyAgentsV2).toHaveBeenCalled();
    svc.stop();
  });

  it('falls back when subscribing is refused, and closes everything on stop', async () => {
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    adapter.subscribeRealtime = vi.fn(() => {
      throw new Error('Real-time data not available');
    });
    const svc = new TeamService({ adapter });
    svc.start();
    await flush();
    expect(svc.mode).toBe('poll');
    svc.stop();

    const live = liveAdapter();
    const svc2 = new TeamService({ adapter: live.adapter });
    svc2.start();
    await flush();
    svc2.stop();
    expect(live.closed).toHaveBeenCalledTimes(2);
  });
});
