import type {QueuedPrompt} from "../lib/composer-queue";
import {ParkedNoticeBand} from "./usage-pace-banner";
import {QueuedMessageBar} from "./queued-message-bar";

export interface ParkedMessageBarProps
{
	/** Keys the joined queue list's remembered expansion. */
	sessionId: string;
	/** The parked prompts, head first. */
	items: readonly QueuedPrompt[];
	willAutoSend: boolean;
	/** The window's reset, epoch seconds; the detail shows only while it is ahead. */
	resetsAt: number | undefined;
	archived: boolean;
	/** A flush is running: Send anyway is busy. */
	flushing: boolean;
	onSendAnyway: () => void;
	onEdit: (item: QueuedPrompt) => void;
	onRemove: (id: string) => void;
	/**
	 * Upstream's `listInTranscript`: the parked rows draw in the transcript and the held count joins the usage-limit
	 * band, so the dock bar renders nothing.
	 */
	listInTranscript?: boolean;
	/** Test seam for the reset's time zone. */
	timeZone?: string;
}

/**
 * claude.ai/code's `EpitaxyParkedMessageBar` dock variant (`dj`): a notice band ("You hit your usage limit. …", the
 * reset, Send anyway) squared off at the bottom, over the parked messages as a QueuedMessageBar joined to it with no
 * Send now, Clear all or reorder.
 */
export function ParkedMessageBar({
	sessionId,
	items,
	willAutoSend,
	resetsAt,
	archived,
	flushing,
	onSendAnyway,
	onEdit,
	onRemove,
	listInTranscript = false,
	timeZone,
}: ParkedMessageBarProps)
{
	if (items.length === 0 || listInTranscript) return null;
	return (
		<div className="flex w-full flex-col">
			<ParkedNoticeBand
				willAutoSend={willAutoSend}
				resetsAt={resetsAt}
				archived={archived}
				flushing={flushing}
				onSendAnyway={onSendAnyway}
				className="rounded-b-none"
				{...(timeZone === undefined
					? {}
					:
						{
							timeZone,
						})}
			/>
			<QueuedMessageBar
				sessionId={`${sessionId}:parked`}
				items={items}
				joinTop
				onEdit={onEdit}
				onRemove={onRemove}
			/>
		</div>
	);
}
