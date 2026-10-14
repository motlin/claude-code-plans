import {isSessionRouteAlias} from "../lib/session-route-alias";
import {createFileRoute, Link, useRouter} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {Suspense, useEffect, useMemo, useState} from "react";
import {SessionRouteIdentity} from "../components/session-route-identity";
import {sessionIdentityFailure} from "../lib/api/session-identity";
import {sessionQueryKeys} from "../lib/api/sessions";
import {sessionSourceQueryOptions} from "../lib/api/session-source";
import {LinkedJson} from "../components/linked-json";
import {asRecord, isRecord} from "../lib/narrow";
import type {LinkedJsonContext} from "../components/linked-json-links";
import {Bot, MessageSquare, Cpu, FileText, AlertTriangle} from "lucide-react";

export const Route = createFileRoute("/session/$id_/source/$uuid")({
	component: SourceViewPage,
	// Identity and source data load inside their boundaries, so navigation can paint the app shell first.
	loader: ({context: {queryClient}, params}) => {
		const identity = isSessionRouteAlias(params.id)
			? queryClient.getQueryState(sessionQueryKeys.identity(params.id))
			: undefined;
		return {
			title:
				identity?.status === "error"
					? sessionIdentityFailure(identity.error).title
					: `Source: ${params.uuid.slice(0, 8)}`,
		};
	},
	head: ({params, loaderData}) => ({
		meta: [{title: loaderData?.title ?? `Source: ${params.uuid.slice(0, 8)}`}],
	}),
});

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function prettyJsonl(raw: string): string {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

function CodeBlock({content, max = 50_000}: {content: string; max?: number}) {
	const truncated = content.length > max;
	const display = truncated ? content.slice(0, max) + "\n\n... [truncated]" : content;
	return (
		<pre className="bg-surface-1 text-primary text-xs font-mono whitespace-pre-wrap break-all rounded p-3 overflow-x-auto leading-relaxed">
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
	const parsed = asRecord(safeParse(raw));
	if (!parsed) {
		return {type: "unknown", contentPreview: raw.slice(0, 80), toolNames: []};
	}

	const type = typeof parsed["type"] === "string" ? parsed["type"] : "unknown";
	const toolNames: string[] = [];
	let contentPreview = "";

	const content = asRecord(parsed["message"])?.["content"];

	if (Array.isArray(content)) {
		for (const block of content) {
			if (isRecord(block)) {
				if (block["type"] === "text" && typeof block["text"] === "string" && !contentPreview) {
					contentPreview = block["text"].slice(0, 120).replace(/\n/g, " ");
				} else if (block["type"] === "tool_use" && typeof block["name"] === "string") {
					toolNames.push(block["name"]);
				} else if (block["type"] === "tool_result") {
					toolNames.push("tool_result");
				}
			} else if (typeof block === "string" && !contentPreview) {
				contentPreview = block.slice(0, 120).replace(/\n/g, " ");
			}
		}
	}

	return {type, contentPreview, toolNames};
}

function recordTypeIcon(type: string) {
	const iconClass = "h-3.5 w-3.5 shrink-0";
	switch (type) {
		case "assistant":
			return <Bot className={`${iconClass} text-accent-100`} />;
		case "user":
			return <MessageSquare className={`${iconClass} text-green-400`} />;
		case "system":
			return <Cpu className={`${iconClass} text-yellow-400`} />;
		default:
			return <FileText className={`${iconClass} text-t6`} />;
	}
}

function NeighborLink({
	entry,
	sessionId,
}: {
	entry: {
		raw: string;
		lineIndex: number;
		uuid?: string | undefined;
		parseError?: boolean | undefined;
	};
	sessionId: string;
}) {
	const summary = useMemo(() => summarizeRecord(entry.raw), [entry.raw]);

	const toolLabel =
		summary.toolNames.length > 0
			? summary.toolNames.slice(0, 3).join(", ") + (summary.toolNames.length > 3 ? "..." : "")
			: "";

	const preview = summary.contentPreview
		? summary.contentPreview.length > 100
			? summary.contentPreview.slice(0, 100) + "..."
			: summary.contentPreview
		: "";

	const inner = (
		<div className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-border bg-surface-0/30 hover:bg-surface-0/60 transition-colors text-xs group">
			{recordTypeIcon(summary.type)}
			<span className="font-mono text-secondary shrink-0">L{entry.lineIndex}</span>
			<span className="font-medium text-secondary shrink-0">{summary.type}</span>
			{entry.parseError && <AlertTriangle className="h-3 w-3 text-danger-000 shrink-0" />}
			{toolLabel && <span className="text-t6 font-mono truncate">{toolLabel}</span>}
			{preview && !toolLabel && <span className="text-t6 truncate italic">{preview}</span>}
			{entry.uuid && (
				<span className="ml-auto font-mono text-t6 opacity-60 group-hover:opacity-100 shrink-0">
					{entry.uuid.slice(0, 8)}
				</span>
			)}
		</div>
	);

	if (entry.uuid) {
		return (
			<a href={`/session/${sessionId}/source/${entry.uuid}`} className="block mb-1 no-underline">
				{inner}
			</a>
		);
	}

	return <div className="mb-1">{inner}</div>;
}

function CopyButton({text}: {text: string}) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => {
				setCopied(false);
			}, 1500);
		} catch {
			// clipboard not available
		}
	};
	return (
		<button
			type="button"
			onClick={() => {
				void copy();
			}}
			className="text-xs px-2 py-1 rounded bg-surface-0 hover:bg-fill-control text-secondary"
		>
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

function SourceViewPage() {
	const params = Route.useParams();
	return (
		<SessionRouteIdentity routeId={params.id}>
			{(sessionId) => (
				<Suspense
					fallback={
						<p role="status" className="p-6">
							Loading source…
						</p>
					}
				>
					<ResolvedSourceView sessionId={sessionId} recordUuid={params.uuid} />
				</Suspense>
			)}
		</SessionRouteIdentity>
	);
}

function ResolvedSourceView({sessionId, recordUuid}: {sessionId: string; recordUuid: string}) {
	const {data} = useSuspenseQuery(sessionSourceQueryOptions(sessionId, recordUuid, 5));
	const router = useRouter();
	const loaderData = Route.useLoaderData();
	const title = `Source: ${recordUuid.slice(0, 8)}`;
	useEffect(() => {
		if (loaderData.title !== title) void router.invalidate({filter: (match) => match.routeId === Route.id});
	}, [loaderData.title, title, router]);

	const jsonCtx: LinkedJsonContext = useMemo(
		() => ({
			sessionId,
			...(data?.projectId === undefined ? {} : {projectId: data.projectId}),
			knownUuids: new Set(data?.knownUuids ?? []),
		}),
		[sessionId, data?.projectId, data?.knownUuids],
	);

	if (!data) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<h1 className="text-lg font-medium text-primary mb-2">Source not found</h1>
				<p className="text-sm text-t6">
					No JSONL entry with uuid {recordUuid} in session {sessionId}.
				</p>
				<Link to="/session/$id" params={{id: sessionId}} className="text-accent-100 text-sm hover:underline">
					Back to session
				</Link>
			</div>
		);
	}

	const {window: rawWindow, parsedBlocksJson, parsedBlocksCount, paired, sessionTitle} = data;
	const focalRaw = prettyJsonl(rawWindow.focal.raw);
	const focalParsed = safeParse(rawWindow.focal.raw);
	const pairedParsed = paired ? safeParse(paired.resultEntry.raw) : undefined;
	const parsedBlocksParsed = safeParse(parsedBlocksJson);

	return (
		<div className="mx-auto max-w-4xl p-6 space-y-6">
			<div>
				<Link to="/session/$id" params={{id: sessionId}} className="text-accent-100 text-sm hover:underline">
					← {sessionTitle}
				</Link>
				<h1 className="text-lg font-medium text-primary mt-1">
					JSONL source · line {rawWindow.focal.lineIndex} · {recordUuid}
				</h1>
			</div>

			<section>
				<div className="flex items-center justify-between mb-2">
					<h2 className="text-sm font-medium text-secondary">Focal raw JSONL</h2>
					<CopyButton text={focalRaw} />
				</div>
				{focalParsed === undefined ? (
					<CodeBlock content={focalRaw} />
				) : (
					<LinkedJson value={focalParsed} context={jsonCtx} />
				)}
			</section>

			{paired && (
				<section>
					<div className="flex items-center justify-between mb-2">
						<h2 className="text-sm font-medium text-secondary">
							Paired tool_result · line {paired.resultLineIndex}
						</h2>
						{paired.resultEntry.uuid && (
							<a
								href={`/session/${sessionId}/source/${paired.resultEntry.uuid}`}
								target="_blank"
								rel="noopener noreferrer"
								className="text-xs text-accent-100 hover:underline"
							>
								open in new tab
							</a>
						)}
					</div>
					{pairedParsed === undefined ? (
						<CodeBlock content={prettyJsonl(paired.resultEntry.raw)} />
					) : (
						<LinkedJson value={pairedParsed} context={jsonCtx} />
					)}
				</section>
			)}

			<section>
				<h2 className="text-sm font-medium text-secondary mb-2">
					Parsed MessageContent block{parsedBlocksCount === 1 ? "" : "s"} ({parsedBlocksCount})
				</h2>
				{parsedBlocksCount === 0 ? (
					<p className="text-xs text-t6 italic">
						No parsed block — this entry was skipped by the parser (e.g. system, file-history-snapshot).
					</p>
				) : parsedBlocksParsed === undefined ? (
					<CodeBlock content={parsedBlocksJson} />
				) : (
					<LinkedJson value={parsedBlocksParsed} context={jsonCtx} />
				)}
			</section>

			<section>
				<h2 className="text-sm font-medium text-secondary mb-2">
					Before ({rawWindow.before.length} line
					{rawWindow.before.length === 1 ? "" : "s"})
				</h2>
				{rawWindow.before.length === 0 ? (
					<p className="text-xs text-t6 italic">No preceding lines.</p>
				) : (
					rawWindow.before.map((entry) => (
						<NeighborLink key={entry.lineIndex} entry={entry} sessionId={sessionId} />
					))
				)}
			</section>

			<section>
				<h2 className="text-sm font-medium text-secondary mb-2">
					After ({rawWindow.after.length} line
					{rawWindow.after.length === 1 ? "" : "s"})
				</h2>
				{rawWindow.after.length === 0 ? (
					<p className="text-xs text-t6 italic">No following lines.</p>
				) : (
					rawWindow.after.map((entry) => (
						<NeighborLink key={entry.lineIndex} entry={entry} sessionId={sessionId} />
					))
				)}
			</section>
		</div>
	);
}
