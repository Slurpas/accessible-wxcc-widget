/**
 * Read-only team-data probe, run by an administrator from the DevTools
 * console inside Webex Contact Center Desktop:
 *
 *   await accessibleWxccProbe()
 *   await accessibleWxccProbe({ datasets: ['nameFoundInDesktopSources'] })
 *
 * It answers one question: can this user's own Desktop session see which
 * colleagues are logged in and whether they are Ready? It checks
 *   1. buddyAgentsV2 (what the team list uses today): counts per state only;
 *   2. Desktop's real-time data channel (window.wxcc.rtdwc, exposed by the
 *      official SDK as Desktop.rtdwc but undocumented): which datasets accept
 *      a subscription and what the data looks like.
 *
 * Privacy: the report holds structure only — key names, types, counts and
 * state words such as "Available". Names, IDs, numbers, e-mail addresses and
 * tokens are never copied into it, so it is safe to paste into a ticket.
 * Nothing is changed: no state change, no write, no token request, and every
 * subscription is closed again before the probe returns.
 */
import { connectDesktop } from '../services/desktop-sdk.js';
import { REASON_FIELDS } from '../services/team-dashboard.js';

export const PROBE_VERSION = 2;

// Likely dataset names. The real names are not documented; add more with
// { datasets: [...] } after searching Desktop's sources for "datasetName".
export const CANDIDATE_DATASETS = [
  'agentState',
  'agentStates',
  'agentDetails',
  'agentSessions',
  'agentStatistics',
  'agentStats',
  'agents',
  'teamAgents',
  'teamAgentStates',
  'teamStats',
  'teamStatistics',
  'teamPerformance',
  'queueStats',
  'queueStatistics',
];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+/g;
const DIGITS_RE = /\+?\d[\d\s-]{3,}\d/g;
const STATE_KEY_RE = /state|status|type|phase/i;
const STATE_WORD_RE = /^[A-Za-z][A-Za-z_-]{1,30}$/;

/** True for keys that are really data (an agent ID, an e-mail, a name with a space). */
export function isIdLike(key) {
  const k = String(key);
  return /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k) || k.includes('@') || /\s/.test(k) || /\d{4,}/.test(k);
}

/** Scrub IDs, e-mail addresses and numbers from a message and keep it short. */
export function scrub(text) {
  return String(text == null ? '' : text)
    .replace(UUID_RE, '<id>')
    .replace(EMAIL_RE, '<email>')
    .replace(DIGITS_RE, '<number>')
    .slice(0, 160);
}

function errorText(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return scrub(err);
  const base = err.message || err.type || err.name || 'error';
  // Axios-style errors: the server's own reason says what the request lacked.
  const body = err.response && err.response.data;
  const detail = body && typeof body === 'object' ? body.message || body.error || body.description || body.reason : typeof body === 'string' ? body : '';
  return scrub(detail ? `${base}: ${typeof detail === 'string' ? detail : JSON.stringify(describeShape(detail, 1))}` : base);
}

/**
 * Describe a value's structure without its content. State-like fields keep
 * their value when it is a short plain word (e.g. "Available", "Engaged"),
 * because the vocabulary is exactly what the probe needs to learn.
 */
export function describeShape(value, depth = 3, key = '') {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const out = { type: 'array', length: value.length };
    if (value.length && depth > 0) out.item = describeShape(value[0], depth - 1, key);
    const words = stateWords(value, key);
    if (words.length) out.values = words;
    return out;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    // An object keyed by agent IDs is a map: describe one entry, never the keys.
    if (keys.length && keys.filter(isIdLike).length * 2 >= keys.length) {
      const first = value[keys[0]];
      return { type: 'map', size: keys.length, item: depth > 0 ? describeShape(first, depth - 1) : typeof first };
    }
    const out = { type: 'object', keys: {} };
    for (const k of keys.slice(0, 40)) {
      if (isIdLike(k)) continue;
      out.keys[k] = depth > 0 ? describeShape(value[k], depth - 1, k) : typeOf(value[k]);
    }
    if (keys.length > 40) out.moreKeys = keys.length - 40;
    return out;
  }
  if (typeof value === 'string' && STATE_KEY_RE.test(key) && STATE_WORD_RE.test(value)) return `string "${value}"`;
  return typeof value;
}

function typeOf(v) {
  if (v === null) return 'null';
  return Array.isArray(v) ? 'array' : typeof v;
}

function stateWords(arr, key) {
  if (!STATE_KEY_RE.test(key)) return [];
  return [...new Set(arr.filter((v) => typeof v === 'string' && STATE_WORD_RE.test(v)))].slice(0, 20);
}

/** Method and property names of an object and its prototype (names only). */
function apiNames(obj) {
  const names = new Set();
  let o = obj;
  for (let i = 0; o && o !== Object.prototype && i < 3; i += 1) {
    for (const n of Object.getOwnPropertyNames(o)) if (n !== 'constructor' && !isIdLike(n)) names.add(`${n}:${typeOf(safeGet(obj, n))}`);
    o = Object.getPrototypeOf(o);
  }
  return [...names].sort().slice(0, 60);
}

function safeGet(obj, name) {
  try {
    return obj[name];
  } catch {
    return undefined;
  }
}

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

function closeSubscription(sub) {
  try {
    if (typeof sub === 'function') sub();
    else if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe();
    else if (sub && typeof sub.close === 'function') sub.close();
    else return false;
    return true;
  } catch {
    return false;
  }
}

async function probeBuddies(adapter) {
  const out = { profileIdPresent: false, ownTeamIdPresent: false, states: {} };
  let latest = {};
  try {
    latest = adapter.getLatestData() || {};
  } catch {
    /* reported below */
  }
  const profileId = String(latest.agentProfileID || '');
  const teamId = String(latest.teamId || '');
  out.profileIdPresent = /^[0-9a-f-]{36}$/i.test(profileId);
  out.ownTeamIdPresent = !!teamId;
  if (!out.profileIdPresent) return out;
  for (const state of ['Available', 'Idle']) {
    try {
      const res = await withTimeout(
        adapter.buddyAgentsV2({ agentProfileId: profileId, mediaType: 'telephony', channelName: 'telephony', state }),
        8000,
        'buddyAgentsV2',
      );
      const list = (res && (res.data || res).agentList) || null;
      if (!Array.isArray(list)) {
        out.states[state] = { error: errorText(res && (res.data || res).type) };
        continue;
      }
      out.states[state] = {
        count: list.length,
        withTeamId: list.filter((a) => a && a.teamId).length,
        inOwnTeam: teamId ? list.filter((a) => a && String(a.teamId) === teamId).length : null,
        entryShape: list.length ? describeShape(list[0], 1) : null,
        // Which Not Ready reason fields (if any) this tenant sends; names only.
        reasonFieldsFound: REASON_FIELDS.filter((f) => list.some((a) => a && a[f] !== undefined && a[f] !== null && a[f] !== '')),
      };
    } catch (err) {
      out.states[state] = { error: errorText(err) };
    }
  }
  return out;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{1,80}$/;

/**
 * Desktop's own catalogue of real-time datasets (rtdwc.DATASET constants and
 * the dataset factory). These are code identifiers, not user data; only
 * identifier-like strings are kept.
 */
export function datasetCatalog(rt) {
  const constants = {};
  const names = new Set();
  const visit = (obj, prefix, depth) => {
    if (!obj || typeof obj !== 'object' || depth < 0) return;
    for (const k of Object.keys(obj).slice(0, 80)) {
      if (isIdLike(k)) continue;
      const v = safeGet(obj, k);
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string' && NAME_RE.test(v) && !isIdLike(v)) {
        constants[path] = v;
        names.add(v);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) visit(v, path, depth - 1);
    }
  };
  visit(safeGet(rt, 'DATASET'), '', 2);
  const factory = safeGet(rt, 'dataSetFactory');
  const out = { constants, factoryApi: factory ? apiNames(factory) : [] };
  // Registered dataset handlers, if the factory keeps them in a map or object.
  for (const key of ['dataSets', 'datasets', 'registry', 'handlers', 'map']) {
    const reg = factory && safeGet(factory, key);
    const keys = reg instanceof Map ? [...reg.keys()] : reg && typeof reg === 'object' ? Object.keys(reg) : [];
    for (const n of keys) if (NAME_RE.test(String(n)) && !isIdLike(String(n))) names.add(String(n));
  }
  out.names = [...names].slice(0, 60);
  return out;
}

async function probeRtdwc(win, extra, waitMs) {
  const out = { wxccPresent: false, rtdwcPresent: false };
  const wxcc = safeGet(win, 'wxcc');
  out.wxccPresent = !!wxcc;
  const rt = wxcc && safeGet(wxcc, 'rtdwc');
  out.rtdwcPresent = !!rt;
  if (!rt) return out;
  out.api = apiNames(rt);
  out.initError = rt.error ? errorText(rt.error) : null;
  if (typeof rt.getConnectionState === 'function') {
    try {
      out.connectionState = describeShape(await withTimeout(rt.getConnectionState(), 4000, 'getConnectionState'), 1, 'state');
    } catch (err) {
      out.connectionState = { error: errorText(err) };
    }
  }
  if (typeof rt.subscribe !== 'function') return out;

  out.catalog = datasetCatalog(rt);
  // Prefer Desktop's own dataset names; fall back to guesses only if none are found.
  const datasets = [...new Set([...extra, ...(out.catalog.names.length ? out.catalog.names : CANDIDATE_DATASETS)])].filter((n) => NAME_RE.test(n));
  const results = datasets.map((name) => ({ dataset: name, accepted: false, updates: 0, errors: 0, firstUpdate: null, firstError: null, closed: false }));
  const subs = await Promise.all(
    results.map(async (r) => {
      try {
        const sub = await withTimeout(
          rt.subscribe({
            datasetName: r.dataset,
            update: (data) => {
              r.updates += 1;
              if (!r.firstUpdate) r.firstUpdate = describeShape(data);
            },
            error: (err) => {
              r.errors += 1;
              if (!r.firstError) r.firstError = errorText(err);
            },
          }),
          5000,
          'subscribe',
        );
        r.accepted = true;
        return sub;
      } catch (err) {
        r.firstError = r.firstError || errorText(err);
        return null;
      }
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  subs.forEach((sub, i) => {
    results[i].closed = closeSubscription(sub);
  });
  out.results = results;
  out.datasetsWithData = results.filter((r) => r.updates > 0).map((r) => r.dataset);
  return out;
}

/**
 * Run the probe. Options: datasets (extra names to try), waitMs (how long to
 * listen, default 10 s). Resolves to the report and prints it as JSON.
 */
export async function runTeamProbe({ datasets = [], waitMs = 10000, win = globalThis, connect = connectDesktop, print = true } = {}) {
  const report = { probe: 'accessible-wxcc-widget team probe', version: PROBE_VERSION, at: new Date().toISOString() };
  let adapter = null;
  try {
    adapter = await connect(win);
    report.sdk = 'ok';
  } catch (err) {
    report.sdk = errorText(err);
  }
  if (adapter) report.buddyAgentsV2 = await probeBuddies(adapter);
  report.realTimeData = await probeRtdwc(win, datasets.map(String), waitMs);
  if (adapter) adapter.cleanup();
  if (print) console.info(`[accessible-wxcc-widget] Team probe report (contains no names, IDs or tokens; safe to share):\n${JSON.stringify(report, null, 2)}`);
  return report;
}
