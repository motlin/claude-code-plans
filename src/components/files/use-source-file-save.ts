import {type QueryKey, useQueryClient} from "@tanstack/react-query";
import {type RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";

import {FileSaveError, saveFileText} from "../../lib/api/file-edit";
import {createSaveQueue, reportsDirty, type SaveError, type SaveReason} from "../../lib/source-save";
import {useToast} from "../toast-context";
import type {SourceEditorHandle} from "./source-editor";

/** Upstream's per-browser autosave preference (`useLocalStorage("epitaxy-thimble", true)`); no UI sets it. */
const AUTO_SAVE_PREF_KEY = "epitaxy-thimble";

function readAutoSavePref(): boolean
{
	try
	{
		const raw = localStorage.getItem(AUTO_SAVE_PREF_KEY);
		return raw === null || JSON.parse(raw) !== false;
	}
	catch
	{
		return true;
	}
}

function baseName(path: string): string
{
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

interface DiskFile
{
	content: string;
	etag: string | null;
}

/**
 * Saving the Files source editor, upstream's shared viewer (`cd2efac6e`): the editor's flushes
 * go through upstream `gS`'s queue to `PUT /api/file/$` with the loaded version as `If-Match`,
 * a save updates the file query in place, and the pane's unsaved guard hears only upstream `om`
 * (dirty while autosave is off, or after a failed save).
 */
export function useSourceFileSave({
	path,
	queryKey,
	file,
	editable,
	lossy,
	editorRef,
	onEditStart,
	onDirtyChange,
}: {
	path: string;
	queryKey: QueryKey;
	file: DiskFile | undefined;
	editable: boolean;
	lossy: boolean;
	editorRef: RefObject<SourceEditorHandle | null>;
	onEditStart: (() => void) | undefined;
	onDirtyChange: ((dirty: boolean) => void) | undefined;
})
{
	const queryClient = useQueryClient();
	const toast = useToast();
	const [autoSavePref] = useState(readAutoSavePref);
	const autoSave = autoSavePref && !lossy;
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<SaveError | null>(null);

	// The version the editor started from; a refetch only moves it while there is no draft.
	const disk = useRef<DiskFile | null>(file ?? null);
	const dirtyRef = useRef(false);
	const errorRef = useRef<SaveError | null>(null);
	if (file !== undefined && (disk.current === null || !dirtyRef.current)) disk.current = file;

	const latest = useRef(
		{
			path,
			queryKey,
			onEditStart,
			onDirtyChange,
		},
	);
	useEffect(() =>
	{
		latest.current =
		{
			path,
			queryKey,
			onEditStart,
			onDirtyChange,
		};
	});

	const queue = useMemo(
		() =>
			createSaveQueue(
				{
					diskText: () => disk.current?.content ?? "",
					write: async (text) =>
					{
						const {path: target, queryKey: key} = latest.current;
						setSaving(true);
						try
						{
							const etag = await saveFileText(target, text, disk.current?.etag ?? null);
							disk.current =
							{
								content: text,
								etag,
							};
							queryClient.setQueryData(key, (old: unknown) =>
								typeof old === "object" && old !== null && "content" in old
									?
										{
											...old,
											content: text,
											...(etag === null
												? {}
												:
													{
														etag,
													}),
										}
									: old,
							);
							errorRef.current = null;
							setError(null);
							const current = editorRef.current?.getValue();
							dirtyRef.current = current !== undefined && current !== text;
							setDirty(dirtyRef.current);
						}
						catch (failure)
						{
							const saveError =
								failure instanceof FileSaveError
									? failure.error
									:
										{
											kind: "writeFailed" as const,
										};
							errorRef.current = saveError;
							setError(saveError);
							toast(
								{
									kind: "error",
									message: `Couldn’t save ${baseName(target)}.`,
								},
							);
							throw failure;
						}
						finally
						{
							setSaving(false);
						}
					},
				},
			),
		[queryClient, toast, editorRef],
	);

	const onChange = useCallback((nowDirty: boolean) =>
	{
		if (nowDirty && !dirtyRef.current) latest.current.onEditStart?.();
		dirtyRef.current = nowDirty;
		setDirty(nowDirty);
	}, []);

	const onSave = useCallback(
		(text: string, reason: SaveReason) =>
		{
			// Upstream stops saving while a save error shows; ⌘S retries it.
			if (!editable || (errorRef.current !== null && reason !== "explicit")) return;
			errorRef.current = null;
			queue.save(text, reason);
		},
		[editable, queue],
	);

	const save = useCallback(() =>
	{
		const text = editorRef.current?.getValue();
		if (text !== undefined) onSave(text, "explicit");
	}, [editorRef, onSave]);

	/** Upstream `cS`: back to the disk contents, clearing the error. */
	const discard = useCallback(() =>
	{
		editorRef.current?.reset(disk.current?.content ?? "");
		errorRef.current = null;
		setError(null);
		dirtyRef.current = false;
		setDirty(false);
	}, [editorRef]);

	const reported = editable && reportsDirty(dirty, autoSave, error);
	const reportedRef = useRef(false);
	useEffect(() =>
	{
		if (reportedRef.current === reported) return;
		reportedRef.current = reported;
		latest.current.onDirtyChange?.(reported);
	}, [reported]);
	useEffect(
		() => () =>
		{
			if (reportedRef.current) latest.current.onDirtyChange?.(false);
		},
		[],
	);

	return {
		autoSavePref,
		autoSave,
		dirty,
		saving,
		error,
		onChange,
		onSave,
		save,
		discard,
	};
}
