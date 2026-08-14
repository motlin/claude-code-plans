import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type ReactNode,
} from "react";

import { writeClipboardText } from "../lib/clipboard";
import { formatResourceCount, resourceCoverageNote } from "../lib/session-resources";
import {
  extractSessionLinks,
  groupSessionLinks,
  type CollectedLink,
  type LinkEntry,
  type LinkGroup,
  type SessionLinks,
} from "../lib/session-links";
import type { SessionLine } from "../lib/transcript";
import { pillStyles } from "./detail-top-bar";
import { JumpChips } from "./jump-chips";
import { SessionDrawer } from "./session-drawer";

export interface LinkEnricher {
  extractId(url: string): string | null;
  Wrapper: ComponentType<{ id: string; children: ReactNode }>;
}

export const LINK_ENRICHERS: Readonly<Record<string, LinkEnricher>> = {};

export const INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY =
  "ccp-session-links-include-tools-and-thinking";

export interface SessionLinkDisplay {
  groups: LinkGroup[];
  totalCount: number;
  hiddenCount: number;
}

export function useLinksDrawerState() {
  const [includeToolsAndThinking, setIncludeToolsAndThinking] = useState(false);
  const [storageHydrated, setStorageHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY);
    setIncludeToolsAndThinking(stored === "true");
    setStorageHydrated(true);
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    localStorage.setItem(INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY, String(includeToolsAndThinking));
  }, [includeToolsAndThinking, storageHydrated]);

  return { includeToolsAndThinking, setIncludeToolsAndThinking };
}

export function useExtractedSessionLinks(
  lines: SessionLine[],
  currentHost: string | undefined,
  userRules: Array<{ label: string; hostPattern: string }>,
): SessionLinks {
  return useMemo(
    () => extractSessionLinks(lines, currentHost, userRules),
    [currentHost, lines, userRules],
  );
}

/**
 * Group links the server already collected over the whole session. Returns
 * undefined until that scan lands, which is the caller's signal to keep showing
 * the window-only extraction and its `12+` floors.
 */
export function useGroupedSessionLinks(
  links: CollectedLink[] | undefined,
  currentHost: string | undefined,
  userRules: Array<{ label: string; hostPattern: string }>,
): SessionLinks | undefined {
  return useMemo(
    () => (links === undefined ? undefined : groupSessionLinks(links, currentHost, userRules)),
    [currentHost, links, userRules],
  );
}

function visibleMessageGroups(groups: LinkGroup[]): LinkGroup[] {
  return groups.flatMap((group) => {
    const entries = group.entries.flatMap((entry) => {
      const occurrences = entry.occurrences.filter((occurrence) => occurrence.source === "visible");
      return occurrences.length === 0 ? [] : [{ ...entry, occurrences }];
    });
    return entries.length === 0 ? [] : [{ ...group, entries }];
  });
}

function countEntries(groups: LinkGroup[]): number {
  return groups.reduce((count, group) => count + group.entries.length, 0);
}

export function useSessionLinkDisplay(
  sessionLinks: SessionLinks,
  includeToolsAndThinking: boolean,
): SessionLinkDisplay {
  const visibleGroups = useMemo(
    () => visibleMessageGroups(sessionLinks.groups),
    [sessionLinks.groups],
  );
  const visibleCount = useMemo(() => countEntries(visibleGroups), [visibleGroups]);

  return useMemo(
    () => ({
      groups: includeToolsAndThinking ? sessionLinks.groups : visibleGroups,
      totalCount: includeToolsAndThinking ? sessionLinks.totalCount : visibleCount,
      hiddenCount: sessionLinks.totalCount - visibleCount,
    }),
    [
      includeToolsAndThinking,
      sessionLinks.groups,
      sessionLinks.totalCount,
      visibleCount,
      visibleGroups,
    ],
  );
}

interface LinksDrawerToggleProps {
  count: number;
  /** JSONL records before the loaded window, which `count` never saw. */
  unscannedRecordCount?: number;
  isOpen: boolean;
  onToggle: () => void;
}

export function LinksDrawerToggle({
  count,
  unscannedRecordCount = 0,
  isOpen,
  onToggle,
}: LinksDrawerToggleProps) {
  return (
    <button
      type="button"
      disabled={count === 0}
      aria-expanded={isOpen}
      title={resourceCoverageNote(unscannedRecordCount)}
      onClick={onToggle}
      className={`${pillStyles.outline} disabled:cursor-not-allowed disabled:opacity-40 ${isOpen ? "bg-bg-200 text-text-100" : ""}`}
    >
      <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
      Links {formatResourceCount(count, unscannedRecordCount)}
    </button>
  );
}

interface LinkRowProps {
  entry: LinkEntry;
  copied: boolean;
  onCopy: (url: string) => Promise<void>;
}

function LinkRow({ entry, copied, onCopy }: LinkRowProps) {
  return (
    <li className="border-b border-border-300/10 px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span title={entry.url} className="min-w-0 flex-1 truncate text-xs text-text-200">
          {entry.label}
        </span>
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${entry.label} in a new tab`}
          title="Open in a new tab"
          className="flex size-7 shrink-0 items-center justify-center rounded text-text-500 transition-colors hover:bg-bg-300/70 hover:text-text-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
        <button
          type="button"
          aria-label={`Copy ${entry.label}`}
          title={copied ? "Copied" : "Copy URL"}
          onClick={() => void onCopy(entry.url)}
          className="flex size-7 shrink-0 items-center justify-center rounded text-text-500 transition-colors hover:bg-bg-300/70 hover:text-text-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2">
        <JumpChips occurrences={entry.occurrences} resourceLabel="link" />
      </div>
    </li>
  );
}

interface LinksDrawerProps {
  display: SessionLinkDisplay;
  /** JSONL records before the loaded window, which extraction never saw. */
  unscannedRecordCount?: number;
  includeToolsAndThinking: boolean;
  onIncludeToolsAndThinkingChange: (include: boolean) => void;
  onClose: () => void;
}

export function LinksDrawer({
  display,
  unscannedRecordCount = 0,
  includeToolsAndThinking,
  onIncludeToolsAndThinkingChange,
  onClose,
}: LinksDrawerProps) {
  const [filterText, setFilterText] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const copiedTimeoutReference = useRef<number | undefined>(undefined);
  const query = filterText.trim().toLowerCase();

  const filteredGroups = useMemo(
    () =>
      query === ""
        ? display.groups
        : display.groups.flatMap((group) => {
            const entries = group.entries.filter(
              (entry) =>
                entry.url.toLowerCase().includes(query) ||
                entry.label.toLowerCase().includes(query),
            );
            return entries.length === 0 ? [] : [{ ...group, entries }];
          }),
    [display.groups, query],
  );

  useEffect(
    () => () => {
      if (copiedTimeoutReference.current !== undefined) {
        window.clearTimeout(copiedTimeoutReference.current);
      }
    },
    [],
  );

  const copyUrl = useCallback(async (url: string) => {
    setCopiedUrl(null);
    const succeeded = await writeClipboardText(url);
    if (!succeeded) return;

    setCopiedUrl(url);
    if (copiedTimeoutReference.current !== undefined) {
      window.clearTimeout(copiedTimeoutReference.current);
    }
    copiedTimeoutReference.current = window.setTimeout(() => setCopiedUrl(null), 1_500);
  }, []);

  function toggleCategory(categoryId: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function handleFilterChange(event: ChangeEvent<HTMLInputElement>): void {
    setFilterText(event.target.value);
  }

  const emptyMessage =
    query !== ""
      ? `No links match “${filterText}”.`
      : !includeToolsAndThinking && display.hiddenCount > 0
        ? `No links in visible messages. Enable 'Include tools and thinking' to see ${display.hiddenCount} more.`
        : includeToolsAndThinking
          ? "No links in this session."
          : "No links in visible messages.";

  return (
    <SessionDrawer
      title="Links"
      count={display.totalCount}
      unscannedRecordCount={unscannedRecordCount}
      onClose={onClose}
      headerContent={
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-300">
          <input
            type="checkbox"
            checked={includeToolsAndThinking}
            onChange={(event) => onIncludeToolsAndThinkingChange(event.target.checked)}
            className="size-3.5 shrink-0 accent-accent-100"
          />
          <span>Include tools and thinking</span>
        </label>
      }
    >
      <div className="sticky top-0 z-20 border-b border-border-300/15 bg-bg-200 p-3">
        <label className="relative block">
          <span className="sr-only">Filter links</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filterText}
            onChange={handleFilterChange}
            placeholder="Filter links"
            className="w-full rounded-md border border-border-300/20 bg-bg-100 py-2 pl-8 pr-3 text-xs text-text-100 outline-none placeholder:text-text-500 focus:border-accent-100/60"
          />
        </label>
      </div>

      {filteredGroups.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-text-500">{emptyMessage}</p>
      ) : (
        filteredGroups.map((group) => {
          const isCollapsed = query === "" && collapsed.has(group.categoryId);
          return (
            <section key={group.categoryId} aria-labelledby={`links-${group.categoryId}`}>
              <button
                type="button"
                id={`links-${group.categoryId}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleCategory(group.categoryId)}
                className="sticky top-[57px] z-10 flex w-full items-center gap-2 border-b border-border-300/15 bg-bg-200 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-300 hover:bg-bg-300/40"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <span>{group.entries.length}</span>
              </button>
              {!isCollapsed && (
                <ul>
                  {group.entries.map((entry) => (
                    <LinkRow
                      key={entry.url}
                      entry={entry}
                      copied={copiedUrl === entry.url}
                      onCopy={copyUrl}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </SessionDrawer>
  );
}
