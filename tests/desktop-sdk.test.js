/**
 * Real adapter with a fake SDK module that reproduces SDK 3.0.1 behaviour:
 * config.cleanup() drops the AGENTX_SERVICE reference for good, after which
 * init() no longer hands the service to the other modules and calls such as
 * stateChangeV2 resolve to undefined ("SERVICE is not defined...").
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const sdk = vi.hoisted(() => {
  const state = { service: null, initCalls: 0, cleanupCalls: 0 };
  const agentStateInfo = {
    latestData: {},
    stateChangeV2: vi.fn(async (payload) => (state.service ? { data: { ...payload } } : undefined)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const Desktop = {
    config: {
      agentxSERVICE: undefined,
      init: vi.fn(async () => {
        state.initCalls += 1;
        state.service = Desktop.config.agentxSERVICE || null;
      }),
      cleanup: vi.fn(() => {
        state.cleanupCalls += 1;
        Desktop.config.agentxSERVICE = undefined;
        state.service = null;
      }),
    },
    agentStateInfo,
    agentContact: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    dialer: { startOutdial: vi.fn(async () => ({ data: {} })), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    logger: { createLogger: () => null },
  };
  return { Desktop, state };
});

vi.mock('@wxcc-desktop/sdk', () => ({ Desktop: sdk.Desktop }));

const { connectDesktop } = await import('../src/services/desktop-sdk.js');

describe('connectDesktop inside Desktop', () => {
  beforeAll(() => {
    globalThis.AGENTX_SERVICE = { isInited: true };
    sdk.Desktop.config.agentxSERVICE = globalThis.AGENTX_SERVICE;
  });

  it('keeps the SDK working after the widget unmounts and mounts again', async () => {
    const first = await connectDesktop();
    expect(await first.stateChangeV2({ state: 'Available' })).toBeTruthy();
    first.cleanup(); // agent switches to another page

    const second = await connectDesktop(); // agent comes back
    expect(await second.stateChangeV2({ state: 'Available' })).toMatchObject({ data: { state: 'Available' } });

    expect(sdk.state.cleanupCalls).toBe(0);
    expect(sdk.state.initCalls).toBe(1);
  });

  it('removes only its own listeners on cleanup', async () => {
    const adapter = await connectDesktop();
    const handler = () => {};
    adapter.onAgentStateEvent('eAgentChannelStateChanged', handler);
    adapter.cleanup();
    expect(sdk.Desktop.agentStateInfo.removeEventListener).toHaveBeenCalledWith('eAgentChannelStateChanged', handler);
    expect(sdk.Desktop.config.cleanup).not.toHaveBeenCalled();
  });

  it('passes outdial requests to Desktop.dialer.startOutdial in the documented shape', async () => {
    const adapter = await connectDesktop();
    const data = { entryPointId: 'ep', destination: '+4646123456', direction: 'OUTBOUND', attributes: {}, mediaType: 'telephony', outboundType: 'OUTDIAL' };
    await adapter.startOutdial(data);
    expect(sdk.Desktop.dialer.startOutdial).toHaveBeenCalledWith({ data });
    const onFail = () => {};
    adapter.onDialerEvent('eOutdialFailed', onFail);
    adapter.cleanup();
    expect(sdk.Desktop.dialer.removeEventListener).toHaveBeenCalledWith('eOutdialFailed', onFail);
  });

  it('reports a missing post-interaction API instead of crashing', async () => {
    const adapter = await connectDesktop();
    expect(() => adapter.fetchPostInteractionTasks({})).toThrow('not available');
  });
});
