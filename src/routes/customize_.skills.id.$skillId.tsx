import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CustomizeNotice } from "../components/customize/customize-empty";
import { SkillDetailHeader } from "../components/customize/skill-detail";
import { customizeSkillDetailQueryOptions } from "../lib/api/customize";

export const Route = createFileRoute("/customize_/skills/id/$skillId")({
  component: SkillDetailLayout,
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(customizeSkillDetailQueryOptions(params.skillId));
  },
  head: () => ({ meta: [{ title: "Skill · Customize" }] }),
});

/** Skill detail shell: header and Overview · Contents tabs over the active tab. */
function SkillDetailLayout() {
  const { skillId } = Route.useParams();
  const { data, isPending, isError } = useQuery(customizeSkillDetailQueryOptions(skillId));

  return (
    <div className="flex w-full flex-col bg-surface-1 text-body text-primary">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-4 pb-8 md:px-8">
        {isPending ? (
          <p className="text-body text-t6">Loading skill…</p>
        ) : isError ? (
          <CustomizeNotice
            title="Skill not found"
            body="It may have been removed or renamed since the list was loaded."
          />
        ) : (
          <>
            <SkillDetailHeader detail={data} />
            <Outlet />
          </>
        )}
      </div>
    </div>
  );
}
