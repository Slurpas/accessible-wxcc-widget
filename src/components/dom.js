/**
 * Small DOM helper. All dynamic text is set with textContent (never parsed
 * as HTML markup), so names and numbers from Webex can never inject markup.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Set text only when it changed, to avoid needless screen-reader churn. */
export function setText(el, text) {
  const t = text === undefined || text === null ? '' : String(text);
  if (el.textContent !== t) el.textContent = t;
}

export function formatTime(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
