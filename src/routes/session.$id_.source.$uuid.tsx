import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {useMemo, useState} from 'react';
import {z} from 'zod';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {MessageContent, RawJsonlLine} from '../lib/sessions';
import {LinkedJson, type LinkedJsonContext} from '../components/linked-json';
import {Bot, MessageSquare, Cpu, FileText, AlertTriangle} from 'lucide-react';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const UUID_RE = /^[a-f0-9-]{36}$/i;
const SESSION_ID_RE = /^[a-z0-9-]+$/;

const InputSchema = z.object({
	sessionId: z.string(),
	uuid: z.string(),
	contextN: z.number().int().min(0).max(50).default(5),
});

// fallow-ignore-next-line unused-type
export interface PairedResult {
	resultEntry: RawJsonlLine;
	resultLineIndex: number;
	toolUseId: string;
}

const getSessionSource = createServerFn({method: 'GET'})
	.inputValidator(InputSchema)
	.handler(async ({data}) => {
		const {sessionId, uuid, contextN} = data;
		if (!UUID_RE.test(uuid)) return null;
		if (!SESSION_ID_RE.test(sessionId)) return null;

		const {readSession, readSessionRawWindow} = await import('../lib/sessions');
		const window = await readSessionRawWindow(PROJECTS_DIR, sessionId, uuid, contextN);
		if (!window) return null;

		const detail = await readSession(PROJECTS_DIR, sessionId);
		const parsedBlocks: MessageContent[] = [];
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
			const {getDb} = await import('../lib/db');
			const {getSessionProjectId} = await import('../lib/db/queries');
			const db = getDb();
			const pid = getSessionProjectId(db.index, sessionId);
			if (pid) projectId = pid;
		} catch {
			// DB not available -- leave undefined
		}

		return {
			window,
			parsedBlocksJson: JSON.stringify(parsedBlocks, null, 2),
			parsedBlocksCount: parsedBlocks.length,
			paired,
			sessionTitle,
			knownUuids,
			projectId,
		};
	});

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export function findPairedToolResult(focalRaw: string, candidates: RawJsonlLine[]): PairedResult | null {
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

export const Route = createFileRoute('/session/$id_/source/$uuid')({
	component: SourceViewPage,
	loader: ({params}) => getSessionSource({data: {sessionId: params.id, uuid: params.uuid, contextN: 5}}),
	head: ({params}) => ({meta: [{title: `Source: ${params.uuid.slice(0, 8)}`}]}),
});

function prettyJsonl(raw: string): string {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

function CodeBlock({content, max = 50_000}: {content: string; max?: number}) {
	const truncated = content.length > max;
	const display = truncated ? content.slice(0, max) + '\n\n... [truncated]' : content;
	return (
		<pre className="bg-bg-100 text-text-000 text-xs font-mono whitespace-pre-wrap break-all rounded p-3 overflow-x-auto leading-relaxed">
			{display}
		</pre>
	);
}

interface RecordSummary {
	type: string;
	contentPreview: string;
	toolNames: string[];
}

function summarizeRecord(raw: string): RecordSummary {
	const parsed = safeParse(raw) as Record<string, unknown> | undefined;
	if (!parsed || typeof parsed !== 'object') {
		return {type: 'unknown', contentPreview: raw.slice(0, 80), toolNames: []};
	}

	const type = typeof parsed['type'] === 'string' ? parsed['type'] : 'unknown';
	const toolNames: string[] = [];
	let contentPreview = '';

	const message = parsed['message'] as Record<string, unknown> | undefined;
	const content = message?.['content'];

	if (Array.isArray(content)) {
		for (const block of content) {
			if (typeof block === 'object' && block !== null) {
				const blockRecord = block as Record<string, unknown>;
				if (blockRecord['type'] === 'text' && typeof blockRecord['text'] === 'string' && !contentPreview) {
					contentPreview = (blockRecord['text'] as string).slice(0, 120).replace(/\n/g, ' ');
				} else if (blockRecord['type'] === 'tool_use' && typeof blockRecord['name'] === 'string') {
					toolNames.push(blockRecord['name'] as string);
				} else if (blockRecord['type'] === 'tool_result') {
					toolNames.push('tool_result');
				}
			} else if (typeof block === 'string' && !contentPreview) {
				contentPreview = block.slice(0, 120).replace(/\n/g, ' ');
			}
		}
	}

	return {type, contentPreview, toolNames};
}

function recordTypeIcon(type: string) {
	const iconClass = 'h-3.5 w-3.5 shrink-0';
	switch (type) {
		case 'assistant':
			return <Bot className={`${iconClass} text-accent-100`} />;
		case 'user':
			return <MessageSquare className={`${iconClass} text-green-400`} />;
		case 'system':
			return <Cpu className={`${iconClass} text-yellow-400`} />;
		default:
			return <FileText className={`${iconClass} text-text-500`} />;
	}
}

function NeighborLink({entry, sessionId}: {entry: RawJsonlLine; sessionId: string}) {
	const summary = useMemo(() => summarizeRecord(entry.raw), [entry.raw]);

	const toolLabel =
		summary.toolNames.length > 0
			? summary.toolNames.slice(0, 3).join(', ') + (summary.toolNames.length > 3 ? '...' : '')
			: '';

	const preview = summary.contentPreview
		? summary.contentPreview.length > 100
			? summary.contentPreview.slice(0, 100) + '...'
			: summary.contentPreview
		: '';

	const inner = (
		<div className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-border-300/15 bg-bg-200/30 hover:bg-bg-200/60 transition-colors text-xs group">
			{recordTypeIcon(summary.type)}
			<span className="font-mono text-text-300 shrink-0">L{entry.lineIndex}</span>
			<span className="font-medium text-text-200 shrink-0">{summary.type}</span>
			{entry.parseError && <AlertTriangle className="h-3 w-3 text-danger-000 shrink-0" />}
			{toolLabel && <span className="text-text-400 font-mono truncate">{toolLabel}</span>}
			{preview && !toolLabel && <span className="text-text-500 truncate italic">{preview}</span>}
			{entry.uuid && (
				<span className="ml-auto font-mono text-text-500 opacity-60 group-hover:opacity-100 shrink-0">
					{entry.uuid.slice(0, 8)}
				</span>
			)}
		</div>
	);

	if (entry.uuid) {
		return (
			<a
				href={`/session/${sessionId}/source/${entry.uuid}`}
				className="block mb-1 no-underline"
			>
				{inner}
			</a>
		);
	}

	return <div className="mb-1">{inner}</div>;
}

function CopyButton({text}: {text: string}) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {
					// clipboard not available
				}
			}}
			className="text-xs px-2 py-1 rounded bg-bg-200 hover:bg-bg-300 text-text-200"
		>
			{copied ? 'Copied' : 'Copy'}
		</button>
	);
}

function SourceViewPage() {
	const data = Route.useLoaderData();
	const params = Route.useParams();

	if (!data) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<h1 className="text-lg font-medium text-text-100 mb-2">Source not found</h1>
				<p className="text-sm text-text-500">
					No JSONL entry with uuid {params.uuid} in session {params.id}.
				</p>
				<Link
					to="/session/$id"
					params={{id: params.id}}
					className="text-accent-100 text-sm hover:underline"
				>
					Back to session
				</Link>
			</div>
		);
	}

	const {window: rawWindow, parsedBlocksJson, parsedBlocksCount, paired, sessionTitle, knownUuids, projectId} = data;
	const focalRaw = prettyJsonl(rawWindow.focal.raw);
	const focalParsed = safeParse(rawWindow.focal.raw);
	const pairedParsed = paired ? safeParse(paired.resultEntry.raw) : undefined;
	const parsedBlocksParsed = safeParse(parsedBlocksJson);

	const jsonCtx: LinkedJsonContext = useMemo(
		() => ({
			sessionId: params.id,
			projectId,
			knownUuids: new Set(knownUuids ?? []),
		}),
		[params.id, projectId, knownUuids],
	);

	return (
		<div className="mx-auto max-w-4xl p-6 space-y-6">
			<div>
				<Link
					to="/session/$id"
					params={{id: params.id}}
					className="text-accent-100 text-sm hover:underline"
				>
					← {sessionTitle}
				</Link>
				<h1 className="text-lg font-medium text-text-100 mt-1">
					JSONL source · line {rawWindow.focal.lineIndex} · {params.uuid}
				</h1>
			</div>

			<section>
				<div className="flex items-center justify-between mb-2">
					<h2 className="text-sm font-medium text-text-200">Focal raw JSONL</h2>
					<CopyButton text={focalRaw} />
				</div>
				{focalParsed !== undefined ? (
					<LinkedJson
						value={focalParsed}
						context={jsonCtx}
					/>
				) : (
					<CodeBlock content={focalRaw} />
				)}
			</section>

			{paired && (
				<section>
					<div className="flex items-center justify-between mb-2">
						<h2 className="text-sm font-medium text-text-200">
							Paired tool_result · line {paired.resultLineIndex}
						</h2>
						{paired.resultEntry.uuid && (
							<a
								href={`/session/${params.id}/source/${paired.resultEntry.uuid}`}
								target="_blank"
								rel="noopener noreferrer"
								className="text-xs text-accent-100 hover:underline"
							>
								open in new tab
							</a>
						)}
					</div>
					{pairedParsed !== undefined ? (
						<LinkedJson
							value={pairedParsed}
							context={jsonCtx}
						/>
					) : (
						<CodeBlock content={prettyJsonl(paired.resultEntry.raw)} />
					)}
				</section>
			)}

			<section>
				<h2 className="text-sm font-medium text-text-200 mb-2">
					Parsed MessageContent block{parsedBlocksCount === 1 ? '' : 's'} ({parsedBlocksCount})
				</h2>
				{parsedBlocksCount === 0 ? (
					<p className="text-xs text-text-500 italic">
						No parsed block — this entry was skipped by the parser (e.g. system, file-history-snapshot).
					</p>
				) : parsedBlocksParsed !== undefined ? (
					<LinkedJson
						value={parsedBlocksParsed}
						context={jsonCtx}
					/>
				) : (
					<CodeBlock content={parsedBlocksJson} />
				)}
			</section>

			<section>
				<h2 className="text-sm font-medium text-text-200 mb-2">
					Before ({rawWindow.before.length} line{rawWindow.before.length === 1 ? '' : 's'})
				</h2>
				{rawWindow.before.length === 0 ? (
					<p className="text-xs text-text-500 italic">No preceding lines.</p>
				) : (
					rawWindow.before.map((entry) => (
						<NeighborLink
							key={entry.lineIndex}
							entry={entry}
							sessionId={params.id}
						/>
					))
				)}
			</section>

			<section>
				<h2 className="text-sm font-medium text-text-200 mb-2">
					After ({rawWindow.after.length} line{rawWindow.after.length === 1 ? '' : 's'})
				</h2>
				{rawWindow.after.length === 0 ? (
					<p className="text-xs text-text-500 italic">No following lines.</p>
				) : (
					rawWindow.after.map((entry) => (
						<NeighborLink
							key={entry.lineIndex}
							entry={entry}
							sessionId={params.id}
						/>
					))
				)}
			</section>
		</div>
	);
}
