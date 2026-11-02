import { describe, it, expect, vi } from 'vitest';
import { mapAuxCodes, toneForCode, loadIdleCodes, fetchIdleCodes } from '../src/services/auxiliary-codes.js';

// Shape copied from Cisco's documented fetchPaginatedAuxCodes response.
const page = (data, p = 0, totalPages = 1) => ({ meta: { page: p, pageSize: 100, totalPages }, data });

describe('mapAuxCodes', () => {
  it('drops system codes, duplicates and the Available code', () => {
    const codes = mapAuxCodes([
      { id: '0', name: 'Available' },
      { id: 'a', name: 'Break', isSystem: false, isDefault: false },
      { id: 'b', name: 'RONA', isSystem: true },
      { id: 'a', name: 'Break again' },
      { id: 'c', name: 'Meeting', isDefault: true },
      null,
      { name: 'no id' },
    ]);
    expect(codes.map((c) => c.id)).toEqual(['c', 'a']); // default first
  });

  it('keeps tenant names and ids exactly', () => {
    const [c] = mapAuxCodes([{ id: '3c5fa5f2-21fe-41cb-a5a3-5d71eccd5e1a', name: 'Lunch' }]);
    expect(c).toMatchObject({ id: '3c5fa5f2-21fe-41cb-a5a3-5d71eccd5e1a', name: 'Lunch', tone: 'lunch' });
  });

  it('returns [] for bad input', () => {
    expect(mapAuxCodes(undefined)).toEqual([]);
    expect(mapAuxCodes({})).toEqual([]);
  });
});

describe('toneForCode', () => {
  it.each([
    ['Lunch', 'lunch'],
    ['Lunsch', 'lunch'],
    ['Coffee Break', 'break'],
    ['Fika', 'break'],
    ['Admin work', 'admin'],
    ['Möte', 'admin'],
    ['Not Ready', 'notready'],
  ])('%s -> %s', (name, tone) => expect(toneForCode(name)).toBe(tone));
});

describe('fetchIdleCodes', () => {
  it('requests IDLE_CODE and follows pagination', async () => {
    const adapter = {
      fetchPaginatedAuxCodes: vi
        .fn()
        .mockResolvedValueOnce(page([{ id: '1', name: 'A' }], 0, 2))
        .mockResolvedValueOnce(page([{ id: '2', name: 'B' }], 1, 2)),
    };
    const all = await fetchIdleCodes(adapter);
    expect(all.map((c) => c.id)).toEqual(['1', '2']);
    expect(adapter.fetchPaginatedAuxCodes).toHaveBeenNthCalledWith(1, { workType: 'IDLE_CODE', page: 0, pageSize: 100 });
    expect(adapter.fetchPaginatedAuxCodes).toHaveBeenNthCalledWith(2, { workType: 'IDLE_CODE', page: 1, pageSize: 100 });
  });
});

describe('loadIdleCodes', () => {
  it('falls back to profile idle codes when the paginated call fails', async () => {
    const adapter = {
      fetchPaginatedAuxCodes: vi.fn().mockRejectedValue(new Error('boom')),
      getLatestData: () => ({ idleCodes: [{ id: '1646', name: 'Meeting', isSystem: false }] }),
    };
    const r = await loadIdleCodes(adapter);
    expect(r.source).toBe('profile');
    expect(r.codes[0].name).toBe('Meeting');
  });

  it('never rejects, so READY stays usable', async () => {
    const adapter = {
      fetchPaginatedAuxCodes: vi.fn().mockResolvedValue(undefined),
      getLatestData: () => {
        throw new Error('no data');
      },
    };
    const r = await loadIdleCodes(adapter);
    expect(r).toEqual({ codes: [], source: 'none', error: 'AUX_CODES_UNAVAILABLE' });
  });
});
