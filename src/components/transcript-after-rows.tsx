import type {KeyboardEvent, ReactNode, Ref} from "react";

import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";

/** Upstream's sticky top (c4a70913c `y`): below the top fade, the suggested-task chip and the sticky prompt. */
const TRANSCRIPT_STICKY_TOP_CLASS =
	"top-[calc(max(var(--epitaxy-top-fade-height,0px),var(--fade-top,0px),var(--epitaxy-suggested-task-end,0px),var(--epitaxy-sticky-prompt-end,0px))+5px)]";

/** Upstream `hTe`: the inline approval cards stick under the top fade, and fall below the tail when one holds a tool card in flow. */
const CARDS_CLASS = `${CHAT_COLUMN_CLASS} w-full sticky has-[.epitaxy-tool-card-in-flow]:order-last ${TRANSCRIPT_STICKY_TOP_CLASS} bg-[var(--epitaxy-transcript-surface,var(--color-surface-1))]`;

const SHOWN_ACTIONS = "[[data-transcript-tail-turn]:has(>[data-transcript-last-row-controls]:not(:empty))+&]";

/** Upstream `mTe`: a turn gap above the chrome, or `mt-xs` under a tail turn whose actions are shown. */
const CHROME_CLASS = `${CHAT_COLUMN_CLASS} flex w-full flex-col gap-[var(--chat-turn-gap)] pt-[var(--chat-turn-gap)] ${SHOWN_ACTIONS}:pt-0 ${SHOWN_ACTIONS}:mt-xs empty:hidden`;

const PART_CLASS = `${CHAT_COLUMN_CLASS} w-full empty:hidden`;

/** Upstream `Xt`: Home and End inside a card stay in the card instead of jumping the feed. */
function stopHomeEnd(event: KeyboardEvent)
{
	if (event.key === "Home" || event.key === "End") event.stopPropagation();
}

/** Upstream's shared-arm part props: a continuation of the last turn for feed navigation. */
const CONTINUES_TURN =
{
	"data-find-omitted": "",
	"data-transcript-continues-turn": "",
	role: "presentation",
	onKeyDown: stopHomeEnd,
} as const;

/**
 * Upstream's after-rows block (`w8` in its legacy arm's `transcript-after-rows`): what the session draws below its last
 * row. Before-cards, then the sticky inline approval cards, the tail turn (the turn box with the last turn's actions
 * outlet under it) and the tail chrome (working line and mark outlet). Each part carries its own chat column.
 */
export function TranscriptAfterRows({
	beforeCards,
	cards,
	turnBox,
	chrome,
	actionsOutletRef,
}: {
	beforeCards?: ReactNode;
	cards?: ReactNode;
	turnBox?: ReactNode;
	/** `undefined` draws no chrome; anything else, `null` included, draws the (possibly empty) chrome. */
	chrome?: ReactNode;
	actionsOutletRef?: Ref<HTMLDivElement>;
})
{
	if (beforeCards == null && cards == null && turnBox == null && chrome === undefined) return null;
	return (
		<div data-testid="transcript-after-rows">
			<div
				data-testid="transcript-before-cards"
				data-transcript-before-cards=""
				{...CONTINUES_TURN}
				className={PART_CLASS}
			>
				{beforeCards}
			</div>
			{/* Upstream's tail: a turn box below a row left empty by a carried turn mark starts gap-xs below it */}
			<div
				data-transcript-tail=""
				className="flex flex-col [reading-flow:flex-visual] [[data-transcript-before-cards]:empty+&[data-row-left-empty]_[data-turn-box]]:!mt-xs"
			>
				<div
					data-testid="transcript-trailing-slot"
					data-find-omitted=""
					data-transcript-cards=""
					data-transcript-continues-turn=""
					role="presentation"
					onKeyDown={stopHomeEnd}
					className={CARDS_CLASS}
					// Upstream's layer-aware z-index: one above the transcript layer.
					style={
					{
						zIndex: 1,
					}}
				>
					{cards}
				</div>
				<div>
					{turnBox != null && (
						// `group/msg` is local's name for upstream's `group/message-row`, so hovering the box reveals the actions.
						<div data-transcript-tail-turn="" className="group/msg flex w-full flex-col gap-xs">
							<div data-testid="transcript-tail-slot" data-find-omitted="" className={PART_CLASS}>
								{turnBox}
							</div>
							<div
								ref={actionsOutletRef}
								data-testid="transcript-tail-actions"
								data-find-omitted=""
								data-transcript-last-row-controls=""
								className={PART_CLASS}
							/>
						</div>
					)}
					{chrome !== undefined && (
						<div data-testid="transcript-tail-chrome" {...CONTINUES_TURN} className={CHROME_CLASS}>
							{chrome}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
