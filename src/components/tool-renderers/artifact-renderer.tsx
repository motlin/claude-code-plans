import type {KeyboardEvent} from "react";
import {AppWindow, ChevronRight} from "lucide-react";
import type {ArtifactSummary} from "../../lib/api/artifacts";
import {ARTIFACT_MARK_KINDS, ARTIFACT_TYPE_KINDS, MARK_INK, resolveArtifactMark} from "../../lib/artifact-mark";
import {artifactCardStatus, type ArtifactCardStatus, type ParsedArtifact} from "../../lib/artifact-output";
import type {ArtifactListEntry} from "../../lib/artifact-schemas";
import {artifactPreviewPath, isPreviewableSourcePath} from "../../lib/artifact-source-paths";
import {ArtifactGlyph} from "../artifact-mark";
import {FallbackRenderer} from "./fallback-renderer";
import {KeyValueCard} from "./shared";
import {isArtifactCard, type ClientToolCall, type ToolRendererProps} from "./types";

type ArtifactKind = ArtifactSummary["kind"];

function basename(path: string): string
{
	return path.split("/").pop() ?? path;
}

/**
 * Upstream's card label: the artifact's title, else its file's name without
 * the extension. Upstream `MF` drops a bare id, so an unnamed card reads
 * "Untitled artifact".
 */
function artifactLabel(artifact: ParsedArtifact, input: ClientToolCall["input"]): string
{
	if (artifact.title !== undefined) return artifact.title;
	const filePath = artifact.path ?? input["file_path"];
	if (typeof filePath !== "string" || filePath === "") return "Untitled artifact";
	const name = basename(filePath);
	return name.replace(/\.\w+$/, "") || name;
}

/** Whether the sandboxed source preview can show the local file a publish came from. */
function previewableSource(artifact: ParsedArtifact, input: ClientToolCall["input"]): boolean
{
	const filePath = artifact.path ?? input["file_path"];
	return typeof filePath === "string" && isPreviewableSourcePath(filePath);
}

const STATUS_TEXT: Record<ArtifactCardStatus, string> =
{
	opened: "Opened",
	published: "Published",
};

/**
 * Upstream's "Open artifact" card (`R`): a div role=button that click, Enter
 * and Space activate. Local has no in-app artifact pane, so every activation
 * opens the claude.ai URL in a new tab, upstream's own no-opener fallback.
 * A publish from a local HTML or Markdown file also gets a "Preview source"
 * link to the sandboxed local preview.
 */
export function ArtifactCard({
	url,
	label,
	previewHref,
	typeKind,
	status,
}: {
	url: string;
	label: string;
	previewHref: string | undefined;
	/** The artifact's type kind, when it was made from a known type. */
	typeKind?: ArtifactKind | undefined;
	/** Upstream `z`'s status text; the session Artifacts pane passes none. */
	status?: ArtifactCardStatus | undefined;
})
{
	const mark = resolveArtifactMark(
		{
			typeKind,
		},
	);
	const open = () =>
	{
		window.open(url, "_blank", "noopener,noreferrer");
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) =>
	{
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		open();
	};
	return (
		<div className="flex flex-col w-full my-[6px]">
			{/* Upstream gets the pointer from cds [role=button] base styles; a local div needs cursor-pointer. */}
			<div
				role="button"
				tabIndex={0}
				aria-label={`Open artifact ${label}`}
				onClick={open}
				onKeyDown={onKeyDown}
				className="relative isolate flex self-start min-w-[min(100%,318px)] max-w-[min(100%,318px)] items-start gap-xs rounded-lg ps-2.5 pe-xs py-sm text-start group/btn focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus group/tool cursor-pointer"
			>
				<span
					aria-hidden="true"
					className="task-card-surface shadow-[inset_0_0_0_1px_var(--upstream-border)] absolute inset-0 -z-[1] rounded-[inherit] group-hover/btn:bg-fill-ghost-hover"
				/>
				{mark === undefined ? (
					<AppWindow size={16} aria-hidden="true" className="shrink-0 self-center text-muted-as-secondary" />
				) : (
					// Upstream c33aef2b7 `L`: `Q$(…, "sm")`'s bare glyph, its ink on the slot.
					<span className={`flex shrink-0 self-center ${MARK_INK[mark.hue]}`}>
						<span data-artifact-mark={mark.kind} className="flex">
							<ArtifactGlyph icon={ARTIFACT_MARK_KINDS[mark.kind].icon} size="sm" />
						</span>
					</span>
				)}
				<span className="min-w-0 flex-1 text-body text-primary truncate">{label}</span>
				{status === undefined ? null : (
					<span className="shrink-0 text-footnote text-muted-as-secondary">{STATUS_TEXT[status]}</span>
				)}
				<span className="shrink-0 self-center text-muted-as-secondary">
					<ChevronRight size={16} aria-hidden="true" data-cds-mirror="" />
				</span>
			</div>
			{previewHref !== undefined && (
				<a
					href={previewHref}
					className="mt-1 self-start rounded px-1 text-caption text-secondary hover:bg-fill-ghost-hover hover:text-primary"
				>
					Preview source
				</a>
			)}
		</div>
	);
}

/** A publish's known type kind, from the type it was created from. */
function publishTypeKind(input: ClientToolCall["input"]): ArtifactKind | undefined
{
	const typeUrl = input["type_url"];
	return typeof typeUrl === "string" && Object.hasOwn(ARTIFACT_TYPE_KINDS, typeUrl)
		? ARTIFACT_TYPE_KINDS[typeUrl]
		: undefined;
}

function ArtifactListBody({toolCall, artifacts}: {toolCall: ClientToolCall; artifacts: ArtifactListEntry[]})
{
	const params = Object.entries(toolCall.input).map(([key, value]) => (
	{
		key,
		value: typeof value === "string" ? value : JSON.stringify(value),
	}));
	return (
		<KeyValueCard call={toolCall} params={params} copyText={toolCall.result}>
			<div className="flex flex-col gap-g2">
				{artifacts.map((artifact) => (
					<a
						key={artifact.url}
						href={artifact.url}
						target="_blank"
						rel="noopener noreferrer"
						className="flex min-w-0 items-center gap-g4 text-primary hover:underline"
					>
						{artifact.favicon !== undefined && (
							<span aria-hidden="true" className="shrink-0">
								{artifact.favicon}
							</span>
						)}
						<span className="truncate">{artifact.title}</span>
					</a>
				))}
			</div>
		</KeyValueCard>
	);
}

/**
 * Artifact body: an "Open artifact" card for a publish or open, link rows for
 * a list, and the key/value body for every other action or a failure.
 */
export function ArtifactRenderer({toolCall}: ToolRendererProps)
{
	if (isArtifactCard(toolCall) && toolCall.artifact !== undefined)
	{
		return (
			<ArtifactCard
				url={toolCall.artifact.url}
				label={artifactLabel(toolCall.artifact, toolCall.input)}
				typeKind={publishTypeKind(toolCall.input)}
				status={artifactCardStatus(toolCall.input, toolCall.artifact)}
				previewHref={
					previewableSource(toolCall.artifact, toolCall.input)
						? artifactPreviewPath(toolCall.artifact.id)
						: undefined
				}
			/>
		);
	}
	if (toolCall.artifactList !== undefined && !toolCall.isError)
	{
		return <ArtifactListBody toolCall={toolCall} artifacts={toolCall.artifactList} />;
	}
	return <FallbackRenderer toolCall={toolCall} />;
}
