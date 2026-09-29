import { ExternalLink, Info } from "lucide-react";
import type { ArtifactSummary } from "../lib/api/artifacts";
import { artifactSourceUrl } from "../lib/artifact-source-paths";

type PreviewableArtifact = Pick<
  ArtifactSummary,
  "id" | "url" | "title" | "sourceExists" | "sourceModifiedAt" | "lastPublishedAt"
>;

function OpenOnClaudeLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent-100 hover:underline"
    >
      Open on claude.ai
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}

/**
 * The artifact's local source in a scripts-only sandboxed iframe, like
 * claude.ai/code's artifact frame but without `allow-same-origin`, so the
 * page gets an opaque origin and cannot reach this app. Without a local
 * source it links out to the published artifact instead.
 */
export function ArtifactSourcePreview({ artifact }: { artifact: PreviewableArtifact }) {
  if (!artifact.sourceExists) {
    return (
      <div className="flex flex-col items-start gap-2 p-6 text-body text-secondary">
        <p>The local source file for this artifact no longer exists.</p>
        <OpenOnClaudeLink url={artifact.url} />
      </div>
    );
  }

  const modifiedSincePublish =
    artifact.sourceModifiedAt !== null &&
    artifact.lastPublishedAt !== null &&
    artifact.sourceModifiedAt > artifact.lastPublishedAt;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="note"
        className="flex items-start gap-2 border-b border-border bg-surface-2 px-4 py-2 text-footnote text-secondary"
      >
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <div className="flex min-w-0 flex-col">
          <span className="text-primary">
            Local source · may differ from the published version
            {modifiedSincePublish && " · modified since publish"}
          </span>
          <span className="text-ink-muted">
            Multi-file artifacts are not supported, so relative assets may not load.
          </span>
        </div>
      </div>
      <iframe
        src={artifactSourceUrl(artifact.id)}
        sandbox="allow-scripts"
        title={`Local source of ${artifact.title}`}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
