/**
 * Resolving a clicked element to something the agent can find in source.
 *
 * The primary anchor is `data-testid`. Those values are hardcoded in the
 * visualiser source and survive minification byte-identically, so the agent
 * resolves one to an exact file:line with a single ripgrep.
 *
 * Coverage measured on a live Visualiser measure screen (129 visible
 * interactive elements): 57.4% carry a testid themselves, 96.1% have one within
 * five ancestors, and 1.6% have none within ten. Hence MAX_ANCHOR_DEPTH = 5 --
 * it is where the curve flattens, not a guess.
 */

import type {
  Anchor,
  AnnotationTarget,
  BoundingBox,
  BuildContext,
  ClippingAncestor,
} from './types';

/** Five ancestors reaches 96.1% of visible interactive elements. */
export const MAX_ANCHOR_DEPTH = 5;

/** How far to look for an ancestor that could be clipping the target. */
const MAX_CLIP_DEPTH = 10;

const MAX_NEARBY_TEXT = 120;

/** Emotion generates these per build, so they are worthless to the agent. */
const EMOTION_CLASS = /^css-[a-z0-9]+/;

const TEST_ID = 'data-testid';

/**
 * Walk from `el` up to MAX_ANCHOR_DEPTH looking for a data-testid, recording
 * how far up it was found and the child route back down to `el`.
 */
export function resolveAnchor(el: Element): Anchor {
  let node: Element | null = el;
  let depth = 0;
  const hops: Element[] = [];

  while (node && depth <= MAX_ANCHOR_DEPTH) {
    const testId = node.getAttribute(TEST_ID);
    if (testId) {
      return { testId, depth, path: buildChildPath(hops) };
    }
    hops.push(node);
    node = node.parentElement;
    depth++;
  }

  return { testId: null, depth: -1, path: '' };
}

/**
 * The route from the anchor down to the target, e.g. `> div:nth-of-type(2) > span`.
 * `hops` is ordered target-first, so it is reversed here.
 */
function buildChildPath(hops: Element[]): string {
  if (hops.length === 0) return '';
  return hops
    .slice()
    .reverse()
    .map((node) => {
      const tag = node.tagName.toLowerCase();
      const index = nthOfType(node);
      return index === 1 ? `> ${tag}` : `> ${tag}:nth-of-type(${index})`;
    })
    .join(' ');
}

function nthOfType(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 1;
  let index = 1;
  for (const sibling of Array.from(parent.children)) {
    if (sibling === el) return index;
    if (sibling.tagName === el.tagName) index++;
  }
  return index;
}

/** Class names worth showing: emotion hashes dropped, semantic ones kept. */
export function semanticClassNames(el: Element): string[] {
  const raw = el.getAttribute('class');
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .filter((name) => name.length > 0 && !EMOTION_CLASS.test(name));
}

/**
 * The React component that rendered this element, and the props it was given.
 *
 * There is an asymmetry here worth stating, because it decides what can be
 * trusted where:
 *
 *  - The component NAME is an identifier, so Terser mangles it. It is only
 *    meaningful on a branch build (`isDistEnv` excludes `branch`, so branch
 *    bundles skip minification entirely).
 *  - The PROP names are object keys -- `<Slider value={x}/>` compiles to
 *    `createElement(Slider, { value: x })`. The webpack config passes Terser
 *    only `compress: { passes: 2 }`, so `mangle.properties` keeps its default
 *    of false and those keys survive. Props are therefore reliable on staging
 *    and production too.
 *
 * Props are what answer "what state was this control in" -- a slider's value
 * and range, a button's `disabled` and `variant` -- which is the difference
 * between "the handle looks wrong" and "the handle at value 0 looks wrong".
 */
export function reactInfo(el: Element): { name: string | null; props: Record<string, string> } {
  const key = Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  );
  if (!key) return { name: null, props: {} };

  let fiber = (el as unknown as Record<string, FiberNode | undefined>)[key];
  let guard = 0;

  while (fiber && guard < 30) {
    const type = fiber.type;
    if (typeof type === 'function') {
      const named = type as { displayName?: string; name?: string };
      const rawName = named.displayName || named.name;
      // Minified builds collapse names to one or two characters; treat those
      // as absent rather than reporting `t` as a component.
      const name = rawName && rawName.length > 2 ? rawName : null;
      return { name, props: filterProps(fiber.memoizedProps) };
    }
    fiber = fiber.return;
    guard++;
  }
  return { name: null, props: {} };
}

export function reactComponentName(el: Element): string | null {
  return reactInfo(el).name;
}

/** Props worth reporting: at most this many, to keep the comment readable. */
const MAX_PROPS = 12;
const MAX_PROP_LENGTH = 60;

/**
 * Props that are never useful and sometimes dangerous.
 *
 * Handlers and `children` are noise. `sx`/`style`/`className` duplicate what
 * the computed styles already say. The hard rule below it matters more: only
 * primitives are kept, because a prop can hold an entire dataset or customer
 * record and this payload ends up pasted into a public-ish PR comment.
 */
const SKIPPED_PROPS = new Set(['children', 'className', 'style', 'sx', 'ref', 'key', 'theme']);

export function filterProps(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, string> = {};

  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (SKIPPED_PROPS.has(name) || name.startsWith('on') || name.startsWith('aria-')) continue;
    if (name.startsWith('data-')) continue;

    // Objects, arrays and functions are dropped outright rather than
    // summarised: a shape hint is not worth the exposure risk.
    if (value === null) {
      out[name] = 'null';
      continue;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      out[name] = String(value);
      continue;
    }
    if (typeof value === 'string') {
      out[name] = value.length > MAX_PROP_LENGTH ? `${value.slice(0, MAX_PROP_LENGTH)}\u2026` : value;
    }
  }
  return out;
}

interface FiberNode {
  type?: unknown;
  return?: FiberNode;
  memoizedProps?: unknown;
}

/**
 * The nearest ancestor that actually scrolls, and how far it is scrolled.
 *
 * This is the app's real scroll position. `window.scrollY` is permanently 0
 * here -- the visualiser is a fixed-viewport app whose panels scroll
 * internally (`overflow-y: auto` in outputsSidebar, waypointsFlyPane,
 * TiledDetectionSidebar and others). Without this, a comment written after
 * scrolling a sidebar records viewport coordinates the agent cannot reproduce,
 * with no indication that scrolling happened at all.
 */
export function scrollContextOf(
  el: Element,
  getStyle: (e: Element) => CSSStyleDeclaration = window.getComputedStyle.bind(window),
): ScrollContext | null {
  let node: Element | null = el.parentElement;
  let depth = 0;

  while (node && depth < 15) {
    let style: CSSStyleDeclaration;
    try {
      style = getStyle(node);
    } catch {
      return null;
    }
    const scrollsY = ['auto', 'scroll'].includes(style.overflowY);
    const scrollsX = ['auto', 'scroll'].includes(style.overflowX);
    const overflowsY = node.scrollHeight > node.clientHeight + 1;
    const overflowsX = node.scrollWidth > node.clientWidth + 1;

    if ((scrollsY && overflowsY) || (scrollsX && overflowsX)) {
      return {
        selector: describeSelector(node),
        scrollTop: Math.round(node.scrollTop),
        scrollLeft: Math.round(node.scrollLeft),
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    }
    node = node.parentElement;
    depth++;
  }
  return null;
}

/** How far into which panel. */
export interface ScrollContext {
  selector: string;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Landmarks that name a region of the UI. */
const LANDMARK_ROLES = new Set([
  'navigation',
  'main',
  'complementary',
  'region',
  'banner',
  'contentinfo',
  'search',
  'form',
  'dialog',
]);
const LANDMARK_TAGS = new Set(['nav', 'main', 'aside', 'header', 'footer', 'form', 'dialog']);

/** Outermost-first, and capped: four hops is enough to say which panel. */
const MAX_REGION_HOPS = 4;

/**
 * Which part of the UI the element lives in.
 *
 * A `data-testid` says what was clicked; it does not say where. "This is in the
 * Outputs sidebar" is a different and often more useful fact, particularly when
 * the anchor resolved several ancestors up and the testid alone is ambiguous.
 */
export function regionPath(el: Element): string[] {
  const path: string[] = [];
  let node: Element | null = el.parentElement;
  let depth = 0;

  while (node && node !== document.body && depth < 25) {
    const role = node.getAttribute('role') ?? '';
    const tag = node.tagName.toLowerCase();
    const isLandmark = LANDMARK_ROLES.has(role) || LANDMARK_TAGS.has(tag);
    const testId = node.getAttribute(TEST_ID);

    if (isLandmark) {
      const label = node.getAttribute('aria-label');
      path.push(label ? `${role || tag}: ${label}` : role || tag);
    } else if (testId) {
      path.push(`[${testId}]`);
    }
    node = node.parentElement;
    depth++;
  }
  return path.reverse().slice(0, MAX_REGION_HOPS);
}

/**
 * Actual form-control values.
 *
 * `elementState` reads ARIA attributes, but MUI frequently does not set
 * `aria-checked` on a plain Checkbox, so a checkbox reported nothing at all.
 * These DOM properties are definitive and free to read. The target is often a
 * wrapper, so one descendant input is inspected too.
 */
export function formValues(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const control =
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
      ? el
      : el.querySelector('input, textarea, select');
  if (!control) return out;

  if (control instanceof HTMLInputElement) {
    if (control.type === 'checkbox' || control.type === 'radio') {
      out.checked = String(control.checked);
      if (control.indeterminate) out.indeterminate = 'true';
    } else if (control.value) {
      out.value = truncate(control.value);
    }
    if (control.type) out.inputType = control.type;
    return out;
  }
  if (control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
    if (control.value) out.value = truncate(control.value);
  }
  return out;
}

/**
 * The nearest ancestor whose layout properties could explain a visual defect.
 *
 * This exists because of a real case: on PR 19381 a slider thumb was clipped by
 * an ancestor MUI Card with `overflow: hidden`, and the agent had to deduce
 * that from four screenshots. Handing it over turns a deduction into a fact.
 */
export function findClippingAncestor(
  el: Element,
  getStyle: (e: Element) => CSSStyleDeclaration = window.getComputedStyle.bind(window),
): ClippingAncestor | null {
  let node = el.parentElement;
  let depth = 0;

  while (node && depth < MAX_CLIP_DEPTH && node !== document.body) {
    const style = getStyle(node);
    const reasons: string[] = [];

    const overflow = style.overflow;
    const overflowX = style.overflowX;
    const overflowY = style.overflowY;
    if (overflow && overflow !== 'visible') reasons.push(`overflow: ${overflow}`);
    else {
      if (overflowX && overflowX !== 'visible') reasons.push(`overflow-x: ${overflowX}`);
      if (overflowY && overflowY !== 'visible') reasons.push(`overflow-y: ${overflowY}`);
    }
    if (style.clipPath && style.clipPath !== 'none') reasons.push(`clip-path: ${style.clipPath}`);
    if (style.transform && style.transform !== 'none') reasons.push('transform (new containing block)');

    if (reasons.length > 0) {
      return { selector: describeSelector(node), reasons };
    }

    node = node.parentElement;
    depth++;
  }
  return null;
}

/** A short, readable descriptor for an element. */
export function describeSelector(el: Element): string {
  const testId = el.getAttribute(TEST_ID);
  if (testId) return `[data-testid="${testId}"]`;
  const semantic = semanticClassNames(el);
  if (semantic.length > 0) return `.${semantic[0]}`;
  return el.tagName.toLowerCase();
}

/**
 * The properties a designer actually complains about.
 *
 * This is not the `computedStyles` dump stock AFS suggests. A wall of two
 * hundred properties buries the two that matter and makes the PR comment
 * unreadable for the humans also on the thread. These eight cover the
 * overwhelming majority of design feedback -- colour, type, spacing, radius --
 * and turn "this should be 16px" into "this is 14px and should be 16px".
 */
const REPORTED_STYLE_PROPERTIES = [
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-family',
  'border-radius',
  'padding',
  'margin',
] as const;

export function reportedStyles(
  el: Element,
  getStyle: (e: Element) => CSSStyleDeclaration = window.getComputedStyle.bind(window),
): Record<string, string> {
  const out: Record<string, string> = {};
  let style: CSSStyleDeclaration;
  try {
    style = getStyle(el);
  } catch {
    return out;
  }
  for (const property of REPORTED_STYLE_PROPERTIES) {
    const value = style.getPropertyValue(property);
    // `font-family` comes back as the full stack; keep only the first face so
    // the row stays readable.
    if (!value) continue;
    out[property] = property === 'font-family' ? value.split(',')[0].trim() : value.trim();
  }
  return out;
}

/**
 * Interaction state, because the same element looks different disabled, open or
 * checked -- and a screenshot cannot say which of those it was.
 */
export function elementState(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const interesting = [
    'aria-disabled',
    'aria-expanded',
    'aria-checked',
    'aria-selected',
    'aria-label',
    'role',
    'title',
    'placeholder',
  ];
  for (const name of interesting) {
    const value = el.getAttribute(name);
    if (value) out[name] = value;
  }
  if ((el as HTMLInputElement).disabled) out.disabled = 'true';
  if (el.matches(':focus')) out.focused = 'true';
  return out;
}

/** Visible text in or immediately around the element, for human orientation. */
export function nearbyText(el: Element): string {
  const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (own.length > 0) return truncate(own);

  const parent = el.parentElement;
  if (!parent) return '';
  const around = (parent.textContent || '').replace(/\s+/g, ' ').trim();
  return truncate(around);
}

function truncate(text: string): string {
  return text.length <= MAX_NEARBY_TEXT ? text : `${text.slice(0, MAX_NEARBY_TEXT - 1)}\u2026`;
}

/**
 * Last-resort CSS path. Only used when no testid was within range, and always
 * reported as low confidence: MUI prefixes class names at runtime and emotion
 * hashes change between builds, so this can rot without warning.
 */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let guard = 0;

  while (node && node !== document.body && guard < 12) {
    const tag = node.tagName.toLowerCase();
    const index = nthOfType(node);
    parts.unshift(index === 1 ? tag : `${tag}:nth-of-type(${index})`);
    node = node.parentElement;
    guard++;
  }
  return `body > ${parts.join(' > ')}`;
}

export function boundingBoxOf(el: Element): BoundingBox {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** Assemble the full target descriptor for a clicked element. */
export function describeDomTarget(
  el: Element,
  build: BuildContext,
  clickPoint: { x: number; y: number },
): AnnotationTarget {
  const anchor = resolveAnchor(el);
  // One fiber walk for both, since they come from the same place.
  const react = reactInfo(el);

  return {
    anchor,
    tagName: el.tagName.toLowerCase(),
    classNames: semanticClassNames(el),
    // The name is mangled off a branch build; the props are not (see reactInfo).
    componentName: build.isBranchBuild ? react.name : null,
    componentNameReliable: build.isBranchBuild,
    props: react.props,
    nearbyText: nearbyText(el),
    boundingBox: boundingBoxOf(el),
    clickPoint,
    region: regionPath(el),
    scrollContext: scrollContextOf(el),
    clippingAncestor: findClippingAncestor(el),
    styles: reportedStyles(el),
    state: elementState(el),
    values: formValues(el),
    // Only pay the cost, and the rot risk, when there is no durable anchor.
    cssPath: anchor.testId === null ? cssPath(el) : null,
  };
}
