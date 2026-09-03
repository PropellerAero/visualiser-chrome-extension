/**
 * Turning annotations into the PR comment that Ziggy reads.
 *
 * This is the entire contract with the agent -- nothing on the agent side
 * parses it, so the comment is consumed as prose and must be self-explanatory
 * to a reader who has never seen the format.
 *
 * NO IMAGE AT ALL. Two findings closed that door. GitHub sanitises `data:` URI
 * images out of comments -- verified against its own renderer, which returns
 * `<img alt="shot">` with the src stripped. And a clipboard carrying both
 * `text/plain` and `image/png` is resolved to one of them on paste -- the image
 * -- so bundling both would silently drop the comments. Anything that cannot
 * ride along in the single copy does not ship; the link carries the context
 * instead.
 *
 * A NOTE ON BUNDLING. All comments are exported as one document, which is what
 * a designer wants to paste once. The cost is that `post_review_reply.py` in
 * the agent hard-codes MAX_REPLY_CHARS = 500, so one pasted comment gets one
 * 500-character reply covering every item in it, and the eyes/thumbs reaction
 * lifecycle is per comment rather than per finding. Pasting the sections as
 * separate comments restores per-item replies at the cost of more pasting.
 */

import { intentMeta } from './types';
import type { Annotation, PageContextSnapshot } from './types';

/**
 * Version of the overlay that produced a comment.
 *
 * Stamped into the export so a reader -- human or agent -- can tell which
 * format a comment came from. The payload has already changed shape several
 * times (screenshots added then removed, intents renamed, six context fields
 * added), and without a version an older comment is indistinguishable from a
 * newer one that is simply missing data.
 *
 * Independent of the extension's own `manifest.json` version, because this is
 * an experimental feature inside a shared extension and the two move at
 * different rates. Bump the minor when the exported format changes.
 */
export const OVERLAY_VERSION = '0.1.0';

export function toMarkdown(annotation: Annotation, index?: number): string {
  const lines: string[] = [];
  const heading = index === undefined ? '### Comment' : `### ${index}. ${labelFor(annotation)}`;

  lines.push(heading);
  lines.push('');
  lines.push(annotation.body.trim());
  lines.push('');
  lines.push('<details><summary>Element details</summary>');
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | --- |');
  for (const [label, value] of targetRows(annotation)) {
    lines.push(`| ${label} | ${value} |`);
  }
  lines.push('');
  lines.push('</details>');

  return lines.join('\n');
}

/**
 * Export every comment as one titled document.
 *
 * The title matters: without it the paste reads as an unexplained table dump,
 * and neither the agent nor the humans on the thread know where it came from.
 */
export function toSharedMarkdown(annotations: Annotation[]): string {
  if (annotations.length === 0) return '';

  const first = annotations[0];
  const count = annotations.length;
  const lines: string[] = [];

  lines.push(`## Design feedback (${count} ${count === 1 ? 'comment' : 'comments'})`);
  lines.push('');
  lines.push(
    `Captured with the design overlay v${OVERLAY_VERSION} on the branch ` +
      'deploy. Each comment is anchored to a `data-testid` you can grep for ' +
      'in the source.',
  );
  lines.push('');
  // No screenshot rides along. GitHub strips `data:` URI images from comments
  // (verified against its own renderer), and a clipboard carrying both text and
  // an image is resolved to one of them on paste -- the image -- which would
  // silently drop these comments. So the link is the way to see what was seen:
  // it carries the branch bundle, the flag overrides and, on the 3D map, the
  // camera position in the `view=` parameter.
  lines.push(
    `**To see this yourself:** open the link in the page context below. It ` +
      `restores the same branch build, feature flags and view.`,
  );
  lines.push('');

  annotations.forEach((annotation, i) => {
    lines.push(toMarkdown(annotation, i + 1));
    lines.push('');
  });

  lines.push('<details><summary>Page context (applies to all comments)</summary>');
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | --- |');
  for (const [label, value] of pageRows(first)) {
    lines.push(`| ${label} | ${value} |`);
  }
  lines.push('');
  lines.push('</details>');

  return lines.join('\n');
}

/** A short label for lists and headings, derived from the body. */
export function labelFor(annotation: Annotation): string {
  const firstLine = annotation.body.trim().split('\n')[0].trim();
  const clipped = firstLine.length > 72 ? `${firstLine.slice(0, 71)}\u2026` : firstLine;
  return clipped || 'Comment';
}

function targetRows(annotation: Annotation): Array<[string, string]> {
  const target = annotation.target;
  const rows: Array<[string, string]> = [];

  // The gloss rides along because the label alone does not tell the agent how
  // to treat it -- in particular that a "New idea" will collide with the
  // acceptance criteria and needs the ticket changed first.
  const intent = intentMeta(annotation.intent);
  rows.push(['kind', `**${intent.label}** — ${intent.gloss}`]);

  if (annotation.figmaUrl) {
    rows.push(['design', annotation.figmaUrl]);
  }

  if (target.anchor.testId) {
    const where = target.anchor.depth === 0 ? 'self' : `ancestor, depth ${target.anchor.depth}`;
    rows.push(['anchor', `${code(`data-testid="${target.anchor.testId}"`)} (${where})`]);
    if (target.anchor.path) rows.push(['path from anchor', code(target.anchor.path)]);
  } else {
    // Say so plainly rather than quietly degrading -- the agent should know the
    // anchor is weak before it trusts the selector.
    rows.push(['anchor', 'none found within 5 ancestors — selector below is low confidence']);
    if (target.cssPath) rows.push(['css path (unstable)', code(target.cssPath)]);
  }

  const element = target.classNames.length
    ? `${target.tagName}.${target.classNames.join('.')}`
    : target.tagName;
  rows.push(['element', code(element)]);

  if (target.componentName && target.componentNameReliable) {
    rows.push(['component', code(target.componentName)]);
  }

  // Props are reliable on every build (object keys are not mangled), which is
  // why they appear even when the component name is suppressed. They are what
  // turn "the handle looks wrong" into "the handle at value 0 looks wrong".
  const props = Object.entries(target.props);
  if (props.length) {
    rows.push(['props', props.map(([k, v]) => `${k}=${escapePipes(v)}`).join('; ')]);
  }

  if (target.region.length) {
    rows.push(['in', target.region.map(escapePipes).join(' \u203a ')]);
  }

  if (target.nearbyText) rows.push(['near text', `"${escapePipes(target.nearbyText)}"`]);

  const box = target.boundingBox;
  rows.push(['box', `${box.width}x${box.height} at (${box.x}, ${box.y})`]);
  rows.push(['clicked at', `(${target.clickPoint.x}, ${target.clickPoint.y}) in the viewport`]);

  const styles = Object.entries(target.styles);
  if (styles.length) {
    rows.push([
      'current styles',
      styles.map(([k, v]) => `${k}: ${escapePipes(v)}`).join('; '),
    ]);
  }

  const state = Object.entries(target.state);
  if (state.length) {
    rows.push(['state', state.map(([k, v]) => `${k}=${escapePipes(v)}`).join('; ')]);
  }

  const values = Object.entries(target.values);
  if (values.length) {
    rows.push(['control value', values.map(([k, v]) => `${k}=${escapePipes(v)}`).join('; ')]);
  }

  // The app's real scroll position. Without it the box and click point above
  // are coordinates the agent cannot reproduce.
  if (target.scrollContext) {
    const scroll = target.scrollContext;
    rows.push([
      'scrolled',
      `${code(scroll.selector)} at ${scroll.scrollTop}px of ` +
        `${Math.max(0, scroll.scrollHeight - scroll.clientHeight)}px`,
    ]);
  }

  if (target.clippingAncestor) {
    rows.push([
      'clipping ancestor',
      `${code(target.clippingAncestor.selector)} — ${escapePipes(
        target.clippingAncestor.reasons.join(', '),
      )}`,
    ]);
  }

  return rows;
}

function pageRows(annotation: Annotation): Array<[string, string]> {
  const page: PageContextSnapshot = annotation.page;
  const build = annotation.build;
  const rows: Array<[string, string]> = [];

  if (build.branch) rows.push(['branch', code(build.branch)]);
  if (build.app) {
    rows.push(['app', `${build.app} (${build.isBranchBuild ? 'branch build' : 'staging build'})`]);
  }
  rows.push(['url', page.url]);
  rows.push([
    'viewport',
    `${page.viewport.w}x${page.viewport.h} @${page.viewport.dpr}x, zoom ${page.viewport.zoom}%`,
  ]);
  if (page.scroll.x || page.scroll.y) {
    rows.push(['scroll', `${page.scroll.x}, ${page.scroll.y}`]);
  }
  // Both, because they can disagree: the OS asks for dark and the app renders
  // light, and only one of those is what the designer saw.
  rows.push(['theme', `app ${page.themeMode}, OS prefers ${page.colorScheme}`]);
  rows.push(['language', page.language]);
  rows.push(['browser', escapePipes(page.userAgent)]);

  // State the URL cannot carry. Without this the agent opens the link and sees
  // a different screen from the one that was annotated.
  const state = annotation.appState;
  if (state.dialogs.length) {
    rows.push(['open dialogs', state.dialogs.map(escapePipes).join('; ')]);
  }
  if (state.drawers.length) {
    rows.push(['open panels', state.drawers.map(escapePipes).join('; ')]);
  }
  if (state.expanded.length) {
    rows.push(['expanded', state.expanded.map(escapePipes).join('; ')]);
  }
  if (state.activeTab) rows.push(['active tab', escapePipes(state.activeTab)]);
  if (state.documentTitle) rows.push(['page title', escapePipes(state.documentTitle)]);

  const overrides = Object.entries(page.flags.overrides);
  rows.push([
    'flag overrides (from URL)',
    overrides.length ? overrides.map(([k, v]) => `${k}=${v}`).join('; ') : 'none',
  ]);

  const cached = Object.entries(page.flags.cached);
  if (page.flags.cacheUnavailable) {
    rows.push(['other flags', 'LaunchDarkly cache unreadable']);
  } else if (cached.length) {
    // Only the enabled ones: a full dump of every flag in the environment is
    // noise, and "what was on" is the question worth answering.
    const enabled = cached.filter(([, v]) => v !== false && v !== '' && v !== 0);
    rows.push([
      'other flags on',
      enabled.length ? enabled.map(([k, v]) => `${k}=${String(v)}`).join('; ') : 'none',
    ]);
  } else {
    rows.push(['other flags', 'not exposed to the page']);
  }

  return rows;
}

function code(text: string): string {
  return `\`${text}\``;
}

/** A raw pipe would break the markdown table row. */
function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}
