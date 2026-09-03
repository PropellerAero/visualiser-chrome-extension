import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_ANCHOR_DEPTH,
  cssPath,
  describeSelector,
  findClippingAncestor,
  nearbyText,
  filterProps,
  formValues,
  regionPath,
  resolveAnchor,
  scrollContextOf,
  semanticClassNames,
} from './anchor';
import {
  assessBuild,
  checkIntegrity,
  detectApps,
  isArmed,
  resolveBuildContext,
  stashBranchParam,
} from './branch';
import {
  captureAppState,
  estimateZoom,
  luminanceOf,
  readCachedFlags,
  readFlagOverrides,
} from './context';
import {
  isEditable,
  loadAnnotations,
  memoryAdapter,
  normaliseAnnotation,
  removeAnnotation,
  upsertAnnotation,
} from './storage';
import { OVERLAY_VERSION, labelFor, toMarkdown, toSharedMarkdown } from './serialise';
import { intentMeta } from './types';
import type { Annotation, BuildContext } from './types';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('resolveAnchor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds a testid on the element itself at depth 0', () => {
    mount('<button data-testid="vis-upload" id="t">Upload</button>');
    const anchor = resolveAnchor(document.getElementById('t')!);
    expect(anchor).toEqual({ testId: 'vis-upload', depth: 0, path: '' });
  });

  it('walks up to an ancestor and records the route back down', () => {
    mount(`
      <div data-testid="vis-card">
        <div><span id="t">Low</span></div>
      </div>`);
    const anchor = resolveAnchor(document.getElementById('t')!);
    expect(anchor.testId).toBe('vis-card');
    expect(anchor.depth).toBe(2);
    expect(anchor.path).toBe('> div > span');
  });

  it('disambiguates siblings with nth-of-type', () => {
    mount(`
      <div data-testid="vis-row">
        <span>first</span><span id="t">second</span>
      </div>`);
    const anchor = resolveAnchor(document.getElementById('t')!);
    expect(anchor.path).toBe('> span:nth-of-type(2)');
  });

  it(`gives up past ${MAX_ANCHOR_DEPTH} ancestors rather than returning a distant anchor`, () => {
    // Seven wrappers puts the testid out of range; a match that far away is
    // more likely to mislead the agent than help it.
    mount(
      `<div data-testid="too-far">${'<div>'.repeat(7)}<span id="t">x</span>${'</div>'.repeat(7)}</div>`,
    );
    const anchor = resolveAnchor(document.getElementById('t')!);
    expect(anchor.testId).toBeNull();
    expect(anchor.depth).toBe(-1);
  });

  it('prefers the nearest testid when several are in range', () => {
    mount(`
      <div data-testid="outer">
        <div data-testid="inner"><span id="t">x</span></div>
      </div>`);
    expect(resolveAnchor(document.getElementById('t')!).testId).toBe('inner');
  });
});

describe('semanticClassNames', () => {
  it('drops emotion hashes and keeps semantic names', () => {
    mount('<div id="t" class="css-1a2b3c MuiSlider-thumb css-9z8y7x-MuiBox-root Mui5-Card"></div>');
    expect(semanticClassNames(document.getElementById('t')!)).toEqual([
      'MuiSlider-thumb',
      'Mui5-Card',
    ]);
  });

  it('returns an empty list when there is no class attribute', () => {
    mount('<div id="t"></div>');
    expect(semanticClassNames(document.getElementById('t')!)).toEqual([]);
  });
});

describe('findClippingAncestor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // The PR 19381 case: a slider thumb clipped by an ancestor card with
  // overflow: hidden. The agent had to deduce this from screenshots.
  it('reports the overflow ancestor that explains a clipped element', () => {
    mount(`
      <div class="MuiCard-root" id="card">
        <div><span id="thumb"></span></div>
      </div>`);
    const styles: Record<string, Partial<CSSStyleDeclaration>> = {
      card: { overflow: 'hidden' },
    };
    const getStyle = (el: Element) =>
      ({ overflow: 'visible', ...styles[el.id] }) as CSSStyleDeclaration;

    const found = findClippingAncestor(document.getElementById('thumb')!, getStyle);
    expect(found).not.toBeNull();
    expect(found!.selector).toBe('.MuiCard-root');
    expect(found!.reasons).toContain('overflow: hidden');
  });

  it('returns null when nothing up the tree clips', () => {
    mount('<div><span id="thumb"></span></div>');
    const getStyle = () => ({ overflow: 'visible' }) as CSSStyleDeclaration;
    expect(findClippingAncestor(document.getElementById('thumb')!, getStyle)).toBeNull();
  });

  it('prefers a testid over a class name when describing the ancestor', () => {
    mount(`
      <div data-testid="vis-panel" id="p"><span id="thumb"></span></div>`);
    const getStyle = (el: Element) =>
      ({ overflow: el.id === 'p' ? 'auto' : 'visible' }) as CSSStyleDeclaration;
    expect(findClippingAncestor(document.getElementById('thumb')!, getStyle)!.selector).toBe(
      '[data-testid="vis-panel"]',
    );
  });
});

describe('nearbyText and describeSelector', () => {
  it('falls back to the parent when the element has no text of its own', () => {
    mount('<div id="p">Low Medium High<span id="t"></span></div>');
    expect(nearbyText(document.getElementById('t')!)).toBe('Low Medium High');
  });

  it('truncates long text rather than flooding the comment', () => {
    mount(`<div id="t">${'x'.repeat(400)}</div>`);
    const text = nearbyText(document.getElementById('t')!);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text.endsWith('\u2026')).toBe(true);
  });

  it('builds a css path only as a fallback', () => {
    mount('<div><section><span id="t"></span></section></div>');
    expect(cssPath(document.getElementById('t')!)).toBe('body > div > section > span');
  });

  it('describes a bare element by tag when it has nothing better', () => {
    mount('<article id="t"></article>');
    expect(describeSelector(document.getElementById('t')!)).toBe('article');
  });
});

describe('detectApps', () => {
  // Measured live: 38 of 98 resources came from the branch host while the
  // mothership shell came from the ordinary one, so a page mixes builds.
  const branchUrl =
    'https://docking-bay-branch.dev.propelleraero.com/apps/visualiser-dev/branch/VN-14074-red/app/app.abc.js';
  const plainUrl = 'https://docking-bay.dev.propelleraero.com/apps/mothership/app/app.def.js';

  it('separates a branch-built app from a plain one on the same page', () => {
    const apps = detectApps([branchUrl, branchUrl, plainUrl]);
    const vis = apps.find((a) => a.app === 'visualiser-dev')!;
    const shell = apps.find((a) => a.app === 'mothership')!;
    expect(vis.branch).toBe('VN-14074-red');
    expect(vis.resourceCount).toBe(2);
    expect(shell.branch).toBeNull();
  });

  it('ignores unrelated resources', () => {
    expect(detectApps(['https://cdn.segment.com/analytics.js', 'data:image/png;base64,AAA'])).toEqual(
      [],
    );
  });

  it('treats one branch chunk as proof, whatever order resources arrive in', () => {
    const apps = detectApps([
      'https://docking-bay.dev.propelleraero.com/apps/visualiser-dev/x.js',
      branchUrl,
    ]);
    expect(apps[0].branch).toBe('VN-14074-red');
  });
});

describe('checkIntegrity', () => {
  const branchBuild: BuildContext = {
    app: 'visualiser-dev',
    branch: 'VN-14074-red',
    isBranchBuild: true,
    urlClaimsBranch: 'VN-14074-red',
  };

  it('passes when the loaded branch matches the URL', () => {
    expect(checkIntegrity(branchBuild, null).ok).toBe(true);
  });

  // The silent-wrong-answer case: the router drops the param, the main bundle
  // renders, and every annotation describes code that is not on the PR.
  it('blocks when the URL asks for a branch that did not load', () => {
    const verdict = checkIntegrity(
      { app: 'visualiser', branch: null, isBranchBuild: false, urlClaimsBranch: 'VN-14074-red' },
      null,
    );
    expect(verdict.ok).toBe(false);
    // The message says what to DO, and deliberately does not name the branch
    // or the bundle: that was diagnostic detail the designer cannot act on.
    expect(verdict.ok === false && verdict.reason).toContain('staging link from the pull request');
    expect(verdict.ok === false && verdict.reason).not.toContain('VN-14074-red');
  });

  it('gives the same message whether or not the URL claimed a branch', () => {
    const withClaim = checkIntegrity(
      { app: 'visualiser', branch: null, isBranchBuild: false, urlClaimsBranch: 'VN-14074-red' },
      null,
    );
    const withoutClaim = checkIntegrity(
      { app: 'visualiser', branch: null, isBranchBuild: false, urlClaimsBranch: null },
      null,
    );
    // The required action is identical, so the wording is too.
    expect(withClaim.ok === false && withClaim.reason).toBe(
      withoutClaim.ok === false ? withoutClaim.reason : '',
    );
  });

  it('blocks when a different branch loaded than the one requested', () => {
    const verdict = checkIntegrity({ ...branchBuild, urlClaimsBranch: 'VN-99999-other' }, null);
    expect(verdict.ok).toBe(false);
  });

  it('blocks a plain staging page with no branch requested at all', () => {
    const verdict = checkIntegrity(
      { app: 'visualiser', branch: null, isBranchBuild: false, urlClaimsBranch: null },
      null,
    );
    expect(verdict.ok).toBe(false);
  });

  it('uses the stashed branch when the router has stripped the param', () => {
    const verdict = checkIntegrity({ ...branchBuild, urlClaimsBranch: null }, 'VN-14074-red');
    expect(verdict.ok).toBe(true);
  });
});

describe('stashBranchParam', () => {
  it('stashes the param so it survives the router stripping it', () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    } as unknown as Storage;

    stashBranchParam('?test-visualiser-dev-branch=VN-14074-red&other=1', fake);
    expect(storage.get('prp-design-overlay-branch')).toBe('VN-14074-red');
  });

  it('leaves the stash alone when the param is absent', () => {
    const storage = new Map<string, string>([['prp-design-overlay-branch', 'kept']]);
    const fake = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    } as unknown as Storage;

    stashBranchParam('?unrelated=1', fake);
    expect(storage.get('prp-design-overlay-branch')).toBe('kept');
  });
});

describe('assessBuild', () => {
  const SEARCH = '?test-visualiser-dev-branch=VN-14074-red';
  const SHELL = 'https://docking-bay.dev.propelleraero.com/apps/mothership/app/app.def.js';
  const APP =
    'https://docking-bay-branch.dev.propelleraero.com/apps/visualiser-dev/branch/VN-14074-red/app/app.abc.js';

  // The exact defect seen in the field: mothership fetches the visualiser
  // bundle asynchronously, so an assessment taken when the content script runs
  // sees only the shell and wrongly reports that no branch build is running.
  // The fix is that assessing is cheap and repeatable, not that the first
  // answer is right.
  it('blocks before the app bundle has loaded', () => {
    const early = assessBuild([SHELL], SEARCH, null);
    expect(early.verdict.ok).toBe(false);
    expect(early.build.isBranchBuild).toBe(false);
  });

  it('passes once the app bundle arrives, with no reload needed', () => {
    const later = assessBuild([SHELL, APP], SEARCH, null);
    expect(later.verdict.ok).toBe(true);
    expect(later.build.branch).toBe('VN-14074-red');
    expect(later.build.isBranchBuild).toBe(true);
  });

  it('still reports which apps loaded, for the callers that branch on it', () => {
    const later = assessBuild([SHELL, APP], SEARCH, null);
    expect(later.apps.map((a) => a.app)).toContain('visualiser-dev');
    expect(later.apps.find((a) => a.app === 'visualiser-dev')?.branch).toBe('VN-14074-red');
  });

  it('falls back to the stashed branch once the router strips the param', () => {
    const stripped = assessBuild([SHELL, APP], '?other=1', 'VN-14074-red');
    expect(stripped.verdict.ok).toBe(true);
  });

  it('survives a malformed query string rather than throwing', () => {
    expect(() => assessBuild([SHELL, APP], '?%', null)).not.toThrow();
  });
});

describe('resolveBuildContext', () => {
  it('prefers the branch-built app over a busier plain one', () => {
    const context = resolveBuildContext(
      [
        { app: 'mothership', branch: null, resourceCount: 90 },
        { app: 'visualiser-dev', branch: 'VN-14074-red', resourceCount: 8 },
      ],
      'VN-14074-red',
    );
    expect(context.app).toBe('visualiser-dev');
    expect(context.isBranchBuild).toBe(true);
  });

  it('degrades cleanly when nothing was detected', () => {
    expect(resolveBuildContext([], null)).toEqual({
      app: null,
      branch: null,
      isBranchBuild: false,
      urlClaimsBranch: null,
    });
  });
});

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    createdAt: 1,
    updatedAt: 1,
    status: 'draft',
    body: 'The handle is centred on the track end, so half of it is cut off.',
    intent: 'design-deviation',
    figmaUrl: null,
    build: {
      app: 'visualiser-dev',
      branch: 'VN-14073-slider',
      isBranchBuild: true,
      urlClaimsBranch: 'VN-14073-slider',
    },
    appState: {
      dialogs: [],
      drawers: [],
      expanded: [],
      activeTab: null,
      documentTitle: 'Mine Site - Propeller',
    },
    page: {
      url: 'https://app.api-staging.prpeller.com/p/viewer/site/x?view=abc',
      viewport: { w: 1440, h: 900, dpr: 2, zoom: 100 },
      scroll: { x: 0, y: 0 },
      colorScheme: 'light',
      themeMode: 'light',
      language: 'en-AU',
      userAgent: 'Mozilla/5.0 Chrome/131',
      flags: {
        overrides: { 'vis-slider-refresh': 'true' },
        cached: { 'vis-other-flag': true, 'vis-off-flag': false },
        cacheUnavailable: false,
      },
    },
    target: {
      anchor: { testId: 'vis-detection-detail-slider', depth: 0, path: '' },
      tagName: 'span',
      classNames: ['MuiSlider-thumb'],
      componentName: 'SliderField',
      componentNameReliable: true,
      props: { value: '0', min: '0', max: '100' },
      nearbyText: 'Low Medium High',
      boundingBox: { x: 204, y: 486, width: 12, height: 12 },
      clickPoint: { x: 210, y: 492 },
      region: ['complementary: Outputs', '[vis-detect-features-card]'],
      scrollContext: {
        selector: '.MuiDrawer-paper',
        scrollTop: 320,
        scrollLeft: 0,
        scrollHeight: 1400,
        clientHeight: 700,
      },
      clippingAncestor: { selector: '.MuiCard-root', reasons: ['overflow: hidden'] },
      styles: { color: 'rgb(0, 0, 0)', 'font-size': '14px' },
      state: { 'aria-disabled': 'true' },
      values: { checked: 'false', inputType: 'checkbox' },
      cssPath: null,
    },
    ...overrides,
  };
}

describe('labelFor', () => {
  it('derives a label from the first line of the body', () => {
    expect(labelFor(annotation({ body: 'Handle is clipped\nmore detail here' }))).toBe(
      'Handle is clipped',
    );
  });

  it('truncates a long first line', () => {
    const label = labelFor(annotation({ body: 'x'.repeat(200) }));
    expect(label.length).toBeLessThanOrEqual(72);
    expect(label.endsWith('\u2026')).toBe(true);
  });

  it('never returns an empty label', () => {
    expect(labelFor(annotation({ body: '   ' }))).toBe('Comment');
  });
});

describe('toMarkdown', () => {
  it('leads with the designer words, with no separate summary field', () => {
    const md = toMarkdown(annotation());
    expect(md).toContain('half of it is cut off');
    expect(md).toContain('### Comment');
  });

  it('carries the anchor, component and the clipping ancestor', () => {
    const md = toMarkdown(annotation());
    expect(md).toContain('`data-testid="vis-detection-detail-slider"` (self)');
    expect(md).toContain('`SliderField`');
    // The row that turns the PR 19381 deduction into a stated fact.
    expect(md).toContain('`.MuiCard-root` — overflow: hidden');
  });

  it('states the current styles, so "should be 16px" has a baseline', () => {
    expect(toMarkdown(annotation())).toContain('font-size: 14px');
  });

  it('reports interaction state a screenshot cannot show', () => {
    expect(toMarkdown(annotation())).toContain('aria-disabled=true');
  });

  it('carries the kind with the gloss the agent needs, and no severity', () => {
    const md = toMarkdown(annotation());
    expect(md).toContain("**Doesn't match design**");
    expect(md).toContain('the design is authoritative');
    expect(md).not.toContain('severity');
  });

  // The whole reason this option exists: it will hit the AC-conflict rule, and
  // the agent should learn that from the comment rather than from a refusal.
  it('warns that a new idea needs the ticket updated', () => {
    const md = toMarkdown(annotation({ intent: 'new-idea' }));
    expect(md).toContain('**New idea**');
    expect(md).toContain('needs the ticket updated');
  });

  it('includes the Figma frame when the designer supplied one', () => {
    const md = toMarkdown(annotation({ figmaUrl: 'https://figma.com/design/abc?node-id=1-2' }));
    expect(md).toContain('| design | https://figma.com/design/abc?node-id=1-2 |');
  });

  it('omits the design row entirely when there is no frame', () => {
    expect(toMarkdown(annotation())).not.toContain('| design |');
  });

  it('suppresses the component name on a minified build rather than lying', () => {
    const a = annotation();
    const md = toMarkdown({
      ...a,
      target: { ...a.target, componentName: null, componentNameReliable: false },
    });
    expect(md).not.toContain('| component |');
  });

  it('says plainly when no durable anchor was found', () => {
    const a = annotation();
    const md = toMarkdown({
      ...a,
      target: { ...a.target, anchor: { testId: null, depth: -1, path: '' }, cssPath: 'body > span' },
    });
    expect(md).toContain('none found within 5 ancestors');
    expect(md).toContain('low confidence');
  });

  it('reports where the designer clicked, not just the element box', () => {
    // For a click on the 3D map the element is the whole canvas, so the box is
    // the viewport and only this row says what was meant.
    expect(toMarkdown(annotation())).toContain('| clicked at | (210, 492) in the viewport |');
  });

  it('escapes pipes so page text cannot break a table row', () => {
    const a = annotation();
    const md = toMarkdown({ ...a, target: { ...a.target, nearbyText: 'Low | Medium | High' } });
    expect(md).toContain('Low \\| Medium \\| High');
  });
});

describe('toSharedMarkdown', () => {
  it('titles the export so the paste is self-explanatory', () => {
    const md = toSharedMarkdown([annotation(), annotation({ id: 'a2' })]);
    expect(md.startsWith('## Design feedback (2 comments)')).toBe(true);
    expect(md).toContain('anchored to a `data-testid`');
  });

  // The payload has already changed shape several times, so an unversioned
  // comment is indistinguishable from a newer one that is simply missing data.
  it('stamps the overlay version, so the format is identifiable', () => {
    expect(toSharedMarkdown([annotation()])).toContain(`design overlay v${OVERLAY_VERSION}`);
    expect(OVERLAY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('uses the singular for one comment', () => {
    expect(toSharedMarkdown([annotation()])).toContain('(1 comment)');
  });

  it('numbers every comment in one document', () => {
    const md = toSharedMarkdown([
      annotation({ body: 'first thing' }),
      annotation({ id: 'a2', body: 'second thing' }),
    ]);
    expect(md).toContain('### 1. first thing');
    expect(md).toContain('### 2. second thing');
  });

  it('includes page context once, not per comment', () => {
    const md = toSharedMarkdown([annotation(), annotation({ id: 'a2' })]);
    expect(md.match(/Page context/g)).toHaveLength(1);
    expect(md).toContain('1440x900 @2x, zoom 100%');
    expect(md).toContain('en-AU');
  });

  it('reports the flag overrides an agent needs to reproduce the view', () => {
    const md = toSharedMarkdown([annotation()]);
    expect(md).toContain('vis-slider-refresh=true');
  });

  it('lists only flags that were on, not the whole environment', () => {
    const md = toSharedMarkdown([annotation()]);
    expect(md).toContain('vis-other-flag=true');
    expect(md).not.toContain('vis-off-flag');
  });

  it('says so when the flag cache could not be read', () => {
    const a = annotation();
    const md = toSharedMarkdown([
      { ...a, page: { ...a.page, flags: { overrides: {}, cached: {}, cacheUnavailable: true } } },
    ]);
    expect(md).toContain('LaunchDarkly cache unreadable');
  });

  it('returns nothing for an empty set rather than a bare title', () => {
    expect(toSharedMarkdown([])).toBe('');
  });

  // There is no attached image: GitHub strips data: URI images, and a clipboard
  // holding both text and an image resolves to the image on paste, which would
  // drop the comments. The link is what lets a reader see the same thing.
  it('points at the link rather than promising an attached image', () => {
    const md = toSharedMarkdown([annotation(), annotation({ id: 'a2' })]);
    expect(md).toContain('**To see this yourself:**');
    expect(md).toContain('restores the same branch build, feature flags and view');
    expect(md).not.toContain('Screenshot');
  });

  it('carries the url that restores the view', () => {
    const md = toSharedMarkdown([annotation()]);
    expect(md).toContain('| url | https://app.api-staging.prpeller.com/p/viewer/site/x?view=abc |');
  });
});

describe('feature flag + page context capture', () => {
  it('reads only the visualiser flag-override params', () => {
    const flags = readFlagOverrides(
      '?test-visualiser-dev-branch=b&test-visualiser-ff__vis-a=true&test-visualiser-ff__vis-b=compact&other=1',
    );
    expect(flags).toEqual({ 'vis-a': 'true', 'vis-b': 'compact' });
  });

  it('survives a malformed query string', () => {
    expect(() => readFlagOverrides('?%')).not.toThrow();
  });

  it('reads LaunchDarkly cached flags in both shapes the SDK uses', () => {
    const store: Record<string, string> = {
      'ld:env:user:flags': JSON.stringify({ bare: true, wrapped: { value: 'compact' } }),
      unrelated: 'x',
    };
    const fake = {
      getItem: (k: string) => store[k] ?? null,
      ...store,
    } as unknown as Storage;
    const { cached, cacheUnavailable } = readCachedFlags(fake);
    expect(cacheUnavailable).toBe(false);
    expect(cached).toEqual({ bare: true, wrapped: 'compact' });
  });

  it('degrades to cacheUnavailable rather than throwing', () => {
    const hostile = new Proxy({} as Storage, {
      ownKeys() {
        throw new Error('blocked');
      },
    });
    expect(readCachedFlags(hostile).cacheUnavailable).toBe(true);
  });

  it('estimates browser zoom and rounds to avoid false precision', () => {
    expect(estimateZoom(1280, 1280)).toBe(100);
    expect(estimateZoom(1280, 1420)).toBe(90);
    expect(estimateZoom(0, 0)).toBe(100);
  });
});

describe('storage', () => {
  it('round-trips annotations per branch without mixing them', async () => {
    const adapter = memoryAdapter();
    await upsertAnnotation(adapter, 'branch-a', annotation({ id: 'a' }));
    await upsertAnnotation(adapter, 'branch-b', annotation({ id: 'b' }));

    expect((await loadAnnotations(adapter, 'branch-a')).map((a) => a.id)).toEqual(['a']);
    expect((await loadAnnotations(adapter, 'branch-b')).map((a) => a.id)).toEqual(['b']);
  });

  it('replaces rather than duplicates on re-save', async () => {
    const adapter = memoryAdapter();
    await upsertAnnotation(adapter, 'b', annotation({ id: 'a', body: 'first' }));
    const next = await upsertAnnotation(adapter, 'b', annotation({ id: 'a', body: 'second' }));
    expect(next).toHaveLength(1);
    expect(next[0].body).toBe('second');
  });

  it('discards malformed stored values instead of throwing', async () => {
    const adapter = memoryAdapter({ 'annotations:b': [{ nope: true }, null, 'x'] });
    expect(await loadAnnotations(adapter, 'b')).toEqual([]);
  });

  it('locks editing once an annotation has been shared', () => {
    expect(isEditable(annotation({ status: 'draft' }))).toBe(true);
    expect(isEditable(annotation({ status: 'shared' }))).toBe(false);
  });

  it('removes only the named annotation', async () => {
    const adapter = memoryAdapter();
    await upsertAnnotation(adapter, 'b', annotation({ id: 'a' }));
    await upsertAnnotation(adapter, 'b', annotation({ id: 'c' }));
    const left = await removeAnnotation(adapter, 'b', 'a');
    expect(left.map((x) => x.id)).toEqual(['c']);
  });
});

// The overlay decides "is this element mine or the app's" from the composed
// path, not from closest(). closest() stops at the shadow boundary, so a click
// on a panel button looked like an app element -- the overlay swallowed its own
// clicks and would have annotated its own UI. This pins the distinction.
describe('shadow-boundary detection', () => {
  const HOST_ID = 'prp-design-overlay-host';

  function isOurs(path: EventTarget[]): boolean {
    return path.some((node) => node instanceof Element && (node as Element).id === HOST_ID);
  }

  it('recognises an element inside our own shadow tree via the host in the path', () => {
    const host = document.createElement('div');
    host.id = HOST_ID;
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    shadow.append(button);

    // closest() cannot see the host from inside the shadow tree...
    expect(button.closest(`#${HOST_ID}`)).toBeNull();
    // ...but the composed path contains it, which is why the path is used.
    expect(isOurs([button, shadow, host, document.body])).toBe(true);
  });

  it('treats an ordinary app element as annotatable', () => {
    document.body.innerHTML = '<main><button id="app-btn">Upload</button></main>';
    const button = document.getElementById('app-btn')!;
    expect(isOurs([button, document.body])).toBe(false);
  });
});

describe('captureAppState', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Mine Site - Propeller';
  });

  // The gap this closes: a designer opens a dialog to expose the defect, the
  // URL records the route but not the dialog, and the agent opens the link to
  // a different screen.
  it('names an open dialog from its aria-label', () => {
    document.body.innerHTML =
      '<div role="dialog" aria-label="Upload media" style="width:10px;height:10px"></div>';
    const el = document.querySelector('[role=dialog]') as HTMLElement;
    el.getBoundingClientRect = () => ({ width: 300, height: 200 }) as DOMRect;
    expect(captureAppState(document).dialogs).toEqual(['Upload media']);
  });

  it('falls back to a heading inside the dialog', () => {
    document.body.innerHTML = '<div role="dialog"><h2>Manage categories</h2></div>';
    const el = document.querySelector('[role=dialog]') as HTMLElement;
    el.getBoundingClientRect = () => ({ width: 300, height: 200 }) as DOMRect;
    expect(captureAppState(document).dialogs).toEqual(['Manage categories']);
  });

  it('ignores a dialog that is in the DOM but hidden', () => {
    // MUI leaves closed dialogs mounted, so an unfiltered query would report
    // dialogs nobody can see.
    document.body.innerHTML =
      '<div role="dialog" aria-hidden="true" aria-label="Closed"></div>' +
      '<div role="dialog" aria-label="Zero size"></div>';
    expect(captureAppState(document).dialogs).toEqual([]);
  });

  it('records the selected tab', () => {
    document.body.innerHTML =
      '<div role="tab" aria-selected="false">Layers</div>' +
      '<div role="tab" aria-selected="true">Measurements</div>';
    expect(captureAppState(document).activeTab).toBe('Measurements');
  });

  it('reports no tab when the view has none', () => {
    expect(captureAppState(document).activeTab).toBeNull();
  });

  it('carries the document title', () => {
    expect(captureAppState(document).documentTitle).toBe('Mine Site - Propeller');
  });
});

describe('app state in the export', () => {
  it('reports open dialogs and the active tab so the view can be reproduced', () => {
    const md = toSharedMarkdown([
      annotation({
        appState: {
          dialogs: ['Upload media'],
          drawers: ['Outputs'],
          expanded: ['Detect features'],
          activeTab: 'Measurements',
          documentTitle: 'Mine Site - Propeller',
        },
      }),
    ]);
    expect(md).toContain('| open dialogs | Upload media |');
    expect(md).toContain('| active tab | Measurements |');
  });

  it('omits the dialog row when nothing was open', () => {
    expect(toSharedMarkdown([annotation()])).not.toContain('open dialogs');
  });
});

// Both of these reproduce crashes seen in the field after the schema moved
// under drafts that were already saved:
//   TypeError: Cannot read properties of undefined (reading 'x')      <- clickPoint
//   TypeError: Cannot read properties of undefined (reading 'label')  <- intent
describe('normaliseAnnotation — stored drafts that predate the current schema', () => {
  /** A draft as saved by the version with title/severity and fix/change. */
  const legacy = {
    id: 'ann_old',
    createdAt: 1000,
    updatedAt: 1000,
    status: 'draft',
    title: 'Slider handle is clipped',
    body: 'The handle is cut off at both ends.',
    intent: 'fix',
    severity: 'important',
    target: {
      anchor: { testId: 'vis-slider', depth: 0, path: '' },
      tagName: 'span',
      classNames: ['MuiSlider-thumb'],
      componentName: 'SliderField',
      componentNameReliable: true,
      props: { value: '0', min: '0', max: '100' },
      nearbyText: 'Low',
      boundingBox: { x: 100, y: 200, width: 40, height: 20 },
      clippingAncestor: null,
      cssPath: null,
      // no clickPoint, no styles, no state
    },
    // no figmaUrl, no appState, no page
  };

  it('repairs a legacy draft instead of throwing on it', () => {
    const out = normaliseAnnotation(legacy);
    expect(out).not.toBeNull();
    expect(out!.body).toBe('The handle is cut off at both ends.');
  });

  it('derives the missing clickPoint from the box, where the pin used to be', () => {
    const out = normaliseAnnotation(legacy)!;
    expect(out.target.clickPoint).toEqual({ x: 120, y: 200 });
  });

  it('maps the legacy fix intent forward', () => {
    expect(normaliseAnnotation(legacy)!.intent).toBe('design-deviation');
  });

  it('maps legacy change to new-idea', () => {
    expect(normaliseAnnotation({ ...legacy, intent: 'change' })!.intent).toBe('new-idea');
  });

  // Mapping an old approval onto a change-kind would send the agent to "fix"
  // something the designer had signed off, so it degrades to question, whose
  // gloss forbids a code change.
  it('degrades a removed or unknown intent to question, never to a change', () => {
    expect(normaliseAnnotation({ ...legacy, intent: 'approve' })!.intent).toBe('question');
    expect(normaliseAnnotation({ ...legacy, intent: 'nonsense' })!.intent).toBe('question');
    expect(normaliseAnnotation({ ...legacy, intent: undefined })!.intent).toBe('question');
  });

  it('recovers the text from title when body is absent', () => {
    const noBody = { ...legacy, body: undefined };
    expect(normaliseAnnotation(noBody)!.body).toBe('Slider handle is clipped');
  });

  it('fills the absent page, appState and figmaUrl with usable defaults', () => {
    const out = normaliseAnnotation(legacy)!;
    expect(out.figmaUrl).toBeNull();
    expect(out.appState).toEqual({
      dialogs: [],
      drawers: [],
      expanded: [],
      activeTab: null,
      documentTitle: '',
    });
    expect(out.page.viewport.zoom).toBe(100);
    expect(out.page.flags.overrides).toEqual({});
  });

  it('rejects a record with no usable identity, text or geometry', () => {
    expect(normaliseAnnotation(null)).toBeNull();
    expect(normaliseAnnotation('nope')).toBeNull();
    expect(normaliseAnnotation({ id: 'a', body: 'x' })).toBeNull();
    expect(normaliseAnnotation({ ...legacy, body: '  ', title: undefined })).toBeNull();
    expect(normaliseAnnotation({ ...legacy, target: { ...legacy.target, boundingBox: null } })).toBeNull();
  });

  it('rejects a box with non-finite numbers rather than rendering NaN pins', () => {
    const bad = { ...legacy, target: { ...legacy.target, boundingBox: { x: NaN, y: 0, width: 1, height: 1 } } };
    expect(normaliseAnnotation(bad)).toBeNull();
  });

  it('loads a mixed store, keeping what it can and dropping what it cannot', async () => {
    const adapter = memoryAdapter({ 'annotations:b': [legacy, null, { id: 'x' }, annotation()] });
    const loaded = await loadAnnotations(adapter, 'b');
    expect(loaded.map((a) => a.id)).toEqual(['ann_old', 'a1']);
  });

  it('renders a repaired legacy draft through the exporter without throwing', () => {
    const out = normaliseAnnotation(legacy)!;
    expect(() => toSharedMarkdown([out])).not.toThrow();
    expect(toSharedMarkdown([out])).toContain("**Doesn't match design**");
  });
});

describe('intentMeta', () => {
  it('falls back rather than returning undefined for an unknown intent', () => {
    expect(intentMeta('fix').label).toBe('Question');
    expect(intentMeta('design-deviation').label).toBe("Doesn't match design");
  });
});

describe('filterProps — React props of the annotated component', () => {
  // Props are trustworthy on every build: prop names are object keys and the
  // webpack config gives Terser no mangle block, so mangle.properties stays
  // false. Component names, being identifiers, are mangled. Hence props are
  // reported even when the component name is suppressed.
  it('keeps the primitives that describe a control', () => {
    expect(filterProps({ value: 0, min: 0, max: 100, disabled: false, variant: 'outlined' })).toEqual(
      { value: '0', min: '0', max: '100', disabled: 'false', variant: 'outlined' },
    );
  });

  // A prop can hold an entire dataset or a customer record, and this payload
  // is pasted into a PR comment, so non-primitives are dropped outright rather
  // than summarised.
  it('drops objects, arrays and functions entirely', () => {
    const out = filterProps({
      site: { id: 'prad7bb3e1', name: 'Mine Site', owner: 'someone@example.com' },
      datasets: [1, 2, 3],
      onChange: () => undefined,
      label: 'Detection detail',
    });
    expect(out).toEqual({ label: 'Detection detail' });
  });

  it('drops handlers, children, styling and aria/data props', () => {
    const out = filterProps({
      onClick: () => undefined,
      children: 'x',
      className: 'a',
      sx: {},
      style: {},
      'aria-label': 'x',
      'data-testid': 'y',
      keep: 'yes',
    });
    expect(out).toEqual({ keep: 'yes' });
  });

  it('records an explicit null, which is different from an absent prop', () => {
    expect(filterProps({ selection: null })).toEqual({ selection: 'null' });
  });

  it('caps the number of props so the comment stays readable', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, i]));
    expect(Object.keys(filterProps(many))).toHaveLength(12);
  });

  it('truncates a long string prop', () => {
    const out = filterProps({ label: 'x'.repeat(200) });
    expect(out.label.length).toBeLessThanOrEqual(61);
    expect(out.label.endsWith('\u2026')).toBe(true);
  });

  it('returns nothing for a non-object', () => {
    expect(filterProps(null)).toEqual({});
    expect(filterProps('nope')).toEqual({});
  });
});

describe('scrollContextOf — the app scrolls in panels, not the window', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function withScroll(el: HTMLElement, scrollTop: number, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  }

  it('finds the scrolled panel and how far it is scrolled', () => {
    document.body.innerHTML =
      '<div id="panel" class="MuiDrawer-paper"><div><span id="t"></span></div></div>';
    const panel = document.getElementById('panel') as HTMLElement;
    withScroll(panel, 320, 1400, 700);
    const styles = (el: Element) =>
      ({ overflowY: el.id === 'panel' ? 'auto' : 'visible', overflowX: 'visible' }) as CSSStyleDeclaration;

    const out = scrollContextOf(document.getElementById('t')!, styles);
    expect(out).toEqual({
      selector: '.MuiDrawer-paper',
      scrollTop: 320,
      scrollLeft: 0,
      scrollHeight: 1400,
      clientHeight: 700,
    });
  });

  // overflow: auto on something that fits is not a scroll container.
  it('ignores a container that can scroll but has nothing to scroll', () => {
    document.body.innerHTML = '<div id="panel"><span id="t"></span></div>';
    const panel = document.getElementById('panel') as HTMLElement;
    withScroll(panel, 0, 500, 500);
    const styles = () => ({ overflowY: 'auto', overflowX: 'visible' }) as CSSStyleDeclaration;
    expect(scrollContextOf(document.getElementById('t')!, styles)).toBeNull();
  });

  it('returns null when nothing up the tree scrolls', () => {
    document.body.innerHTML = '<div><span id="t"></span></div>';
    const styles = () => ({ overflowY: 'visible', overflowX: 'visible' }) as CSSStyleDeclaration;
    expect(scrollContextOf(document.getElementById('t')!, styles)).toBeNull();
  });
});

describe('regionPath — which part of the UI it lives in', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('names landmarks and testids from outermost in', () => {
    document.body.innerHTML = `
      <aside role="complementary" aria-label="Outputs">
        <div data-testid="vis-detect-card">
          <div><span id="t"></span></div>
        </div>
      </aside>`;
    expect(regionPath(document.getElementById('t')!)).toEqual([
      'complementary: Outputs',
      '[vis-detect-card]',
    ]);
  });

  it('falls back to the role or tag when a landmark has no label', () => {
    document.body.innerHTML = '<nav><span id="t"></span></nav>';
    expect(regionPath(document.getElementById('t')!)).toEqual(['nav']);
  });

  it('returns nothing when there is no region to name', () => {
    document.body.innerHTML = '<div><span id="t"></span></div>';
    expect(regionPath(document.getElementById('t')!)).toEqual([]);
  });
});

describe('formValues — ARIA alone misses MUI checkboxes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads a checkbox through its MUI wrapper', () => {
    document.body.innerHTML = '<span id="w" class="MuiCheckbox-root"><input type="checkbox"></span>';
    (document.querySelector('input') as HTMLInputElement).checked = true;
    expect(formValues(document.getElementById('w')!)).toEqual({
      checked: 'true',
      inputType: 'checkbox',
    });
  });

  it('reports the indeterminate state a screenshot cannot show', () => {
    document.body.innerHTML = '<input id="c" type="checkbox">';
    const input = document.getElementById('c') as HTMLInputElement;
    input.indeterminate = true;
    expect(formValues(input).indeterminate).toBe('true');
  });

  it('reads a text field value', () => {
    document.body.innerHTML = '<div id="w"><input type="text" value="Highwall 3"></div>';
    expect(formValues(document.getElementById('w')!).value).toBe('Highwall 3');
  });

  it('returns nothing for an element with no control', () => {
    document.body.innerHTML = '<button id="b">Upload</button>';
    expect(formValues(document.getElementById('b')!)).toEqual({});
  });
});

describe('theme inference — the app can disagree with the OS', () => {
  it('reads dark from a dark rendered background', () => {
    expect(luminanceOf('rgb(18, 18, 18)')).toBe('dark');
  });

  it('reads light from a light one', () => {
    expect(luminanceOf('rgb(255, 255, 255)')).toBe('light');
  });

  it('refuses to guess from a fully transparent background', () => {
    expect(luminanceOf('rgba(0, 0, 0, 0)')).toBe('unknown');
  });

  it('refuses to guess from an unparseable colour', () => {
    expect(luminanceOf('color(display-p3 1 1 1)')).toBe('unknown');
  });
});

describe('the new context in the export', () => {
  it('reports props even though the component name may be mangled', () => {
    const md = toMarkdown(annotation());
    expect(md).toContain('| props | value=0; min=0; max=100 |');
  });

  it('says which panel the element lives in', () => {
    expect(toMarkdown(annotation())).toContain('complementary: Outputs \u203a [vis-detect-features-card]');
  });

  it('reports the panel scroll offset, which page.scroll cannot', () => {
    const md = toMarkdown(annotation());
    expect(md).toContain('| scrolled | `.MuiDrawer-paper` at 320px of 700px |');
  });

  it('reports the control value', () => {
    expect(toMarkdown(annotation())).toContain('checked=false');
  });

  it('reports app theme and OS preference separately', () => {
    expect(toSharedMarkdown([annotation()])).toContain('app light, OS prefers light');
  });

  it('reports open panels and expanded sections', () => {
    const md = toSharedMarkdown([
      annotation({
        appState: {
          dialogs: [],
          drawers: ['Outputs'],
          expanded: ['Detect features'],
          activeTab: null,
          documentTitle: 'x',
        },
      }),
    ]);
    expect(md).toContain('| open panels | Outputs |');
    expect(md).toContain('| expanded | Detect features |');
  });
});

/**
 * Cross-repo contract.
 *
 * QA_LINK below is not hand-written: it is the verbatim output of
 * `build_area_url` in propeller-agent-declarative's
 * tools/generate_branch_test_link.py, for the real visualiser-desktop area.
 * These assertions are what stop the two repos drifting apart -- the producer
 * is tested there, the consumer here, against the same bytes.
 */
describe('the QA link Ziggy actually generates', () => {
  const QA_LINK =
    'https://app.api-staging.prpeller.com/p/viewer/site/prbedb8b4b/measure' +
    '?test-visualiser-dev-branch=VN-14074-agent-vis-change-visualiser-upload-button-colour-red' +
    '&test-visualiser-ff__vis-change-visualiser-upload-button-colour-red=true' +
    '&prp-design-feedback';

  const SEARCH = QA_LINK.slice(QA_LINK.indexOf('?'));

  function fakeStorage(seed: Record<string, string> = {}): Storage {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    } as unknown as Storage;
  }

  it('arms the tool', () => {
    expect(isArmed(SEARCH, fakeStorage())).toBe(true);
  });

  it('still yields the branch, so the integrity guard is unaffected', () => {
    const storage = fakeStorage();
    stashBranchParam(SEARCH, storage);
    expect(storage.getItem('prp-design-overlay-branch')).toBe(
      'VN-14074-agent-vis-change-visualiser-upload-button-colour-red',
    );
  });

  // The failure this guards against: a param in the test-visualiser-ff__
  // namespace would be reported to the agent as a flag the designer had set.
  it('does not read the arming param as a feature flag', () => {
    const flags = readFlagOverrides(SEARCH);
    expect(flags).toEqual({ 'vis-change-visualiser-upload-button-colour-red': 'true' });
    expect(Object.keys(flags)).not.toContain('prp-design-feedback');
    expect(Object.keys(flags)).not.toContain('');
  });

  it('passes the whole build assessment on this link', () => {
    const branchChunk =
      'https://docking-bay-branch.dev.propelleraero.com/apps/visualiser-dev/branch/' +
      'VN-14074-agent-vis-change-visualiser-upload-button-colour-red/app/app.js';
    const shell = 'https://docking-bay.dev.propelleraero.com/apps/mothership/app/app.js';
    const assessment = assessBuild([shell, branchChunk], SEARCH, null);
    expect(assessment.verdict.ok).toBe(true);
    expect(assessment.build.branch).toBe(
      'VN-14074-agent-vis-change-visualiser-upload-button-colour-red',
    );
  });
});

describe('isArmed', () => {
  function fakeStorage(seed: Record<string, string> = {}): Storage {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    } as unknown as Storage;
  }

  // The param is valueless, so URLSearchParams.get() returns '' and a
  // truthiness test would reject a correctly-armed link.
  it('accepts the valueless form, which a truthy get() would reject', () => {
    expect(new URLSearchParams('?prp-design-feedback').get('prp-design-feedback')).toBe('');
    expect(isArmed('?prp-design-feedback', fakeStorage())).toBe(true);
  });

  it('accepts it alongside the branch and flag params, in any position', () => {
    expect(isArmed('?prp-design-feedback&test-visualiser-ff__x=true', fakeStorage())).toBe(true);
    expect(isArmed('?a=1&prp-design-feedback&b=2', fakeStorage())).toBe(true);
  });

  it('stays armed after the router strips the param', () => {
    const storage = fakeStorage();
    expect(isArmed('?prp-design-feedback', storage)).toBe(true);
    // Same tab, later navigation, param gone.
    expect(isArmed('?something-else=1', storage)).toBe(true);
  });

  it('is not armed on a plain staging visit', () => {
    expect(isArmed('', fakeStorage())).toBe(false);
    expect(isArmed('?test-visualiser-dev-branch=b', fakeStorage())).toBe(false);
  });

  it('is not armed by a near-miss param name', () => {
    expect(isArmed('?prp-design-feedbackk', fakeStorage())).toBe(false);
    expect(isArmed('?design-feedback', fakeStorage())).toBe(false);
  });

  it('fails closed when storage throws', () => {
    const hostile = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(isArmed('?nothing=1', hostile)).toBe(false);
  });

  // A malformed query string must not lose an already-armed tab.
  it('falls back to the stash on a malformed query string', () => {
    expect(isArmed('?%', fakeStorage({ 'prp-design-overlay-armed': 'true' }))).toBe(true);
  });
});
