import {Bell, BellOff, CircleCheck, Loader2} from "lucide-react";
import {useEffect, useRef, useState} from "react";

import {useNotificationPermission} from "../hooks/use-notification-permission";
import {
	NOTIFY_TIP_MAX_SHOWS,
	NOTIFY_TIP_ON_MS,
	readNotifyTipShows,
	useCountNotifyTipShow,
	useNotifyTipTrigger,
} from "../lib/notify-tip";
import {useSessionNotifyOptedIn} from "../lib/notify-sessions";
import {useSettings} from "./settings-context";

type TipPhase = "idle" | "popup" | "registering" | "on" | "gone" | "blocked";
type TipState = "offer" | "asking" | "on" | "blocked";

const TIP_COPY: Record<TipState, string> = {
	offer: "Get notified when you’re needed",
	asking: "Choose Allow in your browser’s popup",
	on: "Notifications on",
	blocked: "Notifications are blocked",
};

const TIP_LOOK = {
	offer: {Icon: Bell, tone: "text-secondary"},
	asking: {Icon: Bell, tone: "text-secondary"},
	on: {Icon: CircleCheck, tone: "text-success"},
	blocked: {Icon: BellOff, tone: "text-danger"},
} as const;

/** Upstream's mapping from the tip's phase to the line it shows; null keeps it mounted but invisible. */
function tipState(phase: TipPhase, offer: boolean): TipState | null {
	if (phase === "on" || phase === "gone") return "on";
	if (phase === "blocked") return "blocked";
	if (phase === "popup") return "asking";
	return phase === "registering" || offer ? "offer" : null;
}

/**
 * claude.ai/code's "Get notified when you're needed · Turn on" line under a tool-approval card.
 * It offers while this session's permission requests would stay silent and says it's blocked when
 * the browser refused, but only after the user came back from 30s away and at most three times.
 * Turn on asks the browser when needed and switches on Code permission requests.
 */
export function ToolApprovalNotifyTip({sessionId}: {sessionId: string}) {
	const {settings, setSetting} = useSettings();
	const {supported, permission, requestPermission} = useNotificationPermission();
	const optedIn = useSessionNotifyOptedIn(sessionId);
	const enabled = settings.notifyPermissionRequests || optedIn;
	const offer = supported && (permission === "default" || (permission === "granted" && !enabled));
	const blockedBefore = supported && permission === "denied";
	const underCap = readNotifyTipShows().count < NOTIFY_TIP_MAX_SHOWS;
	const triggered = useNotifyTipTrigger(sessionId, (offer || blockedBefore) && underCap);

	if (!triggered) return null;
	return (
		<NotifyTip
			sessionId={sessionId}
			offer={offer}
			blockedBefore={blockedBefore}
			askFirst={permission === "default"}
			requestPermission={requestPermission}
			turnOn={() => {
				setSetting("notifyPermissionRequests", true);
			}}
		/>
	);
}

function NotifyTip({
	sessionId,
	offer,
	blockedBefore,
	askFirst,
	requestPermission,
	turnOn,
}: {
	sessionId: string;
	offer: boolean;
	blockedBefore: boolean;
	/** Whether Turn on raises the browser's permission popup. */
	askFirst: boolean;
	requestPermission: () => Promise<NotificationPermission>;
	turnOn: () => void;
}) {
	const [phase, setPhase] = useState<TipPhase>(blockedBefore ? "blocked" : "idle");
	// Decided once, so the tip stays through its own state changes.
	const [shown] = useState(offer || blockedBefore);
	const pending = useRef(false);
	const state = tipState(phase, offer);
	const collapsed = phase === "gone";
	const hidden = collapsed || state === null;

	useCountNotifyTipShow(sessionId, shown && !hidden);

	useEffect(() => {
		if (phase !== "on") return undefined;
		const timer = setTimeout(() => {
			setPhase("gone");
		}, NOTIFY_TIP_ON_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [phase]);

	if (!shown) return null;

	const onTurnOn = async () => {
		if (pending.current) return;
		pending.current = true;
		setPhase(askFirst ? "popup" : "registering");
		const result = await requestPermission();
		pending.current = false;
		if (result === "granted") turnOn();
		setPhase(result === "granted" ? "on" : result === "denied" ? "blocked" : "idle");
	};

	const look = state ?? "offer";
	const {Icon, tone} = TIP_LOOK[look];
	const isOffer = look === "offer";
	const busy = phase === "registering";

	return (
		<div
			data-notify-tip
			className={`-mt-3 grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
		>
			<div className="min-h-0 overflow-hidden">
				{/* Upstream pads the divider once, inside the bordered block */}
				<div className="border-t-[0.5px] border-border pt-3">
					<div
						className={`flex min-h-6 w-full items-center gap-2 text-footnote ${tone} ${state === null ? "*:invisible" : ""}`}
					>
						<span
							aria-hidden="true"
							className="inline-flex size-4 shrink-0 items-center justify-center motion-safe:animate-notify-tip-in"
						>
							{phase === "popup" && !askFirst ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Icon className="size-4" />
							)}
						</span>
						<span
							role="status"
							aria-hidden={hidden}
							className={`min-w-0 text-left motion-safe:animate-notify-tip-in ${isOffer ? "flex-1" : ""}`}
						>
							{TIP_COPY[look]}
						</span>
						{isOffer && (
							<span className="flex shrink-0" aria-hidden={hidden}>
								<button
									type="button"
									disabled={hidden || busy}
									onClick={() => void onTurnOn()}
									className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-r5 px-2 text-footnote text-primary hover:bg-alpha-2 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{busy && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
									Turn on
								</button>
							</span>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
