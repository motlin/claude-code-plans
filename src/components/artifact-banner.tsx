import {AppWindow, MessageSquareText} from "lucide-react";
import {renderArtifactLinkCard} from "../lib/client-markdown";
import type {ProcessedLine} from "../lib/transcript";
import {Banner} from "./attachment-banner";
import {MarkdownArticle} from "./markdown-article";

type ArtifactLinkLine = Extract<ProcessedLine, {type: "artifact-link"}>;
type ArtifactWatchLine = Extract<ProcessedLine, {type: "artifact-watch"}>;

/** The link card a markdown link to the artifact renders as. */
function ArtifactCard({url, title}: {url: string; title: string | undefined}) {
	return <MarkdownArticle html={renderArtifactLinkCard(url, title ?? url)} />;
}

/** A `frame-link` record: an artifact the session published, linked out to its page. */
export function ArtifactLinkBanner({line}: {line: ArtifactLinkLine}) {
	return (
		<Banner icon={<AppWindow className="h-3.5 w-3.5" />} label="Published artifact">
			<ArtifactCard url={line.frameUrl} title={line.title} />
			{line.path !== undefined && (
				<span className="font-mono text-t6 truncate min-w-0" title={line.path}>
					{line.path}
				</span>
			)}
		</Banner>
	);
}

function watchNote(artifact: ArtifactWatchLine["artifacts"][number]): string | undefined {
	const notes: string[] = [];
	if (artifact.state !== undefined && artifact.state !== "armed") notes.push(artifact.state);
	if (artifact.commentThreads !== undefined) {
		notes.push(`${artifact.commentThreads} comment thread${artifact.commentThreads === 1 ? "" : "s"}`);
	}
	return notes.length === 0 ? undefined : notes.join(" · ");
}

/** The artifacts the session's comment monitor watches, from its latest state. */
export function ArtifactWatchBanner({line}: {line: ArtifactWatchLine}) {
	return (
		<Banner icon={<MessageSquareText className="h-3.5 w-3.5" />} label="Watching for comments">
			{line.artifacts.map((artifact) => {
				const note = watchNote(artifact);
				return (
					<span key={artifact.url} className="inline-flex items-center gap-1.5 min-w-0">
						<ArtifactCard url={artifact.url} title={artifact.title} />
						{note !== undefined && <span className="text-t6">{note}</span>}
					</span>
				);
			})}
		</Banner>
	);
}
