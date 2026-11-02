/**
 * Loads the tenant's Idle (Not Ready) auxiliary codes and turns them into
 * status buttons. Nothing is hardcoded: names and IDs come from Webex.
 *
 * Primary source: Desktop.agentConfigJsApi.fetchPaginatedAuxCodes with
 * workType IDLE_CODE (documented; respects the agent's desktop profile).
 * Fallback: Desktop.agentStateInfo.latestData.idleCodes (from the agent profile).
 */
import { log } from '../utils/logger.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // safety stop; 1 000 codes is far beyond any real profile

/**
 * Colour family for an idle code, picked from its name.
 * The match words cover English and Swedish names; unmatched codes use the
 * generic Not Ready red. Colour is never the only cue: buttons always carry
 * the code name as text.
 */
const COLOUR_RULES = [
  { tone: 'lunch', words: ['lunch', 'meal', 'lunsch', 'mat'] },
  { tone: 'break', words: ['break', 'coffee', 'tea', 'rast', 'paus', 'fika', 'pause'] },
  { tone: 'admin', words: ['admin', 'meeting', 'training', 'möte', 'utbildning', 'backoffice', 'back office', 'email', 'e-post'] },
];

export function toneForCode(name) {
  const n = String(name || '').toLowerCase();
  for (const rule of COLOUR_RULES) {
    if (rule.words.some((w) => n.includes(w))) return rule.tone;
  }
  return 'notready';
}

/**
 * Normalise raw code entries ({id, name, isSystem, isDefault}) into button
 * definitions. System codes (for example RONA or "Aux on Login") are set by
 * Webex itself and are not offered as buttons.
 */
export function mapAuxCodes(rawCodes) {
  if (!Array.isArray(rawCodes)) return [];
  const seen = new Set();
  const codes = [];
  for (const c of rawCodes) {
    if (!c || c.id === undefined || c.id === null) continue;
    const id = String(c.id);
    if (id === '' || id === '0' || seen.has(id)) continue;
    if (c.isSystem === true || c.isSystemCode === true) continue;
    if (c.active === false) continue;
    seen.add(id);
    const name = String(c.name || '').trim() || 'Not Ready';
    codes.push({ id, name, isDefault: c.isDefault === true || c.defaultCode === true, tone: toneForCode(name) });
  }
  // Default code first (it is the tenant's generic "Not Ready"), others keep Webex order.
  return codes.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Fetch every page of IDLE_CODE aux codes through the SDK. */
export async function fetchIdleCodes(adapter) {
  const all = [];
  let page = 0;
  let totalPages = 1;
  while (page < totalPages && page < MAX_PAGES) {
    const res = await adapter.fetchPaginatedAuxCodes({ workType: 'IDLE_CODE', page, pageSize: PAGE_SIZE });
    if (!res || !Array.isArray(res.data)) {
      if (page === 0) throw new Error('No auxiliary code data returned');
      break;
    }
    all.push(...res.data);
    totalPages = Number(res.meta && res.meta.totalPages) || 1;
    page += 1;
  }
  return all;
}

/**
 * Load idle codes with fallback. Resolves to { codes, source, error }.
 * Never rejects: the READY button must stay usable even if this fails.
 */
export async function loadIdleCodes(adapter) {
  try {
    const raw = await fetchIdleCodes(adapter);
    const codes = mapAuxCodes(raw);
    if (codes.length > 0) return { codes, source: 'paginated', error: null };
  } catch (err) {
    log.warn('fetchPaginatedAuxCodes failed, trying profile idle codes', err);
  }
  try {
    const latest = adapter.getLatestData() || {};
    const codes = mapAuxCodes(latest.idleCodes);
    if (codes.length > 0) return { codes, source: 'profile', error: null };
  } catch (err) {
    log.warn('profile idle codes unavailable', err);
  }
  return { codes: [], source: 'none', error: 'AUX_CODES_UNAVAILABLE' };
}
