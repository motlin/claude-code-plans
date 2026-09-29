import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { type SessionArtifact, sessionArtifactsQueryOptions } from "../../lib/api/artifacts";
import { artifactPreviewPath } from "../../lib/artifact-source-paths";
import { ArtifactCard } from "../tool-renderers/artifact-renderer";
import { registerPane } from "./pane-registry";

const EMPTY_COPY = "Artifacts published in this session appear here.";

/**
 * Local stand-in for upstream's session Artifacts pane: the artifacts only
 * live on claude.ai, so instead of a frame switcher over iframes this lists
 * one upstream "Open artifact" card per artifact, linking out.
 */
export function SessionArtifactsList({ artifacts }: { artifacts: readonly SessionArtifact[] }) {
  if (artifacts.length === 0) {
    return <p className="px-3 py-6 text-center text-body text-muted">{EMPTY_COPY}</p>;
  }
  return (
    <ul className="flex flex-col px-3 py-1">
      {artifacts.map((artifact) => (
        <li key={artifact.url}>
          <ArtifactCard
            url={artifact.url}
            label={artifact.title}
            previewHref={artifact.previewable ? artifactPreviewPath(artifact.id) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}

/** The session's artifacts, refetched whenever the session itself refreshes. */
export function useSessionArtifacts(sessionId: string): SessionArtifact[] {
  return useQuery(sessionArtifactsQueryOptions(sessionId)).data ?? [];
}

/** Registers the `artifacts` pane kind for this session while mounted. */
export function useRegisterArtifactsPane(artifacts: readonly SessionArtifact[]): void {
  useEffect(
    () =>
      registerPane("artifacts", {
        title: "Artifacts",
        render: () => <SessionArtifactsList artifacts={artifacts} />,
      }),
    [artifacts],
  );
}
