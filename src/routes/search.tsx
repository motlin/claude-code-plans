import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileSearchResults, fileSearchViewerNavigation } from "../components/file-search-results";
import {
  sessionSearchQueryOptions,
  messageSearchQueryOptions,
  SearchModeSchema,
  type SearchMode,
  type SessionSearchItem,
  type MessageSearchItem,
} from "../lib/api/search";
import { searchModeLabels } from "../lib/schema-choices";

type SearchResult = SessionSearchItem | MessageSearchItem;

const MARK_CLASSES =
  "[&_mark]:rounded-sm [&_mark]:bg-warning-100/30 [&_mark]:px-0.5 [&_mark]:text-text-100";

function unescapeHtml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function snippetRepeatsTitle(snippetHtml: string, title: string): boolean {
  const text = unescapeHtml(snippetHtml.replaceAll("<mark>", "").replaceAll("</mark>", ""));
  return text === title;
}

export function SearchResultCard({ result }: { result: SearchResult }) {
  const titleHtml = "titleHtml" in result ? result.titleHtml : null;
  const titleStyle = { fontSize: "14px", fontWeight: 430 } as const;
  return (
    <>
      {titleHtml === null ? (
        <div className="truncate" style={titleStyle}>
          {result.title}
        </div>
      ) : (
        <div
          className={`truncate ${MARK_CLASSES}`}
          style={titleStyle}
          dangerouslySetInnerHTML={{ __html: titleHtml }}
        />
      )}
      <div className="mt-0.5 flex items-center gap-2 text-xs text-text-500">
        <span>{result.projectName}</span>
        {result.mtime && (
          <>
            <span>&middot;</span>
            <span>{formatDate(result.mtime)}</span>
          </>
        )}
        {result.messageCount > 0 && (
          <>
            <span>&middot;</span>
            <span>{result.messageCount} msgs</span>
          </>
        )}
      </div>
      {result.snippet && !snippetRepeatsTitle(result.snippet, result.title) && (
        <div
          className={`mt-0.5 truncate text-xs text-text-500 ${MARK_CLASSES}`}
          dangerouslySetInnerHTML={{ __html: result.snippet }}
        />
      )}
    </>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const Route = createFileRoute("/search")({
  component: SearchPage,
  validateSearch: validateSearchParameters,
  head: () => ({
    meta: [{ title: "Search" }],
  }),
});

export function validateSearchParameters(search: Record<string, unknown>): {
  q: string;
  mode: SearchMode;
} {
  const raw = search["mode"] ?? "titles";
  // "messages" is an alias for "conversations" (the mode backed by /api/search/messages).
  const parsed = SearchModeSchema.safeParse(raw === "messages" ? "conversations" : raw);
  if (!parsed.success) {
    throw new Error(
      `Unknown search mode ${JSON.stringify(raw)}: expected ${SearchModeSchema.options.join(", ")}, or messages`,
    );
  }
  return {
    q: typeof search["q"] === "string" ? search["q"] : "",
    mode: parsed.data,
  };
}

function SearchPage() {
  const { q: submittedQuery, mode } = Route.useSearch();
  const navigate = useNavigate();

  if (mode === "files") {
    return (
      <div>
        <h1 className="text-lg font-semibold">Search Files</h1>
        <FileSearchResults
          initialQuery={submittedQuery}
          onQueryChange={(nextQuery) => {
            void navigate({
              to: "/search",
              search: { q: nextQuery, mode: "files" },
              replace: true,
            });
          }}
          onOpen={(absolutePath, lineNumber) => {
            const destination = fileSearchViewerNavigation(absolutePath, lineNumber);
            void navigate({
              to: "/file/$",
              params: { _splat: destination.pathToken },
              hash: destination.hash,
            });
          }}
          onClose={() => {
            void navigate({
              to: "/search",
              search: { q: submittedQuery, mode: "titles" },
              replace: true,
            });
          }}
        />
      </div>
    );
  }

  return <SessionSearch submittedQuery={submittedQuery} mode={mode} />;
}

function SessionSearch({
  submittedQuery,
  mode,
}: {
  submittedQuery: string;
  mode: Exclude<SearchMode, "files">;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(submittedQuery);

  const titlesQuery = useQuery({
    ...sessionSearchQueryOptions(submittedQuery),
    enabled: mode === "titles" && submittedQuery.length > 0,
  });
  const conversationsQuery = useQuery({
    ...messageSearchQueryOptions(submittedQuery),
    enabled: mode === "conversations" && submittedQuery.length > 0,
  });

  const activeQuery = mode === "conversations" ? conversationsQuery : titlesQuery;
  const results: SearchResult[] = activeQuery.data ?? [];
  const loading = activeQuery.isFetching;
  const searched = submittedQuery.length > 0 && activeQuery.isFetched;

  function handleSubmit() {
    const next = query.trim();
    if (!next) return;
    void navigate({ to: "/search", search: { q: next, mode }, replace: true });
  }

  return (
    <div>
      <h1 className="text-lg font-semibold">Search Sessions</h1>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            mode === "conversations" ? "Search conversations..." : "Search session titles..."
          }
          className="flex-1 rounded-md border border-border-300/15 bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent-100"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-md bg-accent-100 px-4 py-2 text-sm font-medium text-bg-000 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      <div className="mt-3 flex gap-1">
        {SearchModeSchema.options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              void navigate({
                to: "/search",
                search: { q: submittedQuery, mode: option },
                replace: true,
              });
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              mode === option
                ? "bg-accent-100 text-bg-000"
                : "bg-bg-200 text-text-500 hover:bg-bg-200/80"
            }`}
          >
            {searchModeLabels[option]}
          </button>
        ))}
      </div>

      {searched && results.length === 0 && (
        <p className="mt-6 text-sm text-text-500">
          No results found for &ldquo;{submittedQuery}&rdquo;
        </p>
      )}

      {searched && results.length > 0 && (
        <div className="mt-4 text-xs text-text-500">{results.length} results</div>
      )}

      {results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((result) => (
            <li key={result.sessionId}>
              <Link
                to="/session/$id"
                params={{ id: result.sessionId }}
                className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
              >
                <SearchResultCard result={result} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
