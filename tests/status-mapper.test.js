import { describe, it, expect } from 'vitest';
import { mapAgentState, mapBuddyState, toMillis, compareTeamMembers, DISPLAY } from '../src/utils/status-mapper.js';

describe('mapAgentState', () => {
  it.each([
    ['Available', DISPLAY.READY],
    ['available', DISPLAY.READY],
    ['Idle', DISPLAY.NOT_READY],
    ['Engaged', DISPLAY.BUSY],
    ['WrapUp', DISPLAY.WRAP_UP],
    ['wrap-up', DISPLAY.WRAP_UP],
    ['RONA', DISPLAY.RONA],
    ['LoggedOut', DISPLAY.OFFLINE],
  ])('%s -> %s', (input, expected) => {
    expect(mapAgentState(input)).toBe(expected);
  });

  it('never guesses unknown values', () => {
    expect(mapAgentState('SomethingNew')).toBe(DISPLAY.UNKNOWN);
    expect(mapAgentState('')).toBe(DISPLAY.UNKNOWN);
    expect(mapAgentState(undefined)).toBe(DISPLAY.UNKNOWN);
    expect(mapAgentState(42)).toBe(DISPLAY.UNKNOWN);
  });
});

describe('mapBuddyState', () => {
  it('uses the queried state when the entry has none', () => {
    expect(mapBuddyState(undefined, 'Available')).toBe(DISPLAY.READY);
    expect(mapBuddyState(undefined, 'Idle')).toBe(DISPLAY.NOT_READY);
  });
  it('only reports READY or NOT READY, never OFFLINE', () => {
    expect(mapBuddyState('LoggedOut', 'Idle')).toBe(DISPLAY.UNKNOWN);
  });
});

describe('toMillis', () => {
  it('converts STORE epoch seconds to milliseconds', () => {
    expect(toMillis(1757579405)).toBe(1757579405000);
  });
  it('keeps SDK epoch milliseconds', () => {
    expect(toMillis(1757579405000)).toBe(1757579405000);
  });
  it('rejects junk', () => {
    expect(toMillis(null)).toBe(0);
    expect(toMillis('abc')).toBe(0);
    expect(toMillis(-5)).toBe(0);
  });
});

describe('compareTeamMembers', () => {
  it('sorts READY first, then by name', () => {
    const rows = [
      { name: 'Erik', display: DISPLAY.NOT_READY },
      { name: 'maria', display: DISPLAY.READY },
      { name: 'Anna', display: DISPLAY.READY },
    ].sort(compareTeamMembers);
    expect(rows.map((r) => r.name)).toEqual(['Anna', 'maria', 'Erik']);
  });
});
