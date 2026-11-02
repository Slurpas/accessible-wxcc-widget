import { vi } from 'vitest';

/** Fake adapter with controllable event emission, mirroring the real adapter interface. */
export function fakeAdapter(overrides = {}) {
  const handlers = new Map();
  const on = (name, fn) => {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
    return () => handlers.get(name).delete(fn);
  };
  return {
    mode: 'desktop',
    getLatestData: vi.fn(() => ({})),
    stateChangeV2: vi.fn(),
    fetchPaginatedAuxCodes: vi.fn(async () => ({ meta: { totalPages: 1 }, data: [] })),
    buddyAgentsV2: vi.fn(async () => ({ data: { agentList: [] } })),
    getTaskMap: vi.fn(async () => new Map()),
    onAgentStateEvent: vi.fn(on),
    onContactEvent: vi.fn(on),
    cleanup: vi.fn(),
    emit(name, payload) {
      for (const fn of [...(handlers.get(name) || [])]) fn(payload);
    },
    listenerCount(name) {
      return handlers.has(name) ? handlers.get(name).size : 0;
    },
    ...overrides,
  };
}

/** Event payload in the shape documented for eAgentChannelStateChanged. */
export function channelEvent(agentState, auxCodeId = '0', ts = Date.now(), extra = {}) {
  return {
    agentId: 'agent-1',
    channelType: 'telephony',
    agentChannelStateDetail: { agentState, auxCodeId, stateChangeTimestamp: ts, stateChangeReason: agentState },
    type: 'AgentChannelStateChanged',
    ...extra,
  };
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
