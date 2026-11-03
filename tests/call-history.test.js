import { describe, it, expect } from 'vitest';
import { CallHistory, attachRecorder } from '../src/services/call-history.js';
import { ContactService } from '../src/services/contact-events.js';
import { fakeAdapter } from './helpers.js';

function clock(start = 1000) {
  const c = { t: start, now: () => c.t };
  return c;
}

const call = (id, extra = {}) => ({ interactionId: id, mediaType: 'telephony', customerNumber: '+46 46 123 456', direction: 'INBOUND', queue: 'Support', callState: 'RINGING', ...extra });

describe('CallHistory', () => {
  it('records one entry per interaction with times and outcome', () => {
    const c = clock();
    const hist = new CallHistory({ now: c.now });
    hist.upsert(call('a'));
    c.t = 5000;
    hist.upsert(call('a', { callState: 'CONNECTED' }));
    c.t = 65000;
    hist.upsert(call('a', { callState: 'WRAP_UP' }));
    hist.finish('a');
    expect(hist.list()).toEqual([
      { id: 'a', number: '+46 46 123 456', direction: 'INBOUND', queue: 'Support', startedAt: 1000, connectedAt: 5000, endedAt: 65000, missed: false },
    ]);
  });

  it('marks calls that were never answered as missed', () => {
    const hist = new CallHistory();
    hist.upsert(call('a'));
    hist.finish('a');
    expect(hist.list()[0].missed).toBe(true);
  });

  it('keeps only the newest entries, newest first', () => {
    const c = clock();
    const hist = new CallHistory({ now: c.now, max: 3 });
    for (const id of ['a', 'b', 'c', 'd']) {
      c.t += 10;
      hist.upsert(call(id));
    }
    expect(hist.list().map((e) => e.id)).toEqual(['d', 'c', 'b']);
  });

  it('ignores chat, email and other digital channels', () => {
    const hist = new CallHistory();
    hist.upsert(call('chat', { mediaType: 'chat' }));
    hist.upsert(call('mail', { mediaType: 'email' }));
    expect(hist.list()).toEqual([]);
  });

  it('only notifies when something actually changed', () => {
    const hist = new CallHistory({ now: () => 1 });
    let n = 0;
    hist.changes.subscribe(() => n++);
    hist.upsert(call('a'));
    hist.upsert(call('a'));
    expect(n).toBe(1);
  });
});

describe('attachRecorder', () => {
  const offer = (id, ani = '+46 46 123 456') => ({ data: { interactionId: id, interaction: { interactionId: id, mediaType: 'telephony', state: 'new', contactDirection: { type: 'INBOUND' }, callProcessingDetails: { ani } } } });

  it('records calls from contact events and finishes them when they leave Desktop', () => {
    const adapter = fakeAdapter();
    const contacts = new ContactService({ adapter });
    const hist = new CallHistory();
    attachRecorder(contacts, hist);
    contacts.start();
    adapter.emit('eAgentOfferContact', offer('x1'));
    expect(hist.list()[0]).toMatchObject({ id: 'x1', number: '+46 46 123 456', endedAt: 0 });
    adapter.emit('eAgentOfferContactRona', { data: { interactionId: 'x1' } });
    expect(hist.list()[0]).toMatchObject({ id: 'x1', missed: true });
    expect(hist.list()[0].endedAt).toBeGreaterThan(0);
  });

  it('two recorders on the same history do not create duplicates', () => {
    const a1 = fakeAdapter();
    const a2 = fakeAdapter();
    const hist = new CallHistory();
    const c1 = new ContactService({ adapter: a1 });
    const c2 = new ContactService({ adapter: a2 });
    attachRecorder(c1, hist);
    attachRecorder(c2, hist);
    c1.start();
    c2.start();
    a1.emit('eAgentOfferContact', offer('x1'));
    a2.emit('eAgentOfferContact', offer('x1'));
    expect(hist.list()).toHaveLength(1);
  });

  it('a stopped widget does not end calls that are still live', () => {
    const adapter = fakeAdapter();
    const contacts = new ContactService({ adapter });
    const hist = new CallHistory();
    attachRecorder(contacts, hist);
    contacts.start();
    adapter.emit('eAgentOfferContact', offer('x1'));
    contacts.stop(); // page switch in Desktop
    expect(hist.list()[0].endedAt).toBe(0);
  });
});
