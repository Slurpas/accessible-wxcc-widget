/**
 * Pure mapping functions between Webex values and what the widget shows.
 * No DOM and no SDK access here, so everything is unit-testable.
 */

/** Display keys used across the UI. Each has a colour token in themes.css. */
export const DISPLAY = Object.freeze({
  READY: 'READY',
  NOT_READY: 'NOT_READY',
  BUSY: 'BUSY',
  WRAP_UP: 'WRAP_UP',
  RONA: 'RONA',
  OFFLINE: 'OFFLINE',
  UNKNOWN: 'UNKNOWN',
  LOADING: 'LOADING',
  ERROR: 'ERROR',
});

/** Icons are text glyphs so they work without image assets and in high-contrast modes. */
export const ICONS = Object.freeze({
  READY: '✔',
  NOT_READY: '✖',
  BUSY: '☎',
  WRAP_UP: '✎',
  RONA: '⚠',
  OFFLINE: '○',
  UNKNOWN: '?',
  LOADING: '…',
  ERROR: '⚠',
});

/**
 * Map a granular channel state (agentChannelStateDetail.agentState or
 * STORE.agent.channelsStatesMap[channel].agentState) to a display key.
 *
 * Values documented by Cisco: Available, Idle, Engaged, WrapUp.
 * RONA is a documented system state (Redirection on No Answer).
 * Anything else is shown as UNKNOWN rather than guessed.
 */
export function mapAgentState(agentState) {
  if (typeof agentState !== 'string' || agentState === '') return DISPLAY.UNKNOWN;
  switch (agentState.toLowerCase().replace(/[\s_-]/g, '')) {
    case 'available':
      return DISPLAY.READY;
    case 'idle':
      return DISPLAY.NOT_READY;
    case 'engaged':
    case 'busy':
      return DISPLAY.BUSY;
    case 'wrapup':
      return DISPLAY.WRAP_UP;
    case 'rona':
      return DISPLAY.RONA;
    case 'loggedout':
    case 'offline':
      return DISPLAY.OFFLINE;
    default:
      return DISPLAY.UNKNOWN;
  }
}

/**
 * Buddy agent entries only report Available or Idle (the API is queried
 * per state). The state we queried is passed as a fallback.
 */
export function mapBuddyState(state, queriedState) {
  const s = mapAgentState(state || queriedState);
  return s === DISPLAY.READY || s === DISPLAY.NOT_READY ? s : DISPLAY.UNKNOWN;
}

/**
 * Webex timestamps are epoch milliseconds in SDK events and epoch seconds
 * in STORE.agent.channelsStatesMap. Normalise to milliseconds.
 */
export function toMillis(ts) {
  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

/** Sort order for the team list: READY first, then other logged-in states. */
const TEAM_ORDER = { READY: 0, NOT_READY: 1, BUSY: 2, WRAP_UP: 3, RONA: 4, UNKNOWN: 5, OFFLINE: 6 };

export function compareTeamMembers(a, b) {
  const d = (TEAM_ORDER[a.display] ?? 9) - (TEAM_ORDER[b.display] ?? 9);
  if (d !== 0) return d;
  return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
}
