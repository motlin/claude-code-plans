import {useQuery} from "@tanstack/react-query";
import {createFileRoute} from "@tanstack/react-router";
import {ContentsViewer} from "../components/customize/contents-viewer";
import {customizeSkillDetailQueryOptions, customizeSkillFileQueryOptions} from "../lib/api/customize";

export const Route = createFileRoute("/customize_/skills/id/$skillId/contents")({
	component: SkillContentsTab,
	head: () => ({meta: [{title: "Skill contents · Customize"}]}),
});

function SkillContentsTab() {
	const {skillId} = Route.useParams();
	const {data} = useQuery(customizeSkillDetailQueryOptions(skillId));
	if (data === undefined) return null;
	return (
		<ContentsViewer
			name={data.skill.name}
			tree={data.tree}
			fileQuery={(path) => customizeSkillFileQueryOptions(skillId, path)}
		/>
	);
}
