/**
 * Bundle entry point. Registers <accessible-wxcc-widget> once.
 * Desktop may load the script more than once (for example after a layout
 * change), so a second registration is skipped instead of throwing.
 */
import { AccessibleWxccWidget } from './widget.js';

export const ELEMENT_NAME = 'accessible-wxcc-widget';

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, AccessibleWxccWidget);
}

// Read-only diagnostic for administrators (DevTools console inside Desktop):
//   await accessibleWxccProbe()
// See src/diagnostics/team-probe.js. It changes nothing and reports no names.
if (typeof globalThis.accessibleWxccProbe === 'undefined') {
  globalThis.accessibleWxccProbe = (options) => import('./diagnostics/team-probe.js').then((m) => m.runTeamProbe(options));
}

export { AccessibleWxccWidget };
