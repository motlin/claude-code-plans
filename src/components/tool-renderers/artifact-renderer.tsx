import type { KeyboardEvent } from "react";
import { AppWindow, ChevronRight } from "lucide-react";
import type { ParsedArtifact } from "../../lib/artifact-output";
import type { ArtifactListEntry } from "../../lib/artifact-schemas";
import { artifactPreviewPath, isPreviewableSourcePath } from "../../lib/artifact-source-paths";
import { FallbackRenderer } from "./fallback-renderer";
import { KeyValueCard } from "./shared";
import { isArtifactCard, type ClientToolCall, type ToolRendererProps } from "./types";

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Upstream's card label: the artifact's title, else its file's name, else its id. */
function artifactLabel(artifact: ParsedArtifact, input: ClientToolCall["input"]): string {
  if (artifact.title !== undefined) return artifact.title;
  const filePath = artifact.path ?? input["file_path"];
  if (typeof filePath === "string" && filePath !== "") return basename(filePath);
  return artifact.id || "Untitled artifact";
}

/** Whether the sandboxed source preview can show the local file a publish came from. */
function previewableSource(artifact: ParsedArtifact, input: ClientToolCall["input"]): boolean {
  const filePath = artifact.path ?? input["file_path"];
  return typeof filePath === "string" && isPreviewableSourcePath(filePath);
}

/**
 * Upstream's "Open artifact" pill. The artifact only lives on claude.ai, so
 * it is a link out in a new tab; Space opens it too, as upstream's button does.
 * A publish from a local HTML or Markdown file also gets a "Preview source"
 * link to the sandboxed local preview.
 */
function ArtifactCard({
  url,
  label,
  previewHref,
}: {
  url: string;
  label: string;
  previewHref: string | undefined;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
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
          className="card-outline absolute inset-0 -z-[1] rounded-[inherit] group-hover/btn:bg-fill-ghost-hover"
        />
        <AppWindow size={16} aria-hidden="true" className="shrink-0 self-center text-ink-muted" />
        <span className="min-w-0 flex-1 text-body text-primary truncate">{label}</span>
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 self-center text-ink-muted"
        />
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

function ArtifactListBody({
  toolCall,
  artifacts,
}: {
  toolCall: ClientToolCall;
  artifacts: ArtifactListEntry[];
}) {
  const params = Object.entries(toolCall.input).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  return (
    <KeyValueCard params={params} copyText={toolCall.result}>
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
export function ArtifactRenderer({ toolCall }: ToolRendererProps) {
  if (isArtifactCard(toolCall) && toolCall.artifact !== undefined) {
    return (
      <ArtifactCard
        url={toolCall.artifact.url}
        label={artifactLabel(toolCall.artifact, toolCall.input)}
        previewHref={
          previewableSource(toolCall.artifact, toolCall.input)
            ? artifactPreviewPath(toolCall.artifact.id)
            : undefined
        }
      />
    );
  }
  if (toolCall.artifactList !== undefined && !toolCall.isError) {
    return <ArtifactListBody toolCall={toolCall} artifacts={toolCall.artifactList} />;
  }
  return <FallbackRenderer toolCall={toolCall} />;
}
