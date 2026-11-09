import {useQuery} from "@tanstack/react-query";

import {fetchHerdrPermissionDialog, isPermissionDialogNotShown} from "../lib/api/herdr";
import type {PermissionDialogShape} from "../lib/herdr/permission-screen";

/** The CLI fires PermissionRequest before it draws the dialog, so a missing dialog is re-read a few times. */
const NOT_SHOWN_RETRIES = 4;
const NOT_SHOWN_RETRY_MS = 500;

/**
 * The shape of the terminal's permission dialog for the card keyed `permissionKey`:
 * "unknown" while it is read, and when it can't be (upstream's askFlagsUnknown, drawn
 * deny-first); undefined when `enabled` is false, so the card keeps the hook's shape.
 */
export function usePermissionDialogShape(
	sessionId: string,
	permissionKey: string | null,
	enabled: boolean,
): PermissionDialogShape | "unknown" | undefined {
	const live = enabled && permissionKey !== null;
	const {data} = useQuery({
		queryKey: ["herdr", "permission-dialog", sessionId, permissionKey] as const,
		queryFn: async () => fetchHerdrPermissionDialog(sessionId),
		enabled: live,
		staleTime: Infinity,
		retry: (failures, error) => failures < NOT_SHOWN_RETRIES && isPermissionDialogNotShown(error),
		retryDelay: NOT_SHOWN_RETRY_MS,
	});
	if (!live) return undefined;
	return data ?? "unknown";
}
