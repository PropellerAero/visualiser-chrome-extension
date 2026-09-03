/**
 * Content-script entry for the design annotation overlay.
 *
 * Runs on the staging hosts only. Content scripts are exempt from the page's
 * CSP, which matters here: staging enforces `script-src 'strict-dynamic' https:`
 * and the existing `productionBanner.ts` content script already proves DOM
 * injection works under exactly that policy (production serves an identical
 * `script-src`).
 */

import { isArmed } from './core/branch';
import { DesignOverlay } from './ui/overlay';

declare global {
  interface Window {
    __prpDesignOverlay__?: DesignOverlay;
  }
}

function start(): void {
  // A SPA route change must not mount a second overlay.
  if (window.__prpDesignOverlay__) return;

  // Nothing is created without the arming param. The manifest already confines
  // this script to staging hosts; this narrows it further to links Ziggy
  // generated, so the tool never surfaces for someone who merely happens to be
  // on staging. Checked before construction so an unarmed page carries no DOM,
  // no listeners and no storage reads.
  if (!isArmed(window.location.search, window.sessionStorage)) return;

  window.__prpDesignOverlay__ = new DesignOverlay();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
