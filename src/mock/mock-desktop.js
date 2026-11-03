/**
 * MOCK Desktop adapter for development and demos.
 *
 * Safety:
 *  - It never imports or calls the Cisco SDK, so it cannot change a real agent state.
 *  - The widget only uses it when it is NOT running inside Desktop AND mock
 *    mode was requested explicitly AND the build allows mock mode
 *    (production builds compile this file out entirely).
 *  - All names and numbers below are fictitious and labelled as demo data.
 */

const AGENT_ID = '00000000-0000-4000-8000-000000000001';
const PROFILE_ID = '00000000-0000-4000-8000-0000000000aa';
const TEAM_ID = 'mock-team-1';

const IDLE_CODES = [
  { id: '00000000-0000-4000-8000-0000000000c1', name: 'Not Ready', isSystem: false, isDefault: true },
  { id: '00000000-0000-4000-8000-0000000000c2', name: 'Lunch', isSystem: false, isDefault: false },
  { id: '00000000-0000-4000-8000-0000000000c3', name: 'Break', isSystem: false, isDefault: false },
  { id: '00000000-0000-4000-8000-0000000000c4', name: 'Admin', isSystem: false, isDefault: false },
  { id: '00000000-0000-4000-8000-0000000000c5', name: 'RONA', isSystem: true, isDefault: false },
];

// Large tenant with long names, for layout testing (dev harness: ?codes=many).
const MANY_IDLE_CODES = [
  ...IDLE_CODES,
  ...[
    'Meeting',
    'Training',
    'Coaching with team leader',
    'Administrative work - back office',
    'Email and case follow-up',
    'Technical problem',
    'Personal time',
    'Outbound campaign preparation',
    'Fika',
    'System downtime - waiting for IT support',
    'Quality review',
    'Project work',
    'End of shift',
  ].map((name, i) => ({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, name, isSystem: false, isDefault: false })),
];

const TEAM = [
  { agentId: 'm-2', agentName: 'Demo Anna (mock)', teamId: TEAM_ID, state: 'Available' },
  { agentId: 'm-3', agentName: 'Demo Erik (mock)', teamId: TEAM_ID, state: 'Idle', auxCodeId: '00000000-0000-4000-8000-0000000000c2' },
  { agentId: 'm-4', agentName: 'Demo Maria (mock)', teamId: TEAM_ID, state: 'Available' },
  { agentId: 'm-5', agentName: 'Demo Johan (mock)', teamId: TEAM_ID, state: 'Idle' },
  { agentId: 'm-9', agentName: 'Other Team Agent (mock)', teamId: 'mock-team-2', state: 'Available' },
];

const MOCK_OUTDIAL_EP = '00000000-0000-4000-8000-0000000000e1';

export function createMockAdapter({ latencyMs = 400, manyCodes = false } = {}) {
  const idleCodes = manyCodes ? MANY_IDLE_CODES : IDLE_CODES;
  const listeners = new Map(); // eventName -> Set
  const tasks = new Map();
  let failNext = false;
  let failNextDial = false;
  let offline = false;
  let callSeq = 0;
  let channel = {
    agentState: 'Idle',
    auxCodeId: idleCodes[0].id,
    stateChangeTimestamp: Date.now(),
    stateChangeReason: 'Not Ready',
    pendingIdle: false,
  };

  const wait = (ms = latencyMs) => new Promise((r) => setTimeout(r, ms));

  function emit(name, payload) {
    for (const fn of [...(listeners.get(name) || [])]) fn(payload);
  }

  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name) && listeners.get(name).delete(fn);
  }

  function setChannel(agentState, auxCodeId, reason) {
    channel = { ...channel, agentState, auxCodeId, stateChangeReason: reason, stateChangeTimestamp: Date.now() };
    emit('eAgentChannelStateChanged', {
      agentId: AGENT_ID,
      channelType: 'telephony',
      agentChannelStateDetail: { ...channel },
      type: 'AgentChannelStateChanged',
    });
  }

  function interaction(id, state, extra = {}) {
    const t = tasks.get(id);
    return {
      interactionId: id,
      mediaType: 'telephony',
      state,
      contactDirection: { type: t.outbound ? 'OUTBOUND' : 'INBOUND' },
      outboundType: t.outbound ? 'OUTDIAL' : null,
      callProcessingDetails: {
        ani: t.ani,
        dnis: t.dnis,
        virtualTeamName: t.queue,
      },
      media: { [id]: { mediaResourceId: id, mediaType: 'telephony', mType: 'mainCall', isHold: !!t.hold } },
      participants: { [AGENT_ID]: { pType: 'Agent', isWrapUp: !!t.wrap } },
      ...extra,
    };
  }

  function contactEvent(name, id, state) {
    const t = tasks.get(id);
    if (t) t.state = state;
    emit(name, { data: { interactionId: id, interaction: interaction(id, state) } });
  }

  const adapter = {
    mode: 'mock',
    agentId: AGENT_ID,
    teamId: TEAM_ID,

    getLatestData() {
      return {
        agentName: 'Demo Agent (mock)',
        agentProfileID: PROFILE_ID,
        teamId: TEAM_ID,
        teamName: 'Demo Team',
        idleCodes: idleCodes,
        channelsStatesMap: { telephony: { ...channel, stateChangeTimestamp: Math.floor(channel.stateChangeTimestamp / 1000) } },
        isOutboundEnabledForAgent: true,
        isOutboundEnabledForTenant: true,
        outDialEp: MOCK_OUTDIAL_EP,
      };
    },

    async stateChangeV2(payload) {
      await wait();
      if (offline) throw new Error('Mock: network unavailable');
      if (failNext) {
        failNext = false;
        throw new Error('Mock: state change rejected');
      }
      const [type] = payload.channelType;
      setChannel(payload.state, payload.auxCodeId, payload.reason);
      return {
        data: { agentId: AGENT_ID, channelType: type, agentChannelStateDetail: { ...channel }, type: 'AgentChannelStateChanged' },
        type: 'AgentDesktopMessage',
      };
    },

    async fetchPaginatedAuxCodes({ workType, page = 0, pageSize = 100 }) {
      await wait();
      if (workType !== 'IDLE_CODE') return { meta: { page, totalPages: 1 }, data: [] };
      const start = page * pageSize;
      return {
        meta: { page, pageSize, totalPages: Math.ceil(idleCodes.length / pageSize), totalRecords: idleCodes.length },
        data: idleCodes.slice(start, start + pageSize),
      };
    },

    async buddyAgentsV2(data) {
      await wait();
      if (offline) throw new Error('Mock: network unavailable');
      return {
        data: { agentList: TEAM.filter((a) => a.state === data.state).map((a) => ({ ...a })), type: 'BuddyAgents' },
      };
    },

    async getTaskMap() {
      const m = new Map();
      for (const [id, t] of tasks) m.set(id, { interactionId: id, interaction: interaction(id, t.state) });
      return m;
    },

    /** Mock outdial: never reaches Webex, just starts a fake outbound call. */
    async startOutdial({ destination, entryPointId }) {
      await wait();
      if (offline) throw new Error('Mock: network unavailable');
      if (failNextDial) {
        failNextDial = false;
        emit('eOutdialFailed', { data: { reason: 'Mock: number not reachable' } });
        throw new Error('Mock: outdial failed');
      }
      if (entryPointId !== MOCK_OUTDIAL_EP) throw new Error('Mock: unknown entry point');
      const id = adapter.controls.outboundCall({ dnis: destination });
      return { data: { interactionId: id } };
    },

    async fetchPostInteractionTasks() {
      await wait();
      throw new Error('Mock: no post-interaction data');
    },

    onAgentStateEvent: on,
    onContactEvent: on,
    onDialerEvent: on,

    cleanup() {
      listeners.clear();
    },

    /** Controls for the dev harness and tests. Not part of the real adapter. */
    controls: {
      incomingCall({ ani = '+46 46 123 456', dnis = '+46 46 999 000', queue = 'Technical Support EMEA (demo)' } = {}) {
        const id = `mock-call-${++callSeq}`;
        tasks.set(id, { ani, dnis, queue, outbound: false, state: 'new' });
        contactEvent('eAgentOfferContact', id, 'new');
        return id;
      },
      outboundCall({ dnis = '+46 40 555 123', ani = '+46 46 999 000', queue = 'Outdial (demo)' } = {}) {
        const id = `mock-call-${++callSeq}`;
        tasks.set(id, { ani, dnis, queue, outbound: true, state: 'connected' });
        contactEvent('eAgentContactAssigned', id, 'connected');
        setChannel('Engaged', '0', 'Engaged');
        return id;
      },
      answer(id = lastId()) {
        if (!tasks.has(id)) return;
        contactEvent('eAgentContactAssigned', id, 'connected');
        setChannel('Engaged', '0', 'Engaged');
      },
      hold(id = lastId()) {
        if (!tasks.has(id)) return;
        tasks.get(id).hold = true;
        contactEvent('eAgentContactHeld', id, 'connected');
      },
      unhold(id = lastId()) {
        if (!tasks.has(id)) return;
        tasks.get(id).hold = false;
        contactEvent('eAgentContactUnHeld', id, 'connected');
      },
      updateAni(ani = '+46 70 111 22 33', id = lastId()) {
        if (!tasks.has(id)) return;
        tasks.get(id).ani = ani;
        emit('eAgentContactAniUpdated', { data: { interactionId: id, ani, interaction: interaction(id, tasks.get(id).state) } });
      },
      endCall(id = lastId()) {
        if (!tasks.has(id)) return;
        tasks.get(id).wrap = true;
        contactEvent('eAgentContactEnded', id, 'wrapUp');
        setChannel('WrapUp', '0', 'WrapUp');
      },
      wrapUp(id = lastId()) {
        if (!tasks.has(id)) return;
        emit('eAgentContactWrappedUp', { data: { interactionId: id } });
        tasks.delete(id);
        setChannel('Available', '0', 'Available');
      },
      setExternalState(agentState, auxCodeId = '0') {
        setChannel(agentState, auxCodeId, agentState);
      },
      failNextStateChange() {
        failNext = true;
      },
      failNextOutdial() {
        failNextDial = true;
      },
      setOffline(v) {
        offline = !!v;
      },
      idleCodes: idleCodes,
    },
  };

  function lastId() {
    return [...tasks.keys()].pop();
  }

  return adapter;
}
