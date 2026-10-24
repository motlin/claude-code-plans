import {z} from "zod";
import {resolveUrl} from "./client";

const RewindFilesPreviewResponseSchema = z.union([
	z.strictObject({inFlight: z.literal(true)}),
	z.strictObject({
		canRewind: z.boolean(),
		filesChanged: z.array(z.string()),
		insertions: z.number(),
		deletions: z.number(),
	}),
]);

const RewindFilesRestoredResponseSchema = z.strictObject({restored: z.literal(true), skipped: z.number()});

/** The files a code restore would put back, as upstream's confirm counts them. */
export interface RewindFileChanges {
	filesChanged: string[];
	insertions: number;
	deletions: number;
}

function rewindFilesUrl(sessionId: string): string {
	return `/api/sessions/${encodeURIComponent(sessionId)}/rewind-files`;
}

/**
 * Upstream `Lue`: `"restoring"` while an earlier code restore still runs, null
 * when the code can't be restored to the message or nothing changed since it.
 */
export async function fetchRewindFilesPreview(
	sessionId: string,
	message: string,
): Promise<"restoring" | RewindFileChanges | null> {
	const response = await fetch(resolveUrl(`${rewindFilesUrl(sessionId)}?message=${encodeURIComponent(message)}`), {
		credentials: "same-origin",
		cache: "no-store",
	});
	if (!response.ok) return null;
	const body = RewindFilesPreviewResponseSchema.parse(await response.json());
	if ("inFlight" in body) return "restoring";
	if (!body.canRewind || body.filesChanged.length === 0) return null;
	return {filesChanged: body.filesChanged, insertions: body.insertions, deletions: body.deletions};
}

/** Upstream `Rue`: restore the code to the message; `inFlight` when an earlier restore still runs. */
export async function postRewindFiles(
	sessionId: string,
	message: string,
): Promise<{ok: true; skipped: number} | {ok: false; inFlight: boolean}> {
	const response = await fetch(resolveUrl(rewindFilesUrl(sessionId)), {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({message}),
	});
	const json: unknown = await response.json();
	if (response.ok) return {ok: true, skipped: RewindFilesRestoredResponseSchema.parse(json).skipped};
	return {
		ok: false,
		inFlight: typeof json === "object" && json !== null && "inFlight" in json && json.inFlight === true,
	};
}
