import {
  GitPullRequest,
  CircleDot,
  GitCommit,
  FileCode,
  Search,
  GitBranch,
  ExternalLink,
  User,
  MessageSquare,
  CheckCircle,
  XCircle,
  CircleAlert,
  GitMerge,
} from "lucide-react";
import type { ToolRendererProps } from "./types";
import { CollapsibleSection, CopyableBody, ErrorBorder } from "./shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function stateBadge(state: string) {
  const s = state.toLowerCase();
  if (s === "open") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-r6 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
        <CircleDot className="h-3 w-3" />
        open
      </span>
    );
  }
  if (s === "closed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-r6 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
        <XCircle className="h-3 w-3" />
        closed
      </span>
    );
  }
  if (s === "merged") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-r6 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
        <GitMerge className="h-3 w-3" />
        merged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-r6 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      {state}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

interface ListItem {
  number?: number;
  title?: string;
  state?: string;
  user?: { login?: string };
  html_url?: string;
  merged?: boolean;
}

function ItemList({ items, icon }: { items: ListItem[]; icon: "pr" | "issue" }) {
  const Icon = icon === "pr" ? GitPullRequest : CircleAlert;
  return (
    <div className="space-y-0.5">
      {items.map((item, i) => {
        const effectiveState = item.merged ? "merged" : (item.state ?? "");
        return (
          <div
            key={item.number ?? i}
            className="flex items-center gap-2 px-2 py-1 hover:bg-t2 rounded-r6 text-body"
          >
            <Icon className="h-3.5 w-3.5 text-secondary shrink-0" />
            <span className="text-secondary shrink-0">#{item.number}</span>
            {effectiveState && stateBadge(effectiveState)}
            {item.html_url ? (
              <a
                href={item.html_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:text-accent-100 hover:underline truncate flex-1"
                title={item.title}
              >
                {truncate(item.title ?? "", 80)}
              </a>
            ) : (
              <span className="text-primary truncate flex-1" title={item.title}>
                {truncate(item.title ?? "", 80)}
              </span>
            )}
            {item.user?.login && (
              <span className="text-secondary shrink-0 flex items-center gap-1">
                <User className="h-3 w-3" />
                {item.user.login}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ListPullRequestsRenderer({ data }: { data: unknown }) {
  const items = Array.isArray(data) ? (data as ListItem[]) : [];
  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2 mb-2">
        <GitPullRequest className="h-4 w-4 text-secondary" />
        <span className="text-body text-primary">{items.length} pull request(s)</span>
      </div>
      <ItemList items={items} icon="pr" />
    </div>
  );
}

function ListIssuesRenderer({ data }: { data: unknown }) {
  const items = Array.isArray(data) ? (data as ListItem[]) : [];
  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2 mb-2">
        <CircleAlert className="h-4 w-4 text-secondary" />
        <span className="text-body text-primary">{items.length} issue(s)</span>
      </div>
      <ItemList items={items} icon="issue" />
    </div>
  );
}

interface DetailData {
  number?: number;
  title?: string;
  state?: string;
  merged?: boolean;
  body?: string;
  html_url?: string;
  user?: { login?: string };
  comments?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

function SingleItemRenderer({ data, icon }: { data: DetailData; icon: "pr" | "issue" }) {
  const Icon = icon === "pr" ? GitPullRequest : CircleAlert;
  const effectiveState = data.merged ? "merged" : (data.state ?? "");
  const body = data.body ?? "";
  const previewBody = body.length > 300 ? body.slice(0, 300) + "..." : body;

  return (
    <div className="px-2 py-2 space-y-2">
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 text-secondary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-body font-medium text-primary">{data.title}</span>
            <span className="text-body text-secondary">#{data.number}</span>
            {effectiveState && stateBadge(effectiveState)}
          </div>
          <div className="flex items-center gap-3 mt-1 text-body text-secondary">
            {data.user?.login && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {data.user.login}
              </span>
            )}
            {data.comments !== undefined && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {data.comments}
              </span>
            )}
            {data.additions !== undefined && (
              <span className="text-extended-green">+{data.additions}</span>
            )}
            {data.deletions !== undefined && (
              <span className="text-extended-pink">-{data.deletions}</span>
            )}
            {data.changed_files !== undefined && <span>{data.changed_files} files</span>}
          </div>
        </div>
        {data.html_url && (
          <a
            href={data.html_url}
            target="_blank"
            rel="noreferrer"
            className="text-secondary hover:text-accent-100 shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {previewBody && (
        <CollapsibleSection label="Body">
          <pre className="text-secondary text-code font-mono whitespace-pre-wrap bg-t1 rounded-r6 p-2 max-h-48 overflow-auto">
            {previewBody}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  );
}

interface CommitData {
  sha?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  html_url?: string;
  author?: { login?: string };
}

function CommitListRenderer({ data }: { data: unknown }) {
  const commits = Array.isArray(data) ? (data as CommitData[]) : [];
  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2 mb-2">
        <GitCommit className="h-4 w-4 text-secondary" />
        <span className="text-body text-primary">{commits.length} commit(s)</span>
      </div>
      <div className="space-y-0.5">
        {commits.map((c, i) => {
          const sha = c.sha?.slice(0, 7) ?? "";
          const message = c.commit?.message?.split("\n")[0] ?? "";
          const author = c.author?.login ?? c.commit?.author?.name ?? "";
          return (
            <div
              key={c.sha ?? i}
              className="flex items-center gap-2 px-2 py-1 hover:bg-t2 rounded-r6 text-body"
            >
              <GitCommit className="h-3.5 w-3.5 text-secondary shrink-0" />
              {c.html_url ? (
                <a
                  href={c.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-code font-mono text-accent-100 hover:underline shrink-0"
                >
                  {sha}
                </a>
              ) : (
                <span className="text-code font-mono text-secondary shrink-0">{sha}</span>
              )}
              <span className="text-primary truncate flex-1" title={message}>
                {truncate(message, 80)}
              </span>
              {author && <span className="text-secondary shrink-0">{author}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SingleCommitRenderer({ data }: { data: CommitData }) {
  const sha = data.sha?.slice(0, 7) ?? "";
  const message = data.commit?.message ?? "";
  const author = data.author?.login ?? data.commit?.author?.name ?? "";

  return (
    <div className="px-2 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <GitCommit className="h-4 w-4 text-secondary" />
        {data.html_url ? (
          <a
            href={data.html_url}
            target="_blank"
            rel="noreferrer"
            className="text-code font-mono text-accent-100 hover:underline"
          >
            {sha}
          </a>
        ) : (
          <span className="text-code font-mono text-secondary">{sha}</span>
        )}
        {author && (
          <span className="text-body text-secondary flex items-center gap-1">
            <User className="h-3 w-3" />
            {author}
          </span>
        )}
      </div>
      <pre className="text-primary text-code font-mono whitespace-pre-wrap bg-t1 rounded-r6 p-2 max-h-48 overflow-auto">
        {message}
      </pre>
    </div>
  );
}

interface FileContentsData {
  name?: string;
  path?: string;
  content?: string;
  encoding?: string;
  html_url?: string;
  type?: string;
}

function FileContentsRenderer({ data }: { data: FileContentsData }) {
  let content = data.content ?? "";
  if (data.encoding === "base64" && content) {
    try {
      content = atob(content.replace(/\n/g, ""));
    } catch {
      // keep raw
    }
  }
  const displayContent =
    content.length > 5000 ? content.slice(0, 5000) + "\n... (truncated)" : content;

  return (
    <div className="px-2 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <FileCode className="h-4 w-4 text-secondary" />
        <span className="text-code font-mono text-primary">{data.path ?? data.name ?? "file"}</span>
        {data.html_url && (
          <a
            href={data.html_url}
            target="_blank"
            rel="noreferrer"
            className="text-secondary hover:text-accent-100 shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {displayContent && (
        <pre className="text-secondary text-code font-mono whitespace-pre-wrap bg-t1 rounded-r6 p-2 max-h-64 overflow-auto">
          {displayContent}
        </pre>
      )}
    </div>
  );
}

interface SearchResultItem {
  name?: string;
  path?: string;
  html_url?: string;
  repository?: { full_name?: string };
  title?: string;
  number?: number;
  state?: string;
  user?: { login?: string };
  body?: string;
}

function SearchResultsRenderer({ data }: { data: unknown }) {
  const parsed = data as { items?: SearchResultItem[]; total_count?: number };
  const items = parsed.items ?? (Array.isArray(data) ? (data as SearchResultItem[]) : []);
  const total = parsed.total_count;

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2 mb-2">
        <Search className="h-4 w-4 text-secondary" />
        <span className="text-body text-primary">
          {total !== undefined ? `${total} result(s)` : `${items.length} result(s)`}
        </span>
      </div>
      <div className="space-y-0.5">
        {items.map((item, i) => (
          <div
            key={item.html_url ?? i}
            className="flex items-center gap-2 px-2 py-1 hover:bg-t2 rounded-r6 text-body"
          >
            {item.number !== undefined ? (
              <>
                <CircleAlert className="h-3.5 w-3.5 text-secondary shrink-0" />
                <span className="text-secondary shrink-0">#{item.number}</span>
                {item.state && stateBadge(item.state)}
              </>
            ) : (
              <FileCode className="h-3.5 w-3.5 text-secondary shrink-0" />
            )}
            {item.html_url ? (
              <a
                href={item.html_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:text-accent-100 hover:underline truncate flex-1"
                title={item.title ?? item.path}
              >
                {truncate(item.title ?? item.path ?? item.name ?? "", 80)}
              </a>
            ) : (
              <span className="text-primary truncate flex-1">
                {truncate(item.title ?? item.path ?? item.name ?? "", 80)}
              </span>
            )}
            {item.repository?.full_name && (
              <span className="text-secondary shrink-0 text-code font-mono">
                {item.repository.full_name}
              </span>
            )}
            {item.user?.login && (
              <span className="text-secondary shrink-0 flex items-center gap-1">
                <User className="h-3 w-3" />
                {item.user.login}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface BranchData {
  name?: string;
  commit?: { sha?: string };
  protected?: boolean;
}

function BranchListRenderer({ data }: { data: unknown }) {
  const branches = Array.isArray(data) ? (data as BranchData[]) : [];
  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="h-4 w-4 text-secondary" />
        <span className="text-body text-primary">{branches.length} branch(es)</span>
      </div>
      <div className="space-y-0.5">
        {branches.map((b, i) => (
          <div
            key={b.name ?? i}
            className="flex items-center gap-2 px-2 py-1 hover:bg-t2 rounded-r6 text-body"
          >
            <GitBranch className="h-3.5 w-3.5 text-secondary shrink-0" />
            <span className="text-primary text-code font-mono">{b.name}</span>
            {b.commit?.sha && (
              <span className="text-secondary text-code font-mono">{b.commit.sha.slice(0, 7)}</span>
            )}
            {b.protected && (
              <span className="text-xs px-1.5 py-0.5 rounded-r6 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                protected
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SuccessActionRenderer({ data, action }: { data: unknown; action: string }) {
  const d = data as Record<string, unknown>;
  const title = d["title"] as string | undefined;
  const number = d["number"] as number | undefined;
  const htmlUrl = d["html_url"] as string | undefined;

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-green-500" />
        <span className="text-body text-primary">{action}</span>
      </div>
      {(title || number) && (
        <div className="flex items-center gap-2 mt-1 text-body">
          {number !== undefined && <span className="text-secondary">#{number}</span>}
          {htmlUrl ? (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent-100 hover:underline truncate"
            >
              {title ?? htmlUrl}
            </a>
          ) : (
            title && <span className="text-primary">{title}</span>
          )}
        </div>
      )}
    </div>
  );
}

function DefaultGithubRenderer({ resultText }: { resultText: string }) {
  let formatted = resultText;
  try {
    const parsed = JSON.parse(resultText);
    formatted = JSON.stringify(parsed, null, 2);
  } catch {
    // plain text
  }
  const displayText =
    formatted.length > 3000 ? formatted.slice(0, 3000) + "\n... (truncated)" : formatted;

  return (
    <div className="bg-t1 rounded-r6 p-2 max-h-64 overflow-auto">
      <pre className="text-secondary text-code font-mono whitespace-pre-wrap">{displayText}</pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input summary
// ---------------------------------------------------------------------------

function InputSummary({ tool, input }: { tool: string; input: Record<string, unknown> }) {
  const owner = input["owner"] as string | undefined;
  const repo = input["repo"] as string | undefined;
  const repoStr = owner && repo ? `${owner}/${repo}` : (repo ?? "");

  const parts: string[] = [];
  if (repoStr) parts.push(repoStr);

  const prNum = input["pullNumber"] ?? input["pull_number"];
  if (typeof prNum === "number" || typeof prNum === "string") parts.push(`#${prNum}`);

  const issueNum = input["issueNumber"] ?? input["issue_number"];
  if (typeof issueNum === "number" || typeof issueNum === "string") parts.push(`#${issueNum}`);

  const query = input["q"] ?? input["query"];
  if (typeof query === "string" && query) parts.push(`"${truncate(query, 40)}"`);

  const path = input["path"] as string | undefined;
  if (path) parts.push(path);

  const branch = input["branch"] as string | undefined;
  if (branch && tool.includes("branch")) parts.push(branch);

  if (parts.length === 0) return null;

  return <span className="text-secondary ml-1">{parts.join(" ")}</span>;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function GithubRenderer({ toolCall }: ToolRendererProps) {
  // Extract tool name: "mcp__plugin_github_github__list_pull_requests" -> "list_pull_requests"
  const tool = toolCall.name.split("__").slice(2).join("__");
  const resultText = toolCall.result ?? "";
  const data = tryParseJson(resultText);
  const input = toolCall.input as Record<string, unknown>;

  const label = (
    <span className="flex items-center gap-1.5">
      <span>{tool.replace(/_/g, " ")}</span>
      <InputSummary tool={tool} input={input} />
    </span>
  );

  const renderResult = () => {
    if (toolCall.isError) {
      return <DefaultGithubRenderer resultText={resultText} />;
    }

    if (!resultText) {
      return <span className="text-body text-secondary">No result</span>;
    }

    switch (tool) {
      case "list_pull_requests":
      case "search_pull_requests":
        if (data && typeof data === "object" && "items" in (data as Record<string, unknown>)) {
          return <SearchResultsRenderer data={data} />;
        }
        return <ListPullRequestsRenderer data={data ?? resultText} />;

      case "pull_request_read":
        if (data && typeof data === "object" && !Array.isArray(data)) {
          return <SingleItemRenderer data={data as DetailData} icon="pr" />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "list_issues":
      case "search_issues":
        if (data && typeof data === "object" && "items" in (data as Record<string, unknown>)) {
          return <SearchResultsRenderer data={data} />;
        }
        return <ListIssuesRenderer data={data ?? resultText} />;

      case "issue_read":
        if (data && typeof data === "object" && !Array.isArray(data)) {
          return <SingleItemRenderer data={data as DetailData} icon="issue" />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "list_commits":
        return <CommitListRenderer data={data ?? resultText} />;

      case "get_commit":
        if (data && typeof data === "object" && !Array.isArray(data)) {
          return <SingleCommitRenderer data={data as CommitData} />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "get_file_contents":
        if (data && typeof data === "object" && !Array.isArray(data)) {
          return <FileContentsRenderer data={data as FileContentsData} />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "search_code":
        return <SearchResultsRenderer data={data ?? resultText} />;

      case "list_branches":
      case "list_tags":
        return <BranchListRenderer data={data ?? resultText} />;

      case "create_pull_request":
        if (data && typeof data === "object") {
          return <SuccessActionRenderer data={data} action="Pull request created" />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "create_branch":
        if (data && typeof data === "object") {
          return <SuccessActionRenderer data={data} action="Branch created" />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "issue_write":
        if (data && typeof data === "object") {
          return <SuccessActionRenderer data={data} action="Issue created" />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "add_issue_comment":
      case "add_reply_to_pull_request_comment":
        if (data && typeof data === "object") {
          return <SuccessActionRenderer data={data} action="Comment added" />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "merge_pull_request":
        if (data && typeof data === "object") {
          return <SuccessActionRenderer data={data} action="Pull request merged" />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      case "update_pull_request":
        if (data && typeof data === "object") {
          return <SuccessActionRenderer data={data} action="Pull request updated" />;
        }
        return <DefaultGithubRenderer resultText={resultText} />;

      default:
        return <DefaultGithubRenderer resultText={resultText} />;
    }
  };

  return (
    <CopyableBody copyText={resultText}>
      <ErrorBorder isError={toolCall.isError}>
        <CollapsibleSection label={label} defaultOpen={true}>
          {renderResult()}
        </CollapsibleSection>
      </ErrorBorder>
    </CopyableBody>
  );
}
