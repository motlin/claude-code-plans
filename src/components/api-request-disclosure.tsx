import {useQuery} from "@tanstack/react-query";
import {useId, useState, type ReactNode} from "react";

import {sessionApiRequestsQueryOptions} from "../lib/api/sessions";
import {resolveApiRequest, type ApiRequestSummary, type ApiRequestShapeSummary} from "../lib/api-request-log";
import {formatModelName} from "../lib/model-name";
import {ChevronIcon, CollapsibleSection} from "./tool-renderers/shared";

const NUMBER = new Intl.NumberFormat("en-US");

function Fact({label, children}: {label: string; children: ReactNode}) {
	return (
		<div className="flex gap-2 min-w-0">
			<span className="shrink-0 text-t6">{label}</span>
			<span className="min-w-0 break-words text-secondary">{children}</span>
		</div>
	);
}

function RequestFacts({request}: {request: ApiRequestSummary}) {
	const model = formatModelName(request.model) ?? request.model;
	return (
		<>
			<div className="text-secondary">
				{`${model} · ${request.effort} effort · ${request.thinking.type} thinking (${request.thinking.display})`}
			</div>
			<Fact label="Max tokens">{NUMBER.format(request.maxTokens)}</Fact>
			{request.permissionMode !== undefined && <Fact label="Permission mode">{request.permissionMode}</Fact>}
			<Fact label="Query source">{request.querySource}</Fact>
			{request.betas.length > 0 && <Fact label="Betas">{request.betas.join(", ")}</Fact>}
		</>
	);
}

function ShapeFacts({request, shape}: {request: ApiRequestSummary; shape: ApiRequestShapeSummary}) {
	const changes = request.toolChanges;
	const blocks = `${shape.system.length} block${shape.system.length === 1 ? "" : "s"}`;
	return (
		<>
			{changes !== undefined && (
				<Fact label="Tools changed">
					{[...changes.added.map((name) => `+${name}`), ...changes.removed.map((name) => `−${name}`)].join(
						" ",
					)}
				</Fact>
			)}
			<Fact label={`Tools (${shape.tools.length})`}>{shape.tools.join(", ")}</Fact>
			<CollapsibleSection label={`System prompt (${blocks})`}>
				<div className="flex flex-col gap-2">
					{shape.system.map((text, index) => (
						<pre
							key={index}
							className="whitespace-pre-wrap break-words font-mono text-[11px] text-secondary"
						>
							{text}
						</pre>
					))}
				</div>
			</CollapsibleSection>
		</>
	);
}

function RequestBody({sessionId, requestRef}: {sessionId: string; requestRef: string}) {
	const query = useQuery(sessionApiRequestsQueryOptions(sessionId, true));
	if (query.data === undefined) return query.isError ? "Couldn't load the API request log" : "Loading…";
	const resolved = resolveApiRequest(query.data, requestRef);
	if (resolved === null) return "No API request logged for this turn";
	return (
		<>
			<RequestFacts request={resolved.request} />
			{resolved.shape === null ? (
				<div className="text-t6">No tool list or system prompt logged for this request</div>
			) : (
				<ShapeFacts request={resolved.request} shape={resolved.shape} />
			)}
		</>
	);
}

/**
 * The Messages API request (CLI 2.1.300+) an assistant turn came from: its
 * model, effort, thinking mode, betas, tools and system prompt. A local
 * diagnostic upstream never shows, so only Verbose draws it. The session's
 * request log is fetched on first open.
 */
export function ApiRequestDisclosure({sessionId, requestRef}: {sessionId: string; requestRef: string}) {
	const [open, setOpen] = useState(false);
	const bodyId = useId();
	return (
		<div className="flex flex-col gap-1 text-xs min-w-0">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => {
					setOpen(!open);
				}}
				className="flex self-start items-center gap-1 text-t6 hover:text-primary cursor-pointer"
			>
				<ChevronIcon expanded={open} />
				Request
			</button>
			{open && (
				<div id={bodyId} data-testid="api-request-body" className="flex flex-col gap-1 pl-4 min-w-0">
					<RequestBody sessionId={sessionId} requestRef={requestRef} />
				</div>
			)}
		</div>
	);
}
