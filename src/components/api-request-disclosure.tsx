import {useQuery} from "@tanstack/react-query";
import {useId, useState, type ReactNode} from "react";

import {sessionApiRequestMessagesQueryOptions, sessionApiRequestsQueryOptions} from "../lib/api/sessions";
import {
	resolveApiRequest,
	type ApiRequestSummary,
	type ApiRequestShapeSummary,
	type ClassifierArtifactSummary,
} from "../lib/api-request-log";
import type {ApiRequestMessage, ApiRequestMessageBlock} from "../lib/api-request-messages";
import {assertNever} from "../lib/assert-never";
import {formatModelName} from "../lib/model-name";
import {
	classifierArtifactAttestationLabels,
	classifierArtifactPublishEnvLabels,
	classifierArtifactShareModeLabels,
	classifierArtifactShareRoleLabels,
} from "../lib/schema-choices";
import {ChevronIcon, CollapsibleSection} from "./tool-renderers/shared";
import {type AttachedImage, UserAttachments} from "./user-attachments";

const NUMBER = new Intl.NumberFormat("en-US");

function Fact({label, children}: {label: string; children: ReactNode}) {
	return (
		<div className="flex gap-2 min-w-0">
			<span className="shrink-0 text-t6">{label}</span>
			<span className="min-w-0 break-words text-secondary">{children}</span>
		</div>
	);
}

/** A label from a schema-choice map, falling back to the raw value the lenient runtime schemas let through. */
function choiceLabel(labels: Record<string, string>, value: string): string {
	return labels[value] ?? value;
}

/** One line describing what the classifier knew about an artifact: its share probe, publish and local files. */
function describeClassifierArtifact(artifact: ClassifierArtifactSummary): string {
	const parts: string[] = [];
	if (artifact.attested !== undefined) {
		parts.push(`${choiceLabel(classifierArtifactAttestationLabels, artifact.attested)}, not probed`);
	}
	const {share} = artifact;
	if (share !== undefined) {
		parts.push(`${choiceLabel(classifierArtifactShareModeLabels, share.mode)} share`);
		if (share.role !== undefined) parts.push(`role ${choiceLabel(classifierArtifactShareRoleLabels, share.role)}`);
		parts.push(share.isSharedLive ? "shared live" : "not shared live");
		if (share.probeFailed) parts.push("share probe failed");
		else if (!share.probed) parts.push("not probed");
		if (share.probed && !share.probeCurrentAccount) parts.push("probed as another account");
		if (share.typeLock) parts.push("type-locked");
		if (share.livePaths.length > 0) parts.push(`live paths: ${share.livePaths.join(", ")}`);
		if (share.capabilities.length > 0) parts.push(`capabilities: ${share.capabilities.join(", ")}`);
		if (share.grantObserved) parts.push("grant observed");
	}
	if (artifact.publishedEnv !== undefined) {
		parts.push(`published to ${choiceLabel(classifierArtifactPublishEnvLabels, artifact.publishedEnv)}`);
	}
	if (artifact.lastPublish) parts.push("last publish");
	if (artifact.paths.length > 0) parts.push(`from ${artifact.paths.join(", ")}`);
	return parts.join(" · ");
}

function ArtifactFacts({artifacts}: {artifacts: readonly ClassifierArtifactSummary[]}) {
	return (
		<div className="flex flex-col gap-1 min-w-0">
			<span className="text-t6">{`Artifacts (${artifacts.length})`}</span>
			{artifacts.map((artifact) => (
				<div key={artifact.id} className="flex flex-col pl-4 min-w-0">
					<span className="break-all font-mono text-[11px] text-secondary">{artifact.id}</span>
					<span className="break-words text-t6">{describeClassifierArtifact(artifact)}</span>
				</div>
			))}
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
			{request.artifacts !== undefined && <ArtifactFacts artifacts={request.artifacts} />}
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

const PRE = "whitespace-pre-wrap break-words font-mono text-[11px] text-secondary";

function attachedImages(key: string, images: readonly {mediaType: string; data: string}[]): AttachedImage[] {
	return images.map((image, index) => ({
		key: `${key}-${index}`,
		src: `data:${image.mediaType};base64,${image.data}`,
		label: "Attached image",
	}));
}

function MessageBlock({block, blockKey}: {block: ApiRequestMessageBlock; blockKey: string}) {
	switch (block.type) {
		case "text":
			return <pre className={PRE}>{block.text}</pre>;
		case "thinking":
			return (
				<div className="flex flex-col min-w-0">
					<span className="text-t6">Thinking</span>
					<pre className={PRE}>{block.text}</pre>
				</div>
			);
		case "tool_use":
			return (
				<div className="flex flex-col min-w-0">
					<span className="text-t6">{`Tool use ${block.name}`}</span>
					<pre className={PRE}>{block.input}</pre>
				</div>
			);
		case "tool_result":
			return (
				<div className="flex flex-col min-w-0">
					<span className="text-t6">{`Tool result ${block.toolUseId}${block.isError ? " (error)" : ""}`}</span>
					{block.text !== "" && <pre className={PRE}>{block.text}</pre>}
					<UserAttachments images={attachedImages(blockKey, block.images)} />
				</div>
			);
		case "tool_addition":
			return <span className="text-t6">{`Added tool ${block.name}${block.definition ? "" : " (by name)"}`}</span>;
		case "image":
			return <UserAttachments images={attachedImages(blockKey, [block])} />;
		default:
			return assertNever(block);
	}
}

function RequestMessage({message}: {message: ApiRequestMessage}) {
	return (
		<div className="flex flex-col gap-1 min-w-0">
			<span className="text-t6 font-medium">{message.role}</span>
			<div className="flex flex-col gap-1 pl-4 min-w-0">
				{message.blocks.map((block, index) => (
					<MessageBlock key={index} block={block} blockKey={`${message.hash}-${index}`} />
				))}
			</div>
		</div>
	);
}

/** The request's tail: the messages it appended after the prefix it kept, loaded when this section mounts. */
function RequestMessages({sessionId, requestId}: {sessionId: string; requestId: string}) {
	const query = useQuery(sessionApiRequestMessagesQueryOptions(sessionId, requestId));
	if (query.data === undefined) return query.isError ? "Couldn't load the request's messages" : "Loading…";
	const {messages, missing} = query.data;
	return (
		<div data-testid="api-request-messages" className="flex flex-col gap-2 min-w-0">
			{messages.length === 0 && missing.length === 0 && <span className="text-t6">No new messages</span>}
			{messages.map((message, index) => (
				<RequestMessage key={`${message.hash}-${index}`} message={message} />
			))}
			{missing.length > 0 && (
				<span className="text-t6">{`${missing.length} message${missing.length === 1 ? " has" : "s have"} no logged blob`}</span>
			)}
		</div>
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
			<CollapsibleSection label="New messages">
				<RequestMessages sessionId={sessionId} requestId={resolved.request.id} />
			</CollapsibleSection>
		</>
	);
}

/**
 * The Messages API request (CLI 2.1.300+) an assistant turn came from: its
 * model, effort, thinking mode, betas, tools, system prompt and the messages
 * it appended (fetched by hash when that section opens). A local
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
