import type {SessionArtifact} from "../../lib/api/artifacts";
import {artifactPreviewPath} from "../../lib/artifact-source-paths";
import {ArtifactCard} from "../tool-renderers/artifact-renderer";

const EMPTY_COPY = "Artifacts published in this session appear here.";

/**
 * Local stand-in for upstream's session Artifacts pane: the artifacts only
 * live on claude.ai, so instead of a frame switcher over iframes this lists
 * one upstream "Open artifact" card per artifact, linking out.
 */
export function SessionArtifactsList({artifacts}: {artifacts: readonly SessionArtifact[]}) {
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
