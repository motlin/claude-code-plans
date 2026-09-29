import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Scroll } from "lucide-react";
import { CustomizeNotice } from "../components/customize/customize-empty";
import { CustomizeList, groupBy, ShortDate } from "../components/customize/customize-list";
import { CUSTOMIZE_SECTIONS, matchesQuery, resolveOption } from "../components/customize/sections";
import { customizeSkillsQueryOptions, type SkillSummary } from "../lib/api/customize";

export const Route = createFileRoute("/customize/skills")({
  component: CustomizeSkills,
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(customizeSkillsQueryOptions);
  },
  head: () => ({ meta: [{ title: "Skills · Customize" }] }),
});

const SECTION = CUSTOMIZE_SECTIONS[0]!;

function compareSkills(sort: string): (a: SkillSummary, b: SkillSummary) => number {
  if (sort === "name") return (a, b) => a.name.localeCompare(b.name);
  return (a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name);
}

function CustomizeSkills() {
  const search = useSearch({ from: "/customize" });
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
  const sort = resolveOption(SECTION.sort ?? [], search.sort).value;
  const visible = skills
    .filter((skill) => source === "all" || skill.source === source)
    .filter((skill) => matchesQuery(search.q, skill.name, skill.description, skill.sourceLabel))
    .sort(compareSkills(sort));

  return (
    <CustomizeList
      icon={Scroll}
      noun={SECTION.noun}
      searching={searching}
      groups={groupBy(
        visible,
        (skill) => ({ key: skill.sourceLabel, title: skill.sourceLabel }),
        (skill) => ({
          key: skill.id,
          title: skill.name,
          source: `from ${skill.sourceLabel}`,
          subtitle: skill.description,
          meta: <ShortDate ms={skill.mtime} />,
        }),
      )}
      empty={
        <CustomizeNotice
          title="No skills yet"
          body="Personal skills live in ~/.claude/skills; project skills live in <project>/.claude/skills."
        />
      }
    />
  );
}
