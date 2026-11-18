/*
 * Upstream's neutral surface (`$9.neutral`): surface-1 with the `--cds-banner-neutral-tint` (alpha-1)
 * layer. Under fizzy-lake `color` its `stacks:` overrides (`TP`) swap both for the page fill and ring
 * the card in `--cds-fizzy-lake-color-banner-line`.
 */
export const NOTICE_SURFACE_CLASS =
{
	fizzy: "bg-page shadow-card-ring text-primary [--card-ring-color:var(--banner-line)]",
	base: "bg-surface-1 bg-[linear-gradient(var(--color-alpha-1)_0_0)] shadow-card-ring text-primary",
};
