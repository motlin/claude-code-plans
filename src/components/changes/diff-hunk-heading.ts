import type {FileDiffMetadata, Hunk} from "@pierre/diffs";
import {adoptDiffSheet} from "./diff-rails";

/*
 * Upstream c91a5e4a6 `h`/`g` (kill switch `__gb__662002787`; always on locally): each Changes-pane
 * "N unmodified lines" separator also shows the `@@ … @@ <context>` of the hunk below it, unless the
 * enclosing scope is already visible inside that hunk. The regexes are upstream's `l/u/d/f/p/m`.
 */

/** Upstream `l`: an identifier, or a markdown ATX heading. */
const HEADING_PATTERNS = [/^[A-Za-z_$]/, /^ {0,3}#{1,6}[ \t]/] as const;
/** Upstream `u`. */
const PROSE_FILE = /(\.(md|mdx|markdown|txt|rst|adoc)|(^|\/)(readme|license|changelog|notice|authors|copying))$/i;
/** Upstream `d`. */
const STYLE_FILE = /\.(css|pcss|postcss|scss|sass|sss|less|styl|stylus)$/i;
/** Upstream `f`. */
const BLOCK_CLOSER = /^(end|fi|esac|done)$/;
/** Upstream `p`. */
const ACCESS_LABEL = /^(public|private|protected):$/;
/** Upstream `m`. */
const LABEL_FRIENDLY_FILE = /(\.(ya?ml|mk)|(^|\/)(GNU)?makefile)$/i;

/** Upstream c91a5e4a6 `h`: the heading to show for `hunk`, or `undefined` for none. */
export function hunkHeading(fileDiff: FileDiffMetadata, hunk: Hunk): string | undefined {
	const context = hunk.hunkContext?.trim();
	const pattern = HEADING_PATTERNS.find((regex) => context !== undefined && context !== "" && regex.test(context));
	if (
		STYLE_FILE.test(fileDiff.name) ||
		(context && BLOCK_CLOSER.test(context)) ||
		(context && ACCESS_LABEL.test(context) && !LABEL_FRIENDLY_FILE.test(fileDiff.name)) ||
		(pattern === HEADING_PATTERNS[0] && PROSE_FILE.test(fileDiff.name))
	) {
		return undefined;
	}
	const change = hunk.hunkContent.find((content) => content.type === "change");
	if (!context || !pattern || !change) return context === "" ? undefined : context;
	const visible = [
		...fileDiff.additionLines.slice(hunk.additionLineIndex, change.additionLineIndex + change.additions),
		...fileDiff.deletionLines.slice(
			change.deletionLineIndex,
			change.deletionLineIndex + (change.additions ? 0 : change.deletions),
		),
	];
	return visible.some((line) => pattern.test(line)) ? undefined : context;
}

/** Upstream c91a5e4a6 `I`: which side a diff row belongs to. */
function rowSide(row: Element): "additions" | "deletions" {
	return row.getAttribute("data-line-type") === "change-deletion" || row.closest("[data-deletions]") !== null
		? "deletions"
		: "additions";
}

const GUTTER_LABELS = "[data-code]:not([data-additions]) > [data-gutter] > [data-separator] [data-unmodified-lines]";

/**
 * Upstream c91a5e4a6 `g`: wrap each visible gutter separator label's count in `[data-unmodified-count]`
 * and append a `[data-hunk-heading]` for the hunk below it; without a heading (or a fileDiff) undo both.
 * Idempotent, so it runs after every render.
 */
export function decorateHunkHeadings(host: Element, fileDiff: FileDiffMetadata | undefined): void {
	for (const label of host.shadowRoot?.querySelectorAll(GUTTER_LABELS) ?? []) {
		const next = label.closest("[data-separator]")?.nextElementSibling;
		const start = Number(next?.getAttribute("data-column-number") ?? Number.NaN);
		const deletions = next !== null && next !== undefined && rowSide(next) === "deletions";
		const hunk = fileDiff?.hunks.find((h) => (deletions ? h.deletionStart : h.additionStart) === start);
		const text = fileDiff && hunk && hunkHeading(fileDiff, hunk);
		let heading = label.querySelector("[data-hunk-heading]");
		if (!text) {
			const count = label.querySelector("[data-unmodified-count]");
			count?.replaceWith(...count.childNodes);
			heading?.remove();
			continue;
		}
		if (!heading) {
			const count = label.ownerDocument.createElement("span");
			count.setAttribute("data-unmodified-count", "");
			count.append(...label.childNodes);
			heading = label.ownerDocument.createElement("span");
			heading.setAttribute("data-hunk-heading", "");
			label.append(count, heading);
		}
		if (heading.textContent !== text) {
			heading.textContent = text;
			heading.setAttribute("title", text);
		}
	}
}

/**
 * The hunk-heading rules of upstream c91a5e4a6 sheet `C`, verbatim and in order. Upstream ships them in
 * one sheet with the line-number-ink rules; merge when diff-code-theme-line-number-ink lands.
 */
export const HUNK_HEADING_CSS = [
	"[data-hunk-heading]{margin-inline-start:.5ch;font-family:var(--diffs-font-family,var(--diffs-font-fallback));line-height:0;white-space:pre;unicode-bidi:isolate}",
	'[data-hunk-heading]::before{content:" "}',
	"[data-separator-content]:has([data-unmodified-count]):hover{text-decoration:none}",
	"[data-expand-index] [data-separator-content]:hover [data-unmodified-count]{text-decoration:underline}",
	"[data-unmodified-lines]:has(>[data-hunk-heading]){max-width:calc(100cqi - 56px)}",
	'[data-diff-type="split"][data-overflow="wrap"] [data-hunk-heading]{display:none}',
].join("");

/** Upstream c91a5e4a6 `E` (adopts sheet `C`), limited to the hunk-heading rules. */
export const adoptHunkHeadingCss = adoptDiffSheet(HUNK_HEADING_CSS);
