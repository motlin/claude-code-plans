import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { recentSessionsQueryOptions } from "../../../lib/api/sessions";
import type { Section, SubItem } from "../types";
import { LoadingBars } from "../primitives/LoadingBars";

// SubList is the fallback renderer for sidebar sections without a dedicated
// component. Sidebar.tsx routes sections with custom hierarchy to their own
// sublists, so only `sessions` actually reaches this component.
export function SubList({
  section,
  activeItemId,
}: {
  section: Section;
  activeItemId: string | null;
}) {
  const sessionsQuery = useQuery({
    ...recentSessionsQueryOptions(20),
    enabled: section === "sessions",
  });

  let items: SubItem[] | null = null;

  if (section === "sessions") {
    if (sessionsQuery.data) {
      // Server returns the 20 most-recent sessions, already ordered.
      items = sessionsQuery.data.sessions.map((s) => ({
        id: s.id,
        label: s.title,
        to: "/session/$id",
        params: { id: s.id },
      }));
    }
  } else {
    items = [];
  }

  if (items === null) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="pl-10">
      {items.map((item) => {
        const isActive = item.id === activeItemId;
        return (
          <Link
            key={item.id}
            to={item.to as string}
            params={item.params}
            className={`mb-px block truncate rounded-[4px] px-2 py-1 text-xs no-underline transition-colors ${
              isActive
                ? "bg-bg-300/50 font-medium text-text-000"
                : "text-text-500 hover:bg-bg-300/50 hover:text-text-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
