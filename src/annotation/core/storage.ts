/**
 * Draft storage.
 *
 * Drafts and the "shared with Ziggy" marker live here; the pull request is the
 * source of truth for anything submitted. That split is deliberate -- a second
 * durable store for feedback status would drift against the PR's own reactions,
 * which is the state the designer and the agent both already read.
 *
 * Keyed by branch so a designer can hold drafts on several pull requests at
 * once without them bleeding together.
 */

import { INTENT_META } from './types';
import type {
  Annotation,
  AnnotationIntent,
  AppStateSnapshot,
  BoundingBox,
  BuildContext,
  PageContextSnapshot,
  ScrollContextSnapshot,
} from './types';

const KEY_PREFIX = 'annotations:';

/** Kept behind an interface so the core never imports the chrome namespace. */
export interface StorageAdapter {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export function keyForBranch(branch: string): string {
  return `${KEY_PREFIX}${branch}`;
}

export async function loadAnnotations(
  adapter: StorageAdapter,
  branch: string,
): Promise<Annotation[]> {
  const raw = await adapter.get(keyForBranch(branch));
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map(normaliseAnnotation)
    .filter((a): a is Annotation => a !== null);
}

/**
 * Legacy intents, mapped forward.
 *
 * The kinds changed from AFS's undefined `fix | change | question | approve` to
 * the current four, and drafts saved under the old names are still on disk.
 *
 * `approve` and anything unrecognised map to `question`, which is the only safe
 * default: its gloss tells the agent to answer rather than change code. Mapping
 * an old approval onto `design-deviation` would send Ziggy to "fix" something
 * the designer had explicitly signed off.
 */
const LEGACY_INTENTS: Record<string, AnnotationIntent> = {
  fix: 'design-deviation',
  change: 'new-idea',
  question: 'question',
  approve: 'question',
};

/**
 * Coerce a stored record into the current shape, or reject it.
 *
 * This exists because the schema moved under data that was already saved:
 * `clickPoint`, `figmaUrl` and `appState` were added later, `title` and
 * `severity` were removed, and the intent vocabulary changed. Without this the
 * overlay read a stale draft and threw on first render -- reading `.x` of an
 * absent `clickPoint`, and `.label` of an absent intent -- which took out the
 * whole panel rather than degrading.
 *
 * Never throws. A record it cannot salvage is dropped; one it can is repaired,
 * because the designer's words are the part worth keeping.
 */
export function normaliseAnnotation(raw: unknown): Annotation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const id = record.id;
  const target = record.target;
  if (typeof id !== 'string' || typeof target !== 'object' || target === null) return null;

  // Older drafts kept the text in `title`; newer ones in `body`.
  const body =
    typeof record.body === 'string' && record.body.trim()
      ? record.body
      : typeof record.title === 'string'
        ? record.title
        : '';
  if (!body.trim()) return null;

  const targetRecord = target as Record<string, unknown>;
  const box = normaliseBox(targetRecord.boundingBox);
  if (!box) return null;

  const rawIntent = typeof record.intent === 'string' ? record.intent : '';
  const intent: AnnotationIntent =
    rawIntent in INTENT_META
      ? (rawIntent as AnnotationIntent)
      : (LEGACY_INTENTS[rawIntent] ?? 'question');

  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();

  return {
    id,
    createdAt,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : createdAt,
    status: record.status === 'shared' ? 'shared' : 'draft',
    body,
    intent,
    figmaUrl: typeof record.figmaUrl === 'string' && record.figmaUrl ? record.figmaUrl : null,
    target: {
      anchor: normaliseAnchor(targetRecord.anchor),
      tagName: typeof targetRecord.tagName === 'string' ? targetRecord.tagName : 'unknown',
      classNames: stringArray(targetRecord.classNames),
      componentName:
        typeof targetRecord.componentName === 'string' ? targetRecord.componentName : null,
      componentNameReliable: targetRecord.componentNameReliable === true,
      props: stringRecord(targetRecord.props),
      nearbyText: typeof targetRecord.nearbyText === 'string' ? targetRecord.nearbyText : '',
      boundingBox: box,
      // Pre-clickPoint drafts get the box centre, which is exactly where their
      // pins used to be drawn, so nothing visibly moves.
      clickPoint: normalisePoint(targetRecord.clickPoint) ?? {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y),
      },
      region: stringArray(targetRecord.region),
      scrollContext: normaliseScroll(targetRecord.scrollContext),
      clippingAncestor: normaliseClipping(targetRecord.clippingAncestor),
      styles: stringRecord(targetRecord.styles),
      state: stringRecord(targetRecord.state),
      values: stringRecord(targetRecord.values),
      cssPath: typeof targetRecord.cssPath === 'string' ? targetRecord.cssPath : null,
    },
    build: normaliseBuild(record.build),
    page: normalisePage(record.page),
    appState: normaliseAppState(record.appState),
  };
}

function normaliseBox(value: unknown): BoundingBox | null {
  if (typeof value !== 'object' || value === null) return null;
  const box = value as Record<string, unknown>;
  const nums = ['x', 'y', 'width', 'height'].map((k) => box[k]);
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, width, height] = nums as number[];
  return { x, y, width, height };
}

function normalisePoint(value: unknown): { x: number; y: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y };
}

function normaliseAnchor(value: unknown): Annotation['target']['anchor'] {
  const fallback = { testId: null, depth: -1, path: '' };
  if (typeof value !== 'object' || value === null) return fallback;
  const anchor = value as Record<string, unknown>;
  return {
    testId: typeof anchor.testId === 'string' && anchor.testId ? anchor.testId : null,
    depth: typeof anchor.depth === 'number' ? anchor.depth : -1,
    path: typeof anchor.path === 'string' ? anchor.path : '',
  };
}

function normaliseScroll(value: unknown): ScrollContextSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const scroll = value as Record<string, unknown>;
  if (typeof scroll.selector !== 'string') return null;
  return {
    selector: scroll.selector,
    scrollTop: numberOr(scroll.scrollTop, 0),
    scrollLeft: numberOr(scroll.scrollLeft, 0),
    scrollHeight: numberOr(scroll.scrollHeight, 0),
    clientHeight: numberOr(scroll.clientHeight, 0),
  };
}

function normaliseClipping(value: unknown): Annotation['target']['clippingAncestor'] {
  if (typeof value !== 'object' || value === null) return null;
  const clip = value as Record<string, unknown>;
  if (typeof clip.selector !== 'string') return null;
  return { selector: clip.selector, reasons: stringArray(clip.reasons) };
}

function normaliseBuild(value: unknown): BuildContext {
  const fallback: BuildContext = {
    app: null,
    branch: null,
    isBranchBuild: false,
    urlClaimsBranch: null,
  };
  if (typeof value !== 'object' || value === null) return fallback;
  const build = value as Record<string, unknown>;
  return {
    app: typeof build.app === 'string' ? build.app : null,
    branch: typeof build.branch === 'string' ? build.branch : null,
    isBranchBuild: build.isBranchBuild === true,
    urlClaimsBranch: typeof build.urlClaimsBranch === 'string' ? build.urlClaimsBranch : null,
  };
}

function normalisePage(value: unknown): PageContextSnapshot {
  const page = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const viewport = (
    typeof page.viewport === 'object' && page.viewport !== null ? page.viewport : {}
  ) as Record<string, unknown>;
  const scroll = (
    typeof page.scroll === 'object' && page.scroll !== null ? page.scroll : {}
  ) as Record<string, unknown>;
  const flags = (typeof page.flags === 'object' && page.flags !== null ? page.flags : {}) as Record<
    string,
    unknown
  >;

  return {
    url: typeof page.url === 'string' ? page.url : '',
    viewport: {
      w: numberOr(viewport.w, 0),
      h: numberOr(viewport.h, 0),
      dpr: numberOr(viewport.dpr, 1),
      zoom: numberOr(viewport.zoom, 100),
    },
    scroll: { x: numberOr(scroll.x, 0), y: numberOr(scroll.y, 0) },
    colorScheme:
      page.colorScheme === 'light' || page.colorScheme === 'dark' ? page.colorScheme : 'unknown',
    themeMode:
      page.themeMode === 'light' || page.themeMode === 'dark' ? page.themeMode : 'unknown',
    language: typeof page.language === 'string' ? page.language : '',
    userAgent: typeof page.userAgent === 'string' ? page.userAgent : '',
    flags: {
      overrides: stringRecord(flags.overrides),
      cached: primitiveRecord(flags.cached),
      cacheUnavailable: flags.cacheUnavailable === true,
    },
  };
}

function normaliseAppState(value: unknown): AppStateSnapshot {
  if (typeof value !== 'object' || value === null) {
    return { dialogs: [], drawers: [], expanded: [], activeTab: null, documentTitle: '' };
  }
  const state = value as Record<string, unknown>;
  return {
    dialogs: stringArray(state.dialogs),
    drawers: stringArray(state.drawers),
    expanded: stringArray(state.expanded),
    activeTab: typeof state.activeTab === 'string' ? state.activeTab : null,
    documentTitle: typeof state.documentTitle === 'string' ? state.documentTitle : '',
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter((v): v is string => typeof v === 'string');
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function primitiveRecord(value: unknown): Record<string, string | number | boolean> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      out[key] = item;
    }
  }
  return out;
}

export async function saveAnnotations(
  adapter: StorageAdapter,
  branch: string,
  annotations: Annotation[],
): Promise<void> {
  await adapter.set(keyForBranch(branch), annotations);
}

export async function upsertAnnotation(
  adapter: StorageAdapter,
  branch: string,
  annotation: Annotation,
): Promise<Annotation[]> {
  const existing = await loadAnnotations(adapter, branch);
  const index = existing.findIndex((a) => a.id === annotation.id);
  const next = existing.slice();
  if (index >= 0) next[index] = annotation;
  else next.push(annotation);
  await saveAnnotations(adapter, branch, next);
  return next;
}

export async function removeAnnotation(
  adapter: StorageAdapter,
  branch: string,
  id: string,
): Promise<Annotation[]> {
  const existing = await loadAnnotations(adapter, branch);
  const next = existing.filter((a) => a.id !== id);
  await saveAnnotations(adapter, branch, next);
  return next;
}

/**
 * Only `draft` annotations are editable. Once shared, the PR comment is the
 * record, and letting the local copy drift from it would make the overlay lie.
 */
export function isEditable(annotation: Annotation): boolean {
  return annotation.status === 'draft';
}

/** Backed by chrome.storage.local (10 MB quota, ample for cropped JPEGs). */
export function chromeStorageAdapter(): StorageAdapter {
  return {
    async get(key) {
      const result = await chrome.storage.local.get(key);
      return result[key];
    },
    async set(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}

/** In-memory adapter for tests and for a page context without chrome APIs. */
export function memoryAdapter(seed: Record<string, unknown> = {}): StorageAdapter {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
  };
}
