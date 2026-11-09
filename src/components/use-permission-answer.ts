import {useQueryClient} from "@tanstack/react-query";
import {useCallback, useState} from "react";

import {isPermissionNotPending} from "../lib/api/herdr";
import {sessionQueryKeys} from "../lib/api/sessions";
import type {PermissionDecision} from "../lib/permission-card";
import {useToast} from "./toast-context";

/**
 * Answer the docked permission card. When the server says no prompt is pending,
 * the card is stale: it drops at once, the notifications and session lists that
 * drew it refetch, and a short notice says why, instead of an error on a dead card.
 * The drop holds only for the card it hit (`permissionId`), so a later prompt shows.
 */
export function usePermissionAnswer({
	permissionId,
	send,
}: {
	permissionId: string | null;
	send: (decision: PermissionDecision) => Promise<void>;
}): {
	dropped: boolean;
	answer: (decision: PermissionDecision) => Promise<void>;
	/** Runs another answer to the same prompt (the card's switch to Auto) with the same not-pending handling. */
	answerWith: (run: () => Promise<void>) => Promise<void>;
} {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [droppedId, setDroppedId] = useState<string | null>(null);
	const answerWith = useCallback(
		async (run: () => Promise<void>) => {
			try {
				await run();
			} catch (error) {
				if (!isPermissionNotPending(error)) throw error;
				setDroppedId(permissionId);
				void queryClient.invalidateQueries({queryKey: ["notifications"]});
				void queryClient.invalidateQueries({queryKey: sessionQueryKeys.recentLists()});
				void queryClient.invalidateQueries({queryKey: sessionQueryKeys.groupedLists()});
				toast({kind: "warning", message: "That permission request is no longer pending"});
			}
		},
		[permissionId, queryClient, toast],
	);
	const answer = useCallback(
		async (decision: PermissionDecision) => answerWith(async () => send(decision)),
		[answerWith, send],
	);
	return {dropped: permissionId !== null && droppedId === permissionId, answer, answerWith};
}
