import {createFileRoute, useSearch} from "@tanstack/react-router";
import {prefetchCustomizeSection} from "../components/customize/section-prefetch";
import {SkillsSection} from "../components/customize/section-views";

export const Route = createFileRoute("/customize/skills")({
	component: CustomizeSkills,
	loader: ({context: {queryClient}}) => prefetchCustomizeSection(queryClient, "skills"),
	head: () => ({meta: [{title: "Skills · Customize"}]}),
});

function CustomizeSkills() {
	const search = useSearch({from: "/customize"});
	return <SkillsSection search={search} />;
}
