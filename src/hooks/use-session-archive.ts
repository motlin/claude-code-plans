import {type QueryClient, useQueryClient} from "@tanstack/react-query";
import {useCallback, useState} from "react";

import {useToast} from "../components/toast-context";
import {requestSessionArchived} from "../lib/api/sessions";

const ARCHIVE_FAILED_MESSAGE = "Couldn’t archive this session. Try again.";
const UNARCHIVE_FAILED_MESSAGE = "Couldn’t unarchive this session. Try again.";
/** Upstream's `sd` toast for every explicit (non-Undo) unarchive. */
const UNARCHIVED_TOAST = {kind: "success", message: "Session unarchived", durationMs: 3000} as const;

/** Upstream `ud()`'s module-level map: one in-flight unarchive per session, shared by every caller. */
const inflightUnarchive = new Map<string, Promise<void>>();

/**
 * Unarchive with the success/failure toast, reusing the request already running for this session
 * (a double click, or the row menu while the note is pending) so it fires and toasts once.
 */
async function unarchiveOnce(qc: QueryClient, sessionId: string, toast: ReturnType<typeof useToast>): Promise<void> {
	const existing = inflightUnarchive.get(sessionId);
	if (existing !== undefined) return existing;
	const request = requestSessionArchived(qc, sessionId, false)
		.then(
			() => {
				toast(UNARCHIVED_TOAST);
			},
			() => {
				toast({kind: "error", message: UNARCHIVE_FAILED_MESSAGE});
			},
		)
		.finally(() => {
			inflightUnarchive.delete(sessionId);
		});
	inflightUnarchive.set(sessionId, request);
	return request;
}

/**
 * Archive or unarchive one session. Archiving toasts "Archived 1 session" with
 * [Undo]; unarchiving toasts "Session unarchived" once per in-flight request (the Undo itself stays quiet); neither the request nor the Undo depends on the caller staying
 * mounted, so a row menu that closes on select can still finish the job.
 */
export function useSessionArchive(sessionId: string): (archived: boolean) => void {
	const qc = useQueryClient();
	const toast = useToast();

	return useCallback(
		(archived: boolean) => {
			const unarchive = () => {
				requestSessionArchived(qc, sessionId, false).catch(() => {
					toast({kind: "error", message: UNARCHIVE_FAILED_MESSAGE});
				});
			};
			if (!archived) {
				void unarchiveOnce(qc, sessionId, toast);
				return;
			}
			requestSessionArchived(qc, sessionId, true).then(
				() => {
					toast({
						kind: "success",
						message: "Archived 1 session",
						action: {label: "Undo", onAction: unarchive},
					});
				},
				() => {
					toast({kind: "error", message: ARCHIVE_FAILED_MESSAGE});
				},
			);
		},
		[qc, sessionId, toast],
	);
}

/**
 * Upstream's archived-note Unarchive: `pending` stays true while the request runs, success
 * toasts "Session unarchived" for 3s, and failure toasts the unarchive error.
 */
export function useUnarchiveSession(sessionId: string): {unarchive: () => void; pending: boolean} {
	const qc = useQueryClient();
	const toast = useToast();
	const [pending, setPending] = useState(false);

	const unarchive = useCallback(() => {
		setPending(true);
		void unarchiveOnce(qc, sessionId, toast).finally(() => {
			setPending(false);
		});
	}, [qc, sessionId, toast]);

	return {unarchive, pending};
}

function archivedSessionsMessage(count: number): string {
	return `Archived ${count} session${count === 1 ? "" : "s"}`;
}

/**
 * Archive several sessions at once, like a group header's "Archive all": one
 * toast "Archived N sessions" with [Undo] that unarchives them all.
 */
export function useArchiveSessions(): (sessionIds: readonly string[]) => void {
	const qc = useQueryClient();
	const toast = useToast();

	return useCallback(
		(sessionIds: readonly string[]) => {
			if (sessionIds.length === 0) return;
			void Promise.allSettled(sessionIds.map(async (id) => requestSessionArchived(qc, id, true))).then(
				(results) => {
					const archived = sessionIds.filter((_, index) => results[index]?.status === "fulfilled");
					if (archived.length < sessionIds.length) {
						toast({kind: "error", message: ARCHIVE_FAILED_MESSAGE});
					}
					if (archived.length === 0) return;
					const unarchive = () => {
						Promise.all(archived.map(async (id) => requestSessionArchived(qc, id, false))).catch(() => {
							toast({kind: "error", message: UNARCHIVE_FAILED_MESSAGE});
						});
					};
					toast({
						kind: "success",
						message: archivedSessionsMessage(archived.length),
						action: {label: "Undo", onAction: unarchive},
					});
				},
			);
		},
		[qc, toast],
	);
}
