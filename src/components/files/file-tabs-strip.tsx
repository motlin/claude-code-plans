import { X } from "lucide-react";
import type { KeyboardEvent } from "react";

import type { FileTabsAction, FileTabsState } from "../../lib/file-tabs";
import { getFileIcon } from "../file-tree";
import { ContextMenu, ContextMenuTrigger, MenuContent } from "../ui/menu";
import { TabMenuItems } from "./file-context-menu";

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

interface FileTabsStripProps {
  state: FileTabsState;
  dispatch: (action: FileTabsAction) => void;
  /** The working directory; paths inside it copy and attach relative to it. */
  cwd?: string | undefined;
  onAttachContext?: ((snippet: string) => void) | undefined;
  /** Shows the file's folder in the tree column. */
  onRevealInTree?: ((path: string) => void) | undefined;
}

/**
 * The Files pane header's tab strip ("Open files"), replacing the "Files"
 * title once a file is open. Preview tabs are italic; a double-click pins.
 * Delete/Backspace closes the focused tab and ⌃⇧←/→ reorders it.
 */
export function FileTabsStrip({
  state,
  dispatch,
  cwd,
  onAttachContext,
  onRevealInTree,
}: FileTabsStripProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, path: string): void {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      dispatch({ type: "close", path });
    } else if (
      event.ctrlKey &&
      event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      dispatch({ type: "move", path, delta: event.key === "ArrowLeft" ? -1 : 1 });
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
    >
      {state.tabs.map((tab) => {
        const name = baseName(tab.path);
        const active = tab.path === state.active;
        const Icon = getFileIcon(name);
        return (
          <ContextMenu key={tab.path}>
            <ContextMenuTrigger
              role="presentation"
              className={`group/tab flex h-6 min-w-0 shrink basis-[192px] items-center rounded-r5 p-[2px] text-body transition-colors hover:bg-fill-ghost-hover ${active ? "bg-fill-control text-primary" : "text-secondary"}`}
            >
              <button
                type="button"
                role="tab"
                data-file-tab
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={tab.path}
                onClick={() => dispatch({ type: "reveal", path: tab.path })}
                onDoubleClick={() => dispatch({ type: "pin", path: tab.path })}
                onKeyDown={(event) => handleKeyDown(event, tab.path)}
                className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1 bg-transparent px-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent-100 ${tab.preview ? "italic" : ""}`}
              >
                <Icon aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
                <span className="max-w-[140px] truncate">{name}</span>
                {tab.preview && <span className="sr-only">, preview</span>}
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Close ${name}`}
                onClick={() => dispatch({ type: "close", path: tab.path })}
                className={`flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-t6 transition-opacity group-hover/tab:opacity-100 hover:bg-fill-control hover:text-primary ${active ? "opacity-100" : "opacity-0"}`}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </ContextMenuTrigger>
            <MenuContent>
              <TabMenuItems
                path={tab.path}
                cwd={cwd}
                onAttachContext={onAttachContext}
                onRevealInTree={onRevealInTree}
                dispatch={dispatch}
              />
            </MenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}
