import {isAvailable, landFocusTarget} from "./focus-regions";
import {nameStopByText} from "./stop-name";

/**
 * Upstream's `question` focus region: the palette's "Jump to question" lands
 * on the next waiting card, transcript cards before dock cards (beside the
 * composer), and draws the cds overlay focus ring on it until focus moves.
 */
export const WAITING_CARD_SELECTOR = "[data-approval-card-root]";

/**
 * Upstream's codeChat region resolver over `waitingCardRoots` (question slot →
 * inline approval slot → composer column): the shown waiting cards in the
 * transcript in document order, then those beside the composer, landing on
 * the card after the one holding `from`, else on the first.
 */
export function findWaitingCard(root: Document, from: Element | null = null): HTMLElement | null
{
	const all = [...root.querySelectorAll<HTMLElement>(WAITING_CARD_SELECTOR)].filter(isAvailable);
	const dock = root.querySelector('[data-focus-region="composer"]')?.parentElement ?? null;
	const docked = dock === null ? [] : all.filter((card) => dock.contains(card));
	const cards = [...all.filter((card) => !docked.includes(card)), ...docked];
	const index = from === null ? -1 : cards.findIndex((card) => card.contains(from));
	return (index === -1 ? cards[0] : (cards[index + 1] ?? cards[0])) ?? null;
}

/**
 * Upstream's `It` → `G`: scroll the card into view and land on it with the
 * overlay ring (and a temporary tabindex and `nO` name when it lacks them),
 * all undone when focus moves elsewhere or the card is pressed.
 */
export function landOnWaitingCard(card: HTMLElement): void
{
	card.scrollIntoView(
		{
			block: "nearest",
		},
	);
	landFocusTarget(
		card,
		{
			ring: true,
			ringOn: card,
			prepare: () => nameStopByText(card),
		},
	);
}
