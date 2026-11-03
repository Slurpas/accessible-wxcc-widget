import { describe, it, expect, vi } from 'vitest';
import { runTeamProbe, describeShape, scrub, isIdLike, datasetCatalog } from '../src/diagnostics/team-probe.js';
import { fakeAdapter } from './helpers.js';

const PROFILE = '11111111-2222-4333-8444-555555555555';
const SECRET_BITS = ['Anna Svensson', 'anna@example.com', '+46461234567', '9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', 'eyJhbGciOi'];

function agents() {
  return [
    { agentId: '9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', agentName: 'Anna Svensson', teamId: 'team-1', state: 'Available', dn: '+46461234567' },
    { agentId: 'a1', agentName: 'Erik', teamId: 'team-2', state: 'Available', auxCodeId: 'c-1' },
  ];
}

function fakeRtdwc() {
  const listeners = {};
  const closes = vi.fn();
  return {
    closes,
    listeners,
    rtdwc: {
      getConnectionState: async () => 'CONNECTED',
      subscribe: vi.fn(async ({ datasetName, update, error }) => {
        listeners[datasetName] = { update, error };
        if (datasetName === 'agentState') {
          setTimeout(() =>
            update({
              data: {
                '9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b': { agentName: 'Anna Svensson', email: 'anna@example.com', state: 'Engaged', token: 'eyJhbGciOi' },
                'b2c3d4e5-0000-4000-8000-000000000000': { agentName: 'Erik', state: 'Available' },
              },
              list: [{ status: 'WrapUp' }],
            }),
          );
        }
        if (datasetName === 'teamStats') setTimeout(() => error(new Error('Not authorised for anna@example.com 9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b')));
        if (datasetName === 'queueStats') throw new Error('Unknown dataset');
        return { unsubscribe: closes };
      }),
    },
  };
}

function setup() {
  const rt = fakeRtdwc();
  const adapter = fakeAdapter({ getLatestData: () => ({ agentProfileID: PROFILE, teamId: 'team-1' }) });
  adapter.buddyAgentsV2.mockImplementation(async ({ state }) => ({ data: { agentList: state === 'Available' ? agents() : [] } }));
  const win = { wxcc: { rtdwc: rt.rtdwc } };
  return { rt, adapter, win, connect: async () => adapter };
}

describe('team probe', () => {
  it('reports buddy counts, accepted datasets and data shapes', async () => {
    const { adapter, win, connect } = setup();
    const r = await runTeamProbe({ win, connect, waitMs: 20, print: false, datasets: ['extraDataset', 'bad name!'] });
    expect(r.sdk).toBe('ok');
    expect(r.buddyAgentsV2.states.Available).toMatchObject({ count: 2, withTeamId: 2, inOwnTeam: 1 });
    expect(r.buddyAgentsV2.states.Idle.count).toBe(0);
    expect(r.buddyAgentsV2.states.Available.reasonFieldsFound).toEqual(['auxCodeId']);
    const rt = r.realTimeData;
    expect(rt.rtdwcPresent).toBe(true);
    expect(rt.connectionState).toBe('string "CONNECTED"');
    expect(rt.datasetsWithData).toEqual(['agentState']);
    const agentState = rt.results.find((x) => x.dataset === 'agentState');
    expect(agentState.firstUpdate.keys.data).toMatchObject({ type: 'map', size: 2 });
    expect(agentState.firstUpdate.keys.data.item.keys.state).toBe('string "Engaged"');
    expect(agentState.firstUpdate.keys.list.item.keys.status).toBe('string "WrapUp"');
    expect(rt.results.find((x) => x.dataset === 'queueStats')).toMatchObject({ accepted: false, firstError: 'Unknown dataset' });
    expect(rt.results.some((x) => x.dataset === 'extraDataset')).toBe(true);
    expect(rt.results.some((x) => x.dataset === 'bad name!')).toBe(false);
    expect(adapter.cleanup).toHaveBeenCalled();
  });

  it('never copies names, e-mail, numbers, IDs or tokens into the report', async () => {
    const { win, connect } = setup();
    const json = JSON.stringify(await runTeamProbe({ win, connect, waitMs: 20, print: false }));
    for (const bit of SECRET_BITS) expect(json).not.toContain(bit);
    expect(json).not.toContain('Erik');
  });

  it('closes every subscription it opened', async () => {
    const { rt, win, connect } = setup();
    const r = await runTeamProbe({ win, connect, waitMs: 20, print: false });
    const accepted = r.realTimeData.results.filter((x) => x.accepted);
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.every((x) => x.closed)).toBe(true);
    expect(rt.closes).toHaveBeenCalledTimes(accepted.length);
  });

  it('only reads: no state change or other write is attempted', async () => {
    const { adapter, win, connect } = setup();
    await runTeamProbe({ win, connect, waitMs: 20, print: false });
    expect(adapter.stateChangeV2).not.toHaveBeenCalled();
  });

  it('works when real-time data or the SDK is missing', async () => {
    const r = await runTeamProbe({ win: {}, connect: async () => Promise.reject(new Error('NOT_IN_DESKTOP')), waitMs: 1, print: false });
    expect(r.sdk).toBe('NOT_IN_DESKTOP');
    expect(r.realTimeData).toEqual({ wxccPresent: false, rtdwcPresent: false });
  });

  it("tries Desktop's own dataset names when it can find them", async () => {
    const { rt, win, connect } = setup();
    rt.rtdwc.DATASET = { AGENT: 'agentState', NESTED: { TEAM: 'teamAgentStates' }, ORG: '9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b' };
    rt.rtdwc.dataSetFactory = { dataSets: new Map([['liveAgents', {}]]), create() {} };
    const r = await runTeamProbe({ win, connect, waitMs: 20, print: false });
    expect(r.realTimeData.catalog.constants).toEqual({ AGENT: 'agentState', 'NESTED.TEAM': 'teamAgentStates' });
    expect(r.realTimeData.catalog.names).toEqual(['agentState', 'teamAgentStates', 'liveAgents']);
    expect(r.realTimeData.results.map((x) => x.dataset)).toEqual(['agentState', 'teamAgentStates', 'liveAgents']);
    expect(JSON.stringify(r)).not.toContain('9f0c1a2b');
  });

  it("includes the server's reason for a rejected subscription, scrubbed", async () => {
    const { rt, win, connect } = setup();
    rt.rtdwc.subscribe = vi.fn(async ({ error }) => {
      const err = new Error('Request failed with status code 400');
      err.response = { data: { message: 'filter.agentId missing for 9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b' } };
      error(err);
      return () => {};
    });
    const r = await runTeamProbe({ win, connect, waitMs: 20, print: false, datasets: ['x1'] });
    expect(r.realTimeData.results[0].firstError).toBe('Request failed with status code 400: filter.agentId missing for <id>');
  });

  it('tries the valid datasets Webex lists when a name is rejected', async () => {
    const { win, connect } = setup();
    win.wxcc.rtdwc.DATASET = { TEAMSTATS: 'wxcc.rtd.teamstats' };
    win.wxcc.rtdwc.subscribe = vi.fn(async ({ datasetName, update, error }) => {
      if (datasetName === 'wxcc.rtd.teamstats') {
        const err = new Error('Request failed with status code 400');
        err.response = { data: { message: 'Invalid datasets: wxcc.rtd.teamstats\nValid datasets are: [wxcc.rtd.teamchannelstats, wxcc.rtd.agentchannelstats]' } };
        error(err);
        throw err;
      }
      if (datasetName === 'wxcc.rtd.agentchannelstats') {
        setTimeout(() =>
          update({ datasetValues: [{ key: '9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', data: { agentName: 'Anna Svensson', currentState: 'Idle', idleCodeName: 'Lunch', teamName: 'Team Anna Svensson' } }] }),
        );
      }
      return () => {};
    });
    const r = await runTeamProbe({ win, connect, waitMs: 20, print: false });
    const rt = r.realTimeData;
    expect(rt.validDatasets).toEqual(['wxcc.rtd.agentchannelstats', 'wxcc.rtd.teamchannelstats']);
    expect(rt.results.map((x) => x.dataset)).toEqual(['wxcc.rtd.teamstats', 'wxcc.rtd.teamchannelstats', 'wxcc.rtd.agentchannelstats']);
    expect(rt.results[0].firstError).toBe('Invalid dataset (see validDatasets)');
    expect(rt.datasetsWithData).toEqual(['wxcc.rtd.agentchannelstats']);
    const agent = rt.results.find((x) => x.dataset === 'wxcc.rtd.agentchannelstats');
    const data = agent.firstUpdate.keys.datasetValues.item.keys.data.keys;
    expect(data).toEqual({ agentName: 'string', currentState: 'string "Idle"', idleCodeName: 'string "Lunch"', teamName: 'string' });
    expect(JSON.stringify(r)).not.toMatch(/Anna|9f0c1a2b/);
  });

  it("reports whether Desktop's post-interaction history can be read, without numbers", async () => {
    const { adapter, win, connect } = setup();
    adapter.fetchPostInteractionTasks = vi.fn(async () => ({ data: { tasks: [{ ani: '+46461234567', direction: 'INBOUND', agentName: 'Anna Svensson' }] } }));
    const r = await runTeamProbe({ win, connect, waitMs: 20, print: false });
    expect(r.callHistory).toMatchObject({ available: true, ok: true, count: 1 });
    const args = adapter.fetchPostInteractionTasks.mock.calls[0][0];
    expect(args.pageNumber).toBe(0);
    expect(args.endTime - args.startTime).toBe(24 * 3600 * 1000);
    expect(JSON.stringify(r)).not.toMatch(/46461234567|Anna/);
  });

  it('reports a history error or a missing API', async () => {
    const { adapter, win, connect } = setup();
    expect((await runTeamProbe({ win, connect, waitMs: 20, print: false })).callHistory).toEqual({ available: false });
    adapter.fetchPostInteractionTasks = vi.fn(async () => {
      throw new Error('Forbidden for anna@example.com');
    });
    const r = await runTeamProbe({ win, connect, waitMs: 20, print: false });
    expect(r.callHistory).toEqual({ available: true, ok: false, error: 'Forbidden for <email>' });
  });

  it('reports where the outdial entry point is, without its value', async () => {
    const { adapter, win, connect } = setup();
    win.AGENTX_SERVICE = { conf: { profile: { outDialEp: '9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', isOutboundEnabledForAgent: true, outdialANIId: 'ani-1', agentName: 'Anna Svensson' } } };
    adapter.getOutdialSettings = () => ({ outDialEp: win.AGENTX_SERVICE.conf.profile.outDialEp });
    const r = await runTeamProbe({ win, connect, waitMs: 20, print: false });
    expect(r.outdial).toMatchObject({
      entryPointFound: true,
      entryPointType: 'string',
      profilePresent: true,
      profileKeys: { outDialEp: 'string (UUID)', isOutboundEnabledForAgent: 'boolean true', outdialANIId: 'string' },
    });
    expect(JSON.stringify(r)).not.toMatch(/9f0c1a2b|Anna|ani-1/);
  });

  it('reads no catalogue from objects without one', () => {
    expect(datasetCatalog({})).toEqual({ constants: {}, factoryApi: [], names: [] });
  });

  it('scrubs and classifies safely', () => {
    expect(scrub('agent 9f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b anna@example.com +46 46 123 456')).toBe('agent <id> <email> <number>');
    expect(isIdLike('Anna Svensson')).toBe(true);
    expect(isIdLike('agentName')).toBe(false);
    expect(describeShape({ agentName: 'Anna', state: 'Idle' })).toEqual({ type: 'object', keys: { agentName: 'string', state: 'string "Idle"' } });
  });
});
