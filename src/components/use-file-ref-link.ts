import {useQueryClient} from "@tanstack/react-query";
import {type KeyboardEvent, type MouseEvent, useCallback, useContext, useMemo, useSyncExternalStore} from "react";

import {type FileRefStatus, fileRefStatusQueryOptions} from "../lib/api/file-refs";
import type {FileRef} from "../lib/file-refs";
import {markFileRefMissing, missingFileRefs, subscribeMissingFileRefs} from "../lib/missing-file-refs";
import {relativeToCwd} from "./files/mention-path";
import {useOpenInDefaultApp} from "./use-open-in-default-app";
import {FileRefsContext, useFileRefsCwd} from "./file-refs-context";
import {useResolvedFileRefs, EMPTY_REFS} from "./use-resolved-file-refs";

const NO_PATHS: readonly string[] = [];

const NO_SESSION = "";

/**
 * {@link useResolvedFileRefs} against the surrounding {@link FileRefsProvider};
 * empty outside one. With `linkMissing`, paths not found inside the roots link
 * too, until a click finds them missing.
 */
export function useFileRefs(texts: readonly string[], linkMissing = false): ReadonlyMap<string, FileRef> {
	const context = useContext(FileRefsContext);
	const sessionId = context?.sessionId ?? NO_SESSION;
	const missingFiles = useSyncExternalStore(
		subscribeMissingFileRefs,
		() => missingFileRefs(sessionId),
		() => missingFileRefs(sessionId),
	);
	const refs = useResolvedFileRefs(
		context === null ? NO_PATHS : texts,
		context?.sessionPaths ?? NO_PATHS,
		[context?.cwd],
		{linkMissing, missingFiles},
	);
	return context === null ? EMPTY_REFS : refs;
}

/** Upstream's 150ms before a slow existence check marks the clicked ref busy. */
const BUSY_DELAY_MS = 150;

export type CheckedOpenResult = "opened" | "missing" | "outside";

/**
 * Upstream's `rr` click for an optimistically linked ref: a file already known
 * to exist opens at once; otherwise its existence is rechecked (the ref turns
 * `aria-busy` if that takes over 150ms), then it opens or joins the session's
 * missing files, which re-renders it blocked.
 */
export function useCheckedOpen(
	sessionId: string,
	open: (ref: FileRef) => void,
): (ref: FileRef, element: HTMLElement) => Promise<CheckedOpenResult> {
	const queryClient = useQueryClient();
	return useCallback(
		async (ref, element) => {
			const options = fileRefStatusQueryOptions(ref.path);
			if (queryClient.getQueryData(options.queryKey) === "exists") {
				open(ref);
				return "opened";
			}
			const busy = setTimeout(() => {
				element.setAttribute("aria-busy", "true");
			}, BUSY_DELAY_MS);
			let status: FileRefStatus;
			try {
				status = await queryClient.query({...options, staleTime: 0});
			} catch {
				// A failed check opens anyway; the Files pane reports what went wrong.
				status = "exists";
			} finally {
				clearTimeout(busy);
				element.removeAttribute("aria-busy");
			}
			if (status === "exists") {
				open(ref);
				return "opened";
			}
			if (status === "missing") markFileRefMissing(sessionId, ref.path);
			return status;
		},
		[queryClient, sessionId, open],
	);
}

/**
 * Upstream `Yn`'s ⌘/Ctrl-click: a ref inside the cwd opens with its default
 * app instead of the Files pane. Returns whether it took the click.
 */
export function useDefaultAppOpen(): (ref: FileRef) => boolean {
	const cwd = useFileRefsCwd();
	const openInDefaultApp = useOpenInDefaultApp();
	return useCallback(
		(ref) => {
			if (relativeToCwd(ref.path, cwd) === null) return false;
			openInDefaultApp(ref.path);
			return true;
		},
		[cwd, openInDefaultApp],
	);
}

/** The open handler of the surrounding {@link FileRefsProvider}, if any. */
export function useOpenFileRef(): ((ref: FileRef) => void) | null {
	return useContext(FileRefsContext)?.open ?? null;
}

export interface FileRefButtonProps {
	role: "button";
	tabIndex: 0;
	"data-file-ref": "";
	"data-file-path": string;
	"data-file-line"?: number;
	onClick: (event: MouseEvent) => void;
	onKeyDown: (event: KeyboardEvent) => void;
}

export function fileRefButtonProps(
	ref: FileRef,
	open: (ref: FileRef) => void,
	openDefaultApp: (ref: FileRef) => boolean,
): FileRefButtonProps {
	return {
		role: "button",
		tabIndex: 0,
		"data-file-ref": "",
		"data-file-path": ref.path,
		...(ref.line === undefined ? {} : {"data-file-line": ref.line}),
		onClick: (event) => {
			event.stopPropagation();
			if ((event.metaKey || event.ctrlKey) && openDefaultApp(ref)) return;
			open(ref);
		},
		onKeyDown: (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			event.stopPropagation();
			open(ref);
		},
	};
}

const NO_REF = undefined;

/**
 * Upstream `Ir`'s state for one user-row code span, inside a {@link FileRefsProvider}:
 * its resolved ref (undefined until resolved or when it names no file), linked
 * optimistically until a click finds it missing, with button props whose click
 * and Enter/Space recheck existence (busy after 150ms).
 */
export function useUserCodeFileRef(text: string): {
	ref: FileRef | undefined;
	buttonProps: (element: () => HTMLElement | null) => FileRefButtonProps | null;
} {
	const context = useContext(FileRefsContext);
	const texts = useMemo(() => [text], [text]);
	const ref = useFileRefs(texts, true).get(text) ?? NO_REF;
	const checkedOpen = useCheckedOpen(context?.sessionId ?? NO_SESSION, context?.open ?? noOpen);
	const openDefaultApp = useDefaultAppOpen();
	return {
		ref,
		buttonProps: (element) =>
			ref === undefined || ref.block !== undefined
				? null
				: fileRefButtonProps(
						ref,
						(target) => {
							const node = element();
							if (node !== null) void checkedOpen(target, node);
						},
						openDefaultApp,
					),
	};
}

function noOpen() {}
