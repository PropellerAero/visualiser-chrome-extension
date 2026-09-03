/**
 * The design annotation overlay.
 *
 * Three controls: add a comment on an element, toggle the comments, close.
 * Everything renders inside a shadow root so it cannot interfere with the app
 * it is inspecting -- the visualiser runs MUI with a runtime class-name
 * prefixer, and leaking styles either way would be a real defect in a tool
 * whose job is to report visual defects accurately.
 *
 * Submission is copy-to-clipboard rather than a direct API call because
 * staging's CSP `connect-src` does not list GitHub, so no page code can reach
 * it. One click copies every comment as a single block to paste.
 */

import { describeDomTarget, describeSelector } from '../core/anchor';
import { ARM_PARAM, assessBuild, readStashedBranch, stashBranchParam } from '../core/branch';
import type { BuildAssessment } from '../core/branch';
import { captureAppState, capturePageContext } from '../core/context';
import { labelFor, toSharedMarkdown } from '../core/serialise';
import {
  chromeStorageAdapter,
  loadAnnotations,
  removeAnnotation,
  saveAnnotations,
  upsertAnnotation,
} from '../core/storage';
import { INTENT_META, intentMeta } from '../core/types';
import type {
  Annotation,
  AnnotationIntent,
  AnnotationTarget,
  BuildContext,
} from '../core/types';
import {
  ICON_COMMENT,
  ICON_EYE,
  ICON_HELP,
  ICON_PENCIL,
  ICON_SHARE,
  ICON_TRASH,
  OVERLAY_STYLES,
} from './styles';

const HOST_ID = 'prp-design-overlay-host';

/** Order shown to the designer: most common first. */
const INTENTS: Array<{ value: AnnotationIntent; label: string }> = (
  ['design-deviation', 'bug', 'new-idea', 'question'] as AnnotationIntent[]
).map((value) => ({ value, label: INTENT_META[value].label }));

const DEFAULT_INTENT: AnnotationIntent = 'design-deviation';

type Mode = 'idle' | 'picking';

export class DesignOverlay {
  private root: ShadowRoot;
  private panel: HTMLElement | null = null;
  private highlight: HTMLElement | null = null;
  private shield: HTMLElement | null = null;
  /** Marker shown between the click and the comment being saved. */
  private pendingPoint: { x: number; y: number } | null = null;
  private mode: Mode = 'idle';
  private showPins = true;
  private annotations: Annotation[] = [];
  private build: BuildContext;
  private stashedBranch: string | null;
  private storage = chromeStorageAdapter();
  private pinLayer: HTMLElement;
  /** Collapsed by default; remembered so a refresh does not close it. */
  private listOpen = false;
  private lastFigmaUrl: string | null = null;

  constructor() {
    stashBranchParam(window.location.search, sessionStorage);
    this.stashedBranch = readStashedBranch(sessionStorage);
    this.build = this.assess().build;

    const host = document.createElement('div');
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
    this.root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    this.root.appendChild(style);

    this.pinLayer = document.createElement('div');
    this.root.appendChild(this.pinLayer);

    this.renderLauncher();
    this.watchForLateBundles();
    void this.reload();
  }

  /**
   * Re-read the build state from whatever has loaded by now.
   *
   * Never cache this across a user action. Mothership fetches the visualiser
   * bundle asynchronously, long after the content script runs, so an assessment
   * taken at startup reports no branch build even on a correct branch link.
   */
  private assess(): BuildAssessment {
    const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
    return assessBuild(urls, window.location.search, this.stashedBranch);
  }

  /**
   * Notice the app bundle arriving after startup, and pick up its branch.
   *
   * Without this the panel would keep showing the startup verdict until the
   * user reloaded, which is the one thing the message tells them to do and the
   * one thing that would not help.
   */
  private watchForLateBundles(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const observer = new PerformanceObserver(() => {
        if (this.build.isBranchBuild) return;
        const next = this.assess();
        if (!next.build.isBranchBuild) return;
        this.build = next.build;
        observer.disconnect();
        void this.reload();
        if (this.panel) this.refreshPanel();
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // Without the observer the panel still re-assesses on every open.
    }
  }

  private async reload(): Promise<void> {
    if (!this.build.branch) return;
    this.annotations = await loadAnnotations(this.storage, this.build.branch);
    this.renderPins();
  }

  // ---------------------------------------------------------------- launcher

  private renderLauncher(): void {
    const button = document.createElement('button');
    button.className = 'launcher';
    button.title = 'Design feedback';
    button.innerHTML = ICON_PENCIL;
    button.addEventListener('click', () => this.togglePanel(button));
    this.root.appendChild(button);
  }

  private togglePanel(launcher: HTMLElement): void {
    if (this.panel) {
      this.closePanel(launcher);
      return;
    }
    launcher.dataset.active = 'true';
    this.panel = this.buildPanel(launcher);
    this.root.appendChild(this.panel);
  }

  private closePanel(launcher?: HTMLElement): void {
    this.stopPicking();
    this.panel?.remove();
    this.panel = null;
    const button = launcher ?? (this.root.querySelector('.launcher') as HTMLElement | null);
    if (button) delete button.dataset.active;
  }

  private buildPanel(launcher: HTMLElement): HTMLElement {
    const panel = el('div', 'panel');
    const header = el('header');
    header.append(text('span', 'Design feedback'));

    const actions = el('div', 'header-actions');
    actions.append(buildHelp());

    const close = document.createElement('button');
    close.textContent = '\u00D7';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.closePanel(launcher));
    actions.append(close);

    header.append(actions);
    panel.append(header);

    const body = el('div', 'body');
    panel.append(body);

    // Keystrokes must not escape the panel. Keyboard events are composed, so
    // they cross the shadow boundary and reach the app's document-level
    // shortcut handlers -- typing "d" in a comment was also triggering
    // whatever the page binds to "d". Stopping propagation (without
    // preventDefault) leaves typing, tabbing and button activation working
    // inside the panel while the page sees nothing.
    for (const name of ['keydown', 'keyup', 'keypress'] as const) {
      panel.addEventListener(name, (event) => event.stopPropagation());
    }

    // Re-assess on every open: the app bundle may have arrived since the last
    // look, which is the normal case on a freshly-loaded page.
    const assessment = this.assess();
    this.build = assessment.build;

    if (!assessment.verdict.ok) {
      const blocked = el('div', 'blocked');
      blocked.textContent = assessment.verdict.reason;
      body.append(blocked);

      const recheck = document.createElement('button');
      recheck.className = 'action';
      recheck.textContent = 'Check again';
      recheck.addEventListener('click', () => this.refreshPanel());
      body.append(recheck);
      return panel;
    }

    const pick = document.createElement('button');
    pick.className = 'action';
    pick.innerHTML = `${ICON_COMMENT}<span>Add comment</span>`;
    pick.addEventListener('click', () => this.togglePicking(pick));
    body.append(pick);

    const toggle = document.createElement('button');
    toggle.className = 'action';
    toggle.innerHTML = `${ICON_EYE}<span>${this.showPins ? 'Hide comments' : 'Show comments'}</span>`;
    toggle.addEventListener('click', () => {
      this.showPins = !this.showPins;
      const label = toggle.querySelector('span');
      if (label) label.textContent = this.showPins ? 'Hide comments' : 'Show comments';
      this.renderPins();
    });
    body.append(toggle);

    if (this.annotations.length === 0) {
      const empty = el('div', 'count');
      empty.textContent = 'No comments yet on this branch.';
      body.append(empty);
    } else {
      body.append(this.buildCollapsedList());
    }

    if (this.annotations.length > 0) {
      const share = document.createElement('button');
      share.className = 'action primary-action';
      share.innerHTML = `${ICON_SHARE}<span>Share with Ziggy (${this.annotations.length})</span>`;
      share.title = 'Copies every comment as one block, ready to paste into the pull request';
      share.addEventListener('click', () => void this.shareAll());
      body.append(share);

    }

    // The branch and app are not shown. They are recorded on every comment and
    // reported in the export, but the designer opened a link they trust and has
    // no decision to make from a branch name. The blocked state above is where
    // build identity actually matters, and it says so there.
    return panel;
  }

  /**
   * Every comment, collapsed by default.
   *
   * The markers only exist where their element is currently on screen, so a
   * comment whose element has scrolled away or sits behind a closed dialog is
   * otherwise unreachable. This is the way back to those.
   */
  private buildCollapsedList(): HTMLElement {
    const details = document.createElement('details');
    details.className = 'comment-list';
    details.open = this.listOpen;
    details.addEventListener('toggle', () => {
      this.listOpen = details.open;
    });

    const summary = document.createElement('summary');
    const n = this.annotations.length;
    summary.textContent = `${n} comment${n === 1 ? '' : 's'}`;
    details.append(summary);

    const list = el('ul', 'list');
    this.annotations.forEach((annotation, index) => {
      const item = document.createElement('li');

      const main = el('div', 'item-main');
      const title = el('div', 't');
      title.textContent = `${index + 1}. ${labelFor(annotation)}`;
      const sub = el('div', 's');
      sub.textContent = `${intentMeta(annotation.intent).label} · ${annotation.status}`;
      main.append(title, sub);

      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.innerHTML = ICON_PENCIL;
      edit.title = 'Edit this comment';
      edit.setAttribute('aria-label', `Edit comment ${index + 1}`);
      edit.addEventListener('click', () => this.openEdit(annotation));

      item.append(main, edit);
      list.append(item);
    });
    details.append(list);

    const deleteAll = document.createElement('button');
    deleteAll.className = 'delete-all';
    deleteAll.textContent = 'Delete all comments';
    deleteAll.addEventListener('click', () => this.confirmDeleteAll());
    details.append(deleteAll);

    return details;
  }

  /**
   * Ask before destroying everything.
   *
   * Rendered in the panel rather than via `window.confirm`, which blocks the
   * page and can be suppressed by the browser -- a suppressed confirm would
   * mean a silent delete-all.
   */
  private confirmDeleteAll(): void {
    const body = this.panel?.querySelector('.body');
    if (!body) return;

    const confirmView = el('div', 'form');
    const warning = el('div', 'blocked');
    warning.textContent = `Delete all ${this.annotations.length} comments on this branch? This cannot be undone.`;
    confirmView.append(warning);

    const buttons = el('div', 'buttons');
    const yes = document.createElement('button');
    yes.className = 'destructive';
    yes.textContent = 'Delete all';
    yes.addEventListener('click', () => void this.deleteAll());
    const no = document.createElement('button');
    no.className = 'secondary';
    no.textContent = 'Cancel';
    no.addEventListener('click', () => this.refreshPanel());
    buttons.append(yes, no);
    confirmView.append(buttons);

    body.replaceChildren(confirmView);
  }

  private async deleteAll(): Promise<void> {
    if (!this.build.branch) return;
    const removed = this.annotations.length;
    this.annotations = [];
    await saveAnnotations(this.storage, this.build.branch, []);
    this.renderPins();
    this.refreshPanel();
    this.toast(`Deleted ${removed} comment${removed === 1 ? '' : 's'}.`);
  }

  private refreshPanel(): void {
    if (!this.panel) return;
    const launcher = this.root.querySelector('.launcher') as HTMLElement;
    this.panel.remove();
    this.panel = this.buildPanel(launcher);
    this.root.appendChild(this.panel);
  }

  // ----------------------------------------------------------------- picking

  /**
   * Arm picking behind a transparent shield.
   *
   * Capture-phase listeners on `window` were not enough. Listeners on the same
   * node fire in registration order and the app registers its own long before
   * this overlay mounts, so `stopImmediatePropagation` could not undo a handler
   * that had already run -- the click still reached the page. A shield makes the
   * event TARGET ours, so the app never receives the interaction at all, and it
   * carries the crosshair cursor for free.
   */
  private togglePicking(button: HTMLElement): void {
    if (this.mode === 'picking') {
      this.stopPicking();
      delete button.dataset.active;
      return;
    }
    this.mode = 'picking';
    button.dataset.active = 'true';

    const shield = el('div', 'pick-shield');
    shield.addEventListener('pointermove', this.onShieldMove);
    shield.addEventListener('pointerdown', this.onShieldDown);
    shield.addEventListener('click', swallow);
    shield.addEventListener('contextmenu', swallow);
    this.shield = shield;
    this.root.appendChild(shield);
    // Existing markers sit above the shield, so without this a pin would
    // swallow a pick aimed at whatever is underneath it.
    this.pinLayer.style.pointerEvents = 'none';

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  private stopPicking(): void {
    this.mode = 'idle';
    this.shield?.remove();
    this.shield = null;
    this.pinLayer.style.pointerEvents = '';
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.highlight?.remove();
    this.highlight = null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.stopPicking();
      this.refreshPanel();
    }
  };

  private onShieldMove = (event: PointerEvent): void => {
    const target = this.appElementAt(event.clientX, event.clientY);
    if (target) this.drawHighlight(target);
  };

  private onShieldDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = this.appElementAt(event.clientX, event.clientY);
    if (!target) return;

    const point = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
    const annotationTarget = describeDomTarget(target, this.build, point);

    // Drop the marker now, not on save. The designer gets confirmation that the
    // right spot was captured while they are still writing the comment.
    this.pendingPoint = point;
    this.stopPicking();
    this.renderPins();
    this.openForm(annotationTarget);
  };

  /**
   * The topmost app element at a point, skipping anything of ours.
   *
   * Coordinates rather than `event.target`, because with the shield in place
   * the target is always the shield.
   */
  private appElementAt(x: number, y: number): Element | null {
    const host = this.root.host;
    for (const candidate of document.elementsFromPoint(x, y)) {
      if (candidate === host || host.contains(candidate)) continue;
      const rootNode = candidate.getRootNode();
      if (rootNode instanceof ShadowRoot && rootNode.host === host) continue;
      return candidate;
    }
    return null;
  }

  private drawHighlight(target: Element): void {
    if (!this.highlight) {
      this.highlight = el('div', 'highlight');
      this.highlight.append(el('span', 'tag'));
      this.root.appendChild(this.highlight);
    }
    const rect = target.getBoundingClientRect();
    Object.assign(this.highlight.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    const tag = this.highlight.querySelector('.tag') as HTMLElement;
    tag.textContent = describeSelector(target);
  }

  // -------------------------------------------------------------------- form

  private openForm(target: AnnotationTarget): void {
    this.ensurePanel();
    const body = this.panel?.querySelector('.body');
    if (!body) return;
    body.replaceChildren(this.buildForm(target, null));
    focusComment(body);
  }

  /** Open an existing comment for editing, reached by clicking its marker. */
  private openEdit(annotation: Annotation): void {
    this.ensurePanel();
    const body = this.panel?.querySelector('.body');
    if (!body) return;
    body.replaceChildren(this.buildForm(annotation.target, annotation));
    focusComment(body);
  }

  private ensurePanel(): void {
    if (this.panel) return;
    const launcher = this.root.querySelector('.launcher') as HTMLElement;
    this.togglePanel(launcher);
  }

  /**
   * Abandon the form and go back to the panel.
   *
   * Shared by the Cancel button and Escape so the two cannot drift -- in
   * particular, both must clear the pending marker, or a cancelled comment
   * would leave a stray pin on the page with nothing behind it.
   */
  private cancelForm(): void {
    this.pendingPoint = null;
    this.renderPins();
    this.refreshPanel();
  }

  private buildForm(target: AnnotationTarget, existing: Annotation | null): HTMLElement {
    const form = el('div', 'form');

    // Escape cancels. The listener sits on the form, not the panel: the panel
    // stops keyboard propagation to shield the app, and in the bubble phase
    // this inner listener runs first.
    form.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.cancelForm();
    });

    const bodyInput = document.createElement('textarea');
    bodyInput.placeholder = 'What is wrong, and what did you expect?';
    if (existing) bodyInput.value = existing.body;
    form.append(bodyInput);

    // Radios, not a dropdown: all four options visible at once so the designer
    // sees that "question" and "approve" are available without hunting.
    const group = el('div', 'radios');
    const name = `intent-${Date.now()}`;
    const selectedIntent = existing?.intent ?? DEFAULT_INTENT;
    INTENTS.forEach((intent) => {
      const label = el('label', 'radio');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = intent.value;
      if (intent.value === selectedIntent) input.checked = true;
      label.append(input, text('span', intent.label));
      group.append(label);
    });
    form.append(group);

    // Prefilled from the last comment: a designer usually compares several
    // findings against the same frame, and retyping the URL each time is the
    // kind of friction that gets a field left empty.
    const figma = document.createElement('input');
    figma.type = 'text';
    figma.placeholder = 'Figma frame URL (optional)';
    figma.value = existing?.figmaUrl ?? this.lastFigmaUrl ?? '';
    form.append(figma);

    // Nothing is shown when the element resolved cleanly: the testid and its
    // depth are the agent's business, and putting them in front of the designer
    // is jargon they cannot act on. The warning below is the exception, because
    // it IS actionable -- describing the element in words is the mitigation.
    if (!target.anchor.testId) {
      const note = el('div', 'anchor-note weak');
      note.textContent =
        'This element is hard to identify — describe it in words as well, so Ziggy can find it.';
      form.append(note);
    }

    if (existing?.status === 'shared') {
      // The pull request already holds the old wording, so editing here makes
      // the two disagree until it is shared again. Say so rather than let the
      // designer assume the PR updated itself.
      const stale = el('div', 'editing-note');
      stale.textContent = 'Already shared — edit it and share again to update the pull request.';
      form.append(stale);
    }

    const buttons = el('div', 'buttons');
    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      if (!bodyInput.value.trim()) {
        bodyInput.focus();
        return;
      }
      const selected = group.querySelector('input:checked') as HTMLInputElement | null;
      void this.save({
        target,
        existing,
        body: bodyInput.value,
        intent: (selected?.value as AnnotationIntent) ?? DEFAULT_INTENT,
        figmaUrl: figma.value.trim() || null,
      });
    });
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.cancelForm());
    buttons.append(save, cancel);

    if (existing) {
      const del = document.createElement('button');
      del.className = 'danger';
      del.innerHTML = ICON_TRASH;
      del.title = 'Delete this comment';
      del.setAttribute('aria-label', 'Delete this comment');
      del.addEventListener('click', () => void this.delete(existing));
      buttons.append(del);
    }

    form.append(buttons);
    return form;
  }

  private async save(input: {
    target: AnnotationTarget;
    existing: Annotation | null;
    body: string;
    intent: AnnotationIntent;
    figmaUrl: string | null;
  }): Promise<void> {
    if (!this.build.branch) return;
    const now = Date.now();
    const annotation: Annotation = {
      id: input.existing?.id ?? `ann_${now.toString(36)}`,
      createdAt: input.existing?.createdAt ?? now,
      updatedAt: now,
      // An edited comment goes back to draft: the shared copy on the pull
      // request is now stale, and the next share is what reconciles them.
      status: 'draft',
      body: input.body.trim(),
      intent: input.intent,
      target: input.target,
      figmaUrl: input.figmaUrl,
      build: this.build,
      page: input.existing?.page ?? capturePageContext(),
      appState: input.existing?.appState ?? captureAppState(),
    };
    this.lastFigmaUrl = input.figmaUrl ?? this.lastFigmaUrl;
    this.pendingPoint = null;
    this.annotations = await upsertAnnotation(this.storage, this.build.branch, annotation);
    this.renderPins();
    this.refreshPanel();
  }

  private async delete(annotation: Annotation): Promise<void> {
    if (!this.build.branch) return;
    this.annotations = await removeAnnotation(this.storage, this.build.branch, annotation.id);
    this.renderPins();
    this.refreshPanel();
  }

  // ------------------------------------------------------------------ output

  /** One button, one paste: every comment as a single titled document. */
  private async shareAll(): Promise<void> {
    if (this.annotations.length === 0 || !this.build.branch) return;

    await navigator.clipboard.writeText(toSharedMarkdown(this.annotations));

    const now = Date.now();
    this.annotations = this.annotations.map((a) =>
      a.status === 'draft' ? { ...a, status: 'shared' as const, updatedAt: now } : a,
    );
    await saveAnnotations(this.storage, this.build.branch, this.annotations);

    this.renderPins();
    this.refreshPanel();
    this.toast(`${this.annotations.length} comments copied. Paste into the pull request.`);
  }

  // -------------------------------------------------------------------- pins

  private renderPins(): void {
    this.pinLayer.replaceChildren();

    if (this.pendingPoint) {
      const pending = el('div', 'pin pending');
      pending.textContent = String(this.annotations.length + 1);
      pending.title = 'New comment — write it in the panel';
      pending.style.left = `${this.pendingPoint.x - 11}px`;
      pending.style.top = `${this.pendingPoint.y - 11}px`;
      this.pinLayer.append(pending);
    }

    if (!this.showPins) return;

    this.annotations.forEach((annotation, index) => {
      const point = annotation.target.clickPoint;
      const pin = el('div', 'pin');
      pin.dataset.status = annotation.status;
      pin.textContent = String(index + 1);
      pin.title = `${labelFor(annotation)} — click to edit`;
      pin.style.left = `${point.x - 11}px`;
      pin.style.top = `${point.y - 11}px`;
      pin.addEventListener('click', () => this.openEdit(annotation));
      this.pinLayer.append(pin);
    });
  }

  private toast(message: string): void {
    this.root.querySelector('.toast')?.remove();
    const toast = el('div', 'toast');
    toast.textContent = message;
    this.root.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * What this tool is, for someone seeing it for the first time.
 *
 * Three facts, in the order a reader needs them: what it does, that it is not
 * a supported product, and where it works. Anything longer does not get read.
 */
function buildHelp(): HTMLElement {
  const help = el('div', 'help');

  const trigger = document.createElement('button');
  trigger.className = 'help-trigger';
  trigger.innerHTML = ICON_HELP;
  trigger.setAttribute('aria-label', 'About this tool');
  // Focusable so the panel is reachable by keyboard, but it is not a control:
  // hovering or focusing is the whole interaction.
  trigger.type = 'button';
  help.append(trigger);

  const body = el('div', 'help-body');
  body.innerHTML =
    '<strong>Design feedback for Ziggy.</strong> Experimental, internal use ' +
    'only, and works on staging branch builds only.' +
    '<ol>' +
    '<li>Click to add a comment</li>' +
    '<li>Describe the problem, and classify it so Ziggy understands</li>' +
    '<li>When done, click "Share with Ziggy" to copy all comments to your clipboard</li>' +
    '<li>Paste the comment into the GitHub PR for this change</li>' +
    '</ol>' +
    // Worth stating because the absence is otherwise unexplainable: on a
    // staging link without the param there is no UI at all, so nothing can
    // tell the reader why. Someone who has seen this panel once will know.
    `This tool appears when <code>${ARM_PARAM}</code> is in the URL.<br><br>` +
    'Please reach out in #agent-labs for help.';
  help.append(body);

  return help;
}

function text(tag: string, content: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  return node;
}

/** Stop an interaction on the shield reaching anything. */
function swallow(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Put the caret in the comment box.
 *
 * Must run AFTER the form is in the document. The previous version called
 * `focus()` inside `buildForm`, while the element was still detached, and
 * focusing a detached element is a silent no-op -- so the designer had to click
 * the box before typing.
 */
function focusComment(body: Element): void {
  const input = body.querySelector('textarea');
  if (!(input instanceof HTMLTextAreaElement)) return;
  input.focus();
  // Caret after any existing text, so editing appends rather than prepends.
  input.setSelectionRange(input.value.length, input.value.length);
}
