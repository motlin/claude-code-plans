import {useQuery} from "@tanstack/react-query";
import {createFileRoute} from "@tanstack/react-router";
import {SkillOverview} from "../components/customize/skill-detail";
import {customizeSkillDetailQueryOptions} from "../lib/api/customize";

export const Route = createFileRoute("/customize_/skills/id/$skillId/")({
	component: SkillOverviewTab,
});

function SkillOverviewTab() {
	const {skillId} = Route.useParams();
	const {data} = useQuery(customizeSkillDetailQueryOptions(skillId));
	return data === undefined ? null : <SkillOverview detail={data} />;
}
