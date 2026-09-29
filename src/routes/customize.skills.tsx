import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Scroll } from "lucide-react";
import { CustomizeNotice } from "../components/customize/customize-empty";
import { CustomizeList, ShortDate } from "../components/customize/customize-list";
import { useSectionSort } from "../components/customize/persisted-sort";
import { CUSTOMIZE_SECTIONS, resolveOption } from "../components/customize/sections";
import { SkillRowActions } from "../components/customize/skill-row-actions";
import { filterSkills, groupSkills, sortSkills } from "../components/customize/skills-view";
import { customizeSkillsQueryOptions } from "../lib/api/customize";

export const Route = createFileRoute("/customize/skills")({
  component: CustomizeSkills,
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(customizeSkillsQueryOptions);
  },
  head: () => ({ meta: [{ title: "Skills · Customize" }] }),
});

const SECTION = CUSTOMIZE_SECTIONS[0]!;

function CustomizeSkills() {
  const search = useSearch({ from: "/customize" });
  const navigate = useNavigate();
  const sortValue = useSectionSort(SECTION.sortStorageKey, search.sort);
  const { data: skills, isPending } = useQuery(customizeSkillsQueryOptions);

  if (search.view === "discover") {
    return (
      <CustomizeNotice
        title="Discover"
        body="Browsing the plugin catalog for new skills is not available yet."
      />
    );
  }
  if (isPending || skills === undefined)
    return <p className="text-body text-t6">Loading skills…</p>;

  const searching = (search.q ?? "") !== "";
  const source = searching ? "all" : resolveOption(SECTION.filter.options, search.filter).value;
  const sort = resolveOption(SECTION.sort ?? [], sortValue).value;
  const groups = groupSkills(sortSkills(filterSkills(skills, source, search.q), sort));
  const showOnboarding =
    !searching &&
    (source === "all" || source === "personal") &&
    !skills.some((skill) => skill.source === "personal");

  return (
    <div className="flex flex-col gap-6">
      {showOnboarding && (
        <div data-testid="customize-skills-onboarding">
          <CustomizeNotice
            title="Add your first skills"
            body="Personal skills live in ~/.claude/skills."
          />
        </div>
      )}
      <CustomizeList
        icon={Scroll}
        noun={SECTION.noun}
        searching={searching}
        groups={groups.map((group) => ({
          key: group.key,
          title: group.title,
          items: group.skills.map((skill) => ({
            key: skill.id,
            title: skill.name,
            source: `from ${skill.sourceLabel}`,
            subtitle: skill.description,
            meta: <ShortDate ms={skill.mtime} />,
            actions: <SkillRowActions skill={skill} />,
            onView: () =>
              void navigate({
                to: "/customize/skills/id/$skillId",
                params: { skillId: skill.id },
              }),
          })),
        }))}
        empty={
          showOnboarding ? null : (
            <CustomizeNotice
              title="No skills yet"
              body="Personal skills live in ~/.claude/skills; project skills live in <project>/.claude/skills."
            />
          )
        }
      />
    </div>
  );
}
