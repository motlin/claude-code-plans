import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionSourceResponse} from "../../lib/api/session-source";

const UUID_RE = /^[a-f0-9-]{36}$/i;
const SESSION_ID_RE = /^[a-z0-9-]+$/;

export const Route = createFileRoute("/api/sessions/$id/source/$uuid")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params, request}: {params: {id: string; uuid: string}; request: Request}) => {
				const {homedir} = await import("node:os");
				const {join} = await import("node:path");

				const PROJECTS_DIR = join(homedir(), ".claude", "projects");
				const {id: sessionId, uuid} = params;

				if (!UUID_RE.test(uuid) || !SESSION_ID_RE.test(sessionId)) {
					return Response.json(SessionSourceResponse.parse(null), {
						headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
					});
				}

				const url = new URL(request.url);
				const contextParam = url.searchParams.get("context");
				const contextN = contextParam === null ? 5 : Math.max(0, Math.min(50, Number(contextParam) || 0));

				const {readSession, readSessionRawWindow} = await import("../../lib/sessions");
				const window = await readSessionRawWindow(PROJECTS_DIR, sessionId, uuid, contextN);
				if (!window) {
					return Response.json(SessionSourceResponse.parse(null), {
						headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
					});
				}

				const detail = await readSession(PROJECTS_DIR, sessionId);
				const parsedBlocks = [];
				if (detail) {
					for (const msg of detail.messages) {
						for (const block of msg.content) {
							if (block.sourceUuid === uuid) parsedBlocks.push(block);
						}
					}
				}

				const {findPairedToolResult} = await import("../../lib/paired-tool-result");
				const paired = findPairedToolResult(window.focal.raw, window.after);
				const sessionTitle = detail?.title ?? sessionId;

				const allLines = [...window.before, window.focal, ...window.after];
				const knownUuids = allLines.map((l) => l.uuid).filter((u): u is string => u != null);

				let projectId: string | undefined;
				try {
					const {getDb} = await import("../../lib/db");
					const {getSessionProjectId} = await import("../../lib/db/queries");
					const db = getDb();
					const pid = getSessionProjectId(db.index, sessionId);
					if (pid) projectId = pid;
				} catch {
					// DB not available -- leave undefined
				}

				const payload = {
					window,
					parsedBlocksJson: JSON.stringify(parsedBlocks, null, 2),
					parsedBlocksCount: parsedBlocks.length,
					paired,
					sessionTitle,
					knownUuids,
					...(projectId === undefined ? {} : {projectId}),
				};

				return Response.json(SessionSourceResponse.parse(payload), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
