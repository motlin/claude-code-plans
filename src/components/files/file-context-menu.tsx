import { fileContentUrl, revealFileInFinder } from "../../lib/api/file";
import { writeClipboardText } from "../../lib/clipboard";
import type { FileTabsAction } from "../../lib/file-tabs";
import { vscodeFolderUrl } from "../../lib/session-open-in";
import { useToast } from "../toast";
import { MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger } from "../ui/menu";

/*
 * The Files pane's right-click menus, copied from claude.ai/code: tree rows,
 * open-file tabs and the viewer share "Attach as context" and Copy ▸, and each
 * surface adds its own actions below them.
 */

/** A file's path relative to the working directory, or null outside it. */
function relativeToCwd(path: string, cwd: string | undefined): string | null {
  if (cwd === undefined) return null;
  const prefix = `${cwd.replace(/\/+$/, "")}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** The path an `@` mention uses: relative inside the working directory, absolute outside. */
export function mentionPath(path: string, cwd: string | undefined): string {
  return relativeToCwd(path, cwd) ?? path;
}

/** `vscode://file/<abs>:<line>`, which opens the file at that line in VS Code. */
function vscodeFileUrl(path: string, line: number): string {
  return `${vscodeFolderUrl(path)}:${line}`;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function useCopyText(): (text: string, what: string) => void {
  const toast = useToast();
  return (text, what) => {
    void writeClipboardText(text).then((copied) =>
      toast(
        copied
          ? { kind: "success", message: `${what} copied to clipboard.` }
          : { kind: "error", message: `Couldn’t copy the ${what.toLowerCase()}.` },
      ),
    );
  };
}

interface SharedItemsProps {
  /** Absolute path of the file or folder. */
  path: string;
  cwd: string | undefined;
  /** The snippet "Attach as context" sends; the item is hidden without `onAttachContext`. */
  attachSnippet: () => string;
  onAttachContext: ((snippet: string) => void) | undefined;
  /** Show ⇧⌘L beside "Attach as context", where the shortcut applies. */
  attachShortcut?: string | undefined;
}

/** Attach as context · Copy ▸ {Absolute path, Relative path, Filename}. */
function SharedItems({
  path,
  cwd,
  attachSnippet,
  onAttachContext,
  attachShortcut,
}: SharedItemsProps) {
  const copy = useCopyText();
  const relPath = relativeToCwd(path, cwd);
  return (
    <>
      {onAttachContext !== undefined && (
        <MenuItem
          onSelect={() => onAttachContext(attachSnippet())}
          {...(attachShortcut === undefined ? {} : { shortcut: attachShortcut })}
        >
          Attach as context
        </MenuItem>
      )}
      <MenuSub>
        <MenuSubTrigger>Copy</MenuSubTrigger>
        <MenuSubContent>
          <MenuItem onSelect={() => copy(path, "Path")}>Absolute path</MenuItem>
          <MenuItem
            disabled={relPath === null}
            onSelect={() => {
              if (relPath !== null) copy(relPath, "Path");
            }}
          >
            Relative path
          </MenuItem>
          <MenuItem onSelect={() => copy(baseName(path), "Filename")}>Filename</MenuItem>
        </MenuSubContent>
      </MenuSub>
    </>
  );
}

interface TreeRowMenuItemsProps {
  path: string;
  cwd: string;
  isDirectory: boolean;
  onAttachContext: ((snippet: string) => void) | undefined;
}

export function TreeRowMenuItems({
  path,
  cwd,
  isDirectory,
  onAttachContext,
}: TreeRowMenuItemsProps) {
  const mention = mentionPath(path, cwd);
  return (
    <SharedItems
      path={path}
      cwd={cwd}
      attachSnippet={() => `@${mention}${isDirectory ? "/" : ""}`}
      onAttachContext={onAttachContext}
    />
  );
}

interface TabMenuItemsProps {
  path: string;
  cwd: string | undefined;
  onAttachContext: ((snippet: string) => void) | undefined;
  onRevealInTree: ((path: string) => void) | undefined;
  dispatch: (action: FileTabsAction) => void;
}

export function TabMenuItems({
  path,
  cwd,
  onAttachContext,
  onRevealInTree,
  dispatch,
}: TabMenuItemsProps) {
  return (
    <>
      <SharedItems
        path={path}
        cwd={cwd}
        attachSnippet={() => `@${mentionPath(path, cwd)}`}
        onAttachContext={onAttachContext}
      />
      <MenuSeparator />
      <MenuItem
        disabled={onRevealInTree === undefined || relativeToCwd(path, cwd) === null}
        onSelect={() => onRevealInTree?.(path)}
      >
        Reveal in file tree
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => dispatch({ type: "close", path })}>Close file</MenuItem>
      <MenuItem onSelect={() => dispatch({ type: "closeOthers", path })}>
        Close other files
      </MenuItem>
      <MenuItem onSelect={() => dispatch({ type: "closeAll" })}>Close all files</MenuItem>
    </>
  );
}

interface ViewerMenuItemsProps {
  path: string;
  cwd: string | undefined;
  /** The loaded text, when the viewer shows the file as text. */
  content: string | undefined;
  /** The line VS Code opens at. */
  line: number;
  attachSnippet: () => string;
  onAttachContext: ((snippet: string) => void) | undefined;
  attachShortcut: string;
}

export function ViewerMenuItems({
  path,
  cwd,
  content,
  line,
  attachSnippet,
  onAttachContext,
  attachShortcut,
}: ViewerMenuItemsProps) {
  const copy = useCopyText();
  const toast = useToast();
  const revealInFinder = () => {
    revealFileInFinder(path).catch(() =>
      toast({ kind: "error", message: "Couldn’t reveal the file in Finder." }),
    );
  };
  return (
    <>
      <SharedItems
        path={path}
        cwd={cwd}
        attachSnippet={attachSnippet}
        onAttachContext={onAttachContext}
        attachShortcut={attachShortcut}
      />
      <MenuItem
        disabled={content === undefined}
        onSelect={() => {
          if (content !== undefined) copy(content, "File contents");
        }}
      >
        Copy file contents
      </MenuItem>
      <MenuItem render={<a href={fileContentUrl(path, { download: true })} download />}>
        Download file
      </MenuItem>
      <MenuSeparator />
      <MenuSub>
        <MenuSubTrigger>Open in</MenuSubTrigger>
        <MenuSubContent>
          <MenuItem onSelect={() => window.open(vscodeFileUrl(path, line), "_self")}>
            VS Code
          </MenuItem>
          <MenuItem onSelect={revealInFinder}>Finder</MenuItem>
        </MenuSubContent>
      </MenuSub>
    </>
  );
}
