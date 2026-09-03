/**
 * The annotation shape, derived from the Annotation Format Schema (AFS v1.1)
 * but narrowed to what this codebase can actually produce and what the Ziggy
 * agent can act on.
 *
 * Departures from stock AFS, each for a measured reason:
 *  - `elementPath` is demoted to a low-confidence fallback. MUI prefixes class
 *    names at runtime and emotion hashes are build-unstable, so a CSS path is
 *    not durable here. `anchor` (a source-committed data-testid) replaces it.
 *  - `reactComponents` carries a reliability flag, because component names are
 *    only unmangled on branch builds (APP_ENV=branch skips Terser).
 *  - `computedStyles` is narrowed to eight properties plus the single ancestor
 *    most likely to explain a layout complaint. A full dump buries the signal.
 *  - `x`/`y` as "% of viewport" / "px from document top" are dropped. This app
 *    is a fixed-viewport map, not a scrolling document.
 *  - `severity` is dropped: it asked the designer to grade their own feedback,
 *    which they cannot do on the agent's behalf, and `intent` already carries
 *    what changes the agent's response.
 *  - There is no separate 3D-canvas annotation kind. Cesium picking proved not
 *    to yield a usable identifier (0 entities, `scene.pick` empty at every
 *    sampled point), and the debug-mode dance it required was not worth the
 *    complexity. A click on the map is annotated as the canvas element it is,
 *    and `clickPoint` plus the camera state in the URL's `view=` parameter is
 *    what locates it.
 */

/** How the durable anchor was found relative to the annotated element. */
export interface Anchor {
  /** The source-committed `data-testid`, or null when none was in range. */
  testId: string | null;
  /** 0 when the element itself carries it; N when an Nth ancestor does. */
  depth: number;
  /**
   * Child route from the anchor element down to the target, e.g.
   * `> div:nth-of-type(2) > span`. Empty when depth is 0.
   */
  path: string;
}

/** The nearest ancestor whose layout properties could explain a visual defect. */
export interface ClippingAncestor {
  /** A short human-readable descriptor, e.g. `.MuiCard-root`. */
  selector: string;
  /** Only the properties that actually differ from the default. */
  reasons: string[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which bundle served the annotated element. */
export interface BuildContext {
  /** The docking-bay app path, e.g. `visualiser-dev`. */
  app: string | null;
  /** Branch name when this app came from a branch deploy, else null. */
  branch: string | null;
  /**
   * True when the loaded bundle is a branch build. Branch builds are not
   * minified, so React component names are trustworthy only when this is true.
   */
  isBranchBuild: boolean;
  /** Branch the URL claims, for mismatch detection. May be null. */
  urlClaimsBranch: string | null;
}

/**
 * What kind of feedback this is.
 *
 * These replaced AFS's `fix | change | question | approve`, which defined
 * neither `fix` nor `change` and so could not be explained to the designer
 * choosing between them.
 *
 * The line that actually matters to the agent is whether the feedback sits
 * inside what was already agreed: `action-review-comments` DECLINES any
 * comment contradicting an acceptance-criteria line (`declined-ac-conflict`)
 * rather than actioning it. So `new-idea` exists to make that visible up front
 * instead of surfacing as a refusal later.
 *
 * They are also phrased as observations rather than classifications. A designer
 * can see that something does not match the design; asking them to decide
 * whether it is "a bug or a feature request" invites the arbitrary split that
 * lets work be dismissed on a technicality.
 *
 * `approve` is deliberately absent. Per-element approval is noise as a tracked
 * item, and it collides with the thread-level `designConfirmation` gate that
 * holds the PR in draft -- a designer approving three elements could reasonably
 * believe they had approved the PR, and they would not have.
 */
export type AnnotationIntent = 'design-deviation' | 'bug' | 'new-idea' | 'question';

export type AnnotationStatus = 'draft' | 'shared';

export interface IntentMeta {
  label: string;
  gloss: string;
}

/**
 * Look up an intent's label safely.
 *
 * A direct `INTENT_META[intent]` index threw on a stored draft whose intent
 * predated this vocabulary, and took the whole panel down with it. Storage
 * normalises those on read, but this makes the render path unable to fail on a
 * value it does not recognise.
 */
export function intentMeta(intent: string): IntentMeta {
  return INTENT_META[intent as AnnotationIntent] ?? INTENT_META.question;
}

/** Label and the gloss the agent needs to know how to treat it. */
export const INTENT_META: Record<AnnotationIntent, IntentMeta> = {
  'design-deviation': {
    label: "Doesn't match design",
    gloss: 'the build deviates from the agreed design — the design is authoritative',
  },
  bug: {
    label: 'Bug',
    gloss: 'broken or visually broken regardless of what the design says',
  },
  'new-idea': {
    label: 'New idea',
    gloss:
      'goes beyond the agreed design and acceptance criteria, so it needs the ticket ' +
      'updated before it can be actioned',
  },
  question: {
    label: 'Question',
    gloss: 'answer it; do not change the code on the strength of this alone',
  },
};

export interface AnnotationTarget {
  anchor: Anchor;
  tagName: string;
  /** Semantic class names only; emotion hashes are stripped. */
  classNames: string[];
  componentName: string | null;
  /** False when the build is minified, so the name cannot be trusted. */
  componentNameReliable: boolean;
  /**
   * React props of the component that rendered this element.
   *
   * Trustworthy on every build, unlike `componentName`: prop names are object
   * keys and Terser is not configured to mangle properties. Filtered to
   * primitives, because a prop can hold a whole dataset and this ends up in a
   * PR comment.
   */
  props: Record<string, string>;
  nearbyText: string;
  boundingBox: BoundingBox;
  /**
   * Viewport point the designer clicked.
   *
   * Load-bearing for large targets. A click on the 3D map resolves to the
   * whole <canvas>, whose box is the entire viewport -- so a pin placed at the
   * box centre lands nowhere near what was meant. This is where they pointed.
   */
  clickPoint: { x: number; y: number };
  /** Which part of the UI this lives in, outermost first. */
  region: string[];
  /**
   * The panel that was scrolled, and how far.
   *
   * `page.scroll` is always 0 here -- the app is fixed-viewport and its panels
   * scroll internally -- so without this a comment written after scrolling
   * records coordinates nobody can reproduce.
   */
  scrollContext: ScrollContextSnapshot | null;
  clippingAncestor: ClippingAncestor | null;
  /** The eight properties design feedback is usually about. */
  styles: Record<string, string>;
  /** Interaction state a screenshot cannot convey (disabled, expanded, ...). */
  state: Record<string, string>;
  /** Actual form-control values; ARIA alone misses MUI checkboxes. */
  values: Record<string, string>;
  /** Low-confidence fallback, only populated when no testid was in range. */
  cssPath: string | null;
}

export interface Annotation {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: AnnotationStatus;

  /** The designer's own words. There is no separate summary field. */
  body: string;
  intent: AnnotationIntent;

  target: AnnotationTarget;

  /**
   * The Figma frame being compared against, when the designer supplied one.
   *
   * This is the other half of the comparison the designer is actually doing,
   * and Ziggy already resolves `figma` references through its design-context
   * subagent -- so a URL here connects the feedback to its authoritative
   * source instead of leaving the agent to guess which frame was meant.
   */
  figmaUrl: string | null;

  /** Page state, so the agent can reproduce what was on screen. */
  build: BuildContext;
  /** Serialised from core/context.ts at annotation time. */
  page: PageContextSnapshot;
  /** Transient app state the URL does not encode (open dialogs, active tab). */
  appState: AppStateSnapshot;
}

/**
 * The state the URL cannot carry.
 *
 * A designer often has to open a dialog or switch a tab to expose the defect.
 * The route survives in the URL; that state does not, so the agent lands on the
 * page and sees something else. This does not reproduce the state, but it tells
 * the agent what to reproduce.
 */
export interface ScrollContextSnapshot {
  selector: string;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface AppStateSnapshot {
  /** Accessible names of any open dialogs. */
  dialogs: string[];
  /** Open sidebars and drawers; MUI drawers carry no dialog role. */
  drawers: string[];
  /** Expanded accordions, which are often why an element was visible. */
  expanded: string[];
  /** The selected tab, when the view has tabs. */
  activeTab: string | null;
  /** Document title, which the visualiser sets per site/view. */
  documentTitle: string;
}

/**
 * There is no screenshot.
 *
 * It went through two shapes before being dropped. A crop per comment meant
 * copying and pasting an image per finding, because the clipboard holds one
 * image at a time. One shot of the whole page with the pins visible fixed that
 * but still needed a second click and paste, because GitHub strips `data:` URI
 * images and a clipboard holding both text and an image resolves to the image.
 * Nothing that cannot ride along in the single "Share with Ziggy" copy ships,
 * so the URL -- branch bundle, flag overrides, camera state -- is what lets a
 * reader see the same thing.
 */

/**
 * Structural copy of `core/context.ts`'s PageContext, declared here so the
 * stored annotation shape has one home.
 */
export interface PageContextSnapshot {
  url: string;
  viewport: { w: number; h: number; dpr: number; zoom: number };
  scroll: { x: number; y: number };
  /** The OS preference, which can disagree with what the app rendered. */
  colorScheme: 'light' | 'dark' | 'unknown';
  /** The app's own mode, inferred from the rendered background. */
  themeMode: 'light' | 'dark' | 'unknown';
  language: string;
  userAgent: string;
  flags: {
    overrides: Record<string, string>;
    cached: Record<string, string | number | boolean>;
    cacheUnavailable: boolean;
  };
}
