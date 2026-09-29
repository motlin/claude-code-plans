import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowUpDown, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { routinesQueryOptions, type Routine } from "../lib/api/routines";
import {
  DEFAULT_ROUTINE_VIEW,
  filterRoutines,
  formatNextRun,
  hiddenCompletedText,
  RoutineScheduleFilterSchema,
  RoutineSortSchema,
  RoutineStatusFilterSchema,
  routineTitle,
  sortRoutines,
  type RoutineView,
} from "../lib/routines";
import {
  routineKindLabels,
  routineScheduleFilterLabels,
  routineSortLabels,
  routineStatusFilterLabels,
} from "../lib/schema-choices";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";

export const Route = createFileRoute("/routines")({
  component: RoutinesPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(routinesQueryOptions),
  head: () => ({
    meta: [{ title: "Routines" }],
  }),
});

const GHOST_ICON_BUTTON =
  "flex size-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-100 aria-pressed:text-accent-100 [&_svg]:size-4";

/**
 * Read-only local counterpart of claude.ai/code's Routines page: the scheduled
 * prompts, wakeups and cloud routines Claude created in local sessions. There is
 * no Templates tab or "New routine" button, since routines are only created from
 * inside a session here.
 */
function RoutinesPage() {
  const { data: routines } = useSuspenseQuery(routinesQueryOptions);
  const [view, setView] = useState<RoutineView>(DEFAULT_ROUTINE_VIEW);
  const now = useMemo(() => Date.now(), [routines]);

  const { visible, hiddenCompleted } = useMemo(() => {
    const filtered = filterRoutines(routines, view);
    return { ...filtered, visible: sortRoutines(filtered.visible, view.sort) };
  }, [routines, view]);
  const completedCount = routines.filter((routine) => routine.status === "completed").length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-4 pb-6">
        <div className="flex min-h-12 min-w-0 items-center md:min-h-16 md:items-end">
          <h1 className="min-w-0 font-voice text-[28px]/[36px] font-medium text-primary">
            Routines
          </h1>
        </div>
        <div className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          <RoutineSearch
            search={view.search}
            onSearch={(search) => setView((current) => ({ ...current, search }))}
          />
          <FilterMenu view={view} onChange={setView} />
          <SortMenu view={view} completedCount={completedCount} onChange={setView} />
        </div>
      </header>

      <div className="flex flex-col pb-12 pt-1">
        {visible.length > 0 && (
          <ul role="list" aria-label="Routines" className="-mx-3 flex flex-col">
            {visible.map((routine) => (
              <RoutineRow key={routine.toolUseId} routine={routine} now={now} />
            ))}
          </ul>
        )}
        {visible.length === 0 && hiddenCompleted === 0 && (
          <div role="status" className="py-16 text-center text-body text-ink-muted">
            {routines.length === 0
              ? "Scheduled prompts, wakeups and routines Claude creates in your sessions appear here."
              : "No routines match these filters"}
          </div>
        )}
        {hiddenCompleted > 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-body text-ink-muted">
            <span>{hiddenCompletedText(hiddenCompleted)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function routineMeta(routine: Routine, now: number): string {
  const parts = [
    routine.recurring ? (routine.humanSchedule ?? routine.schedule ?? "Recurring") : "One-time",
  ];
  if (routine.kind !== "cron") parts.push(routineKindLabels[routine.kind]);
  if (routine.status === "completed") parts.push("Completed");
  else if (routine.nextRunAt !== null)
    parts.push(`Next run ${formatNextRun(routine.nextRunAt, now)}`);
  return parts.join(" · ");
}

function RoutineRow({ routine, now }: { routine: Routine; now: number }) {
  const title = routineTitle(routine);
  const primaryClass =
    "absolute inset-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-accent-100";
  return (
    <li className="group/cdsrow relative">
      {routine.recordUuid === null ? (
        <Link
          to="/session/$id"
          params={{ id: routine.sessionId }}
          data-primary="true"
          aria-label={title}
          className={primaryClass}
        />
      ) : (
        <Link
          to="/session/$id/source/$uuid"
          params={{ id: routine.sessionId, uuid: routine.recordUuid }}
          data-primary="true"
          aria-label={title}
          className={primaryClass}
        />
      )}
      <div className="pointer-events-none grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-x-3 rounded px-3 py-2 group-hover/cdsrow:bg-fill-ghost-hover group-has-[:focus-visible]/cdsrow:bg-fill-ghost-hover">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            data-routine-title=""
            aria-hidden="true"
            className={`min-w-0 truncate text-body ${routine.status === "completed" ? "text-secondary" : "text-primary"}`}
          >
            {title}
          </span>
          <span data-routine-meta="" className="min-w-0 truncate text-footnote text-secondary">
            {routineMeta(routine, now)}
          </span>
        </div>
        <Link
          to="/session/$id"
          params={{ id: routine.sessionId }}
          className="pointer-events-auto max-w-56 truncate rounded-full border border-border px-2 py-0.5 text-caption text-secondary no-underline transition-colors hover:bg-fill-ghost-hover hover:text-primary"
        >
          {routine.sessionTitle ?? "Session"}
        </Link>
      </div>
    </li>
  );
}

function RoutineSearch({ search, onSearch }: { search: string; onSearch: (next: string) => void }) {
  const [open, setOpen] = useState(search !== "");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        className={GHOST_ICON_BUTTON}
        aria-label="Search routines"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <Search aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="flex h-8 w-64 items-center gap-1 rounded-md border border-border bg-surface-1 px-2 text-body">
      <Search aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      <input
        ref={inputRef}
        type="search"
        autoFocus
        aria-label="Search routines"
        placeholder="Search routines..."
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && search === "") setOpen(false);
        }}
        className="min-w-0 flex-1 bg-transparent text-primary outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="button"
        aria-label="Clear search"
        className="flex size-5 shrink-0 items-center justify-center rounded text-ink-muted hover:text-primary"
        onClick={() => {
          onSearch("");
          setOpen(false);
        }}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

function FilterMenu({
  view,
  onChange,
}: {
  view: RoutineView;
  onChange: (update: (current: RoutineView) => RoutineView) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        className={GHOST_ICON_BUTTON}
        aria-label="Filter routines"
        aria-pressed={view.schedule !== "all" || view.status !== "all"}
      >
        <SlidersHorizontal aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Schedule</MenuLabel>
        <MenuRadioGroup
          value={view.schedule}
          onValueChange={(next: unknown) => {
            const parsed = RoutineScheduleFilterSchema.safeParse(next);
            if (parsed.success) onChange((current) => ({ ...current, schedule: parsed.data }));
          }}
        >
          {RoutineScheduleFilterSchema.options.map((option) => (
            <MenuRadioItem key={option} value={option}>
              {routineScheduleFilterLabels[option]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Status</MenuLabel>
        <MenuRadioGroup
          value={view.status}
          onValueChange={(next: unknown) => {
            const parsed = RoutineStatusFilterSchema.safeParse(next);
            if (parsed.success) onChange((current) => ({ ...current, status: parsed.data }));
          }}
        >
          {RoutineStatusFilterSchema.options.map((option) => (
            <MenuRadioItem key={option} value={option}>
              {routineStatusFilterLabels[option]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function SortMenu({
  view,
  completedCount,
  onChange,
}: {
  view: RoutineView;
  completedCount: number;
  onChange: (update: (current: RoutineView) => RoutineView) => void;
}) {
  return (
    <Menu>
      <MenuTrigger className={GHOST_ICON_BUTTON} aria-label="Sort routines">
        <ArrowUpDown aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuRadioGroup
          value={view.sort}
          onValueChange={(next: unknown) => {
            const parsed = RoutineSortSchema.safeParse(next);
            if (parsed.success) onChange((current) => ({ ...current, sort: parsed.data }));
          }}
        >
          {RoutineSortSchema.options.map((option) => (
            <MenuRadioItem key={option} value={option}>
              {routineSortLabels[option]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuCheckboxItem
          checked={view.includeCompleted}
          onCheckedChange={(checked: boolean) =>
            onChange((current) => ({ ...current, includeCompleted: checked }))
          }
        >
          <span className="flex w-full items-center justify-between gap-4">
            <span>Include completed</span>
            <span className="text-footnote tabular-nums text-ink-muted">{completedCount}</span>
          </span>
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}
