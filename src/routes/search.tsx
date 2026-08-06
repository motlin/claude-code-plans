import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileSearchResults, fileSearchViewerNavigation } from "../components/file-search-results";
import {
  sessionSearchQueryOptions,
  messageSearchQueryOptions,
  type SessionSearchItem,
  type MessageSearchItem,
} from "../lib/api/search";

type SearchResult = SessionSearchItem | MessageSearchItem;

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
  mode: "titles" | "conversations" | "files";
} {
  const mode = search["mode"];
  return {
    q: typeof search["q"] === "string" ? search["q"] : "",
    mode: mode === "conversations" || mode === "files" ? mode : "titles",
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
  mode: "titles" | "conversations";
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
        <button
          type="button"
          onClick={() => {
            void navigate({
              to: "/search",
              search: { q: submittedQuery, mode: "titles" },
              replace: true,
            });
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            mode === "titles"
              ? "bg-accent-100 text-bg-000"
              : "bg-bg-200 text-text-500 hover:bg-bg-200/80"
          }`}
        >
          Search titles
        </button>
        <button
          type="button"
          onClick={() => {
            void navigate({
              to: "/search",
              search: { q: submittedQuery, mode: "conversations" },
              replace: true,
            });
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            mode === "conversations"
              ? "bg-accent-100 text-bg-000"
              : "bg-bg-200 text-text-500 hover:bg-bg-200/80"
          }`}
        >
          Search conversations
        </button>
        <button
          type="button"
          onClick={() => {
            void navigate({
              to: "/search",
              search: { q: submittedQuery, mode: "files" },
              replace: true,
            });
          }}
          className="rounded-full bg-bg-200 px-3 py-1 text-xs font-medium text-text-500 transition-colors hover:bg-bg-200/80"
        >
          Search files
        </button>
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
                <div className="truncate" style={{ fontSize: "14px", fontWeight: 430 }}>
                  {result.title}
                </div>
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
                {result.snippet && (
                  <div
                    className="mt-0.5 truncate text-xs text-text-500 [&_mark]:rounded-sm [&_mark]:bg-warning-100/30 [&_mark]:px-0.5 [&_mark]:text-text-100"
                    dangerouslySetInnerHTML={{ __html: result.snippet }}
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
