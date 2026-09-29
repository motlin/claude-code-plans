import { type MouseEvent, type ReactNode, useState } from "react";

import { writeClipboardText } from "../../lib/clipboard";
import { attachContext } from "../../lib/context-attach";
import { type DiffSide, openDiffCommentDraft } from "../../lib/diff-comments";
import { detectLanguage } from "../../lib/diff-utils";
import { useToast } from "../toast";
import { ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator } from "../ui/menu";

/** The diff lines a right-click lands on: the selection inside the diff, or the clicked line. */
interface DiffLineSelection {
  side: DiffSide;
  line: number;
  endLine: number;
  text: string;
}

function rowSide(row: Element): DiffSide {
  switch (row.getAttribute("data-line-type")) {
    case "change-deletion":
      return "deletions";
    case "change-addition":
      return "additions";
    default:
      return row.closest("[data-code]")?.hasAttribute("data-deletions") ? "deletions" : "additions";
  }
}

function rowText(row: Element): string {
  return (row.textContent ?? "").replace(/\n$/, "");
}

/** The code row for a node inside the diff: a `[data-line]` row, or the row a line number labels. */
function rowOf(node: Node | null): Element | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const row = element?.closest("[data-line], [data-column-number]") ?? null;
  if (row === null || row.hasAttribute("data-line")) return row;
  const index = row.getAttribute("data-line-index");
  const code = row.closest("[data-code]");
  if (index === null || code === null) return null;
  return code.querySelector(`[data-line][data-line-index="${CSS.escape(index)}"]`);
}

/** The rows from `first` to `last` in document order that sit on `last`'s side. */
function rowsBetween(first: Element, last: Element): Element[] {
  const code = last.closest("[data-code]");
  if (code === null) return [last];
  const rows = [...code.querySelectorAll("[data-line]")];
  const [from, to] = [rows.indexOf(first), rows.indexOf(last)].sort((a, b) => a - b);
  if (from === undefined || to === undefined || from === -1) return [last];
  const side = rowSide(last);
  return rows.slice(from, to + 1).filter((row) => rowSide(row) === side);
}

function selectionIn(root: ShadowRoot): Selection | null {
  const scoped = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection;
  const selection = typeof scoped === "function" ? scoped.call(root) : document.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  return node.getRootNode() === root ? selection : null;
}

function selectionOf(rows: Element[]): DiffLineSelection | null {
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) return null;
  const line = Number(first.getAttribute("data-line"));
  const endLine = Number(last.getAttribute("data-line"));
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(endLine)) return null;
  return { side: rowSide(last), line, endLine, text: rows.map(rowText).join("\n") };
}

/** Resolves a right-click inside a `@pierre/diffs` shadow root to diff lines. */
function diffLinesAt(event: MouseEvent): DiffLineSelection | null {
  const path = event.nativeEvent.composedPath();
  const clicked = rowOf(
    path.find((target): target is Element => target instanceof Element) ?? null,
  );
  if (clicked === null) return null;
  const root = clicked.getRootNode();
  const selection = root instanceof ShadowRoot ? selectionIn(root) : null;
  if (selection !== null) {
    const anchor = rowOf(selection.anchorNode);
    const focus = rowOf(selection.focusNode);
    if (anchor !== null && focus !== null) {
      const rows = rowsBetween(anchor, focus);
      if (rows.includes(clicked)) return selectionOf(rows);
    }
  }
  return selectionOf([clicked]);
}

/**
 * The Changes pane body's right-click menu, as on claude.ai/code:
 * Attach as context · Request changes · ─ · Copy ⌘C.
 */
export function DiffContextMenu({
  sessionId,
  path,
  children,
}: {
  sessionId: string;
  path: string;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<DiffLineSelection | null>(null);
  const toast = useToast();

  function attach(lines: DiffLineSelection) {
    const attached = attachContext(sessionId, {
      kind: "selection",
      path,
      range: { start: lines.line, end: lines.endLine },
      text: lines.text,
      language: detectLanguage(path),
    });
    if (!attached) {
      toast({ kind: "error", message: "Open the chat input to attach context." });
    }
  }

  function copy(lines: DiffLineSelection) {
    void writeClipboardText(lines.text).then((copied) =>
      toast(
        copied
          ? { kind: "success", message: "Copied to clipboard." }
          : { kind: "error", message: "Couldn’t copy the selection." },
      ),
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div />}
        onContextMenu={(event: MouseEvent) => setTarget(diffLinesAt(event))}
      >
        {children}
      </ContextMenuTrigger>
      <MenuContent>
        <MenuItem disabled={target === null} onSelect={() => target && attach(target)}>
          Attach as context
        </MenuItem>
        <MenuItem
          disabled={target === null}
          onSelect={() =>
            target &&
            openDiffCommentDraft(sessionId, {
              path,
              side: target.side,
              line: target.line,
              endLine: target.endLine,
            })
          }
        >
          Request changes
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          shortcut="cmd+c"
          disabled={target === null}
          onSelect={() => target && copy(target)}
        >
          Copy
        </MenuItem>
      </MenuContent>
    </ContextMenu>
  );
}
