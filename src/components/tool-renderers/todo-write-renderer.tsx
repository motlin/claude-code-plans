import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";

interface TodoItem {
  content: string;
  status: string;
  activeForm?: string;
}

function statusMarker(status: string): string {
  if (status === "completed") return "[x]";
  if (status === "in_progress") return "[-]";
  return "[ ]";
}

function parseTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is TodoItem =>
      typeof t === "object" && t !== null && typeof (t as TodoItem).content === "string",
  );
}

/**
 * Upstream claude.ai/code renders a TodoWrite call as a bare "Updated todos"
 * label with no expandable body -- the live console shows the checklist in its
 * own chrome, not in the transcript. A session reviewer has no such chrome, so
 * the default view keeps only the in-progress item's activeForm as a quiet
 * italic line and the full checklist stays behind the verbose preset.
 */
export function TodoWriteRenderer({ toolCall, verbose }: ToolRendererProps) {
  const todos = parseTodos(toolCall.input["todos"]);

  if (toolCall.isError) {
    return <KeyValueCard isError params={[]} result={toolCall.result ?? undefined} />;
  }

  if (verbose) {
    if (todos.length === 0) return null;
    return (
      <div className="flex flex-col gap-g2 text-body text-secondary">
        {todos.map((todo, i) => (
          <div key={i} className="flex gap-g2">
            <span className="shrink-0 font-mono text-t6">{statusMarker(todo.status)}</span>
            <span className="min-w-0 break-words">{todo.content}</span>
          </div>
        ))}
      </div>
    );
  }

  const activeForm = todos.find((todo) => todo.status === "in_progress")?.activeForm;
  if (!activeForm) return null;
  return <div className="text-body text-t6 italic">{activeForm}</div>;
}
