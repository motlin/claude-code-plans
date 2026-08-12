import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";
import type { KeyValueParam } from "./shared";

interface TodoItem {
  content: string;
  status: string;
  activeForm?: string;
}

function formatTodoItem(item: TodoItem): string {
  const statusIcon =
    item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[-]" : "[ ]";
  return `${statusIcon} ${item.content}`;
}

export function TodoWriteRenderer({ toolCall }: ToolRendererProps) {
  const rawTodos = toolCall.input["todos"] as unknown[];
  const todos: TodoItem[] = Array.isArray(rawTodos)
    ? rawTodos.filter(
        (t): t is TodoItem =>
          typeof t === "object" && t !== null && typeof (t as TodoItem).content === "string",
      )
    : [];

  const params: KeyValueParam[] = [];
  if (todos.length > 0) {
    params.push({ key: "todos", value: todos.map(formatTodoItem).join("\n") });
  }

  return (
    <KeyValueCard
      isError={toolCall.isError}
      params={params}
      result={toolCall.result ?? undefined}
    />
  );
}
