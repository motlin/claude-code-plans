import {createFileRoute, Link} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {MarkdownView} from "../components/markdown-view";
import {planQueryOptions, planLinksQueryOptions} from "../lib/api/plans";
import {fromMdSlug} from "../lib/md-slug";
import {formatNarrowRelativeTime} from "../lib/relative-time";
import {ArrowLeft, Pencil} from "lucide-react";
import {DetailTopBar} from "../components/detail-top-bar";
import {pillStyles} from "../components/pill-styles";
import {DebugLink} from "../components/debug-link";
import {PlanContextHeader} from "../components/plan-context-header";

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "UTC",
	});
}

export const Route = createFileRoute("/plan/$filename")({
	component: PlanPage,
	loader: async ({context: {queryClient}, params}) =>
		Promise.all([
			queryClient.query({...planQueryOptions(params.filename), staleTime: "static"}),
			queryClient.query({...planLinksQueryOptions(params.filename), staleTime: "static"}),
		]),
	head: ({params}) => ({
		meta: [{title: fromMdSlug(params.filename)}],
	}),
});

function PlanPage() {
	const {filename: slug} = Route.useParams();
	const filename = fromMdSlug(slug);
	const {data: plan} = useSuspenseQuery(planQueryOptions(slug));
	const {data: links} = useSuspenseQuery(planLinksQueryOptions(slug));

	if (!plan) {
		return (
			<div>
				<DetailTopBar>
					<Link to="/plans" className={pillStyles.primary}>
						<ArrowLeft className="h-3.5 w-3.5" />
						All Plans
					</Link>
				</DetailTopBar>
				<h1 className="mt-4 text-lg font-semibold">Plan Not Found</h1>
				<p className="mt-2 text-t6">This plan could not be found.</p>
			</div>
		);
	}

	return (
		<div>
			<DetailTopBar>
				<Link to="/plans" className={pillStyles.primary}>
					<ArrowLeft className="h-3.5 w-3.5" />
					All Plans
				</Link>
				<Link to="/plan/$filename/edit" params={{filename: slug}} className={pillStyles.outline}>
					<Pencil className="h-3 w-3" />
					Edit
				</Link>
				<DebugLink kind="plan" relativePath={filename} />
			</DetailTopBar>
			<div data-testid="plan-page" className="mx-auto mt-4 flex max-w-[68ch] flex-col gap-4">
				<PlanContextHeader links={links} now={Date.now()} />
				<p className="text-footnote text-ink-muted">
					<span>{filename}</span>
					{plan.mtime && (
						<>
							{" · "}
							<time dateTime={plan.mtime} title={formatDate(plan.mtime)}>
								Modified {formatNarrowRelativeTime(Date.parse(plan.mtime), Date.now())}
							</time>
						</>
					)}
				</p>
				<MarkdownView markdown={plan.markdown} />
			</div>
		</div>
	);
}
