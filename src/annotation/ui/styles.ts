/**
 * Styles for the overlay, injected into a shadow root.
 *
 * A shadow root is not decoration here: the visualiser runs MUI with a runtime
 * class-name prefixer, and leaking styles either way would be a real defect in
 * a tool whose whole job is to report visual defects accurately.
 */
export const OVERLAY_STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

.launcher {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: 44px; height: 44px; border-radius: 22px; border: none;
  background: #1f2937; color: #fff; font-size: 18px; cursor: pointer;
  box-shadow: 0 2px 10px rgba(0,0,0,.3);
}
.launcher[data-active="true"] { background: #2563eb; }

.panel {
  position: fixed; right: 16px; bottom: 72px; z-index: 2147483000;
  width: 300px; background: #fff; border-radius: 8px;
  box-shadow: 0 6px 28px rgba(0,0,0,.28); overflow: hidden;
  font-size: 13px; color: #111827;
}
.panel header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; background: #1f2937; color: #fff; font-weight: 600;
}
.panel header button {
  background: none; border: none; color: #fff; cursor: pointer; font-size: 16px; line-height: 1;
}
.panel header .header-actions { display: flex; align-items: center; gap: 6px; }

/*
 * Help affordance. Hover-only and CSS-driven, so it carries no state and
 * cannot get stuck open. Deliberately dim until hovered: it is there for the
 * first-time reader and should not compete with the actual controls.
 */
.help { position: relative; display: flex; align-items: center; }
.help > .help-trigger { opacity: .6; display: flex; padding: 0; }
.help:hover > .help-trigger { opacity: 1; }
.help > .help-trigger svg { width: 14px; height: 14px; }
.help > .help-body {
  display: none; position: absolute; right: -4px; top: 22px; width: 258px;
  background: #111827; color: #e5e7eb; border-radius: 6px; padding: 9px 11px;
  font-size: 11.5px; font-weight: 400; line-height: 1.45;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
}
.help:hover > .help-body, .help:focus-within > .help-body { display: block; }
.help > .help-body strong { color: #fff; }
.help > .help-body ol { margin: 8px 0; padding-left: 18px; }
.help > .help-body li { margin-bottom: 4px; }
.help > .help-body li:last-child { margin-bottom: 0; }
.help > .help-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; background: #1f2937; padding: 1px 4px; border-radius: 3px;
  word-break: break-all;
}
.panel .body { padding: 12px; display: flex; flex-direction: column; gap: 8px; }

button.action {
  width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #d1d5db;
  background: #f9fafb; cursor: pointer; font-size: 13px; text-align: left;
  display: flex; align-items: center; gap: 8px;
}
button.action:hover { background: #f3f4f6; }
button.action[data-active="true"] { background: #dbeafe; border-color: #2563eb; }
button.action:disabled { opacity: .5; cursor: not-allowed; }
button.action svg { flex: 0 0 16px; width: 16px; height: 16px; }
button.action.primary-action { background: #2563eb; border-color: #2563eb; color: #fff; }
button.action.primary-action:hover { background: #1d4ed8; }

.radios { display: flex; gap: 4px; }
.radios .radio {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;
  padding: 6px 4px; border: 1px solid #d1d5db; border-radius: 5px;
  font-size: 12px; cursor: pointer; background: #f9fafb;
}
.radios .radio:has(input:checked) { background: #dbeafe; border-color: #2563eb; font-weight: 600; }
.radios .radio input { margin: 0; }

.blocked {
  padding: 10px; border-radius: 6px; background: #fef2f2;
  border: 1px solid #fecaca; color: #991b1b; line-height: 1.4;
}
.meta { color: #6b7280; font-size: 11px; line-height: 1.5; }
.count { color: #6b7280; font-size: 12px; }

/*
 * Transparent shield that swallows every interaction while picking.
 *
 * Capture-phase listeners on window were not enough: listeners on the same
 * node fire in registration order, and the app registers its own long before
 * the overlay mounts, so a click still reached the page. With a shield the
 * event TARGET is ours, so the app cannot receive it at all.
 *
 * Its z-index sits below the panel and launcher, so those stay clickable, and
 * above anything the app can reasonably paint.
 */
.pick-shield {
  position: fixed; inset: 0; z-index: 2147482990;
  background: transparent; cursor: crosshair;
}

/* devtools-style hover highlight */
.highlight {
  position: fixed; z-index: 2147482999; pointer-events: none;
  background: rgba(37,99,235,.18); border: 1px solid #2563eb;
}
.highlight .tag {
  position: absolute; top: -20px; left: 0; background: #2563eb; color: #fff;
  font-size: 11px; padding: 1px 5px; border-radius: 3px; white-space: nowrap;
}

.pin {
  position: fixed; z-index: 2147482998; width: 22px; height: 22px;
  border-radius: 11px; background: #2563eb; color: #fff; border: 2px solid #fff;
  font-size: 11px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 5px rgba(0,0,0,.35);
}
.pin[data-status="shared"] { background: #059669; }
/* Shown the instant the designer clicks, before the comment is written. */
.pin.pending { background: #f59e0b; border-style: dashed; cursor: default; }

.form { display: flex; flex-direction: column; gap: 8px; }
.form input[type="text"], .form textarea, .form select {
  width: 100%; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 5px;
  font-size: 13px; font-family: inherit;
}
.form textarea { min-height: 68px; resize: vertical; }
.form .row { display: flex; gap: 8px; }
.form .row > * { flex: 1; }
.form .buttons { display: flex; gap: 8px; align-items: stretch; }
.form .buttons button { flex: 1; padding: 7px; border-radius: 5px; cursor: pointer; font-size: 13px; }
.form .buttons .primary { background: #2563eb; color: #fff; border: none; }
.form .buttons .secondary { background: #f3f4f6; border: 1px solid #d1d5db; }
.form .buttons .danger {
  flex: 0 0 34px; display: flex; align-items: center; justify-content: center;
  background: #fff; border: 1px solid #fecaca; color: #b91c1c; padding: 0;
}
.form .buttons .danger:hover { background: #fef2f2; }
.form .buttons .danger svg { width: 15px; height: 15px; }
.form .editing-note { font-size: 11px; color: #b45309; }

.anchor-note { font-size: 11px; color: #6b7280; word-break: break-all; }
.anchor-note.weak { color: #b45309; }

details.comment-list { border: 1px solid #e5e7eb; border-radius: 6px; }
details.comment-list > summary {
  cursor: pointer; padding: 7px 9px; font-size: 12px; font-weight: 600;
  color: #374151; list-style: revert;
}
details.comment-list[open] > summary { border-bottom: 1px solid #e5e7eb; }
details.comment-list > .list { padding: 7px; }
details.comment-list > .delete-all {
  display: block; width: calc(100% - 14px); margin: 0 7px 7px; padding: 6px;
  font-size: 12px; border-radius: 5px; cursor: pointer;
  background: #fff; border: 1px solid #fecaca; color: #b91c1c;
}
details.comment-list > .delete-all:hover { background: #fef2f2; }

ul.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
ul.list li {
  border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px;
  display: flex; align-items: center; gap: 8px;
}
ul.list li .item-main { flex: 1; min-width: 0; }
ul.list li .t { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
ul.list li .s { font-size: 11px; color: #6b7280; }
ul.list li button.edit {
  flex: 0 0 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  border: 1px solid #d1d5db; border-radius: 5px; background: #f9fafb; cursor: pointer; padding: 0;
  color: #374151;
}
ul.list li button.edit:hover { background: #f3f4f6; }
ul.list li button.edit svg { width: 13px; height: 13px; }

.form .buttons .destructive { background: #b91c1c; color: #fff; border: none; }
.toast { position: fixed; right: 16px; bottom: 128px; z-index: 2147483001; background: #111827; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 12px; max-width: 300px; line-height: 1.4; }
`;

// Inline SVG rather than icon files: a content script cannot reference packaged
// assets without declaring web_accessible_resources, and these are ~200 bytes.
const SVG = (path: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const ICON_PENCIL = SVG(
  '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
);

export const ICON_COMMENT = SVG(
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
);

export const ICON_EYE = SVG(
  '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
);

export const ICON_SHARE = SVG(
  '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
);

export const ICON_HELP = SVG(
  '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4"/>' +
    '<path d="M12 17.5h.01"/>',
);

export const ICON_TRASH = SVG(
  '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
);
