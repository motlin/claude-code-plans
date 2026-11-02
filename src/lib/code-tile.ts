/**
 * Upstream c91a5e4a6 `w` (exported `o`, built from its `x`/`b` helpers): the token weight and decoration rules,
 * where only the current mode's `--code-font-skip-*` var lets its token value through.
 */
const TOKEN_FONT_CSS =
	'[data-line] span[style*="-font-weight"]{font-weight:var(--code-font-skip-dark,var(--diffs-token-dark-font-weight,inherit)) var(--code-font-skip-light,var(--diffs-token-light-font-weight,inherit))}' +
	'[data-line] span[style*="-text-decoration"]{text-decoration:var(--code-font-skip-dark,var(--diffs-token-dark-text-decoration,inherit)) var(--code-font-skip-light,var(--diffs-token-light-text-decoration,inherit))}' +
	'[data-line] span[style*="-dark-font-weight:bold"]{--code-font-dark-axes:normal}' +
	'[data-line] span[style*="-light-font-weight:bold"]{--code-font-light-axes:normal}' +
	'[data-line] span[style*="-font-weight"]{font-variation-settings:var(--code-font-skip-dark,var(--code-font-dark-axes,inherit)) var(--code-font-skip-light,var(--code-font-light-axes,inherit))}';

/**
 * Upstream `Qc`: the code tile's `unsafeCSS`, with cd6004fd7 `m` (ligatures on, letter-spacing snapped to 1/64px)
 * and the token font rules spliced in. `--cds-leading-code` / `--cds-font-mono` map to the local tokens.
 */
export const CODE_TILE_CSS =
	':host, [data-file], [data-diff] { --diffs-bg: transparent; }:host { font-size: inherit; } [data-file] { --diffs-font-size: 1em; --diffs-line-height: var(--code-leading, var(--upstream-leading-code)); --diffs-font-family: var(--font-mono); --diffs-gap-inline: 0; --diffs-gap-block: 0; letter-spacing: calc(round(up, 1ch, 1px / 64) - 1ch); font-feature-settings: "liga", "clig", "calt"; } [data-code] { overflow: clip; } [data-line] { min-height: 1lh; padding-inline: 0; line-height: var(--code-leading, var(--upstream-leading-code)); } [data-line]:hover { background: transparent; } ' +
	TOKEN_FONT_CSS;

/** Upstream c5071af19 `J`: one trailing newline dropped, and each lone `\r` shown as ␍. */
export function normalizeTileCode(code: string): string
{
	return code.replace(/\r?\n$/, "").replace(/\r(?!\n)/g, "␍");
}
