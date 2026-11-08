import {X} from "lucide-react";
import {useState, type ReactNode} from "react";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {useRovingToolbar} from "../lib/use-roving-toolbar";
import {shimmerPhaseDelay} from "../lib/shimmer";
import {ShimmerText} from "./shimmer-text";

/**
 * The prompt whose POST to the live pane is still in flight, drawn like upstream's user row with
 * `deliveryStatus:"sending"`: dimmed, no toolbar, and a "Sending…" status under the bubble.
 */
export function SendingUserRow({prompt}: {prompt: string}) {
	return (
		<PendingUserRowShell
			prompt={prompt}
			rowClass="opacity-60 transition-opacity duration-200 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none"
			deliveryStatus="sending"
		>
			<div className="-mt-[8px] flex items-center gap-[3px]">
				<span
					role="status"
					className="flex items-center gap-[3px] text-[12px] leading-none text-secondary comfortable:text-[13px]"
				>
					Sending…
				</span>
			</div>
		</PendingUserRowShell>
	);
}

/**
 * A prompt the session had no live pane to take, drawn like upstream's `heldForHost` user row:
 * "Waiting to deliver to {host}…" under the bubble, with an X that withdraws it into the composer.
 */
export function HeldUserRow({
	prompt,
	reconnecting,
	onWithdraw,
}: {
	prompt: string;
	reconnecting: boolean;
	onWithdraw: () => void;
}) {
	const {ref, onFocus, onKeyDown} = useRovingToolbar();
	return (
		<PendingUserRowShell prompt={prompt} rowClass="" deliveryStatus="held">
			{/* Upstream's `tE`: an always-visible MessageActions toolbar whose X sits at the end under a right-hand bubble. */}
			<div
				ref={ref}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
				data-cds="MessageActions"
				data-reveal="fade"
				data-always-visible=""
				data-size="xs"
				role="toolbar"
				aria-label="Message actions"
				tabIndex={-1}
				className="flex items-center select-none"
			>
				<span
					data-testid="epitaxy-held-for-host"
					className="flex min-h-[20px] items-center text-[12px] leading-[15px] text-secondary pe-[4px] comfortable:min-h-[24px] comfortable:text-[13px] comfortable:leading-[17px] comfortable:pe-[6px]"
				>
					<HeldShimmer key={String(reconnecting)} sweeps={reconnecting}>
						{reconnecting
							? "Waiting for the terminal to reconnect…"
							: "Waiting to deliver to the terminal…"}
					</HeldShimmer>
				</span>
				<button
					type="button"
					aria-label="Withdraw message"
					className="inline-flex size-5 comfortable:size-6 shrink-0 items-center justify-center rounded-r4 comfortable:rounded-r5 text-ink-muted hover:text-primary"
					onMouseDown={(event) => {
						// Upstream `xi`: the click leaves focus where it was.
						event.preventDefault();
					}}
					onClick={onWithdraw}
				>
					<X size={12} aria-hidden="true" />
				</button>
			</div>
		</PendingUserRowShell>
	);
}

/** Upstream's `$T`: the held text in a muted shimmer that sweeps only while reconnecting, in phase with the rest. */
function HeldShimmer({sweeps, children}: {sweeps: boolean; children: ReactNode}) {
	const [delay] = useState(shimmerPhaseDelay);
	return (
		<ShimmerText variant="muted" active={sweeps} delay={delay}>
			{children}
		</ShimmerText>
	);
}

function PendingUserRowShell({
	prompt,
	rowClass,
	deliveryStatus,
	children,
}: {
	prompt: string;
	rowClass: string;
	deliveryStatus: "sending" | "held";
	children: ReactNode;
}) {
	return (
		<div className={`${CHAT_COLUMN_CLASS} flex flex-col gap-2 pb-[var(--chat-turn-gap)]`}>
			<div
				className={`group/msg flex w-full justify-end${rowClass === "" ? "" : ` ${rowClass}`}`}
				data-delivery-status={deliveryStatus}
			>
				<div
					className="flex flex-col items-end gap-g5 comfortable:gap-g6 max-w-[85%] min-w-0"
					data-perf-pending-prompt=""
				>
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body leading-[1.2857] select-text comfortable:rounded-card comfortable:px-4 comfortable:py-3 comfortable:text-[15px]/[20px]">
						<p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]">
							{prompt}
						</p>
					</div>
					{children}
				</div>
			</div>
		</div>
	);
}
