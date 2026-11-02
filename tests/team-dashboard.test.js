import { describe, it, expect, vi } from 'vitest';
import { TeamService, mapBuddyAgents, reasonOf } from '../src/services/team-dashboard.js';
import { DISPLAY } from '../src/utils/status-mapper.js';
import { fakeAdapter, flush } from './helpers.js';

const PROFILE = '11111111-2222-4333-8444-555555555555';

describe('mapBuddyAgents', () => {
  const lists = [
    { state: 'Available', agents: [{ agentId: 'a', agentName: 'Anna', teamId: 'T1' }, { agentId: 'x', agentName: 'Other', teamId: 'T2' }] },
    { state: 'Idle', agents: [{ agentId: 'b', firstName: 'Erik', lastName: 'A', teamId: 'T1' }, { agentId: 'me', agentName: 'Me', teamId: 'T1' }] },
  ];

  it('filters to the current team, excludes self, sorts READY first', () => {
    const r = mapBuddyAgents(lists, { teamId: 'T1', selfId: 'me' });
    expect(r.teamFilterApplied).toBe(true);
    expect(r.rows.map((x) => [x.name, x.display])).toEqual([
      ['Anna', DISPLAY.READY],
      ['Erik A', DISPLAY.NOT_READY],
    ]);
    expect(r.readyCount).toBe(1);
  });

  it('does not filter when entries carry no teamId, and says so', () => {
    const r = mapBuddyAgents([{ state: 'Available', agents: [{ agentId: 'a', agentName: 'Anna' }] }], { teamId: 'T1' });
    expect(r.teamFilterApplied).toBe(false);
    expect(r.rows).toHaveLength(1);
  });
});

describe('TeamService', () => {
  it('queries buddyAgentsV2 for Available and Idle with the agent profile id', async () => {
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    const svc = new TeamService({ adapter });
    await svc.refresh();
    expect(adapter.buddyAgentsV2).toHaveBeenCalledTimes(2);
    expect(adapter.buddyAgentsV2.mock.calls.map((c) => c[0].state)).toEqual(['Available', 'Idle']);
    expect(adapter.buddyAgentsV2.mock.calls[0][0]).toMatchObject({ agentProfileId: PROFILE, mediaType: 'telephony' });
    expect(svc.state.phase).toBe('ok');
  });

  it('is unavailable (no request) without a valid profile id', async () => {
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: 'AXCLfZhH9S1oTdqE1OFw' }) });
    const svc = new TeamService({ adapter });
    await svc.refresh();
    expect(adapter.buddyAgentsV2).not.toHaveBeenCalled();
    expect(svc.state.phase).toBe('unavailable');
  });

  it('keeps the last good list on error and never marks people OFFLINE', async () => {
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    adapter.buddyAgentsV2.mockResolvedValueOnce({ data: { agentList: [{ agentId: 'a', agentName: 'Anna' }] } }).mockResolvedValueOnce({ data: { agentList: [] } });
    const svc = new TeamService({ adapter });
    await svc.refresh();
    adapter.buddyAgentsV2.mockRejectedValue(new Error('network'));
    await svc.refresh();
    expect(svc.state.phase).toBe('error');
    expect(svc.state.rows).toEqual([expect.objectContaining({ name: 'Anna', display: DISPLAY.READY })]);
    expect(svc.state.rows.some((r) => r.display === DISPLAY.OFFLINE)).toBe(false);
  });

  it('treats a failure response type as an error', async () => {
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    adapter.buddyAgentsV2.mockResolvedValue({ data: { type: 'BuddyAgentsRetrieveFailed' } });
    const svc = new TeamService({ adapter });
    await svc.refresh();
    expect(svc.state).toMatchObject({ phase: 'error', error: 'BuddyAgentsRetrieveFailed' });
  });

  it('enforces a minimum refresh interval and rate-limits manual refresh', async () => {
    let t = 0;
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    const svc = new TeamService({ adapter, refreshSeconds: 5, now: () => t });
    expect(svc.refreshMs).toBe(15000);
    expect(new TeamService({ adapter }).refreshMs).toBe(30000); // default
    t = 20000;
    await svc.manualRefresh();
    t = 21000;
    await svc.manualRefresh();
    expect(adapter.buddyAgentsV2).toHaveBeenCalledTimes(2); // one refresh = 2 calls
  });

  it('reports stale data', async () => {
    let t = 1000;
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    const svc = new TeamService({ adapter, now: () => t });
    await svc.refresh();
    expect(svc.isStale()).toBe(false);
    t += 10 * 60 * 1000;
    expect(svc.isStale()).toBe(true);
  });

  it('refreshes at once when the agent returns to the tab with an old list', async () => {
    let t = 1000;
    let visibility = 'visible';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    const svc = new TeamService({ adapter, now: () => t });
    svc.start();
    await flush();
    expect(adapter.buddyAgentsV2).toHaveBeenCalledTimes(2);

    t += 5000; // recent list: no extra request
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(adapter.buddyAgentsV2).toHaveBeenCalledTimes(2);

    visibility = 'hidden';
    t += 60000;
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(adapter.buddyAgentsV2).toHaveBeenCalledTimes(4);

    svc.stop();
    t += 60000;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(adapter.buddyAgentsV2).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });

  it('names a Not Ready reason only when Webex sends one we can resolve', () => {
    const names = new Map([['c-lunch', 'Lunch']]);
    expect(reasonOf({ idleCodeName: 'Meeting' }, names)).toBe('Meeting');
    expect(reasonOf({ auxCodeId: 'c-lunch' }, names)).toBe('Lunch');
    expect(reasonOf({ idleCode: { id: 'c-lunch' } }, names)).toBe('Lunch');
    expect(reasonOf({ auxCodeId: 'unknown' }, names)).toBe('');
    expect(reasonOf({ state: 'Idle' }, names)).toBe(''); // Cisco's documented fields carry no reason
    const { rows } = mapBuddyAgents(
      [
        { state: 'Available', agents: [{ agentId: 'a', agentName: 'A', state: 'Available', auxCodeId: 'c-lunch' }] },
        { state: 'Idle', agents: [{ agentId: 'b', agentName: 'B', state: 'Idle', auxCodeId: 'c-lunch' }] },
      ],
      { codeNames: names },
    );
    expect(rows.map((r) => [r.id, r.reason])).toEqual([['a', ''], ['b', 'Lunch']]);
  });

  it('adds reasons to the current list when idle codes arrive later', async () => {
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    adapter.buddyAgentsV2.mockImplementation(async ({ state }) => ({
      data: { agentList: state === 'Idle' ? [{ agentId: 'b', agentName: 'B', state: 'Idle', auxCodeId: 'c-lunch' }] : [] },
    }));
    const svc = new TeamService({ adapter });
    await svc.refresh();
    expect(svc.state.rows[0].reason).toBe('');
    svc.setIdleCodes([{ id: 'c-lunch', name: 'Lunch' }]);
    expect(svc.state.rows[0].reason).toBe('Lunch');
    expect(adapter.buddyAgentsV2).toHaveBeenCalledTimes(2); // no extra request
  });

  it('stops its timer', () => {
    vi.useFakeTimers();
    const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE }) });
    const svc = new TeamService({ adapter });
    svc.start();
    svc.stop();
    adapter.buddyAgentsV2.mockClear();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(adapter.buddyAgentsV2).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
