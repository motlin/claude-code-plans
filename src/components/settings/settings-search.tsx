import { Popover } from "@base-ui/react/popover";
import {
  Code,
  FileCog,
  Gauge,
  type LucideIcon,
  MessagesSquare,
  ScrollText,
  Search,
  Server,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { settingsTabLabels } from "../../lib/schema-choices";
import type { SettingsTab } from "../../lib/settings-hash";
import { searchSettings, splitMatch, type SettingsSearchResult } from "../../lib/settings-search";

const TAB_ICONS = {
  general: Settings,
  usage: Gauge,
  "claude-code": Code,
  transcript: ScrollText,
  sessions: MessagesSquare,
  application: Server,
  "ai-features": Sparkles,
  "claude-config": FileCog,
  setup: Wrench,
} satisfies Record<SettingsTab, LucideIcon>;

/**
 * The Settings nav search field. Typing opens upstream's 280px results popover: one button per
 * matching row, showing the section icon and name over the row title (muted footnote) with the
 * match in the accent color. Choosing a result hands its tab and row to `onSelect`.
 */
export function SettingsSearch({
  onSelect,
}: {
  onSelect: (tab: SettingsTab, row: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const groups = useMemo(() => searchSettings(query), [query]);
  const needleLength = query.trim().length;
  const open = !dismissed && needleLength > 0;

  const choose = (result: SettingsSearchResult) => {
    setQuery("");
    setDismissed(false);
    onSelect(result.tab, result.rowSlug);
  };

  return (
    <>
      <div
        ref={anchorRef}
        className="mb-1 flex h-8 shrink-0 items-center gap-2 rounded-r6 border border-border bg-[var(--settings-field-bg)] px-2.5 text-secondary focus-within:ring-2 focus-within:ring-accent-100/40"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <input
          type="text"
          role="combobox"
          aria-label="Search settings"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          placeholder="Search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setDismissed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setDismissed(true);
            } else if (event.key === "Enter") {
              const first = groups[0]?.results[0];
              if (first !== undefined) {
                event.preventDefault();
                choose(first);
              }
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-[var(--settings-muted)]"
        />
      </div>
      <Popover.Root
        open={open}
        onOpenChange={(next, details) => {
          if (next) return;
          // Clicks back into the field keep the results open.
          if (
            details.event.target instanceof Node &&
            anchorRef.current?.contains(details.event.target) === true
          ) {
            return;
          }
          setDismissed(true);
        }}
      >
        <Popover.Portal>
          <Popover.Positioner
            anchor={anchorRef}
            side="bottom"
            align="start"
            sideOffset={4}
            className="z-[60]"
          >
            <Popover.Popup
              id={listId}
              data-cds="Popover"
              aria-label="Search results"
              initialFocus={false}
              finalFocus={false}
              className="w-[280px] rounded-card bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] outline-none"
            >
              <div className="max-h-[min(320px,var(--available-height))] overflow-y-auto p-1">
                {groups.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-footnote text-[var(--settings-muted)]">
                    No results
                  </p>
                ) : (
                  groups.flatMap((group) => {
                    const Icon = TAB_ICONS[group.tab];
                    return group.results.map((result) => {
                      const parts = splitMatch(result.title, result.start, needleLength);
                      return (
                        <button
                          key={`${result.tab}/${result.rowSlug}`}
                          type="button"
                          aria-label={`${settingsTabLabels[group.tab]} ${result.title}`}
                          onClick={() => choose(result)}
                          className="flex w-full flex-col gap-0.5 rounded-r6 px-2.5 py-1.5 text-left transition-colors hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover focus-visible:outline-none"
                        >
                          <span className="flex items-center gap-2 text-body text-primary">
                            <Icon aria-hidden="true" className="size-5 shrink-0 p-0.5" />
                            <span data-settings-result-section="">
                              {settingsTabLabels[group.tab]}
                            </span>
                          </span>
                          <span
                            data-settings-result-title=""
                            className="pl-[calc(20px+0.5rem)] text-footnote text-[var(--settings-muted)]"
                          >
                            {parts.before}
                            <span className="text-accent-100">{parts.match}</span>
                            {parts.after}
                          </span>
                        </button>
                      );
                    });
                  })
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
