/**
 * Upstream c91a5e4a6 `w` (exported `o`, built from its `x`/`b` helpers): the token weight and decoration rules,
 * where only the current mode's `--code-font-skip-*` var lets its token value through.
 */
export const TOKEN_FONT_CSS =
	'[data-line] span[style*="-font-weight"]{font-weight:var(--code-font-skip-dark,var(--diffs-token-dark-font-weight,inherit)) var(--code-font-skip-light,var(--diffs-token-light-font-weight,inherit))}' +
	'[data-line] span[style*="-text-decoration"]{text-decoration:var(--code-font-skip-dark,var(--diffs-token-dark-text-decoration,inherit)) var(--code-font-skip-light,var(--diffs-token-light-text-decoration,inherit))}' +
	'[data-line] span[style*="-dark-font-weight:bold"]{--code-font-dark-axes:normal}' +
	'[data-line] span[style*="-light-font-weight:bold"]{--code-font-light-axes:normal}' +
	'[data-line] span[style*="-font-weight"]{font-variation-settings:var(--code-font-skip-dark,var(--code-font-dark-axes,inherit)) var(--code-font-skip-light,var(--code-font-light-axes,inherit))}';

/**
 * Upstream `Qc`: the code tile's `unsafeCSS`, with cd6004fd7 `m` (ligatures on, letter-spacing snapped to 1/64px),
 * the token font rules spliced in, and c2479da9f `w` (the RTL file view sets `--epitaxy-file-line-bidi: plaintext`).
 * `--cds-leading-code` / `--cds-font-mono` map to the local tokens.
 */
export const CODE_TILE_CSS =
	':host, [data-file], [data-diff] { --diffs-bg: transparent; }:host { font-size: inherit; } [data-file] { --diffs-font-size: 1em; --diffs-line-height: var(--code-leading, var(--upstream-leading-code)); --diffs-font-family: var(--font-mono); --diffs-gap-inline: 0; --diffs-gap-block: 0; letter-spacing: calc(round(up, 1ch, 1px / 64) - 1ch); font-feature-settings: "liga", "clig", "calt"; } [data-code] { overflow: clip; } [data-line] { min-height: 1lh; padding-inline: 0; line-height: var(--code-leading, var(--upstream-leading-code)); } ' +
	TOKEN_FONT_CSS +
	"[data-line] { unicode-bidi: var(--epitaxy-file-line-bidi, revert); }";

/** Upstream c5071af19 `J`: one trailing newline dropped, and each lone `\r` shown as ␍. */
export function normalizeTileCode(code: string): string
{
	return code.replace(/\r?\n$/, "").replace(/\r(?!\n)/g, "␍");
}

/** Upstream `Y_`: a command longer than this many characters scrolls in a frame. */
const FRAMED_COMMAND_CHARS = 300;
/** Upstream's line limit beside `Y_`: a command with more lines scrolls in a frame. */
const FRAMED_COMMAND_LINES = 10;

/** Upstream `hv`: whether a command is long enough to scroll inside `CommandFrame`. */
export function commandNeedsFrame(command: string): boolean
{
	return command.length > FRAMED_COMMAND_CHARS || command.split("\n").length > FRAMED_COMMAND_LINES;
}
