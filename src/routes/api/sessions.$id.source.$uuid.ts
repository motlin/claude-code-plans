import {createFileRoute} from '@tanstack/react-router';
import {SessionSourceResponse} from '../../lib/api/sessions';

const UUID_RE = /^[a-f0-9-]{36}$/i;
const SESSION_ID_RE = /^[a-z0-9-]+$/;

export const Route = createFileRoute('/api/sessions/$id/source/$uuid')({
	server: {
		handlers: {
			GET: async ({params, request}: {params: {id: string; uuid: string}; request: Request}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');

				const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
				const {id: sessionId, uuid} = params;

				if (!UUID_RE.test(uuid) || !SESSION_ID_RE.test(sessionId)) {
					return Response.json(SessionSourceResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				const url = new URL(request.url);
				const contextParam = url.searchParams.get('context');
				const contextN = contextParam !== null ? Math.max(0, Math.min(50, Number(contextParam) || 0)) : 5;

				const {readSession, readSessionRawWindow} = await import('../../lib/sessions');
				const window = await readSessionRawWindow(PROJECTS_DIR, sessionId, uuid, contextN);
				if (!window) {
					return Response.json(SessionSourceResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
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

				const paired = findPairedToolResult(window.focal.raw, window.after);
				const sessionTitle = detail?.title ?? sessionId;

				const allLines = [...window.before, window.focal, ...window.after];
				const knownUuids = allLines.map((l) => l.uuid).filter((u): u is string => u != null);

				let projectId: string | undefined;
				try {
					const {getDb} = await import('../../lib/db');
					const {getSessionProjectId} = await import('../../lib/db/queries');
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
					...(projectId !== undefined ? {projectId} : {}),
				};

				return Response.json(SessionSourceResponse.parse(payload), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});

interface PairedResult {
	resultEntry: {raw: string; lineIndex: number; uuid?: string};
	resultLineIndex: number;
	toolUseId: string;
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function findPairedToolResult(
	focalRaw: string,
	candidates: Array<{raw: string; lineIndex: number; uuid?: string}>,
): PairedResult | null {
	const focalParsed = safeParse(focalRaw) as
		| {type?: string; message?: {content?: Array<{type?: string; id?: string}>}}
		| undefined;
	if (focalParsed?.type !== 'assistant' || !Array.isArray(focalParsed.message?.content)) return null;

	const toolUseIds = focalParsed
		.message!.content.filter((c) => c?.type === 'tool_use' && typeof c.id === 'string')
		.map((c) => c.id as string);
	if (toolUseIds.length === 0) return null;

	for (const candidate of candidates) {
		const cParsed = safeParse(candidate.raw) as
			| {type?: string; message?: {content?: Array<{type?: string; tool_use_id?: string}>}}
			| undefined;
		if (cParsed?.type !== 'user' || !Array.isArray(cParsed.message?.content)) continue;
		const matching = cParsed.message!.content.find(
			(c) => c?.type === 'tool_result' && typeof c.tool_use_id === 'string' && toolUseIds.includes(c.tool_use_id),
		);
		if (matching) {
			return {
				resultEntry: candidate,
				resultLineIndex: candidate.lineIndex,
				toolUseId: matching.tool_use_id as string,
			};
		}
	}
	return null;
}
