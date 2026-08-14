import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { plansQueryOptions, type PlanListItem } from "../../../lib/api/plans";
import { toMdSlug } from "../../../lib/md-slug";
import { LoadingBars } from "../primitives/LoadingBars";

interface PlansGroup {
  projectId: string;
  projectName: string;
  plans: PlanListItem[];
}

const UNLINKED_GROUP_ID = "__unlinked__";
const UNLINKED_GROUP_NAME = "Unlinked";

function groupPlans(plans: PlanListItem[]): PlansGroup[] {
  const groups = new Map<string, PlansGroup>();
  for (const plan of plans) {
    if (plan.projects.length === 0) {
      const group = groups.get(UNLINKED_GROUP_ID);
      if (group) {
        group.plans.push(plan);
      } else {
        groups.set(UNLINKED_GROUP_ID, {
          projectId: UNLINKED_GROUP_ID,
          projectName: UNLINKED_GROUP_NAME,
          plans: [plan],
        });
      }
    } else {
      for (const ref of plan.projects) {
        const group = groups.get(ref.projectId);
        if (group) {
          group.plans.push(plan);
        } else {
          groups.set(ref.projectId, {
            projectId: ref.projectId,
            projectName: ref.projectName,
            plans: [plan],
          });
        }
      }
    }
  }
  return [...groups.values()];
}

export function PlansSubList({ activeItemId }: { activeItemId: string | null }) {
  const { data: plans } = useQuery(plansQueryOptions());
  const groups = useMemo(() => (plans ? groupPlans(plans) : undefined), [plans]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Auto-expand/collapse groups based on active plan
  useEffect(() => {
    if (!groups || !activeItemId) return;

    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      const activeGroupId = groups.find((g) =>
        g.plans.some((p) => p.filename === activeItemId),
      )?.projectId;

      // Expand the group containing the active plan
      if (activeGroupId) {
        next.delete(activeGroupId);
      }

      // Collapse all other groups
      for (const group of groups) {
        if (group.projectId !== activeGroupId) {
          next.add(group.projectId);
        }
      }

      return next;
    });
  }, [activeItemId, groups]);

  function toggleGroup(projectId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  if (groups === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (groups.length === 0) {
    return null;
  }

  // If there's only one group, render flat (no nesting needed)
  if (groups.length === 1 && groups[0]) {
    return (
      <div className="pl-10">
        {groups[0].plans.map((plan) => {
          const isActive = plan.filename === activeItemId;
          return (
            <Link
              key={plan.filename}
              to="/plan/$filename"
              params={{ filename: toMdSlug(plan.filename) }}
              className={`mb-px block truncate rounded-r3 px-2 py-1 text-xs no-underline transition-colors ${
                isActive
                  ? "bg-fill-ghost-hover font-medium text-primary"
                  : "text-t6 hover:bg-fill-ghost-hover hover:text-secondary"
              }`}
            >
              {plan.title}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="pl-10">
      {groups.map((group) => {
        const isExpanded = !collapsedGroups.has(group.projectId);
        return (
          <div key={group.projectId}>
            <button
              type="button"
              onClick={() => toggleGroup(group.projectId)}
              className="mb-px flex w-full items-center gap-1 rounded-r3 px-2 py-1 text-xs text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-secondary"
            >
              <ChevronRight
                className="h-2.5 w-2.5 shrink-0 transition-transform duration-200"
                style={{
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                }}
              />
              <span className="truncate font-medium">{group.projectName}</span>
              <span className="ml-auto shrink-0 text-[10px] opacity-60">{group.plans.length}</span>
            </button>
            {isExpanded &&
              group.plans.map((plan) => {
                const isActive = plan.filename === activeItemId;
                return (
                  <Link
                    key={plan.filename}
                    to="/plan/$filename"
                    params={{ filename: toMdSlug(plan.filename) }}
                    className={`mb-px block truncate rounded-r3 py-1 pl-5 pr-2 text-xs no-underline transition-colors ${
                      isActive
                        ? "bg-fill-ghost-hover font-medium text-primary"
                        : "text-t6 hover:bg-fill-ghost-hover hover:text-secondary"
                    }`}
                  >
                    {plan.title}
                  </Link>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
