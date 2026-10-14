import {useEffect, useState} from "react";

/** Upstream's copy for each state the browser Notification permission can leave an opt-in in. */
export const NOTIFICATIONS_BLOCKED_COPY =
	"Notifications are blocked. Allow them in your browser or system settings, then try again.";
export const NOTIFICATIONS_UNAVAILABLE_COPY =
	"Notifications can’t be turned on here. Open Claude in its own browser tab and try again.";

/** Browsers refuse a permission prompt from an embedded frame, so only a top-level tab can opt in. */
function notificationsAvailableHere(): boolean {
	return typeof window !== "undefined" && "Notification" in window && window.self === window.top;
}

export interface NotificationPermissionState {
	/** False without the Notification API or inside a frame, where upstream says to open its own tab. */
	supported: boolean;
	permission: NotificationPermission;
	/** Asks the browser when needed; resolves the permission it ends with. */
	requestPermission: () => Promise<NotificationPermission>;
}

export function useNotificationPermission(): NotificationPermissionState {
	const [supported, setSupported] = useState(false);
	const [permission, setPermission] = useState<NotificationPermission>("default");

	useEffect(() => {
		if (notificationsAvailableHere()) {
			setSupported(true);
			setPermission(Notification.permission);
		}
	}, []);

	const requestPermission = async (): Promise<NotificationPermission> => {
		if (Notification.permission === "granted") return "granted";
		const result = await Notification.requestPermission();
		setPermission(result);
		return result;
	};

	return {supported, permission, requestPermission};
}
