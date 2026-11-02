import type {KeyboardEvent} from "react";
import {AppWindow, ChevronRight} from "lucide-react";
import type {ArtifactSummary} from "../../lib/api/artifacts";
import {ARTIFACT_MARK_KINDS, ARTIFACT_TYPE_KINDS, MARK_INK, resolveArtifactMark} from "../../lib/artifact-mark";
import type {ParsedArtifact} from "../../lib/artifact-output";
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

/** Upstream's card label: the artifact's title, else its file's name, else its id. */
function artifactLabel(artifact: ParsedArtifact, input: ClientToolCall["input"]): string
{
	if (artifact.title !== undefined) return artifact.title;
	const filePath = artifact.path ?? input["file_path"];
	if (typeof filePath === "string" && filePath !== "") return basename(filePath);
	return artifact.id || "Untitled artifact";
}

/** Whether the sandboxed source preview can show the local file a publish came from. */
function previewableSource(artifact: ParsedArtifact, input: ClientToolCall["input"]): boolean
{
	const filePath = artifact.path ?? input["file_path"];
	return typeof filePath === "string" && isPreviewableSourcePath(filePath);
}

/**
 * Upstream's "Open artifact" pill. The artifact only lives on claude.ai, so
 * it is a link out in a new tab; Space opens it too, as upstream's button does.
 * A publish from a local HTML or Markdown file also gets a "Preview source"
 * link to the sandboxed local preview.
 */
export function ArtifactCard({
	url,
	label,
	previewHref,
	typeKind,
}: {
	url: string;
	label: string;
	previewHref: string | undefined;
	/** The artifact's type kind, when it was made from a known type. */
	typeKind?: ArtifactKind | undefined;
})
{
	const mark = resolveArtifactMark(
		{
			typeKind,
		},
	);
	const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) =>
	{
		if (event.key !== " ") return;
		event.preventDefault();
		window.open(url, "_blank", "noopener,noreferrer");
	};
	return (
		<div className="flex flex-col w-full my-[6px]">
			<a
				role="button"
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Open artifact ${label}`}
				onKeyDown={onKeyDown}
				className="relative isolate flex self-start min-w-[318px] max-w-[318px] items-start gap-g3 rounded-r6 pl-2.5 pr-p3 py-p6 text-left group/btn cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus"
			>
				<span
					aria-hidden="true"
					className="card-outline task-card-surface absolute inset-0 -z-[1] rounded-[inherit] group-hover/btn:bg-fill-ghost-hover"
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
				<ChevronRight size={16} aria-hidden="true" className="shrink-0 self-center text-ink-muted" />
			</a>
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
