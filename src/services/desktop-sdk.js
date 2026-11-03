/**
 * Thin adapter around the official Cisco Webex Contact Center Desktop SDK
 * (@wxcc-desktop/sdk). Every Cisco call the widget makes goes through this
 * file, so the rest of the code never touches the SDK directly and can be
 * tested with a fake adapter.
 *
 * Why the SDK is loaded lazily:
 * the SDK reads the global AGENTX_SERVICE object (provided by Desktop) as
 * soon as it is evaluated. Outside Desktop that global does not exist and
 * importing the SDK throws a ReferenceError. We therefore check for the
 * global first and only then import the SDK, so the widget can show a clear
 * diagnostic message instead of crashing.
 */
import { log, setLogSink } from '../utils/logger.js';

const WIDGET_NAME = 'accessible-wxcc-widget';
const WIDGET_PROVIDER = 'accessible-wxcc-widget';
const OUTDIAL_EP_FIELDS = ['outDialEp', 'outdialEp', 'outDialEntryPointId', 'outdialEntryPointId'];

/** True when the page is Webex Contact Center Desktop (or a Desktop-hosted frame). */
export function isInsideDesktop(win = globalThis) {
  try {
    return typeof win.AGENTX_SERVICE === 'object' && win.AGENTX_SERVICE !== null;
  } catch {
    return false;
  }
}

// The SDK module is a singleton inside this bundle and is initialised once
// for the lifetime of the Desktop page. All widget instances (and remounts
// after the agent switches page) share it.
//
// Desktop.config.cleanup() is deliberately never called: in SDK 3.0.1 it
// clears the config module's reference to AGENTX_SERVICE for good, so any
// later init() only logs "SERVICE is not defined..." and every call (e.g.
// stateChangeV2) silently does nothing. Unmounting therefore removes only
// this widget's own listeners.
let sdkPromise = null;

async function loadAndInitSdk() {
  let Desktop;
  try {
    ({ Desktop } = await import('@wxcc-desktop/sdk'));
    await Desktop.config.init({ widgetName: WIDGET_NAME, widgetProvider: WIDGET_PROVIDER });
  } catch (err) {
    const e = new Error(`Desktop SDK could not start: ${err && err.message ? err.message : err}`);
    e.code = 'SDK_INIT_FAILED';
    throw e;
  }
  try {
    const sdkLogger = Desktop.logger.createLogger(WIDGET_NAME);
    if (sdkLogger) setLogSink(sdkLogger);
  } catch {
    /* fall back to console logging */
  }
  return Desktop;
}

/**
 * Load and initialise the SDK. Resolves to an adapter object; rejects with
 * an Error whose `code` is NOT_IN_DESKTOP or SDK_INIT_FAILED.
 */
export async function connectDesktop(win = globalThis) {
  if (!isInsideDesktop(win)) {
    const e = new Error('Webex Contact Center Desktop was not detected');
    e.code = 'NOT_IN_DESKTOP';
    throw e;
  }
  if (!sdkPromise) {
    sdkPromise = loadAndInitSdk();
    sdkPromise.catch(() => {
      sdkPromise = null;
    });
  }
  const Desktop = await sdkPromise;
  return createDesktopAdapter(Desktop);
}

/**
 * Wrap the Desktop SDK object in the adapter interface used by services.
 * Exported for tests; production code uses connectDesktop().
 */
export function createDesktopAdapter(Desktop) {
  const subscriptions = new Set();

  function subscribe(module, eventName, handler) {
    module.addEventListener(eventName, handler);
    const off = () => {
      try {
        module.removeEventListener(eventName, handler);
      } catch {
        /* SDK may already be cleaned up */
      }
      subscriptions.delete(off);
    };
    subscriptions.add(off);
    return off;
  }

  return {
    mode: 'desktop',

    /** Data the SDK fetched from the agent profile (agentProfileID, teamId, idleCodes, ...). */
    getLatestData() {
      return Desktop.agentStateInfo.latestData || {};
    },

    /** Documented: Desktop.agentStateInfo.stateChangeV2({channelType, state, auxCodeId, reason, agentId}). */
    stateChangeV2(payload) {
      return Desktop.agentStateInfo.stateChangeV2(payload);
    },

    /** Documented: Desktop.agentConfigJsApi.fetchPaginatedAuxCodes({workType, page, pageSize}). */
    fetchPaginatedAuxCodes(payload) {
      return Desktop.agentConfigJsApi.fetchPaginatedAuxCodes(payload);
    },

    /** Documented: Desktop.agentContact.buddyAgentsV2({data}). Uses the agent's own Desktop session. */
    buddyAgentsV2(data) {
      return Desktop.agentContact.buddyAgentsV2({ data });
    },

    /** Documented: Desktop.actions.getTaskMap(). Used to restore a call that was active before mount. */
    getTaskMap() {
      return Desktop.actions.getTaskMap();
    },

    /**
     * Outdial settings from Desktop's own agent profile (AGENTX_SERVICE.conf.profile,
     * the object the SDK builds latestData from). The SDK reads the profile but
     * leaves the outdial entry point out of latestData, so it is read here.
     * Read-only, and only these three fields are copied.
     */
    getOutdialSettings() {
      let profile = null;
      try {
        const svc = globalThis.AGENTX_SERVICE;
        profile = svc && svc.conf && svc.conf.profile;
      } catch {
        /* not available */
      }
      if (!profile || typeof profile !== 'object') return {};
      const ep = OUTDIAL_EP_FIELDS.map((f) => profile[f]).find((v) => v !== undefined && v !== null && v !== '');
      return {
        outDialEp: ep,
        isOutboundEnabledForAgent: profile.isOutboundEnabledForAgent,
        isOutboundEnabledForTenant: profile.isOutboundEnabledForTenant,
      };
    },

    /** Documented: Desktop.agentContact.end({interactionId}). Same as Desktop's own End button. */
    endCall(interactionId) {
      return Desktop.agentContact.end({ interactionId });
    },

    /**
     * Documented: Desktop.dialer.startOutdial({data:{entryPointId, destination,
     * direction, attributes, mediaType, outboundType}}). Desktop checks the
     * agent's own outdial permission; the widget never dials without a confirm.
     */
    startOutdial(data) {
      return Desktop.dialer.startOutdial({ data });
    },

    /** Dialer events, for example eOutdialFailed. */
    onDialerEvent(eventName, handler) {
      return subscribe(Desktop.dialer, eventName, handler);
    },

    /**
     * Not documented for widgets (used by Desktop's own post-interaction
     * views). Only the read-only probe calls it, to learn whether a history
     * can be loaded from Webex.
     */
    fetchPostInteractionTasks(payload) {
      const api = Desktop.postInteractions;
      if (!api || typeof api.fetchTasks !== 'function') throw new Error('postInteractions.fetchTasks not available');
      return api.fetchTasks(payload);
    },

    /**
     * Desktop's real-time data channel (Desktop.rtdwc, also window.wxcc.rtdwc).
     * In the official SDK but not documented for widgets; used for the live
     * team list, with buddyAgentsV2 as the fallback. Returns the subscription.
     */
    subscribeRealtime({ datasetName, update, error }) {
      const rt = Desktop.rtdwc || (globalThis.wxcc && globalThis.wxcc.rtdwc);
      if (!rt || typeof rt.subscribe !== 'function') throw new Error('Real-time data not available');
      return rt.subscribe({ datasetName, update, error });
    },

    onAgentStateEvent(eventName, handler) {
      return subscribe(Desktop.agentStateInfo, eventName, handler);
    },

    onContactEvent(eventName, handler) {
      return subscribe(Desktop.agentContact, eventName, handler);
    },

    /** Remove only our own listeners. The shared SDK stays initialised (see above). */
    cleanup() {
      for (const off of [...subscriptions]) off();
    },
  };
}
