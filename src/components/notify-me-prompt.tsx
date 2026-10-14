import {NOTIFICATIONS_BLOCKED_COPY, useNotificationPermission} from "../hooks/use-notification-permission";
import {optInSessionNotifications, useSessionNotifyOptedIn} from "../lib/notify-sessions";
import {ApprovalActionButton} from "./approval-card";
import {useSettings} from "./settings-context";
import {useToast} from "./toast-context";

/**
 * claude.ai/code's composer band "Want to be notified when Claude responds?" with a secondary
 * Notify button. It shows while this session would stay silent: permission not yet asked, or
 * granted with completions off and no opt-in. Notify asks the browser when needed, then opts
 * this session in; a refusal raises upstream's blocked toast.
 */
export function NotifyMePrompt({sessionId}: {sessionId: string}) {
	const {settings} = useSettings();
	const {supported, permission, requestPermission} = useNotificationPermission();
	const optedIn = useSessionNotifyOptedIn(sessionId);
	const toast = useToast();

	if (!supported || permission === "denied") return null;
	if (permission === "granted" && (settings.notifyCompletions || optedIn)) return null;

	const enable = async () => {
		const result = await requestPermission();
		if (result === "granted") optInSessionNotifications(sessionId);
		else if (result === "denied") toast({kind: "error", message: NOTIFICATIONS_BLOCKED_COPY});
	};

	return (
		<div className="flex min-h-[40px] items-center gap-2 rounded-r7 bg-alpha-1 p-[8px]">
			<span className="min-w-0 text-sm text-primary">Want to be notified when Claude responds?</span>
			<span className="ml-auto flex shrink-0">
				<ApprovalActionButton variant="secondary" onClick={() => void enable()}>
					Notify
				</ApprovalActionButton>
			</span>
		</div>
	);
}
