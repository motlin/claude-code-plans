import {useId} from "react";

import {messageHeading} from "../lib/transcript-action-targets";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {WaitingMessageActions} from "./message-actions";

const SEND_NOW_CLASS =
	"relative inline-flex h-5 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-r5 px-2 text-[12px]/[17px] text-ink-muted outline-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus transition-colors hover:bg-fill-ghost-hover hover:text-primary";

/**
 * A prompt waiting for Claude to read it, drawn like upstream's own-composer steer row: the user
 * bubble in a `data-take-back-entry` row with an sr-only heading and "unread" status, then an
 * always-visible toolbar. Only the head (first) waiting row carries Send now.
 */
export function WaitingUserTurn({
	entryId,
	text,
	head,
	onSendNow,
	...rest
}: {
	entryId: string;
	text: string;
	head: boolean;
	/** Stops Claude's current response so it reads this message next; absent leaves Send now inert. */
	onSendNow?: (() => void) | undefined;
	"data-perf-pending-prompt"?: string;
}) {
	const descriptionId = useId();
	return (
		<div className="group/msg flex w-full justify-start items-start gap-1" data-take-back-entry={entryId} {...rest}>
			<h2 className="sr-only select-none">{messageHeading("user", text)}</h2>
			<span role="status" className="sr-only">
				unread
			</span>
			<div className="flex w-full flex-col min-w-0 ms-auto items-end gap-g5">
				<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 max-w-[85%] overflow-hidden text-body leading-[1.2857] select-text">
					<p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]">
						{text}
					</p>
				</div>
				<WaitingMessageActions text={text} unread={!head}>
					{head && (
						<>
							<button
								type="button"
								data-testid="awaiting-turn-send-now"
								aria-describedby={descriptionId}
								className={SEND_NOW_CLASS}
								onClick={() => {
									onSendNow?.();
								}}
							>
								Send now
							</button>
							<span id={descriptionId} hidden>
								Stops Claude’s current response.
							</span>
						</>
					)}
				</WaitingMessageActions>
			</div>
		</div>
	);
}

/**
 * The prompt just typed into the live pane, bridging the moment before the CLI writes it to the
 * JSONL. It waits like any steer, so it is the head waiting row; a failed send loses Send now.
 */
export function OptimisticWaitingTurn({
	prompt,
	error,
	onSendNow,
}: {
	prompt: string;
	error: string;
	onSendNow: (() => void) | undefined;
}) {
	return (
		<div className={`${CHAT_COLUMN_CLASS} flex flex-col gap-2 pb-[var(--chat-turn-gap)]`}>
			<WaitingUserTurn
				entryId="optimistic"
				text={prompt}
				head={error === ""}
				onSendNow={onSendNow}
				data-perf-pending-prompt=""
			/>
			{error !== "" && (
				<div
					role="alert"
					className="rounded-lg border border-danger-000/20 bg-danger-900 px-4 py-3 text-sm text-danger-000"
				>
					{error}
				</div>
			)}
		</div>
	);
}
