import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CodeXml, FileText, LayoutGrid, List, ListFilter, Lock, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { artifactsQueryOptions, type ArtifactSummary } from "../lib/api/artifacts";
import {
  artifactTimestamp,
  filterArtifacts,
  formatArtifactDate,
  groupArtifactsByDate,
  readArtifactsLayout,
  writeArtifactsLayout,
  type ArtifactKind,
  type ArtifactsLayout,
  type ArtifactTypeFilter,
} from "../lib/artifact-gallery";
import { formatCount } from "../lib/pluralize";
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../components/ui/menu";

export const Route = createFileRoute("/artifacts")({
  component: ArtifactsPage,
  validateSearch: (search: Record<string, unknown>): { search?: string } =>
    typeof search["search"] === "string" && search["search"] !== ""
      ? { search: search["search"] }
      : {},
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(artifactsQueryOptions),
  head: () => ({
    meta: [{ title: "Artifacts" }],
  }),
});

const GHOST_ICON_BUTTON =
  "flex size-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-100 [&_svg]:size-4";

const TYPE_FILTER_LABELS: Record<ArtifactTypeFilter, string> = {
  all: "All types",
  html: "HTML",
  docs: "Docs",
};

const TYPE_FILTERS: readonly ArtifactTypeFilter[] = ["all", "html", "docs"];

function isTypeFilter(value: unknown): value is ArtifactTypeFilter {
  return TYPE_FILTERS.includes(value as ArtifactTypeFilter);
}

function ArtifactsPage() {
  const { data: artifacts } = useSuspenseQuery(artifactsQueryOptions);
  const { search = "" } = Route.useSearch();
  const navigate = useNavigate();
  const [layout, setLayout] = useState<ArtifactsLayout>("list");
  const [type, setType] = useState<ArtifactTypeFilter>("all");
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    setLayout(readArtifactsLayout());
  }, []);

  const visible = useMemo(
    () => filterArtifacts(artifacts, { search, type }),
    [artifacts, search, type],
  );
  const searching = search.trim() !== "";

  function toggleLayout() {
    const next: ArtifactsLayout = layout === "grid" ? "list" : "grid";
    setLayout(next);
    writeArtifactsLayout(next);
  }

  function setSearch(next: string) {
    void navigate({
      to: "/artifacts",
      search: next === "" ? {} : { search: next },
      replace: true,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-4 pb-6">
        <div className="flex min-h-12 min-w-0 items-center md:min-h-16 md:items-end">
          <h1 className="min-w-0 font-voice text-[28px]/[36px] font-medium text-primary">
            Artifacts
          </h1>
        </div>
        <div className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          <ArtifactSearch search={search} onSearch={setSearch} />
          <button
            type="button"
            className={GHOST_ICON_BUTTON}
            aria-label={layout === "grid" ? "List view" : "Grid view"}
            onClick={toggleLayout}
          >
            {layout === "grid" ? <List aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
          </button>
          <TypeFilterMenu artifacts={artifacts} type={type} onChange={setType} />
        </div>
        <p role="status" className="sr-only">
          {searching ? `${formatCount(visible.length, "artifact")} matching “${search}”` : ""}
        </p>
      </header>

      <div className="flex flex-col pb-12 pt-1">
        {artifacts.length === 0 ? (
          <div className="flex flex-col items-start gap-3 pb-12 text-body">
            <h3 className="max-w-xs font-medium text-secondary">No artifacts yet</h3>
            <p className="max-w-xs text-footnote text-secondary">
              Artifacts that Claude publishes in your sessions appear here.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div role="status" className="mt-10 text-center text-body text-ink-muted">
            {searching ? `No artifacts matching “${search}”` : "No artifacts of this type"}
          </div>
        ) : layout === "grid" ? (
          <ArtifactGrid artifacts={visible} now={now} />
        ) : (
          <ArtifactList artifacts={visible} now={now} />
        )}
      </div>
    </div>
  );
}

function ArtifactSearch({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (next: string) => void;
}) {
  const [open, setOpen] = useState(search !== "");
  const [draft, setDraft] = useState(search);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(search);
    if (search !== "") setOpen(true);
  }, [search]);

  if (!open) {
    return (
      <button
        type="button"
        className={GHOST_ICON_BUTTON}
        aria-label="Search your artifacts"
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
        aria-label="Search your artifacts"
        placeholder="Search artifacts..."
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onSearch(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && draft === "") setOpen(false);
        }}
        className="min-w-0 flex-1 bg-transparent text-primary outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="button"
        aria-label="Clear search"
        className="flex size-5 shrink-0 items-center justify-center rounded text-ink-muted hover:text-primary"
        onClick={() => {
          setDraft("");
          onSearch("");
          setOpen(false);
        }}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

function TypeFilterMenu({
  artifacts,
  type,
  onChange,
}: {
  artifacts: readonly ArtifactSummary[];
  type: ArtifactTypeFilter;
  onChange: (next: ArtifactTypeFilter) => void;
}) {
  const counts: Record<ArtifactTypeFilter, number> = {
    all: artifacts.length,
    html: artifacts.filter((artifact) => artifact.kind === "html").length,
    docs: artifacts.filter((artifact) => artifact.kind === "docs").length,
  };
  return (
    <Menu>
      <MenuTrigger
        className={GHOST_ICON_BUTTON}
        aria-label={`Filter by type: ${TYPE_FILTER_LABELS[type]}`}
        aria-pressed={type !== "all"}
      >
        <ListFilter aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuRadioGroup
          value={type}
          onValueChange={(next: unknown) => {
            if (isTypeFilter(next)) onChange(next);
          }}
        >
          {TYPE_FILTERS.map((option) => (
            <MenuRadioItem key={option} value={option}>
              <span className="flex w-full items-center justify-between gap-4">
                <span>{TYPE_FILTER_LABELS[option]}</span>
                {option !== "all" && (
                  <span className="text-footnote tabular-nums text-ink-muted">
                    {counts[option]}
                  </span>
                )}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/** Upstream's 36px type tile: a neutral `</>` tile for HTML pages, a blue document tile for Docs. */
function TypeTile({ kind, size = "row" }: { kind: ArtifactKind; size?: "row" | "card" }) {
  const Icon = kind === "docs" ? FileText : CodeXml;
  const tone =
    kind === "docs"
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-300"
      : "bg-alpha-1 text-secondary";
  const box = size === "card" ? "h-full w-full" : "size-9 rounded-lg";
  return (
    <div
      {...(kind === "docs" ? { role: "img", "aria-label": "Docs" } : { "aria-hidden": true })}
      className={`flex shrink-0 items-center justify-center overflow-hidden ${box} ${tone}`}
    >
      <Icon aria-hidden="true" className={size === "card" ? "size-10" : "size-5"} />
    </div>
  );
}

function PrivacyAndDate({ artifact, now }: { artifact: ArtifactSummary; now: Date }) {
  const ms = artifactTimestamp(artifact);
  return (
    <>
      {artifact.audience === "owner" && (
        <>
          <span role="img" aria-label="Private" className="flex shrink-0 items-center">
            <Lock aria-hidden="true" className="size-3.5" />
          </span>
          <span
            aria-hidden="true"
            className="inline-block size-[3px] shrink-0 rounded-full bg-ink-muted"
          />
        </>
      )}
      <span data-artifact-meta="">
        {artifact.lastPublishedAt === null ? "Viewed" : "Edited"}{" "}
        <time dateTime={new Date(ms).toISOString()}>{formatArtifactDate(ms, now)}</time>
      </span>
    </>
  );
}

function ArtifactChips({ artifact }: { artifact: ArtifactSummary }) {
  const chip =
    "pointer-events-auto rounded-full border border-border px-2 py-0.5 text-caption text-secondary no-underline transition-colors hover:bg-fill-ghost-hover hover:text-primary";
  return (
    <>
      <Link to="/session/$id" params={{ id: artifact.sessionId }} className={chip}>
        Session
      </Link>
      {artifact.sourceExists && (
        <Link to="/artifact/$id" params={{ id: artifact.id }} className={chip}>
          Preview
        </Link>
      )}
    </>
  );
}

function PrimaryLink({ artifact, className }: { artifact: ArtifactSummary; className: string }) {
  return (
    <a
      href={artifact.url}
      target="_blank"
      rel="noopener noreferrer"
      data-primary="true"
      aria-label={artifact.title}
      className={`absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-accent-100 ${className}`}
    />
  );
}

function ArtifactList({ artifacts, now }: { artifacts: ArtifactSummary[]; now: Date }) {
  const idPrefix = useId();
  const groups = groupArtifactsByDate(artifacts, now);
  return (
    <div className="-mx-3 flex flex-col gap-3">
      {groups.map((group, index) => {
        const headingId = `${idPrefix}-group-${index}`;
        return (
          <section key={group.label} className="flex flex-col">
            <h2 id={headingId} className="px-3 py-1 text-caption font-medium text-ink-muted">
              {group.label}
            </h2>
            <ul role="list" aria-labelledby={headingId} className="flex flex-col">
              {group.items.map((artifact) => (
                <li key={artifact.url} data-gallery-card="" className="group/cdsrow relative">
                  <PrimaryLink artifact={artifact} className="rounded" />
                  <div className="pointer-events-none grid grid-cols-[2.25rem_minmax(0,1fr)_max-content] items-center gap-x-3 rounded px-3 py-1 group-hover/cdsrow:bg-fill-ghost-hover group-has-[:focus-visible]/cdsrow:bg-fill-ghost-hover">
                    <TypeTile kind={artifact.kind} />
                    <div className="flex min-h-10 min-w-0 flex-col justify-center gap-0.5 sm:pr-8">
                      <span aria-hidden="true" className="min-w-0 truncate text-body text-primary">
                        {artifact.title}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center justify-end gap-1.5 whitespace-nowrap text-footnote tabular-nums text-secondary">
                      <ArtifactChips artifact={artifact} />
                      <span className="hidden items-center gap-1 sm:flex">
                        <PrivacyAndDate artifact={artifact} now={now} />
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ArtifactGrid({ artifacts, now }: { artifacts: ArtifactSummary[]; now: Date }) {
  return (
    <ul role="list" className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
      {artifacts.map((artifact) => (
        <li key={artifact.url} data-gallery-card="" className="group relative h-full">
          <PrimaryLink artifact={artifact} className="rounded-card" />
          <div className="pointer-events-none relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface-2 group-hover:bg-surface-1">
            <div className="relative h-[160px] select-none overflow-hidden">
              <TypeTile kind={artifact.kind} size="card" />
            </div>
            <div className="mx-px border-t border-alpha-1" />
            <div className="relative flex flex-1 flex-col gap-1.5 p-3">
              <div
                aria-hidden="true"
                className="line-clamp-2 min-w-0 text-left text-body leading-5 font-medium text-primary"
              >
                {artifact.title}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1 text-caption text-ink-muted">
                <PrivacyAndDate artifact={artifact} now={now} />
              </div>
              <div className="flex items-center gap-1.5">
                <ArtifactChips artifact={artifact} />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
