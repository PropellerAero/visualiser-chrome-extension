/**
 * The page state an agent needs to recreate what the designer was looking at.
 *
 * Chosen by working backwards from the ways design feedback goes wrong when the
 * agent cannot reproduce the view:
 *
 *  - "it looks fine to me" -> different feature flags, viewport, zoom, or
 *    colour scheme. All captured here.
 *  - "which of the three sliders" -> the anchor, captured in anchor.ts.
 *  - "this should be 16px" -> the agent needs to know what it currently IS,
 *    so a small set of computed styles rides along with the target.
 *  - "the label is cut off" -> text length is locale-dependent, so language is
 *    captured too. The visualiser ships message catalogues per locale.
 *
 * Deliberately NOT captured, and why:
 *  - The full LaunchDarkly flag set. The visualiser reads flags through
 *    `getVisFeatureFlagValue` behind a module-level cache that is not exposed
 *    on `window`, so there is no honest way to enumerate every flag from the
 *    page. What IS available is read below, and the gap is stated rather than
 *    papered over with a guess.
 *  - Unit preferences (metric/imperial), which change label widths. They live
 *    in app state with no documented global. Worth adding via a small hook in
 *    the visualiser later.
 */

import type { AppStateSnapshot } from './types';

/** Prefix mothership reads for per-flag overrides on the visualiser. */
export const FLAG_PARAM_PREFIX = 'test-visualiser-ff__';

export interface FeatureFlagState {
  /** Flags explicitly overridden on the URL. Authoritative and exact. */
  overrides: Record<string, string>;
  /**
   * Flags read from the LaunchDarkly SDK's own localStorage cache. Best-effort:
   * the key layout is the SDK's private business, so this is corroborating
   * evidence, not a contract.
   */
  cached: Record<string, string | number | boolean>;
  /** True when the cache could not be read, so the reader knows it is absent. */
  cacheUnavailable: boolean;
}

export interface PageContext {
  url: string;
  viewport: { w: number; h: number; dpr: number; zoom: number };
  scroll: { x: number; y: number };
  colorScheme: 'light' | 'dark' | 'unknown';
  themeMode: 'light' | 'dark' | 'unknown';
  language: string;
  userAgent: string;
  flags: FeatureFlagState;
}

/** Flag overrides from the query string. Exact, and the ones that matter most. */
export function readFlagOverrides(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const [key, value] of new URLSearchParams(search)) {
      if (key.startsWith(FLAG_PARAM_PREFIX)) {
        out[key.slice(FLAG_PARAM_PREFIX.length)] = value;
      }
    }
  } catch {
    // A malformed query string costs us the overrides, not the annotation.
  }
  return out;
}

/**
 * Read whatever the LaunchDarkly SDK has cached locally.
 *
 * The SDK stores evaluated flags under keys beginning `ld:`. Shape is version-
 * dependent, so every access is defensive and any failure degrades to "cache
 * unavailable" rather than throwing inside an annotation.
 */
export function readCachedFlags(storage: Storage): {
  cached: Record<string, string | number | boolean>;
  cacheUnavailable: boolean;
} {
  const cached: Record<string, string | number | boolean> = {};
  let keys: string[];
  try {
    keys = Object.keys(storage).filter((k) => k.startsWith('ld:'));
  } catch {
    return { cached, cacheUnavailable: true };
  }

  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) continue;
      for (const [flag, entry] of Object.entries(parsed as Record<string, unknown>)) {
        const value = extractFlagValue(entry);
        if (value !== undefined) cached[flag] = value;
      }
    } catch {
      // Skip an unparseable entry; a partial read is still useful.
    }
  }
  return { cached, cacheUnavailable: false };
}

/** The SDK stores either a bare value or `{ value: ... }` depending on version. */
function extractFlagValue(entry: unknown): string | number | boolean | undefined {
  if (typeof entry === 'boolean' || typeof entry === 'number' || typeof entry === 'string') {
    return entry;
  }
  if (typeof entry === 'object' && entry !== null && 'value' in entry) {
    const value = (entry as { value: unknown }).value;
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

/**
 * Browser zoom, as a percentage.
 *
 * A designer reviewing at 90% sees a different layout from one at 100%, and it
 * is invisible in a screenshot. `outerWidth / innerWidth` is the only signal
 * available to a page; it is approximate and rounded to 5% to avoid reporting
 * false precision.
 */
export function estimateZoom(outerWidth: number, innerWidth: number): number {
  if (!innerWidth || !outerWidth) return 100;
  return Math.round((outerWidth / innerWidth) * 20) * 5;
}

export function capturePageContext(): PageContext {
  const overrides = readFlagOverrides(window.location.search);
  const { cached, cacheUnavailable } = readCachedFlags(window.localStorage);

  return {
    url: window.location.href,
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
      zoom: estimateZoom(window.outerWidth, window.innerWidth),
    },
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    colorScheme: detectColorScheme(),
    themeMode: inferThemeMode(),
    language: navigator.language,
    userAgent: navigator.userAgent,
    flags: { overrides, cached, cacheUnavailable },
  };
}

/**
 * Capture the state the URL does not encode.
 *
 * Takes a Document so it is testable without a browser. Every read is
 * defensive: a missing accessible name costs a row, never the annotation.
 */
export function captureAppState(doc: Document = document): AppStateSnapshot {
  return {
    dialogs: openDialogNames(doc),
    drawers: openDrawerNames(doc),
    expanded: expandedSectionNames(doc),
    activeTab: selectedTabName(doc),
    documentTitle: doc.title,
  };
}

/**
 * Open sidebars and drawers.
 *
 * Separate from `dialogs` because MUI's `<Drawer>` in its `permanent` and
 * `persistent` variants carries NO dialog role -- so an open sidebar was
 * invisible to the dialog query, even though the visualiser uses `<Drawer>`
 * (DashboardWidgetEditorDrawer among others). An open sidebar changes the
 * layout the designer was looking at, so it has to be recorded.
 */
function openDrawerNames(doc: Document): string[] {
  const names = new Set<string>();
  let nodes: Element[];
  try {
    nodes = Array.from(
      doc.querySelectorAll('.MuiDrawer-root, [class*="Drawer"], aside, [role="complementary"]'),
    );
  } catch {
    return [];
  }
  for (const node of nodes) {
    if (!isVisible(node)) continue;
    const name = accessibleName(node, doc) ?? node.getAttribute('data-testid');
    if (name) names.add(clip(name));
  }
  return Array.from(names).slice(0, 6);
}

/**
 * Expanded accordions and disclosure sections.
 *
 * `aria-expanded="true"` is the one signal MUI sets consistently for these, and
 * which section was open is often why an element was visible at all.
 */
function expandedSectionNames(doc: Document): string[] {
  const names = new Set<string>();
  try {
    for (const node of Array.from(doc.querySelectorAll('[aria-expanded="true"]'))) {
      if (!isVisible(node)) continue;
      const label =
        node.getAttribute('aria-label') ??
        (node.textContent || '').replace(/\s+/g, ' ').trim() ??
        null;
      if (label) names.add(clip(label));
    }
  } catch {
    return [];
  }
  return Array.from(names).slice(0, 8);
}

function isVisible(node: Element): boolean {
  if (node.getAttribute('aria-hidden') === 'true') return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * The app's own light/dark mode, inferred from the rendered background.
 *
 * Distinct from `colorScheme`, which is the OS preference and can disagree with
 * what the app actually rendered. The visualiser exposes no `data-theme` or
 * `data-mui-color-scheme` attribute to read, so the background luminance is the
 * only signal available from the page.
 */
export function inferThemeMode(
  doc: Document = document,
  getStyle: (e: Element) => CSSStyleDeclaration = window.getComputedStyle.bind(window),
): 'light' | 'dark' | 'unknown' {
  const target = doc.body ?? doc.documentElement;
  if (!target) return 'unknown';
  try {
    return luminanceOf(getStyle(target).backgroundColor);
  } catch {
    return 'unknown';
  }
}

/** Rec. 709 luma, which is close enough to decide light from dark. */
export function luminanceOf(color: string): 'light' | 'dark' | 'unknown' {
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(color);
  if (!match) return 'unknown';
  // A fully transparent background tells us nothing about the theme.
  if (match[4] !== undefined && Number(match[4]) === 0) return 'unknown';
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light';
}

function openDialogNames(doc: Document): string[] {
  const names: string[] = [];
  let nodes: Element[];
  try {
    nodes = Array.from(doc.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]'));
  } catch {
    return names;
  }
  for (const node of nodes) {
    // A closed MUI dialog is often still in the DOM but hidden, so an
    // unfiltered query would report dialogs nobody can see.
    if (node.getAttribute('aria-hidden') === 'true') continue;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const name = accessibleName(node, doc);
    if (name) names.push(name);
  }
  return names;
}

function selectedTabName(doc: Document): string | null {
  try {
    const tab = doc.querySelector('[role="tab"][aria-selected="true"]');
    if (!tab) return null;
    return clip((tab.textContent || '').replace(/\s+/g, ' ').trim()) || null;
  } catch {
    return null;
  }
}

/** aria-label, then aria-labelledby, then a heading inside, then nothing. */
function accessibleName(node: Element, doc: Document): string | null {
  const label = node.getAttribute('aria-label');
  if (label) return clip(label);

  const labelledBy = node.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = doc.getElementById(labelledBy);
    const text = (target?.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return clip(text);
  }

  const heading = node.querySelector('h1, h2, h3, h4, [role="heading"]');
  const text = (heading?.textContent || '').replace(/\s+/g, ' ').trim();
  return text ? clip(text) : null;
}

function clip(text: string): string {
  return text.length > 80 ? `${text.slice(0, 79)}\u2026` : text;
}

function detectColorScheme(): 'light' | 'dark' | 'unknown' {
  try {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // matchMedia is absent in some embedded contexts.
  }
  return 'unknown';
}
