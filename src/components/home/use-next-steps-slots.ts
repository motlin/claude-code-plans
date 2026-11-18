import {useState} from "react";

import {latchNextStepSlots, nextStepRowKey, type NextStepCandidate, type NextStepRow} from "../../lib/home-next-steps";

interface SlotLatch
{
	opening: number;
	keys: readonly string[];
	/** The row key the user dismissed; its slot closes instead of taking a newcomer. */
	putAway?: string;
}

export interface NextStepsSlots<C extends NextStepCandidate>
{
	/** The rows in their latched slots, or ranked before the first draw of this opening. */
	slots: NextStepRow<C>[];
	/** Records the drawn slots; call it during render once a held focus or open rest row has been released. */
	note: () => void;
	/** Closes a dismissed row's slot. */
	forget: (rowKey: string) => void;
}

/**
 * Upstream's per-opening slot latch (`yxe`): once drawn, the Next steps rows keep their slots for the rest of the
 * opening (`openingKey`), so a newcomer takes a slot freed by a row that left or goes last instead of jumping to its
 * ranked place. An empty list forgets the latch.
 */
export function useNextStepsSlots<C extends NextStepCandidate>({
	openingKey,
	ranked,
}: {
	openingKey: number;
	ranked: readonly NextStepRow<C>[];
}): NextStepsSlots<C>
{
	const [state, setState] = useState<SlotLatch | null>(null);
	const latch = state?.opening === openingKey ? state : null;
	const slots =
		latch === null
			? [...ranked]
			: latchNextStepSlots(
					ranked,
					latch.keys.filter(
						(key) => key !== latch.putAway || ranked.some((row) => nextStepRowKey(row) === key),
					),
				);
	return {
		slots,
		note: () =>
		{
			if (ranked.length === 0)
			{
				if (state !== null) setState(null);
				return;
			}
			const keys = slots.map(nextStepRowKey);
			if (latch !== null && keys.join("\n") === latch.keys.join("\n")) return;
			setState(
				{
					opening: openingKey,
					keys,
				},
			);
		},
		forget: (rowKey) =>
		{
			setState((previous) =>
				previous === null
					? previous
					:
						{
							...previous,
							putAway: rowKey,
						},
			);
		},
	};
}
