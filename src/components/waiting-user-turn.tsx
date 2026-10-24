import {type MouseEvent, useCallback, useEffect, useId, useRef, useState} from "react";

import type {QueuedPrompt} from "../lib/composer-queue";
import {messageHeading} from "../lib/transcript-action-targets";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {WaitingMessageActions} from "./message-actions";
import {Spinner} from "./ui/spinner";

/** How long upstream's row announces "read" after Claude picks it up (`eD`). */
const READ_ANNOUNCEMENT_MS = 1400;

/** True for {@link READ_ANNOUNCEMENT_MS} after each pickup (`pickup` changes to a truthy value). */
function useReadAnnouncement(pickup: boolean | number): boolean {
	const [reading, setReading] = useState(false);
	useEffect(() => {
		if (pickup === false || pickup === 0) return undefined;
		setReading(true);
		const timer = setTimeout(() => {
			setReading(false);
		}, READ_ANNOUNCEMENT_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [pickup]);
	return reading;
}

const SEND_NOW_CLASS =
	"relative inline-flex h-5 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-r5 px-2 text-[12px]/[17px] text-ink-muted outline-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus transition-colors hover:bg-fill-ghost-hover hover:text-primary";

const SEND_NOW_TEST_ID = "awaiting-turn-send-now";
/** Upstream's `gI`: how long a keyboard-focused Send now that unmounted may hand focus to the next one. */
const SEND_NOW_FOCUS_HANDOFF_MS = 1000;
/** When a keyboard-focused Send now last unmounted (upstream's module-level `CO`). */
let sendNowFocusLostAt = Number.NEGATIVE_INFINITY;

/**
 * Upstream's focus handoff: when a keyboard-focused Send now unmounts, the next one mounted within
 * {@link SEND_NOW_FOCUS_HANDOFF_MS} takes focus, if it is the only one and focus fell to the body.
 */
function useSendNowFocusHandoff(): (button: HTMLButtonElement | null) => void {
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	return useCallback((button: HTMLButtonElement | null) => {
		const previous = buttonRef.current;
		buttonRef.current = button;
		if (button === null) {
			if (previous?.matches(":focus-visible") === true) sendNowFocusLostAt = performance.now();
			return;
		}
		if (performance.now() - sendNowFocusLostAt > SEND_NOW_FOCUS_HANDOFF_MS) return;
		sendNowFocusLostAt = Number.NEGATIVE_INFINITY;
		const document = button.ownerDocument;
		const only = document.querySelectorAll(`[data-testid="${SEND_NOW_TEST_ID}"]`).length === 1;
		const active = document.activeElement;
		if (only && (active === null || active === document.body)) button.focus({preventScroll: true});
	}, []);
}

/**
 * Upstream's Send now (`Ab`): a ghost xs button, busy until the interrupt settles. A mouse click
 * hands focus to the composer instead of leaving it on a button that is about to unmount.
 */
function SendNowButton({
	onSendNow,
	onFocusComposer,
}: {
	onSendNow: (() => Promise<void> | void) | undefined;
	onFocusComposer: (() => void) | undefined;
}) {
	const descriptionId = useId();
	const [sending, setSending] = useState(false);
	const pointerTypeRef = useRef("");
	const buttonRef = useSendNowFocusHandoff();
	const onClick = (event: MouseEvent<HTMLButtonElement>) => {
		const button = event.currentTarget;
		const pointerType = pointerTypeRef.current;
		pointerTypeRef.current = "";
		if (sending) return;
		if (pointerType === "mouse" && button.ownerDocument.activeElement === button) {
			onFocusComposer?.();
			button.blur();
		}
		if (onSendNow === undefined) return;
		setSending(true);
		void Promise.resolve(onSendNow()).finally(() => {
			setSending(false);
		});
	};
	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				data-testid={SEND_NOW_TEST_ID}
				aria-describedby={descriptionId}
				aria-busy={sending ? true : undefined}
				aria-disabled={sending ? true : undefined}
				className={SEND_NOW_CLASS}
				onPointerDown={(event) => {
					pointerTypeRef.current = event.pointerType;
				}}
				onClick={onClick}
			>
				<span data-send-now-label="" className={sending ? "opacity-0" : ""}>
					Send now
				</span>
				{sending && (
					<span className="absolute inset-0 grid place-items-center leading-[0]">
						<Spinner size="sm" label="Sending…" />
					</span>
				)}
			</button>
			<span id={descriptionId} hidden>
				Stops Claude’s current response.
			</span>
		</>
	);
}

/**
 * A prompt waiting for Claude to read it, drawn like upstream's own-composer steer row: the user
 * bubble in a `data-take-back-entry` row with an sr-only heading and "unread" status, then an
 * always-visible toolbar. Only the head (first) waiting row carries Send now.
 */
export function WaitingUserTurn({
	entryId,
	text,
	head,
	delivered = false,
	onSendNow,
	onFocusComposer,
	onCancel,
	...rest
}: {
	entryId: string;
	text: string;
	head: boolean;
	/** Claude picked the prompt up, so the status reads "read" briefly and then goes quiet. */
	delivered?: boolean;
	/** Stops Claude's current response so it reads this message next; absent leaves Send now inert. */
	onSendNow?: (() => Promise<void> | void) | undefined;
	/** Focuses the session composer, where a mouse click on Send now leaves focus. */
	onFocusComposer?: (() => void) | undefined;
	/** Upstream's "Cancel and edit message": only while the browser holds the text, never once the CLI does. */
	onCancel?: (() => Promise<void> | void) | undefined;
	"data-perf-pending-prompt"?: string;
}) {
	const reading = useReadAnnouncement(delivered);
	return (
		<div className="group/msg flex w-full justify-start items-start gap-1" data-take-back-entry={entryId} {...rest}>
			<h2 className="sr-only select-none">{messageHeading("user", text)}</h2>
			<span role="status" className="sr-only">
				{delivered ? (reading ? "read" : "") : "unread"}
			</span>
			<div className="flex w-full flex-col min-w-0 ms-auto items-end gap-g5">
				<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 max-w-[85%] overflow-hidden text-body leading-[1.2857] select-text">
					<p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]">
						{text}
					</p>
				</div>
				<WaitingMessageActions text={text} unread={!head} onCancel={onCancel}>
					{head && <SendNowButton onSendNow={onSendNow} onFocusComposer={onFocusComposer} />}
				</WaitingMessageActions>
			</div>
		</div>
	);
}

/**
 * The local waiting row unmounts once the CLI writes the prompt into the transcript, so this
 * live region, mounted for as long as the session runs, carries upstream's brief "read" after a
 * waiting prompt leaves the CLI's queue.
 */
export function WaitingPickupStatus({waitingIds}: {waitingIds: readonly string[]}) {
	const previousRef = useRef(waitingIds);
	const [pickups, setPickups] = useState(0);
	useEffect(() => {
		const previous = previousRef.current;
		previousRef.current = waitingIds;
		if (previous.some((id) => !waitingIds.includes(id))) setPickups((count) => count + 1);
	}, [waitingIds]);
	// One span for the session's life: a live region mounted with its text in it may go unannounced.
	const reading = useReadAnnouncement(pickups);
	return (
		<span role="status" className="sr-only" data-waiting-pickup-status="">
			{reading ? "read" : ""}
		</span>
	);
}

/**
 * The prompt just typed into the live pane, bridging the moment before the CLI writes it to the
 * JSONL. It waits like any steer, so it is the head waiting row.
 */
export function OptimisticWaitingTurn({
	prompt,
	onSendNow,
	onFocusComposer,
}: {
	prompt: string;
	onSendNow: (() => Promise<void> | void) | undefined;
	onFocusComposer?: (() => void) | undefined;
}) {
	return (
		<div className={`${CHAT_COLUMN_CLASS} flex flex-col gap-2 pb-[var(--chat-turn-gap)]`}>
			<WaitingUserTurn
				entryId="optimistic"
				text={prompt}
				head
				onSendNow={onSendNow}
				onFocusComposer={onFocusComposer}
				data-perf-pending-prompt=""
			/>
		</div>
	);
}

/**
 * Steers (Enter while working) the browser still holds, as when a pane dialog keeps them from being
 * typed in: upstream draws steers as waiting rows in the transcript, never in the queue band.
 * `head` is false when an earlier waiting row already carries Send now.
 */
export function HeldSteerTurns({
	items,
	head,
	onSendNow,
	onCancel,
	onFocusComposer,
}: {
	items: readonly QueuedPrompt[];
	head: boolean;
	/** Sends this steer next, interrupting the running turn; settles with the interrupt. */
	onSendNow: (id: string) => Promise<void>;
	/** Takes this steer out of the queue and back into the composer. */
	onCancel: (item: QueuedPrompt) => void;
	onFocusComposer?: (() => void) | undefined;
}) {
	if (items.length === 0) return null;
	return (
		<div className={`${CHAT_COLUMN_CLASS} flex flex-col gap-2 pb-[var(--chat-turn-gap)]`}>
			{items.map((item, index) => (
				<WaitingUserTurn
					key={item.id}
					entryId={item.id}
					text={item.text}
					head={head && index === 0}
					onSendNow={async () => {
						await onSendNow(item.id);
					}}
					onCancel={() => {
						onCancel(item);
					}}
					onFocusComposer={onFocusComposer}
				/>
			))}
		</div>
	);
}
