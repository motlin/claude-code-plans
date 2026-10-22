import {messageHeading} from "../lib/transcript-action-targets";

/**
 * A prompt the CLI holds in its queue while Claude works, drawn like upstream's own-composer steer
 * row: the user bubble in a `data-take-back-entry` row with an sr-only heading and "unread" status.
 */
export function WaitingUserTurn({entryId, text}: {entryId: string; text: string}) {
	return (
		<div className="group/msg flex w-full justify-end items-start gap-1" data-take-back-entry={entryId}>
			<h2 className="sr-only select-none">{messageHeading("user", text)}</h2>
			<span role="status" className="sr-only">
				unread
			</span>
			<div className="flex flex-col items-end gap-g5 max-w-[85%] min-w-0">
				<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body leading-[1.2857] select-text">
					<p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]">
						{text}
					</p>
				</div>
			</div>
		</div>
	);
}
