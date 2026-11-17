import type {MouseEvent} from "react";

import type {QueuedPrompt} from "../lib/composer-queue";
import {parkedNoticeMessage, parkedResetDetail} from "../lib/parked-prompts";
import {useNow} from "../hooks/use-now";
import {QueuedMessageBar} from "./queued-message-bar";
import {cdsButtonClass} from "./ui/cds-button";
import {Spinner} from "./ui/spinner";
import {BandShell} from "./usage-pace-banner";

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
	/** Test seam for the reset's time zone. */
	timeZone?: string;
}

function keepComposerFocus(event: MouseEvent)
{
	event.preventDefault();
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
	timeZone,
}: ParkedMessageBarProps)
{
	// Upstream `Fr`: a ticking clock while a reset exists, so the detail drops once it passes.
	const now = useNow(resetsAt !== undefined);
	if (items.length === 0) return null;
	const detail = archived || resetsAt === undefined ? undefined : parkedResetDetail(resetsAt, now, timeZone);
	return (
		<div className="flex w-full flex-col">
			<BandShell
				icon={null}
				className="rounded-b-none"
				actions={
					<button
						type="button"
						aria-label="Send anyway"
						aria-busy={flushing ? true : undefined}
						disabled={flushing || archived}
						className={`${cdsButtonClass("secondary", "sm")} shrink-0`}
						onMouseDown={keepComposerFocus}
						onClick={() =>
						{
							onSendAnyway();
						}}
					>
						<span className={flushing ? "opacity-0" : undefined}>Send anyway</span>
						{flushing && (
							<span className="absolute inset-0 grid place-items-center leading-[0]">
								<Spinner size="sm" />
							</span>
						)}
					</button>
				}
			>
				<span className="min-w-0 text-primary">
					{parkedNoticeMessage(
						{
							archived,
							willAutoSend,
						},
					)}
				</span>
				{detail !== undefined && <span className="min-w-0 text-ink-muted">{detail}</span>}
			</BandShell>
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
