import {useCallback, useRef, useSyncExternalStore} from "react";

import
{
	FOLDER_PERMISSION_MODE_STORAGE_KEY,
	type FolderModes,
	folderModeKey,
	type ModePickMethod,
	readFolderModes,
	restoreFolderMode,
	shouldRememberPick,
	writeFolderMode,
} from "../lib/folder-permission-mode";
import type {LaunchPermissionMode} from "../lib/launch-options";

export interface FolderModeMemory
{
	/** Every folder's remembered mode; the server render and hydration see none. */
	modes: FolderModes;
	/** Upstream's commit: remember a pick for this folder, keeping the previous entry for a rollback. */
	remember: (mode: LaunchPermissionMode, method?: ModePickMethod) => void;
	/** Upstream `x()`: a live switch to `expected` failed, so put the folder's previous entry back. */
	rollback: (expected: LaunchPermissionMode) => void;
}

interface RememberedPick
{
	key: string;
	previous: LaunchPermissionMode | undefined;
	mode: LaunchPermissionMode;
}

const NO_MODES: FolderModes = {};
const listeners = new Set<() => void>();
let cached:
{
	raw: string | null;
	modes: FolderModes;
} | null = null;

function storedRaw(): string | null
{
	try
	{
		return localStorage.getItem(FOLDER_PERMISSION_MODE_STORAGE_KEY);
	}
	catch
	{
		return null;
	}
}

/** The parsed map, kept while the stored string is unchanged so the snapshot stays referentially stable. */
function snapshot(): FolderModes
{
	const raw = storedRaw();
	if (cached?.raw !== raw)
		cached =
		{
			raw,
			modes: readFolderModes(),
		};
	return cached.modes;
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

function notify(): void
{
	for (const listener of listeners) listener();
}

/** The per-folder mode memory for `cwd` (cf6ae6197 `Td`), shared by every composer in this tab. */
export function useFolderModeMemory(cwd: string | undefined): FolderModeMemory
{
	const modes = useSyncExternalStore(subscribe, snapshot, () => NO_MODES);
	const lastPickRef = useRef<RememberedPick | null>(null);
	const key = folderModeKey(cwd);
	const remember = useCallback(
		(mode: LaunchPermissionMode, method: ModePickMethod = "mode_dropdown") =>
		{
			if (
				key === null ||
				!shouldRememberPick(
					{
						mode,
						method,
					},
				)
			)
				return;
			lastPickRef.current =
			{
				key,
				previous: readFolderModes()[key],
				mode,
			};
			writeFolderMode(key, mode);
			notify();
		},
		[key],
	);
	const rollback = useCallback((expected: LaunchPermissionMode) =>
	{
		const pick = lastPickRef.current;
		if (pick?.mode !== expected) return;
		lastPickRef.current = null;
		restoreFolderMode(pick.key, pick.previous, expected);
		notify();
	}, []);
	return {
		modes,
		remember,
		rollback,
	};
}
