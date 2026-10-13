import {noop} from "@tanstack/react-query";
import {createFileRoute, Outlet} from "@tanstack/react-router";
import {SkillDetailFrame} from "../components/customize/detail-frames";
import {customizeSkillDetailQueryOptions} from "../lib/api/customize";

export const Route = createFileRoute("/customize_/skills/id/$skillId")({
	component: SkillDetailLayout,
	loader: ({context: {queryClient}, params}) => {
		void queryClient.query(customizeSkillDetailQueryOptions(params.skillId)).catch(noop);
	},
	head: () => ({meta: [{title: "Skill · Customize"}]}),
});

/** Skill detail shell: header and Overview · Contents tabs over the active tab. */
function SkillDetailLayout() {
	const {skillId} = Route.useParams();
	return (
		<div className="flex w-full flex-col bg-surface-1 text-body text-primary">
			<div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-8 md:px-8">
				<SkillDetailFrame skillId={skillId}>{() => <Outlet />}</SkillDetailFrame>
			</div>
		</div>
	);
}
