import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import {
  type KeyboardEvent,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  FileConflictError,
  loadEditableMarkdown,
  saveEditableMarkdown,
} from "../../lib/api/file-edit";
import { type EditableMarkdownTarget, FILE_CONFLICT_MESSAGE } from "../../lib/file-edit";
import { isMacPlatform } from "../../lib/shortcuts/match";
import { ConfirmDialog } from "../confirm-dialog";
import { useToast } from "../toast";
import { Tooltip } from "../ui/tooltip";

const MarkdownEditor = lazy(() =>
  import("../markdown-editor").then((module) => ({ default: module.MarkdownEditor })),
);

type EditState =
  | { phase: "viewing" }
  | { phase: "loading" }
  | {
      phase: "editing";
      /** What the editor was seeded with; kept fixed so saving never resets it. */
      initial: string;
      draft: string;
      /** The content on disk as of the last load or save, for the dirty check. */
      saved: string;
      etag: string | null;
      saving: boolean;
      conflict: boolean;
    };

const TEXT_BUTTON =
  "inline-flex h-6 shrink-0 cursor-pointer items-center rounded-r5 px-2 text-footnote disabled:cursor-default disabled:opacity-50";

function isSaveShortcut(event: KeyboardEvent): boolean {
  const mod = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/**
 * Editing a plan or memory in place: Edit swaps rendered markdown for the
 * MDX editor, Save (⌘S inside the pane) writes through the file's save API
 * with the loaded version as `If-Match`, and a 409 asks to Override or
 * Discard. Cancel (Discard once there are edits) goes back to the preview.
 */
export function useMarkdownEdit({
  path,
  target,
  onEditStart,
  onDirtyChange,
}: {
  path: string;
  target: EditableMarkdownTarget | null;
  onEditStart: (() => void) | undefined;
  onDirtyChange: ((dirty: boolean) => void) | undefined;
}) {
  const [state, setState] = useState<EditState>({ phase: "viewing" });
  const queryClient = useQueryClient();
  const toast = useToast();
  const name = baseName(path);
  const dirty = state.phase === "editing" && state.draft !== state.saved;

  const onDirtyChangeRef = useRef(onDirtyChange);
  const reportedDirty = useRef(false);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    if (reportedDirty.current === dirty) return;
    reportedDirty.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      if (reportedDirty.current) onDirtyChangeRef.current?.(false);
    },
    [],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["file", path] });
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "plans" || query.queryKey[2] === "memories",
    });
  };

  const start = async () => {
    if (target === null || state.phase !== "viewing") return;
    onEditStart?.();
    setState({ phase: "loading" });
    try {
      const { markdown, etag } = await loadEditableMarkdown(target);
      setState({
        phase: "editing",
        initial: markdown,
        draft: markdown,
        saved: markdown,
        etag,
        saving: false,
        conflict: false,
      });
    } catch {
      setState({ phase: "viewing" });
      toast({ kind: "error", message: `Couldn’t open ${name} for editing.` });
    }
  };

  const save = async (override: boolean) => {
    if (target === null || state.phase !== "editing" || state.saving) return;
    const { draft, etag } = state;
    setState({ ...state, saving: true, conflict: false });
    try {
      const nextEtag = await saveEditableMarkdown(target, draft, override ? null : etag);
      setState((current) =>
        current.phase === "editing"
          ? { ...current, saving: false, saved: draft, etag: nextEtag }
          : current,
      );
      refresh();
    } catch (error) {
      const conflict = error instanceof FileConflictError;
      setState((current) =>
        current.phase === "editing" ? { ...current, saving: false, conflict } : current,
      );
      if (!conflict) toast({ kind: "error", message: `Couldn’t save ${name}.` });
    }
  };

  const exit = () => {
    setState({ phase: "viewing" });
    refresh();
  };

  const change = (markdown: string) =>
    setState((current) =>
      current.phase === "editing" ? { ...current, draft: markdown } : current,
    );

  const handleKeyDown = (event: KeyboardEvent) => {
    if (state.phase !== "editing" || !isSaveShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    void save(false);
  };

  const editButton: ReactNode =
    target === null || state.phase !== "viewing" ? null : (
      <Tooltip content="Edit">
        <button
          type="button"
          aria-label="Edit"
          onClick={() => void start()}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
        >
          <Pencil aria-hidden="true" className="size-4" />
        </button>
      </Tooltip>
    );

  const toolbar: ReactNode =
    state.phase !== "editing" ? null : (
      <>
        <button
          type="button"
          onClick={exit}
          className={`${TEXT_BUTTON} text-secondary hover:bg-fill-ghost-hover hover:text-primary`}
        >
          {dirty ? "Discard" : "Cancel"}
        </button>
        <button
          type="button"
          disabled={!dirty || state.saving}
          onClick={() => void save(false)}
          className={`${TEXT_BUTTON} bg-fill-primary text-on-primary hover:bg-fill-primary-hover`}
        >
          Save
        </button>
      </>
    );

  const editor: ReactNode =
    state.phase === "viewing" ? null : (
      <div className="p-4">
        <div className="mx-auto max-w-[860px]">
          {state.phase === "loading" ? (
            <p className="text-footnote text-t6">Loading editor…</p>
          ) : (
            <Suspense fallback={<p className="text-footnote text-t6">Loading editor…</p>}>
              <MarkdownEditor markdown={state.initial} onChange={change} />
            </Suspense>
          )}
        </div>
      </div>
    );

  const dialog: ReactNode = (
    <ConfirmDialog
      open={state.phase === "editing" && state.conflict}
      onOpenChange={(open) => {
        if (!open) {
          setState((current) =>
            current.phase === "editing" ? { ...current, conflict: false } : current,
          );
        }
      }}
      title={FILE_CONFLICT_MESSAGE}
      cancelLabel="Discard"
      onCancel={exit}
      confirmLabel="Override"
      onConfirm={() => void save(true)}
    />
  );

  return { editing: state.phase !== "viewing", editButton, toolbar, editor, dialog, handleKeyDown };
}
