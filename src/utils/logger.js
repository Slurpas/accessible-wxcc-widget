/**
 * Minimal logger.
 *
 * Privacy rule: callers must only pass short, non-sensitive messages
 * (event names, error messages, counts). Never pass ANI/DNIS, customer
 * names or whole SDK payloads. As a second line of defence, any object
 * argument is reduced to its type name before it is written.
 *
 * Inside Desktop the SDK logger is used, so logs end up in the normal
 * Desktop log collection that administrators already handle.
 */

const PREFIX = 'accessible-wxcc-widget';

let sink = {
  info: (...a) => console.info(`${PREFIX}:`, ...a),
  warn: (...a) => console.warn(`${PREFIX}:`, ...a),
  error: (...a) => console.error(`${PREFIX}:`, ...a),
};

/** Reduce arguments to safe primitives. Objects are never written. */
export function sanitize(args) {
  return args.map((a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (a === null || a === undefined) return String(a);
    if (typeof a === 'object') return `[${Array.isArray(a) ? 'array' : 'object'}]`;
    return a;
  });
}

export function setLogSink(next) {
  if (next && typeof next.info === 'function') sink = next;
}

export const log = {
  info: (...a) => sink.info(...sanitize(a)),
  warn: (...a) => sink.warn(...sanitize(a)),
  error: (...a) => sink.error(...sanitize(a)),
};

/** Turn any thrown value into a short human-readable reason. */
export function errorReason(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error && err.message) return err.message;
  const d = err.data || err.details || {};
  return d.reason || d.reasonCode || err.reason || err.message || 'Unknown error';
}
