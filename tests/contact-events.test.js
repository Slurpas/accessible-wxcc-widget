import { describe, it, expect, beforeEach } from 'vitest';
import { ContactService, extractCallInfo, mapInteractionState, CALL_STATE } from '../src/services/contact-events.js';
import { fakeAdapter, flush } from './helpers.js';

// Payload shape follows Cisco's documented eAgentContact / eAgentOfferContact examples.
function contact(id, state, { ani = '+19997770095', dnis = '+12147659000', queue = 'Queue - Telephony', direction = 'INBOUND', outboundType = null, hold = false, wrap = false } = {}) {
  return {
    data: {
      interactionId: id,
      interaction: {
        interactionId: id,
        mediaType: 'telephony',
        state,
        contactDirection: { type: direction },
        outboundType,
        callProcessingDetails: { ani, dnis, virtualTeamName: queue },
        media: { [id]: { mediaResourceId: id, mediaType: 'telephony', mType: 'mainCall', isHold: hold } },
        participants: { 'agent-1': { pType: 'Agent', isWrapUp: wrap } },
      },
    },
  };
}

describe('extractCallInfo', () => {
  it('reads ANI, DNIS and queue for an inbound call', () => {
    const info = extractCallInfo(contact('i1', 'connected').data.interaction);
    expect(info).toMatchObject({
      ani: '+19997770095',
      dnis: '+12147659000',
      customerNumber: '+19997770095',
      queue: 'Queue - Telephony',
      direction: 'INBOUND',
      callState: CALL_STATE.CONNECTED,
    });
  });

  it('uses DNIS as the customer number for an outdial', () => {
    const info = extractCallInfo(contact('o1', 'connected', { direction: 'OUTBOUND', outboundType: 'OUTDIAL', ani: '+4646999000', dnis: '+4640555123' }).data.interaction);
    expect(info.direction).toBe('OUTBOUND');
    expect(info.customerNumber).toBe('+4640555123');
  });

  it('falls back to callAssociatedData values', () => {
    const info = extractCallInfo({ interactionId: 'x', callAssociatedData: { ani: { value: '123' }, virtualTeamName: { value: 'Q' } } });
    expect(info.ani).toBe('123');
    expect(info.queue).toBe('Q');
  });

  it('detects hold from the main media leg', () => {
    expect(extractCallInfo(contact('h', 'connected', { hold: true }).data.interaction).callState).toBe(CALL_STATE.ON_HOLD);
  });
});

describe('mapInteractionState', () => {
  it.each([
    ['new', CALL_STATE.RINGING],
    ['connected', CALL_STATE.CONNECTED],
    ['consult', CALL_STATE.CONSULTING],
    ['conference', CALL_STATE.CONFERENCE],
    ['wrapUp', CALL_STATE.WRAP_UP],
    ['mystery', CALL_STATE.UNKNOWN],
  ])('%s -> %s', (s, e) => expect(mapInteractionState(s)).toBe(e));
});

describe('ContactService lifecycle', () => {
  let adapter;
  let svc;
  let snap;
  let notices;

  beforeEach(async () => {
    adapter = fakeAdapter();
    svc = new ContactService({ adapter });
    notices = [];
    svc.changes.subscribe((s) => (snap = s));
    svc.notices.subscribe((n) => notices.push(n));
    svc.start();
    await flush();
  });

  it('offer -> assigned -> ANI update -> hold -> ended (wrap-up) -> wrapped up', () => {
    adapter.emit('eAgentOfferContact', contact('c1', 'new'));
    expect(snap.primary).toMatchObject({ callState: CALL_STATE.RINGING, queue: 'Queue - Telephony' });
    expect(notices.at(-1).kind).toBe('new');

    adapter.emit('eAgentContactAssigned', contact('c1', 'connected'));
    expect(snap.primary.callState).toBe(CALL_STATE.CONNECTED);
    expect(notices.at(-1).kind).toBe('state');

    adapter.emit('eAgentContactAniUpdated', { data: { interactionId: 'c1', ani: '888****066', interaction: { interactionId: 'c1', state: 'connected', mediaType: 'telephony' } } });
    expect(snap.primary.ani).toBe('888****066');
    expect(snap.primary.customerNumber).toBe('888****066');
    expect(snap.primary.queue).toBe('Queue - Telephony'); // kept from earlier event

    adapter.emit('eAgentContactHeld', contact('c1', 'connected'));
    expect(snap.primary.callState).toBe(CALL_STATE.ON_HOLD);
    adapter.emit('eAgentContactUnHeld', contact('c1', 'connected', { hold: false }));
    expect(snap.primary.callState).toBe(CALL_STATE.CONNECTED);

    adapter.emit('eAgentContactEnded', contact('c1', 'wrapUp', { wrap: true }));
    expect(snap.primary.callState).toBe(CALL_STATE.WRAP_UP);

    adapter.emit('eAgentContactWrappedUp', { data: { interactionId: 'c1' } });
    expect(snap.primary).toBeNull();
    expect(notices.at(-1).kind).toBe('ended');
  });

  it('removes the call on end when no wrap-up is needed', () => {
    adapter.emit('eAgentContactAssigned', contact('c2', 'connected'));
    adapter.emit('eAgentContactEnded', contact('c2', 'ended'));
    expect(snap.primary).toBeNull();
  });

  it('removes a RONA offer', () => {
    adapter.emit('eAgentOfferContact', contact('c3', 'new'));
    adapter.emit('eAgentOfferContactRona', { data: { interactionId: 'c3' } });
    expect(snap.primary).toBeNull();
  });

  it('restores an already active call from the task map on mount', async () => {
    const a2 = fakeAdapter({ getTaskMap: async () => new Map([['c9', contact('c9', 'connected').data]]) });
    const s2 = new ContactService({ adapter: a2 });
    let s;
    s2.changes.subscribe((v) => (s = v));
    s2.start();
    await flush();
    expect(s.primary).toMatchObject({ interactionId: 'c9', callState: CALL_STATE.CONNECTED });
  });

  it('accepts a Map-like observable task map and never blanks on unknown shapes', () => {
    const tasks = [contact('m1', 'connected').data];
    svc.setTaskMap({ values: () => tasks[Symbol.iterator](), size: 1 });
    expect(snap.primary.interactionId).toBe('m1');
    svc.setTaskMap({ weird: { notATask: true } });
    expect(snap.primary.interactionId).toBe('m1');
    svc.setTaskMap(new Map());
    expect(snap.primary).toBeNull();
  });

  it('counts other interactions and prefers telephony as primary', () => {
    adapter.emit('eAgentContactAssigned', contact('t1', 'connected'));
    const chat = contact('ch1', 'connected');
    chat.data.interaction.mediaType = 'chat';
    adapter.emit('eAgentContactAssigned', chat);
    expect(snap.primary.interactionId).toBe('t1');
    expect(snap.others).toBe(1);
  });

  it('forgets call data on stop (memory only)', () => {
    adapter.emit('eAgentContactAssigned', contact('c4', 'connected'));
    svc.stop();
    expect(svc.calls.size).toBe(0);
    expect(adapter.listenerCount('eAgentContactAssigned')).toBe(0);
  });
});
