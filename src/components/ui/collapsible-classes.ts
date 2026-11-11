/*
 * Upstream's cds `Collapsible` classes (shared-frame `CS`, `x1`, `wY`, `Ma`) and the narrow class merge its
 * trigger and panel apply to a caller's className. Local spellings: `font-control-regular` is upstream's
 * `font-normal font-control`, `duration-[60ms]` its `duration-fast`, `opacity-40` its `opacity-disabled`,
 * `duration-200` + the cubic-bezier its `duration-base ease-out`.
 * The caret's `motion-reduce:transition-none` is local: every transform transition here is gated (reduced-motion-setting).
 * The row-end caret's `stacks:` (fizzy-lake color) ink is unconditional because local fizzy-lake color is always on.
 */

export const COLLAPSIBLE_TRIGGER_CLASS =
	"cds-reset group/clp inline-flex w-fit items-center gap-1.5 border-0 select-none outline-none focus-visible:outline-hidden font-sans text-body font-control-regular text-secondary hover:text-primary transition-shadow duration-[60ms] focus-visible:shadow-focus rounded data-[disabled]:opacity-40 data-[disabled]:pointer-events-none";

export const COLLAPSIBLE_CARET_CLASS =
	"shrink-0 transition-transform group-data-[panel-open]/clp:rotate-90 group-data-[panel-open]/clp:page-rtl:-rotate-90 motion-reduce:transition-none";

export const ROW_END_CARET_INK = "text-[color:var(--cds-text-stays-secondary,var(--color-ink-muted))]";

/** Upstream `wY`: the height-animated disclosure panel, for Base UI panels and hand-rolled disclosures alike. */
export const DISCLOSURE_PANEL_CLASS =
	"break-words h-[var(--cds-disclosure-panel-height)] transition-[height] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:h-0 data-[ending-style]:h-0 data-[starting-style]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[ending-style]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[animating]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[starting-style]:contain-layout data-[ending-style]:contain-layout data-[animating]:contain-layout";

/** Upstream `Ma`. */
export const COLLAPSIBLE_PANEL_CLASS = `${DISCLOSURE_PANEL_CLASS} [--cds-disclosure-panel-height:var(--collapsible-panel-height)]`;

const TEXT_SIZE =
	/^text-(?:body|body-regular|caption|code|entry-floor|footnote|pane|pro|xs|sm|base|lg|\d?xl|\[[\d.]+(?:px|rem|em)\](?:\/.*)?)$/;
const TEXT_ALIGN = /^text-(?:left|center|right|justify|start|end)$/;
const TEXT_WRAP = /^text-(?:wrap|nowrap|balance|pretty|ellipsis|clip)$/;

/** The conflict group of one class, or null when it never conflicts. Only the groups the cds callers pass are known. */
function conflictGroup(token: string): string | null {
	const split = token.lastIndexOf(":");
	const variant = token.slice(0, split + 1);
	const utility = token.slice(split + 1);
	if (TEXT_SIZE.test(utility)) return `${variant}fontSize`;
	if (TEXT_ALIGN.test(utility)) return `${variant}textAlign`;
	if (TEXT_WRAP.test(utility)) return `${variant}textWrap`;
	if (utility.startsWith("text-")) return `${variant}textColor`;
	if (utility === "transition" || utility.startsWith("transition-")) return `${variant}transitionProperty`;
	return null;
}

/**
 * A narrow stand-in for upstream's tailwind-merge (`XZ`): a later class replaces an earlier one in the same group
 * (text size, ink, alignment, wrap, transition property), so a caller's `text-footnote` drops `text-body`.
 */
export function mergeClassNames(base: string, extra: string | undefined): string {
	if (extra === undefined || extra === "") return base;
	const tokens = [...base.split(" "), ...extra.split(" ")].filter((token) => token !== "");
	const lastIndexOfGroup = new Map<string, number>();
	tokens.forEach((token, index) => {
		const group = conflictGroup(token);
		if (group !== null) lastIndexOfGroup.set(group, index);
	});
	return tokens
		.filter((token, index) => {
			const group = conflictGroup(token);
			return group === null || lastIndexOfGroup.get(group) === index;
		})
		.join(" ");
}
