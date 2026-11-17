import {type RefObject, useEffect, useRef} from "react";

/** Upstream's `ES` delay between clearing the region and setting its text, so a screen reader hears the change. */
const ANNOUNCE_DELAY_MS = 50;

export interface ApprovalAnnouncement
{
	/** The card's tool call; null with no card. */
	toolId: string | null;
	/** What to read; null reads nothing. */
	text: string | null;
	/** Upstream's dedupe key (the text without late-filling titles); defaults to the text. */
	key?: string | null;
	/** The card: focus inside it already reads its label, so the region stays quiet. */
	cardRef: RefObject<HTMLElement | null>;
	/** False skips the card already pending when the region mounted. */
	announceOnMount?: boolean;
}

/**
 * Upstream's arrival announcer (cc32965c2 `ES`): writes a card's text into the polite status `regionRef`, once per
 * tool call and key. It clears the region, then sets the text 50ms later unless focus is already in the card.
 */
export function useApprovalAnnouncement(
	regionRef: RefObject<HTMLElement | null>,
	{toolId, text, key = text, cardRef, announceOnMount = true}: ApprovalAnnouncement,
): void
{
	const mountToolId = useRef(toolId);
	const last = useRef<
	{
		toolId: string | null;
		key: string | null;
	} | null>(null);
	useEffect(() =>
	{
		const region = regionRef.current;
		if (region === null) return undefined;
		const skip =
			text === null ||
			text === "" ||
			(!announceOnMount && toolId === mountToolId.current) ||
			(last.current?.toolId === toolId && last.current.key === key);
		if (skip)
		{
			if (toolId !== last.current?.toolId)
			{
				region.textContent = "";
				last.current = null;
			}
			return undefined;
		}
		region.textContent = "";
		const timer = setTimeout(() =>
		{
			if (cardRef.current?.contains(region.ownerDocument.activeElement) !== true) region.textContent = text;
			last.current =
			{
				toolId,
				key,
			};
		}, ANNOUNCE_DELAY_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [regionRef, toolId, text, key, cardRef, announceOnMount]);
}
