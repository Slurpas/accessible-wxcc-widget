/**
 * All user-facing text in one place so it can be translated or reworded
 * without touching the logic. Keep wording short and plain.
 */
export const STRINGS = {
  widgetTitle: 'Accessible agent panel',

  myStatus: 'My status',
  changeStatus: 'Change status',
  myCall: 'My current call',
  myTeam: 'My team',
  settings: 'Display settings',

  // Status labels (shown very large)
  status: {
    READY: 'READY',
    NOT_READY: 'NOT READY',
    BUSY: 'BUSY',
    WRAP_UP: 'WRAP-UP',
    RONA: 'MISSED CALL',
    OFFLINE: 'OFFLINE',
    UNKNOWN: 'UNKNOWN',
    LOADING: 'CONNECTING…',
    ERROR: 'STATUS NOT VERIFIED',
  },

  // Plain-language explanations under the big status
  statusHelp: {
    READY: 'You can receive calls.',
    NOT_READY: 'You will not receive calls.',
    BUSY: 'You are handling a call.',
    WRAP_UP: 'Call finished. Complete wrap-up to continue.',
    RONA: 'A call was not answered in time. You will not receive calls until you choose READY.',
    OFFLINE: 'You are not logged in to the telephony channel.',
    UNKNOWN: 'Webex reported a status this panel does not recognise.',
    LOADING: 'Reading your status from Webex…',
    ERROR: 'Your status could not be read from Webex. Use the normal Webex status menu if needed.',
  },

  readyButton: 'READY',
  notReadyFallback: 'NOT READY',
  requesting: (label) => `Requesting ${label}…`,
  requestFailed: (label, reason) => `Could not change to ${label}. ${reason}`,
  requestNotConfirmed: (label) =>
    `Webex has not confirmed ${label} yet. Check your status before taking calls.`,
  statusAnnounce: (label, reason) => (reason ? `Your status is now ${label}, ${reason}` : `Your status is now ${label}`),
  auxCodesUnavailable: 'Not Ready reasons could not be loaded. Only READY is available.',
  noAgentId: 'Agent identity not available from Webex. Status buttons are disabled.',
  since: (time) => `Since ${time}`,

  // Call panel
  noCall: 'No active call',
  callerNumber: 'Caller number',
  dialledNumber: 'Dialled number',
  customerNumber: 'Customer number',
  queue: 'Queue',
  callStatus: 'Status',
  direction: 'Direction',
  inbound: 'INBOUND',
  outbound: 'OUTBOUND',
  unknownNumber: 'Number withheld',
  unknownQueue: 'Not available',
  otherInteractions: (n) => (n === 1 ? '1 other interaction in progress' : `${n} other interactions in progress`),
  callState: {
    RINGING: 'RINGING',
    CONNECTED: 'CONNECTED',
    ON_HOLD: 'ON HOLD',
    CONSULTING: 'CONSULTING',
    CONFERENCE: 'CONFERENCE',
    WRAP_UP: 'WRAP-UP',
    ENDED: 'ENDED',
    UNKNOWN: 'IN PROGRESS',
  },
  callAnnounceNew: (number, queue) => `Incoming call from ${number}${queue ? `, queue ${queue}` : ''}`,
  callAnnounceState: (state) => `Call status ${state}`,
  callAnnounceEnded: 'Call ended',
  callInfoUnavailable: 'Call information is not available right now.',

  // Team panel
  teamDisabled: 'The team list is turned off in this layout.',
  teamUnavailable: 'The team list is not available.',
  teamLoading: 'Loading team…',
  teamEmpty: 'No colleagues to show right now.',
  teamCounts: (ready, shown) => `${ready} ready · ${shown} logged in and listed`,
  teamStale: (time) => `Information may be out of date. Last updated ${time}.`,
  teamError: (time) =>
    time ? `CONNECTION ERROR. Showing last known list from ${time}.` : 'CONNECTION ERROR. Team list could not be loaded.',
  teamUpdated: (time, seconds) => `Updates automatically every ${seconds} seconds. Last updated ${time}.`,
  refresh: 'Refresh now',

  // Settings
  themeDark: 'Dark theme',
  themeLight: 'Light theme',
  textSize: 'Text size',
  textSizes: { 100: 'Normal', 125: 'Large', 150: 'Extra large' },
  soundOn: 'Sounds on',
  soundOff: 'Sounds off',

  // Connection
  conn: {
    loading: 'Connecting to Webex…',
    connected: 'Connected to Webex',
    disconnected: 'CONNECTION LOST. Information shown may be out of date.',
    error: 'Webex connection error',
    mock: 'DEMO MODE: mock data. Nothing is sent to Webex.',
    notInDesktop:
      'This panel only works inside Webex Contact Center Desktop. It could not find the Desktop connection, so nothing is shown.',
  },
};
