/*
 * claude.ai/code's post-render separator helpers from c91a5e4a6: the trailing separator relabel `o` and the
 * click-anywhere-to-expand handler `i`.
 */

/** Pierre's copy for a trailing separator whose line count isn't known until the file is loaded. */
const UNKNOWN_CONTEXT = "More unchanged context may be available";

/** Upstream `hd.showMoreLines` (id `UT3lU0`). */
export const SHOW_MORE_LINES = "Show more lines";

/** Upstream `o`: rewrites the trailing separator's unknown-count copy; counted copy is left alone. */
export function relabelTrailingSeparator(host: HTMLElement, label: string): void
{
	for (const node of host.shadowRoot?.querySelectorAll("[data-separator-last] [data-unmodified-lines]") ?? [])
	{
		if (node.textContent === UNKNOWN_CONTEXT) node.textContent = label;
	}
}

/**
 * Upstream `i`, the diff body's click handler: a click inside a separator that didn't land on one of its expand
 * buttons clicks every expand button in that separator, so the "N unmodified lines" label expands the gap.
 */
export function expandSeparatorFromClick(event: Event): void
{
	let wrapper: Element | undefined;
	for (const target of event.composedPath())
	{
		if (!(target instanceof Element)) continue;
		if (target.hasAttribute("data-expand-button")) return;
		if (target.hasAttribute("data-separator-wrapper"))
		{
			wrapper = target;
			break;
		}
	}
	for (const button of wrapper?.querySelectorAll("[data-expand-button]") ?? [])
	{
		if (button instanceof HTMLElement) button.click();
	}
}
