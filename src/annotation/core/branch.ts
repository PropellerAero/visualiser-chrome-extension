/**
 * Which bundle is actually running.
 *
 * The branch name is baked into webpack's publicPath for a branch build
 * (`MOTHERSHIP_PATHS.branch` in visualiser's `packages/setup/webpack/utils.ts`),
 * so every chunk is served from
 * `docking-bay-branch.dev.propelleraero.com/apps/<app>/branch/<CI_BRANCH>/`.
 * Verified in the deployed runtime chunk:
 *
 *   __webpack_require__.p = "https://docking-bay-branch.dev.propelleraero.com
 *                            /apps/visualiser-dev/branch/VN-14074-.../"
 *
 * This matters because the SPA router strips unknown query params on internal
 * navigation -- the visualiser's own `captureServerOverride.ts` says so in as
 * many words ("Param stripped by the router -- reuse the tab's stash"). So the
 * URL's `test-visualiser-dev-branch` cannot be trusted mid-session, but the
 * loaded resources can: they are what is actually executing.
 *
 * A page carries a MIX of builds -- measured live, 38 of 98 resources came from
 * the branch host while the mothership shell came from the ordinary one. So
 * attribution is per app, never per page.
 */

import type { BuildContext } from './types';

const BRANCH_RESOURCE =
  /\/\/docking-bay-branch[^/]*\/apps\/([^/]+)\/branch\/([^/]+)\//;
const PLAIN_RESOURCE = /\/\/docking-bay[^-/][^/]*\/apps\/([^/]+)\//;

/** Query param mothership reads to pick a branch bundle for the visualiser. */
export const BRANCH_PARAM = 'test-visualiser-dev-branch';

/** Per-tab stash key, mirroring the pattern in captureServerOverride.ts. */
export const BRANCH_STASH_KEY = 'prp-design-overlay-branch';

/**
 * Valueless param that arms this tool.
 *
 * Emitted only by `generate_branch_test_link.py` in the agent plugin, which
 * builds Ziggy's QA link -- so the overlay appears on Ziggy's pull requests and
 * not on every PR in the repo, whose staging links come from the repo's own
 * `comment-mothership-branch-link` workflow.
 *
 * Deliberately outside the `test-visualiser-` namespace: params with the
 * `test-visualiser-ff__` prefix are read as feature-flag overrides and reported
 * to the agent, so a param there would be mis-reported as a flag the designer
 * had set.
 */
export const ARM_PARAM = 'prp-design-feedback';

export const ARM_STASH_KEY = 'prp-design-overlay-armed';

/**
 * Is the tool armed for this tab?
 *
 * Checked with `has()`, not a truthy `get()`: the param is valueless, so
 * `get()` returns an empty string and a truthiness test would always fail.
 *
 * Stashed per tab because the SPA router strips unknown params on internal
 * navigation -- the visualiser's own `captureServerOverride.ts` says so
 * outright ("Param stripped by the router -- reuse the tab's stash"). Without
 * the stash the overlay would vanish the moment the designer navigated.
 */
export function isArmed(search: string, storage: Storage): boolean {
  try {
    if (new URLSearchParams(search).has(ARM_PARAM)) {
      storage.setItem(ARM_STASH_KEY, 'true');
      return true;
    }
  } catch {
    // A malformed query string falls through to the stash.
  }
  try {
    return storage.getItem(ARM_STASH_KEY) === 'true';
  } catch {
    // Private browsing can throw on storage access; fail closed.
    return false;
  }
}

export interface DetectedApp {
  app: string;
  branch: string | null;
  resourceCount: number;
}

/** Group loaded resource URLs by docking-bay app, noting which are branch builds. */
export function detectApps(resourceUrls: string[]): DetectedApp[] {
  const found = new Map<string, DetectedApp>();

  for (const url of resourceUrls) {
    const branchMatch = BRANCH_RESOURCE.exec(url);
    if (branchMatch) {
      upsert(found, branchMatch[1], branchMatch[2]);
      continue;
    }
    const plainMatch = PLAIN_RESOURCE.exec(url);
    if (plainMatch) {
      upsert(found, plainMatch[1], null);
    }
  }

  return Array.from(found.values()).sort((a, b) => b.resourceCount - a.resourceCount);
}

function upsert(map: Map<string, DetectedApp>, app: string, branch: string | null): void {
  const existing = map.get(app);
  if (existing) {
    existing.resourceCount++;
    // A branch reading always wins: one branch chunk proves the branch build.
    if (branch !== null) existing.branch = branch;
    return;
  }
  map.set(app, { app, branch, resourceCount: 1 });
}

/**
 * Capture the branch param into per-tab sessionStorage the first time it is
 * seen, so it survives the router stripping it. Mirrors `captureDevParamsFromUrl`
 * in the visualiser. sessionStorage (not localStorage) is deliberate: per-tab,
 * cleared on tab close, so it cannot leak between sessions.
 */
export function stashBranchParam(search: string, storage: Storage): void {
  try {
    const params = new URLSearchParams(search);
    if (!params.has(BRANCH_PARAM)) return;
    const value = params.get(BRANCH_PARAM);
    if (value) storage.setItem(BRANCH_STASH_KEY, value);
    else storage.removeItem(BRANCH_STASH_KEY);
  } catch {
    // Private browsing can throw on storage access. A missing stash only costs
    // us the mismatch warning, so degrade rather than break the overlay.
  }
}

export function readStashedBranch(storage: Storage): string | null {
  try {
    return storage.getItem(BRANCH_STASH_KEY);
  } catch {
    return null;
  }
}

/**
 * Resolve the build context for the app under review.
 *
 * `preferredApp` lets a caller name the app explicitly; otherwise the app with
 * a branch wins, and failing that the one with the most loaded resources.
 */
export function resolveBuildContext(
  apps: DetectedApp[],
  urlClaimsBranch: string | null,
  preferredApp?: string,
): BuildContext {
  const chosen =
    (preferredApp && apps.find((a) => a.app === preferredApp)) ||
    apps.find((a) => a.branch !== null) ||
    apps[0];

  if (!chosen) {
    return { app: null, branch: null, isBranchBuild: false, urlClaimsBranch };
  }

  return {
    app: chosen.app,
    branch: chosen.branch,
    isBranchBuild: chosen.branch !== null,
    urlClaimsBranch,
  };
}

export type IntegrityVerdict =
  | { ok: true }
  | { ok: false; reason: string };

export interface BuildAssessment {
  build: BuildContext;
  verdict: IntegrityVerdict;
  apps: DetectedApp[];
}

/**
 * The whole build decision as one pure function, so it can be re-run cheaply
 * whenever fresh resources have loaded.
 *
 * Re-running matters more than it looks. Mothership fetches the visualiser
 * bundle asynchronously, well after DOMContentLoaded, so a content script that
 * samples `performance.getEntriesByType("resource")` once at startup sees the
 * shell's resources and none of the app's -- and concludes, wrongly, that no
 * branch build is running. Callers must treat this as a snapshot and ask again.
 */
export function assessBuild(
  resourceUrls: string[],
  search: string,
  stashedBranch: string | null,
): BuildAssessment {
  const apps = detectApps(resourceUrls);
  let claimed: string | null = null;
  try {
    claimed = new URLSearchParams(search).get(BRANCH_PARAM);
  } catch {
    claimed = null;
  }
  const build = resolveBuildContext(apps, claimed ?? stashedBranch);
  return { build, verdict: checkIntegrity(build, stashedBranch), apps };
}


/**
 * Refuse to annotate what we cannot identify.
 *
 * The failure this guards against is silent and expensive: the designer opens a
 * branch link, the router drops the param on a later navigation, the main
 * bundle is what actually renders, and every annotation they leave describes
 * code that is not on the PR. A blocked annotation is recoverable; a wrong one
 * is not.
 */
export function checkIntegrity(build: BuildContext, stashedBranch: string | null): IntegrityVerdict {
  const claimed = build.urlClaimsBranch || stashedBranch;

  // The two "not a branch build" cases used to carry different wording, and
  // named the branch and the bundle that loaded instead. That was diagnostic
  // detail for whoever wrote this, not for the designer: the required action is
  // identical either way, so they share one short message.
  if (!build.isBranchBuild) {
    return {
      ok: false,
      reason:
        "This page isn't running the pull request's build. " +
        'Open the staging link from the pull request.',
    };
  }

  if (claimed && build.branch && claimed !== build.branch) {
    return {
      ok: false,
      reason:
        'A different branch is loaded than this link asks for. ' +
        'Reload from the staging link in the pull request.',
    };
  }

  return { ok: true };
}
