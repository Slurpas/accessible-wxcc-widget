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

export { AccessibleWxccWidget };
