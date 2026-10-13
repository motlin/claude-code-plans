import {useCallback, useEffect, useMemo, useState} from "react";

import {extractSessionFiles, type FileSourceKey, type SessionFiles} from "../../lib/session-files";
import type {SessionLine} from "../../lib/transcript";

export type FileSourceSelection = Record<FileSourceKey, boolean>;

export const FILE_SOURCE_SELECTION_STORAGE_KEY = "ccp-session-file-sources";

export const FILE_SOURCE_OPTIONS: ReadonlyArray<{key: FileSourceKey; label: string}> = [
	{key: "userMessage", label: "User message"},
	{key: "agentMessage", label: "Agent message"},
	{key: "read", label: "Read"},
	{key: "editWrite", label: "Edit/Write"},
	{key: "bash", label: "Bash"},
	{key: "grepGlob", label: "Grep/Glob"},
	{key: "thinking", label: "Thinking"},
	{key: "other", label: "Other"},
];

export const DEFAULT_FILE_SOURCE_SELECTION: FileSourceSelection = {
	userMessage: true,
	agentMessage: true,
	read: true,
	editWrite: true,
	bash: true,
	grepGlob: true,
	thinking: true,
	other: true,
};

const UNSELECTED_FILE_SOURCES: FileSourceSelection = {
	userMessage: false,
	agentMessage: false,
	read: false,
	editWrite: false,
	bash: false,
	grepGlob: false,
	thinking: false,
	other: false,
};

const EMPTY_SESSION_FILES: SessionFiles = {
	files: [],
	totalCount: 0,
	counts: {
		userMessage: 0,
		agentMessage: 0,
		read: 0,
		editWrite: 0,
		bash: 0,
		grepGlob: 0,
		thinking: 0,
		other: 0,
	},
};

function parseFileSourceSelection(rawValue: string): FileSourceSelection | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawValue);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

	const record = parsed as Record<string, unknown>;
	const keys = FILE_SOURCE_OPTIONS.map((option) => option.key);
	if (Object.keys(record).length !== keys.length) return undefined;
	if (!keys.every((key) => typeof record[key] === "boolean")) return undefined;

	return Object.fromEntries(keys.map((key) => [key, record[key]])) as FileSourceSelection;
}

/** The session-files source checkboxes, hydrated from and persisted to localStorage. */
export function useFileSourceSelection() {
	const [sourceSelection, setSourceSelection] = useState<FileSourceSelection>(DEFAULT_FILE_SOURCE_SELECTION);
	const [storageHydrated, setStorageHydrated] = useState(false);

	useEffect(() => {
		const storedSources = localStorage.getItem(FILE_SOURCE_SELECTION_STORAGE_KEY);
		if (storedSources !== null) {
			const parsedSources = parseFileSourceSelection(storedSources);
			if (parsedSources !== undefined) setSourceSelection(parsedSources);
		}
		setStorageHydrated(true);
	}, []);

	useEffect(() => {
		if (!storageHydrated) return;
		localStorage.setItem(FILE_SOURCE_SELECTION_STORAGE_KEY, JSON.stringify(sourceSelection));
	}, [sourceSelection, storageHydrated]);

	const setSourceSelected = useCallback((source: FileSourceKey, selected: boolean) => {
		setSourceSelection((current) => ({...current, [source]: selected}));
	}, []);
	const unselectAllSources = useCallback(() => {
		setSourceSelection(UNSELECTED_FILE_SOURCES);
	}, []);

	return {sourceSelection, setSourceSelected, unselectAllSources};
}

export function useExtractedSessionFiles(lines: SessionLine[], homeRoot: string | undefined): SessionFiles {
	return useMemo(
		() => (homeRoot === undefined ? EMPTY_SESSION_FILES : extractSessionFiles(lines, homeRoot)),
		[homeRoot, lines],
	);
}

/** A session file's row label: relative to the working directory, absolute outside it. */
export function sessionFileLabel(absolutePath: string, cwd: string | undefined): string {
	if (cwd === undefined) return absolutePath;
	const root = cwd.replace(/\/+$/, "");
	if (root === "" || !absolutePath.startsWith(`${root}/`)) return absolutePath;
	return absolutePath.slice(root.length + 1);
}
