/**
 * Upstream's shared announcer (shared-59 `Px`/`Pd`): one polite sr-only live region on the body, holding
 * one message per key so a caller can replace or clear its own announcement without touching others.
 */

const REGION_ID = "live-announcer";

function liveRegion(): HTMLElement
{
	const existing = document.getElementById(REGION_ID);
	if (existing !== null) return existing;
	const region = document.createElement("div");
	region.id = REGION_ID;
	region.className = "sr-only";
	region.setAttribute("aria-live", "polite");
	region.setAttribute("aria-atomic", "false");
	document.body.append(region);
	return region;
}

function messageFor(region: HTMLElement, key: string): HTMLElement | undefined
{
	return [...region.children].find(
		(child): child is HTMLElement => child instanceof HTMLElement && child.dataset["announceKey"] === key,
	);
}

/** Upstream `Px(text, key)`: read `text` politely, replacing whatever `key` announced before. */
export function announce(text: string, key: string): void
{
	const region = liveRegion();
	const message = messageFor(region, key);
	if (message !== undefined)
	{
		message.textContent = text;
		return;
	}
	const added = document.createElement("div");
	added.dataset["announceKey"] = key;
	added.textContent = text;
	region.append(added);
}

/** Upstream `Pd(key)`: drop `key`'s announcement. */
export function clearAnnouncement(key: string): void
{
	const region = document.getElementById(REGION_ID);
	if (region === null) return;
	messageFor(region, key)?.remove();
}
