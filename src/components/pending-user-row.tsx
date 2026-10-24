import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";

/**
 * The prompt whose POST to the live pane is still in flight, drawn like upstream's user row with
 * `deliveryStatus:"sending"`: dimmed, no toolbar, and a "Sending…" status under the bubble.
 */
export function SendingUserRow({prompt}: {prompt: string}) {
	return (
		<div className={`${CHAT_COLUMN_CLASS} flex flex-col gap-2 pb-[var(--chat-turn-gap)]`}>
			<div
				className="group/msg flex w-full justify-end opacity-60 transition-opacity duration-200 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none"
				data-delivery-status="sending"
			>
				<div className="flex flex-col items-end gap-g5 max-w-[85%] min-w-0" data-perf-pending-prompt="">
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body leading-[1.2857] select-text">
						<p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]">
							{prompt}
						</p>
					</div>
					<div className="-mt-[8px] flex items-center gap-[3px]">
						<span
							role="status"
							className="flex items-center gap-[3px] text-[12px] leading-none text-secondary"
						>
							Sending…
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
