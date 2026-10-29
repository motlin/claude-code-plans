import {noop} from "@tanstack/react-query";
import {createFileRoute} from "@tanstack/react-router";
import {CommandDetailFrame} from "../components/customize/detail-frames";
import {userCommandFileQueryOptions} from "../lib/api/plugins";
import {fromMdSlug} from "../lib/md-slug";

export const Route = createFileRoute("/customize_/skills/command/$source/$filename")({
	component: CommandDetailPage,
	loader: ({context: {queryClient}, params}) => {
		void queryClient.query(userCommandFileQueryOptions(params.source, fromMdSlug(params.filename))).catch(noop);
	},
	head: () => ({meta: [{title: "Command · Customize"}]}),
	staticData: {pageGutter: "tight"},
});

/** A custom command's detail page: header over its rendered markdown. */
function CommandDetailPage() {
	const {source, filename} = Route.useParams();
	return (
		<div className="flex w-full flex-col bg-surface-1 text-body text-primary">
			<div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-8 md:px-8">
				<CommandDetailFrame source={source} filename={fromMdSlug(filename)} />
			</div>
		</div>
	);
}
