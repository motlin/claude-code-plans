/*
 * Upstream ca9e46d28 `q` (gate `__gb__182472174`, a kill switch; always on locally): classic diffs trade the
 * coloured `+`/`−` for a 6px rail in the line-number column (solid for additions, 135° stripes for deletions),
 * keep the glyphs at opacity 0 with CSS alt text, and bring them back under forced colors / more contrast.
 * The minified names are upstream's.
 */
const N = ":is([data-line],[data-no-newline])";
const P = `[data-indicators="classic"] ${N}`;
const F = ':is([data-column-number],[data-gutter-buffer="metadata"])';
const I = '[data-line-type="change-addition"]';
const L = '[data-line-type="change-deletion"]';
const R = `:is(${I},${L})`;
/** Upstream c4860ec62 `p` (forced-colors or more contrast). */
const z = "@media (forced-colors:active),(prefers-contrast:more)";
/** Upstream ca9e46d28 `B`: the glyphs (U+2212 minus for deletions). */
const B =
{
	additions: "+",
	deletions: "−",
} as const;
/** Upstream ca9e46d28 `V`: change-row `--mix-light`/`--mix-dark`. */
const V =
{
	additions:
	{
		light: "88%",
		dark: "80%",
	},
	deletions:
	{
		light: "91.5%",
		dark: "90%",
	},
} as const;
const H =
	":host{--diff-rail-added:light-dark(color-mix(in lab,var(--diffs-addition-base) 86%,black),color-mix(in lab,var(--diffs-addition-base) 80%,var(--diffs-bg)));--diff-rail-removed:light-dark(color-mix(in lab,var(--diffs-deletion-base) 90%,black),color-mix(in lab,var(--diffs-deletion-base) 76%,white))}";
const U = "6px";
const W = `${U} + 2px`;
const G = ":host([data-add-button]) [data-diff]:not([data-disable-line-numbers])";
const K =
{
	box: `content:"";position:absolute;left:0;width:${U};top:0;bottom:0;pointer-events:none`,
	additions: "background:var(--diff-rail-added)",
	deletions:
		"background:linear-gradient(135deg,var(--diff-rail-removed) 25%,transparent 25% 50%,var(--diff-rail-removed) 50% 75%,transparent 75%) 0 0/calc(var(--diffs-line-height,20px) / 4) calc(var(--diffs-line-height,20px) / 4)",
	forcedColors: "forced-color-adjust:none;--diff-rail-added:CanvasText;--diff-rail-removed:CanvasText",
} as const;
/** Upstream c4860ec62 `d`: the features the sheet needs. */
const SUPPORTS = '(content:"x" / "y") and (color:light-dark(red,red)) and (color:color-mix(in lab,red,red))';

export const DIFF_RAILS_CSS = `@supports ${SUPPORTS}{${[
	H,
	`${P}{padding-inline-start:1ch}`,
	`${P}${R}::before{opacity:0}`,
	`${P}${I}::before{content:"${B.additions}" / var(--diff-word-added,"added")}`,
	`${P}${L}::before{content:"${B.deletions}" / var(--diff-word-removed,"removed")}`,
	`${z}{${P}{padding-inline-start:2ch}${P}${R}::before{opacity:1}}`,
	`:host ${F}${R}{box-shadow:none}`,
	`${F}${R}::after{${K.box}}`,
	`[data-diff][data-disable-line-numbers] ${F}{min-width:calc(${U} + 3px)}`,
	`${F}${I}::after{${K.additions}}`,
	`${F}${L}::after{${K.deletions}}`,
	`${F}[data-rail-start]::after{border-top-left-radius:1px;border-top-right-radius:1px}`,
	`${F}[data-rail-end]::after{border-bottom-left-radius:1px;border-bottom-right-radius:1px}`,
	`@media (forced-colors:active){${F}${R}::after{${K.forcedColors}}}`,
	"[data-gutter-utility-slot]{z-index:2}",
	`${G} [data-gutter-utility-slot]{left:calc(${W} + 0.125rem)}`,
	`${G} [data-column-number]{padding-left:max(2ch + 5px,${W} + 1rem + 1px)}`,
	`${F}${I}{--mix-light:${V.additions.light};--mix-dark:${V.additions.dark}}`,
	`:is(${F},${N})${L}{--mix-light:${V.deletions.light};--mix-dark:${V.deletions.dark}}`,
].join("")}}`;

/** Upstream `Q()`'s host style: the alt words the rails sheet's `content: … / var(--diff-word-*)` reads. */
export const DIFF_WORD_STYLE =
{
	"--diff-word-added": '"added"',
	"--diff-word-removed": '"removed"',
} as const;

export interface DiffSheetAdopter
{
	(host: Element): void;
	setDisabled(disabled: boolean): void;
}

/**
 * Upstream c91a5e4a6 `T()`: one constructed sheet per window, appended to a host's shadow root only if it
 * isn't there yet. `setDisabled` flips every sheet it made (upstream's growthbook gate flips).
 */
export function adoptDiffSheet(css: string): DiffSheetAdopter
{
	const sheets = new WeakMap<Window, CSSStyleSheet>();
	const made: WeakRef<CSSStyleSheet>[] = [];
	let disabled = false;
	const adopt = (host: Element): void =>
	{
		const root = host.shadowRoot;
		const win = host.ownerDocument.defaultView;
		if (!root || !win || typeof win.CSSStyleSheet !== "function") return;
		let sheet = sheets.get(win);
		if (!sheet)
		{
			sheet = new win.CSSStyleSheet();
			sheet.replaceSync(css);
			sheet.disabled = disabled;
			sheets.set(win, sheet);
			made.push(new WeakRef(sheet));
		}
		if (!root.adoptedStyleSheets.includes(sheet))
		{
			root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
		}
	};
	const setDisabled = (next: boolean): void =>
	{
		disabled = next;
		for (const ref of made)
		{
			const sheet = ref.deref();
			if (sheet) sheet.disabled = next;
		}
	};
	return Object.assign(
		adopt,
		{
			setDisabled,
		},
	);
}

/** Upstream ca9e46d28 `J`. */
export const adoptRails = adoptDiffSheet(DIFF_RAILS_CSS);

/**
 * Upstream ca9e46d28 `Q(wordDiff, addButton).draw` as a pierre `onPostRender`: on every mount and update,
 * adopt the rails sheet, re-mark the runs and set `data-add-button` (the Changes pane's `!readOnly`).
 */
export function railsPostRender(addButton: boolean): (node: HTMLElement, instance: unknown, phase: string) => void
{
	return (node, _instance, phase) =>
	{
		if (phase === "unmount") return;
		adoptRails(node);
		markRailRuns(node);
		node.toggleAttribute("data-add-button", addButton);
	};
}

/** Upstream ca9e46d28 `Y`. */
function isChangeRow(row: Element | null): boolean
{
	const type = row?.getAttribute("data-line-type");
	return type === "change-addition" || type === "change-deletion";
}

/**
 * Upstream ca9e46d28 `X()`: in every `[data-gutter]`, the first row of a change run gets `data-rail-start`
 * and the last gets `data-rail-end`; every other row loses both. Re-run after each render, since virtual
 * windows and expanded hunks re-create rows.
 */
export function markRailRuns(host: Element): void
{
	for (const gutter of host.shadowRoot?.querySelectorAll("[data-gutter]") ?? [])
	{
		let previous = false;
		let row = gutter.firstElementChild;
		let current = isChangeRow(row);
		while (row)
		{
			const next = row.nextElementSibling;
			const nextIsChange = isChangeRow(next);
			row.toggleAttribute("data-rail-start", current && !previous);
			row.toggleAttribute("data-rail-end", current && !nextIsChange);
			previous = current;
			current = nextIsChange;
			row = next;
		}
	}
}
