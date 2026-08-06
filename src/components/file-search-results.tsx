import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderSearch, LoaderCircle, Search, X } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  fileSearchQueryOptions,
  fileSearchRootsQueryOptions,
  type FileSearchResult,
} from "../lib/api/search";
import { encodeFilePath } from "../lib/api/file";

const DEBOUNCE_MILLISECONDS = 200;
const MINIMUM_QUERY_LENGTH = 2;
const INITIAL_MATCH_COUNT = 5;
const SERVER_MATCH_CAP = 50;

function useDebouncedValue(value: string): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), DEBOUNCE_MILLISECONDS);
    return () => window.clearTimeout(timeout);
  }, [value]);

  return debouncedValue;
}

function pathBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function pathDirectory(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex <= 0 ? "/" : path.slice(0, separatorIndex);
}

function pathTerms(query: string): string[] {
  return query.normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function highlightedText(value: string, query: string): ReactNode {
  const terms = pathTerms(query).sort((left, right) => right.length - left.length);
  if (terms.length === 0) return value;
  const escapedTerms = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escapedTerms.join("|")})`, "giu");
  return value
    .split(pattern)
    .map((part, index) =>
      terms.some((term) => term.toLocaleLowerCase() === part.toLocaleLowerCase()) ? (
        <mark key={`${part}-${index}`}>{part}</mark>
      ) : (
        <Fragment key={`${part}-${index}`}>{part}</Fragment>
      ),
    );
}

function isScopeInsideRoot(scope: string, root: string): boolean {
  return scope === root || scope.startsWith(`${root}/`);
}

function scopeSegments(root: string, scope: string): Array<{ label: string; path: string }> {
  if (!isScopeInsideRoot(scope, root)) return [];
  const segments = [{ label: pathBasename(root) || root, path: root }];
  if (scope === root) return segments;
  let path = root;
  for (const label of scope.slice(root.length + 1).split("/")) {
    path = `${path}/${label}`;
    segments.push({ label, path });
  }
  return segments;
}

export function fileSearchViewerTarget(
  absolutePath: string,
  lineNumber: number,
): {
  absolutePath: string;
  lineNumber: number;
} {
  if (!absolutePath.startsWith("/") || !Number.isSafeInteger(lineNumber) || lineNumber < 1) {
    throw new Error("File search results require an absolute path and positive line number");
  }
  return { absolutePath, lineNumber };
}

export function fileSearchViewerNavigation(
  absolutePath: string,
  lineNumber: number,
): {
  pathToken: string;
  hash: string;
} {
  const target = fileSearchViewerTarget(absolutePath, lineNumber);
  return {
    pathToken: encodeFilePath(target.absolutePath),
    hash: `L${target.lineNumber}`,
  };
}

interface FileSearchResultsProps {
  initialQuery: string;
  onClose: () => void;
  onOpen: (absolutePath: string, lineNumber: number) => void;
  onQueryChange: (query: string) => void;
}

export function FileSearchResults({
  initialQuery,
  onClose,
  onOpen,
  onQueryChange,
}: FileSearchResultsProps) {
  const [query, setQuery] = useState(initialQuery);
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef(new Map<string, HTMLButtonElement>());
  const debouncedQuery = useDebouncedValue(query.trim());
  const rootsQuery = useQuery(fileSearchRootsQueryOptions);

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  useEffect(() => {
    const firstRoot = rootsQuery.data?.roots[0];
    if (activeRoot === null && firstRoot) {
      setActiveRoot(firstRoot);
      setScope(firstRoot);
    }
  }, [activeRoot, rootsQuery.data]);

  const searchEnabled =
    debouncedQuery.length >= MINIMUM_QUERY_LENGTH && activeRoot !== null && scope !== null;
  const searchQuery = useQuery({
    ...fileSearchQueryOptions(debouncedQuery, scope ?? ""),
    enabled: searchEnabled,
  });
  const result = searchQuery.data;
  const resultPaths = useMemo(() => result?.files.map((file) => file.path) ?? [], [result]);

  useEffect(() => {
    if (selectedPath !== null && !resultPaths.includes(selectedPath)) setSelectedPath(null);
  }, [resultPaths, selectedPath]);

  const registerResult = useCallback(
    (path: string) => (element: HTMLButtonElement | null) => {
      if (element) resultRefs.current.set(path, element);
      else resultRefs.current.delete(path);
    },
    [],
  );

  const focusResult = (index: number): void => {
    const path = resultPaths[index];
    if (!path) return;
    const element = resultRefs.current.get(path);
    if (!element) return;
    setSelectedPath(path);
    element.focus();
    element.scrollIntoView({ block: "nearest" });
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" && resultPaths.length > 0) {
      event.preventDefault();
      focusResult(0);
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  const handleResultKeyDown = (event: KeyboardEvent<HTMLButtonElement>, path: string): void => {
    const index = resultPaths.indexOf(path);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusResult(Math.min(index + 1, resultPaths.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) {
        setSelectedPath(null);
        inputRef.current?.focus();
      } else {
        focusResult(index - 1);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSelectedPath(null);
      inputRef.current?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.click();
    }
  };

  const selectRoot = (nextRoot: string): void => {
    if (!rootsQuery.data?.roots.includes(nextRoot)) return;
    setActiveRoot(nextRoot);
    setScope(nextRoot);
    setSelectedPath(null);
  };

  const selectScope = (nextScope: string): void => {
    if (activeRoot === null || !isScopeInsideRoot(nextScope, activeRoot)) return;
    setScope(nextScope);
    setSelectedPath(null);
  };

  return (
    <section aria-label="File content search" className="mt-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-500" />
          <input
            ref={inputRef}
            aria-label="Search file contents"
            autoFocus
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              onQueryChange(event.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search file contents..."
            className="w-full rounded-md border border-border-300/15 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent-100"
          />
        </div>
        <button
          type="button"
          aria-label="Close file search"
          onClick={onClose}
          className="rounded-md p-2 text-text-500 hover:bg-bg-200 hover:text-text-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor="file-search-root" className="text-text-500">
          Root
        </label>
        <select
          id="file-search-root"
          aria-label="Search root"
          disabled={rootsQuery.isPending || rootsQuery.isError}
          value={activeRoot ?? ""}
          onChange={(event) => selectRoot(event.target.value)}
          className="max-w-full rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-text-100"
        >
          {rootsQuery.isPending ? <option value="">Loading roots...</option> : null}
          {rootsQuery.isError ? <option value="">Unable to load roots</option> : null}
          {rootsQuery.data?.roots.map((root) => (
            <option key={root} value={root}>
              {root}
            </option>
          ))}
        </select>
        {activeRoot && scope ? (
          <nav aria-label="Search scope" className="flex min-w-0 items-center gap-1 text-text-500">
            {scopeSegments(activeRoot, scope).map((segment, index) => (
              <Fragment key={segment.path}>
                {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0" /> : null}
                <button
                  type="button"
                  onClick={() => selectScope(segment.path)}
                  className="max-w-40 truncate rounded px-1 py-0.5 hover:bg-bg-200 hover:text-text-100"
                  title={segment.path}
                >
                  {segment.label}
                </button>
              </Fragment>
            ))}
          </nav>
        ) : null}
      </div>

      {rootsQuery.data?.roots.length === 0 ? (
        <p className="mt-8 text-center text-sm text-text-500">
          Add at least one <code>file_roots</code> directory to the app config to search files.
        </p>
      ) : query.trim().length < MINIMUM_QUERY_LENGTH ? (
        <p className="mt-8 text-center text-sm text-text-500">
          Type at least 2 characters to search.
        </p>
      ) : searchQuery.isFetching && result === undefined ? (
        <div
          className="mt-8 flex items-center justify-center gap-2 text-sm text-text-500"
          role="status"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" /> Searching files...
        </div>
      ) : searchQuery.isError ? (
        <p className="mt-8 text-center text-sm text-red-600" role="alert">
          File search failed. Try again.
        </p>
      ) : result && result.files.length === 0 ? (
        <p className="mt-8 text-center text-sm text-text-500">
          No file matches for &ldquo;{debouncedQuery}&rdquo;.
        </p>
      ) : result ? (
        <ResultCards
          result={result}
          query={debouncedQuery}
          scope={scope}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          registerResult={registerResult}
          onExpand={(path) =>
            setExpandedPaths((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            })
          }
          onFocus={setSelectedPath}
          onKeyDown={handleResultKeyDown}
          onOpen={(path, lineNumber) => {
            const target = fileSearchViewerTarget(path, lineNumber);
            onOpen(target.absolutePath, target.lineNumber);
          }}
          onScopeChange={selectScope}
        />
      ) : null}
    </section>
  );
}

interface ResultCardsProps {
  result: FileSearchResult;
  query: string;
  scope: string | null;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  registerResult: (path: string) => (element: HTMLButtonElement | null) => void;
  onExpand: (path: string) => void;
  onFocus: (path: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, path: string) => void;
  onOpen: (path: string, lineNumber: number) => void;
  onScopeChange: (scope: string) => void;
}

function ResultCards({
  result,
  query,
  scope,
  expandedPaths,
  selectedPath,
  registerResult,
  onExpand,
  onFocus,
  onKeyDown,
  onOpen,
  onScopeChange,
}: ResultCardsProps) {
  return (
    <>
      <p className="mt-4 text-xs text-text-500">
        {result.totalResults} matches in {result.totalFiles} files
        {result.isTruncated ? " (showing capped results)" : ""}
      </p>
      <ul className="mt-2 space-y-2">
        {result.files.map((file) => {
          const directory = pathDirectory(file.path);
          const expanded = expandedPaths.has(file.path);
          const shownMatches = expanded ? file.matches : file.matches.slice(0, INITIAL_MATCH_COUNT);
          const hiddenCount = Math.max(
            0,
            Math.min(file.matchCount, SERVER_MATCH_CAP) - INITIAL_MATCH_COUNT,
          );
          const firstLineNumber = file.matches[0]?.lineNumber ?? 1;
          return (
            <li
              key={file.path}
              className="relative rounded-lg border border-border-300/15 bg-bg-100"
            >
              <button
                ref={registerResult(file.path)}
                type="button"
                aria-label={`Open ${file.path} at line ${firstLineNumber}`}
                data-selected={selectedPath === file.path ? "true" : undefined}
                onFocus={() => onFocus(file.path)}
                onKeyDown={(event) => onKeyDown(event, file.path)}
                onClick={(event) => {
                  const lineElement = (event.target as HTMLElement).closest<HTMLElement>(
                    "[data-line-number]",
                  );
                  const lineNumber = Number(lineElement?.dataset["lineNumber"] ?? firstLineNumber);
                  onOpen(file.path, lineNumber);
                }}
                className="block w-full rounded-lg p-3 text-left transition-colors hover:bg-bg-200/50 focus:outline-none focus:ring-1 focus:ring-accent-100"
              >
                <span className="flex items-start justify-between gap-3 pr-8">
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-text-500 [&_mark]:bg-warning-100/30 [&_mark]:text-text-100">
                      {highlightedText(directory, query)}
                    </span>
                    <strong className="block truncate text-sm font-semibold text-text-100 [&_mark]:bg-warning-100/30">
                      {highlightedText(pathBasename(file.path), query)}
                    </strong>
                  </span>
                  <span className="shrink-0 text-xs text-text-500">
                    {file.matchCount} {file.matchCount === 1 ? "match" : "matches"}
                  </span>
                </span>
                <span className="mt-2 block space-y-1">
                  {shownMatches.length === 0 ? (
                    <span data-line-number="1" className="block text-xs text-text-500">
                      Filename or directory match · open at line 1
                    </span>
                  ) : (
                    shownMatches.map((match) => (
                      <span
                        key={`${file.path}:${match.lineNumber}`}
                        data-line-number={match.lineNumber}
                        className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 rounded px-1 py-0.5 text-xs hover:bg-bg-300/40"
                      >
                        <span className="text-right font-mono text-text-500">
                          {match.lineNumber}
                        </span>
                        <span
                          className="truncate text-text-300 [&_mark]:rounded-sm [&_mark]:bg-warning-100/30 [&_mark]:px-0.5 [&_mark]:text-text-100"
                          dangerouslySetInnerHTML={{ __html: match.snippet }}
                        />
                      </span>
                    ))
                  )}
                </span>
              </button>
              {directory !== scope ? (
                <button
                  type="button"
                  aria-label={`Search within ${directory}`}
                  title="Search within this directory"
                  onClick={() => onScopeChange(directory)}
                  className="absolute right-2 top-2 rounded p-1 text-text-500 hover:bg-bg-300/50 hover:text-text-100"
                >
                  <FolderSearch className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => onExpand(file.path)}
                  className="mx-3 mb-2 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-accent-100 hover:bg-bg-200"
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {expanded ? "Show fewer" : `+${hiddenCount} more in this file`}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
