import {
  Globe,
  CheckCircle,
  MousePointer,
  Search,
  Code,
  MessageSquare,
  XCircle,
  AlertTriangle,
  Info,
  FileText,
} from "lucide-react";
import type { ThemedToken } from "@shikijs/core";
import type { ToolRendererProps } from "./types";
import { CollapsibleSection, ErrorBorder, ExpandableBlock } from "./shared";
import { MarkdownArticle } from "../markdown-article";
import { looksLikeMarkdown } from "../../lib/client-markdown";
import { useHighlightedLines } from "../../hooks/use-shiki";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text.trim()), null, 2);
  } catch {
    return text;
  }
}

/**
 * Renders JSON with Shiki syntax highlighting, falling back to plain text
 * while the highlighter loads.
 */
function HighlightedJson({ code }: { code: string }) {
  const tokens = useHighlightedLines(code, "json");

  if (!tokens) {
    return (
      <pre className="bg-bg-200 text-text-100 rounded-r6 leading-relaxed p-2 whitespace-pre-wrap break-all text-code font-mono">
        {code}
      </pre>
    );
  }

  return (
    <pre className="bg-bg-200 rounded-r6 leading-relaxed p-2 whitespace-pre-wrap break-all text-code font-mono">
      {tokens.map((line: ThemedToken[], lineIndex: number) => (
        <div key={lineIndex}>
          {line.map((token: ThemedToken, tokenIndex: number) => (
            <span key={tokenIndex} style={{ color: token.color }}>
              {token.content}
            </span>
          ))}
        </div>
      ))}
    </pre>
  );
}

/**
 * Renders tool result content by detecting whether it is markdown, JSON, or
 * plain text and choosing the appropriate rendering strategy.
 */
function SmartResultContent({ text, maxLines = 20 }: { text: string; maxLines?: number }) {
  if (!text) return null;

  if (looksLikeMarkdown(text)) {
    const lineCount = text.split("\n").length;
    return (
      <ExpandableBlock lineCount={lineCount} maxLines={maxLines}>
        <div className="text-body text-text-100 leading-relaxed">
          <MarkdownArticle markdown={text} />
        </div>
      </ExpandableBlock>
    );
  }

  if (looksLikeJson(text)) {
    const formatted = formatJson(text);
    const lineCount = formatted.split("\n").length;
    return (
      <ExpandableBlock lineCount={lineCount} maxLines={maxLines}>
        <HighlightedJson code={formatted} />
      </ExpandableBlock>
    );
  }

  const lines = text.split("\n");
  return (
    <ExpandableBlock lineCount={lines.length} maxLines={maxLines}>
      <pre className="bg-bg-200 text-text-100 rounded-r6 leading-relaxed p-2 whitespace-pre-wrap break-all text-code font-mono">
        {text}
      </pre>
    </ExpandableBlock>
  );
}

function ResultSummary({ resultText, maxLines = 10 }: { resultText: string; maxLines?: number }) {
  if (!resultText) return null;
  const lines = resultText.split("\n");
  const preview = lines.slice(0, maxLines).join("\n");
  const hasMore = lines.length > maxLines;
  return (
    <div className="bg-t1 rounded-r6 p-2 max-h-48 overflow-auto">
      <pre className="text-assistant-secondary text-code font-mono whitespace-pre-wrap">
        {preview}
        {hasMore && `\n... (${lines.length - maxLines} more lines)`}
      </pre>
    </div>
  );
}

function logLevelIcon(level: string) {
  switch (level) {
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "warning":
    case "warn":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "info":
      return <Info className="h-4 w-4 text-cyan-500" />;
    default:
      return <MessageSquare className="h-4 w-4 text-assistant-secondary" />;
  }
}

function logLevelBadgeClasses(level: string): string {
  switch (level) {
    case "error":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    case "warning":
    case "warn":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
    case "info":
      return "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  }
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

/**
 * Strip the URL from result text when it duplicates the input URL.
 * Common result patterns: "Navigated to https://..." or "Page loaded: https://..."
 */
function stripNavigateUrlFromResult(resultText: string, url: string): string {
  if (!url || !resultText) return resultText;
  // Remove lines that are the URL or "Navigated to <url>"
  const lines = resultText.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed === url) return false;
    if (/^navigated to\s+/i.test(trimmed) && trimmed.toLowerCase().includes(url.toLowerCase()))
      return false;
    if (/^page loaded:\s+/i.test(trimmed) && trimmed.toLowerCase().includes(url.toLowerCase()))
      return false;
    return true;
  });
  return filtered.join("\n").trim();
}

function NavigateRenderer({
  input,
  resultText,
}: {
  input: Record<string, unknown>;
  resultText: string;
}) {
  const url = (input["url"] as string) ?? "";
  const isSuccess = resultText.toLowerCase().includes("navigated to");
  const cleanedResult = stripNavigateUrlFromResult(resultText, url);

  return (
    <div className="px-2 py-2 space-y-2">
      <div className="flex items-center gap-2">
        {isSuccess ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : (
          <Globe className="h-4 w-4 text-blue-500" />
        )}
        <span className="text-body text-assistant-primary">
          {isSuccess ? "Navigated to" : "Navigate to"}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-body text-accent-100 hover:underline truncate min-w-0"
          >
            {url}
          </a>
        )}
      </div>
      {cleanedResult && <ResultSummary resultText={cleanedResult} />}
    </div>
  );
}

function ReadPageRenderer({ resultText }: { resultText: string }) {
  return (
    <div className="px-2 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-blue-500" />
        <span className="text-body text-assistant-primary">Read page content</span>
        <span className="text-body text-text-500">{resultText.split("\n").length} lines</span>
      </div>
      <CollapsibleSection label="Page content">
        <SmartResultContent text={resultText} maxLines={30} />
      </CollapsibleSection>
    </div>
  );
}

function ComputerRenderer({
  input,
  resultText,
}: {
  input: Record<string, unknown>;
  resultText: string;
}) {
  const action = (input["action"] as string) ?? "";
  const coordinate = input["coordinate"] as number[] | undefined;
  const text = (input["text"] as string) ?? "";
  const isError =
    resultText.toLowerCase().includes("no element found") ||
    resultText.toLowerCase().includes("error");

  const detail = [action, coordinate ? `(${coordinate.join(", ")})` : "", text ? `"${text}"` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <ErrorBorder isError={isError}>
      <div className="px-2 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <MousePointer className="h-4 w-4 text-blue-500" />
          <span className="text-body text-assistant-primary">Computer action</span>
          {detail && <span className="text-text-500 text-code font-mono truncate">{detail}</span>}
        </div>
        <SmartResultContent text={resultText} />
      </div>
    </ErrorBorder>
  );
}

function FindRenderer({
  input,
  resultText,
}: {
  input: Record<string, unknown>;
  resultText: string;
}) {
  const description = (input["description"] as string) ?? (input["query"] as string) ?? "";

  return (
    <div className="px-2 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-amber-500" />
        <span className="text-body text-assistant-primary">Find elements</span>
        {description && (
          <span className="text-body text-assistant-secondary truncate">
            &quot;{description}&quot;
          </span>
        )}
      </div>
      <ResultSummary resultText={resultText} />
    </div>
  );
}

function TabsContextRenderer({ resultText }: { resultText: string }) {
  const lines = resultText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="px-2 py-2 space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Globe className="h-4 w-4 text-assistant-secondary" />
        <span className="text-body text-assistant-primary">{lines.length} tab(s)</span>
      </div>
      <div className="bg-t1 rounded-r6 p-2 max-h-48 overflow-auto">
        <pre className="text-assistant-secondary text-code font-mono whitespace-pre-wrap">
          {resultText}
        </pre>
      </div>
    </div>
  );
}

function JavaScriptToolRenderer({
  input,
  resultText,
}: {
  input: Record<string, unknown>;
  resultText: string;
}) {
  const code =
    (input["code"] as string) ??
    (input["expression"] as string) ??
    (input["javascript"] as string) ??
    "";

  return (
    <div className="px-2 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <Code className="h-4 w-4 text-amber-500" />
        <span className="text-body text-assistant-primary">Execute JavaScript</span>
      </div>
      {code && (
        <pre className="bg-bg-200 rounded-r6 p-2 text-text-100 text-code font-mono whitespace-pre-wrap max-h-32 overflow-auto">
          {code}
        </pre>
      )}
      {resultText && (
        <div className="border-l-2 border-extended-green pl-3">
          <div className="text-body text-text-500 font-medium mb-1">Result</div>
          <SmartResultContent text={resultText} />
        </div>
      )}
    </div>
  );
}

function ReadConsoleMessagesRenderer({ resultText }: { resultText: string }) {
  const lines = resultText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const messages = lines.map((line, i) => {
    // Try "[level] message" format
    const m = /^\[(\w+)\]\s+(.+)$/.exec(line);
    if (m) {
      return { id: i, level: m[1]!, message: m[2]! };
    }
    return { id: i, level: "log", message: line };
  });

  return (
    <div className="space-y-1 max-h-64 overflow-auto px-2 py-2">
      <div className="text-body text-assistant-secondary mb-1 flex items-center gap-2">
        <MessageSquare className="h-3 w-3" />
        {messages.length} console message(s)
      </div>
      {messages.map((msg) => (
        <div key={msg.id} className="flex items-start gap-2 px-2 py-1 hover:bg-t2 rounded-r6">
          {logLevelIcon(msg.level)}
          <span
            className={`text-xs px-1.5 py-0.5 rounded-r6 shrink-0 ${logLevelBadgeClasses(msg.level)}`}
          >
            {msg.level}
          </span>
          <span className="text-body text-assistant-primary truncate flex-1" title={msg.message}>
            {msg.message.length > 80 ? msg.message.slice(0, 77) + "..." : msg.message}
          </span>
        </div>
      ))}
    </div>
  );
}

function DefaultRenderer({ resultText }: { resultText: string }) {
  if (!resultText) return <span className="text-body text-text-500">Action completed</span>;
  return <SmartResultContent text={resultText} />;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function ClaudeInChromeRenderer({ toolCall }: ToolRendererProps) {
  const tool = toolCall.name.split("__").slice(2).join("__");
  const resultText = toolCall.result ?? "";
  const input = toolCall.input as Record<string, unknown>;

  return (
    <ErrorBorder isError={toolCall.isError}>
      <ClaudeInChromeContent tool={tool} input={input} resultText={resultText} />
    </ErrorBorder>
  );
}

function ClaudeInChromeContent({
  tool,
  input,
  resultText,
}: {
  tool: string;
  input: Record<string, unknown>;
  resultText: string;
}) {
  switch (tool) {
    case "navigate":
      return <NavigateRenderer input={input} resultText={resultText} />;
    case "read_page":
      return <ReadPageRenderer resultText={resultText} />;
    case "computer":
      return <ComputerRenderer input={input} resultText={resultText} />;
    case "find":
      return <FindRenderer input={input} resultText={resultText} />;
    case "tabs_context_mcp":
      return <TabsContextRenderer resultText={resultText} />;
    case "javascript_tool":
      return <JavaScriptToolRenderer input={input} resultText={resultText} />;
    case "read_console_messages":
      return <ReadConsoleMessagesRenderer resultText={resultText} />;
    default:
      return <DefaultRenderer resultText={resultText} />;
  }
}
