import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useId } from "react";

import { projectMemoriesQueryOptions, type MemoryListItem } from "../../lib/api/memories";
import { plansQueryOptions, type PlanListItem } from "../../lib/api/plans";
import { projectsQueryOptions } from "../../lib/api/projects";
import { toMdSlug } from "../../lib/md-slug";
import { formatNarrowRelativeTime } from "../../lib/relative-time";
import { useSettings } from "../settings-provider";

const MAX_LOCAL_ROWS = 3;

export type RecentMemory = MemoryListItem & { projectName: string };

interface LocalRow {
  key: string;
  title: string;
  project: string | null;
  mtime: string;
}

function newest<T extends { mtime: string }>(items: readonly T[]): T[] {
  return [...items]
    .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime))
    .slice(0, MAX_LOCAL_ROWS);
}

/** A home section of local ~/.claude files in the upstream Sessions markup: h2 plus 40px rows. */
function LocalSection({
  heading,
  pill,
  rows,
  now,
  onOpen,
}: Readonly<{
  heading: string;
  pill: string;
  rows: readonly LocalRow[];
  now: number;
  onOpen: (key: string) => void;
}>) {
  const headingId = useId();
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <header className="flex items-center gap-1">
        <h2 id={headingId} className="text-[13px] leading-[19px] font-normal text-primary">
          {heading}
        </h2>
      </header>
      <ul role="list" className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="group flex h-10 items-center gap-2 rounded-lg bg-alpha-1 px-[5px] py-2 hover:bg-alpha-2 focus-within:bg-alpha-2"
          >
            <button
              type="button"
              aria-label={`Open ${pill.toLowerCase()} ${row.title}`}
              onClick={() => onOpen(row.key)}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex shrink-0 items-center">
                  <span className="inline-flex w-4 items-center justify-center">
                    <span className="size-[5px] rounded-full bg-ink-muted" />
                  </span>
                  <span
                    data-pill-label
                    className="whitespace-nowrap text-[12px] leading-[15px] text-secondary"
                  >
                    {pill}
                  </span>
                </span>
                <span
                  data-row-title
                  className="min-w-0 truncate text-[13px] leading-[19px] text-primary"
                >
                  {row.title}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {row.project !== null && (
                  <span
                    data-row-project
                    className="max-w-[180px] truncate text-[12px] leading-[15px] text-ink-muted"
                  >
                    {row.project}
                  </span>
                )}
                <span className="-mr-1 min-w-5 text-center text-[12px] leading-[15px] text-ink-muted tabular-nums">
                  <time dateTime={row.mtime}>
                    {formatNarrowRelativeTime(Date.parse(row.mtime), now)}
                  </time>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-5 text-ink-muted group-hover:text-secondary"
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The three newest ~/.claude/plans files; `onOpen` receives the plan filename. */
export function RecentPlansSection({
  plans,
  now,
  onOpen,
}: Readonly<{ plans: readonly PlanListItem[]; now: number; onOpen: (filename: string) => void }>) {
  return (
    <LocalSection
      heading="Recent plans"
      pill="Plan"
      now={now}
      onOpen={onOpen}
      rows={newest(plans).map((plan) => ({
        key: plan.filename,
        title: plan.title,
        project: plan.projects[0]?.projectName ?? null,
        mtime: plan.mtime,
      }))}
    />
  );
}

/** The three most recently updated project memory files. */
export function MemoriesUpdatedSection({
  memories,
  now,
  onOpen,
}: Readonly<{
  memories: readonly RecentMemory[];
  now: number;
  onOpen: (memory: { project: string; filename: string }) => void;
}>) {
  const shown = newest(memories);
  const byKey = new Map(shown.map((memory) => [`${memory.project}/${memory.filename}`, memory]));
  return (
    <LocalSection
      heading="Memories updated"
      pill="Memory"
      now={now}
      onOpen={(key) => {
        const memory = byKey.get(key);
        if (memory !== undefined) onOpen({ project: memory.project, filename: memory.filename });
      }}
      rows={[...byKey].map(([key, memory]) => ({
        key,
        title: memory.title,
        project: memory.projectName,
        mtime: memory.mtime,
      }))}
    />
  );
}

/** Local-only home extras, behind the `homeShowLocalSections` setting (off by default). */
export function HomeLocalSections() {
  const { settings } = useSettings();
  return settings.homeShowLocalSections ? <EnabledLocalSections /> : null;
}

function EnabledLocalSections() {
  const navigate = useNavigate();
  const { data: plans } = useQuery(plansQueryOptions());
  const { data: projects } = useQuery(projectsQueryOptions());
  const memoryLists = useQueries({
    queries: (projects ?? [])
      .filter((project) => project.memoryCount > 0)
      .map((project) => projectMemoriesQueryOptions(project.id)),
  });
  const memories = memoryLists.flatMap(({ data }) =>
    data == null
      ? []
      : data.memories.map((memory) => ({ ...memory, projectName: data.project.name })),
  );
  const now = Date.now();

  return (
    <>
      <RecentPlansSection
        plans={plans ?? []}
        now={now}
        onOpen={(filename) =>
          void navigate({ to: "/plan/$filename", params: { filename: toMdSlug(filename) } })
        }
      />
      <MemoriesUpdatedSection
        memories={memories}
        now={now}
        onOpen={({ project, filename }) =>
          void navigate({
            to: "/memory/$project/$filename",
            params: { project, filename: toMdSlug(filename) },
          })
        }
      />
    </>
  );
}
