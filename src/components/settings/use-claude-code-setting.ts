import {type QueryClient, useQuery, useQueryClient} from "@tanstack/react-query";
import {useRef, useState} from "react";
import {claudeCodeSettingsQueryOptions, postClaudeCodeSetting} from "../../lib/api/claude-code-settings";
import {composerDefaultsQueryOptions} from "../../lib/api/composer-defaults";
import type {ClaudeCodeSettingKey, ClaudeCodeSettingsState} from "../../lib/claude-code-settings-schema";

type SettingValue = string | boolean | undefined;

/**
 * Writes run one at a time per query client, each sending the mtime of the state the previous write
 * returned, so two quick toggles don't trip the server's stale-mtime guard.
 */
const writeChains = new WeakMap<QueryClient, Promise<unknown>>();

async function enqueue<T>(queryClient: QueryClient, task: () => Promise<T>): Promise<T> {
	const next = (writeChains.get(queryClient) ?? Promise.resolve()).then(task);
	writeChains.set(
		queryClient,
		next.catch(() => {}),
	);
	return next;
}

interface ClaudeCodeSettingBinding {
	/** The shown value: the pending write's while one is in flight, else the file's. */
	value: SettingValue;
	loading: boolean;
	/** Settings never loaded (e.g. settings.json is not valid JSON). */
	unavailable: boolean;
	state: ClaudeCodeSettingsState | undefined;
	writeFailed: boolean;
	write: (value: SettingValue) => void;
}

/**
 * One allow-listed settings.json key, like upstream's declarative row binding: the value flips at once
 * (optimistic), and only the newest write's response settles it, so an older write answering late is
 * ignored. A refused write reverts the value and raises `writeFailed`.
 */
export function useClaudeCodeSetting(key: ClaudeCodeSettingKey): ClaudeCodeSettingBinding {
	const queryClient = useQueryClient();
	const query = useQuery(claudeCodeSettingsQueryOptions);
	const [optimistic, setOptimistic] = useState<{value: SettingValue} | null>(null);
	const [writeFailed, setWriteFailed] = useState(false);
	const sequence = useRef(0);

	const write = (value: SettingValue) => {
		sequence.current += 1;
		const mine = sequence.current;
		setOptimistic({value});
		setWriteFailed(false);
		void enqueue(queryClient, async () => {
			const current = queryClient.getQueryData(claudeCodeSettingsQueryOptions.queryKey);
			const saved = await postClaudeCodeSetting({key, value, expectedMtimeMs: current?.mtimeMs ?? null});
			if (saved !== null) queryClient.setQueryData(claudeCodeSettingsQueryOptions.queryKey, saved);
			return saved;
		}).then((saved) => {
			if (mine !== sequence.current) return;
			setOptimistic(null);
			if (saved === null) {
				setWriteFailed(true);
				void queryClient.invalidateQueries({queryKey: claudeCodeSettingsQueryOptions.queryKey});
				return;
			}
			if (key === "skipDangerousModePermissionPrompt") {
				void queryClient.invalidateQueries({queryKey: composerDefaultsQueryOptions.queryKey});
			}
		});
	};

	return {
		value: optimistic === null ? query.data?.values[key] : optimistic.value,
		loading: query.isPending,
		unavailable: query.isError,
		state: query.data,
		writeFailed,
		write,
	};
}
