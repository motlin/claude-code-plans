import {createFileRoute, Link} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {ExternalLink} from "lucide-react";
import {ArtifactSourcePreview} from "../components/artifact-source-preview";
import {artifactsQueryOptions} from "../lib/api/artifacts";

export const Route = createFileRoute("/artifact/$id")({
	component: ArtifactPreviewPage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(artifactsQueryOptions),
	head: () => ({
		meta: [{title: "Artifact"}],
	}),
});

const HEADER_LINK =
	"inline-flex items-center gap-1 rounded-md px-2 py-1 text-footnote text-secondary no-underline transition-colors hover:bg-fill-ghost-hover hover:text-primary";

/** Local stand-in for claude.ai/code's artifact viewer: the sandboxed local source. */
function ArtifactPreviewPage() {
	const {id} = Route.useParams();
	const {data: artifacts} = useSuspenseQuery(artifactsQueryOptions);
	const artifact = artifacts.find((candidate) => candidate.id === id);

	if (artifact === undefined) {
		return (
			<div className="flex flex-col items-start gap-2 p-6 text-body text-secondary">
				<h1 className="text-primary font-medium">Artifact not found</h1>
				<Link to="/artifacts" className="text-accent-100 hover:underline">
					All artifacts
				</Link>
			</div>
		);
	}

	return (
		<div className="flex min-h-[80vh] flex-1 flex-col">
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
				<h1 className="min-w-0 truncate text-body font-medium text-primary">{artifact.title}</h1>
				<div className="flex shrink-0 items-center gap-1">
					<Link to="/session/$id" params={{id: artifact.sessionId}} className={HEADER_LINK}>
						Open session
					</Link>
					<a href={artifact.url} target="_blank" rel="noopener noreferrer" className={HEADER_LINK}>
						Open in web
						<ExternalLink aria-hidden="true" className="size-3.5" />
					</a>
				</div>
			</header>
			<ArtifactSourcePreview artifact={artifact} />
		</div>
	);
}
