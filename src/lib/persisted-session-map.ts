import {readFileSync, renameSync, writeFileSync} from "node:fs";
import {z} from "zod";
import {hmrPersist} from "./hmr-persist";

/**
 * A per-session map the server can mirror to a JSON file, so state a hook
 * reported before a restart is still there after it. Every write rewrites the
 * file atomically; nothing is written until `persistTo` names one.
 */
export interface PersistedSessionMap<T> {
	/** Mirror the map to `file` from now on, first replacing it with what the file holds. */
	persistTo(file: string): void;
	get(sessionId: string): T | null;
	set(sessionId: string, value: T): void;
	/** Forget the session's entry; true when there was one. */
	delete(sessionId: string): boolean;
	/** Forget every entry in memory and stop mirroring to disk, as a fresh process starts. */
	reset(): void;
}

export function persistedSessionMap<T>(key: string, schema: z.ZodType<T>): PersistedSessionMap<T> {
	const store = hmrPersist(`${key}Store`, () => new Map<string, T>());
	const persistence = hmrPersist(`${key}File`, () => ({file: null as string | null}));
	const fileSchema = z.record(z.string(), schema);

	function save(): void {
		const {file} = persistence;
		if (file === null) return;
		const temp = `${file}.tmp`;
		writeFileSync(temp, JSON.stringify(Object.fromEntries(store)));
		renameSync(temp, file);
	}

	return {
		persistTo(file) {
			persistence.file = file;
			store.clear();
			let json: unknown;
			try {
				json = JSON.parse(readFileSync(file, "utf8"));
			} catch {
				return;
			}
			const saved = fileSchema.safeParse(json);
			if (!saved.success) return;
			for (const [sessionId, value] of Object.entries(saved.data)) store.set(sessionId, value);
		},
		get: (sessionId) => store.get(sessionId) ?? null,
		set(sessionId, value) {
			store.set(sessionId, value);
			save();
		},
		delete(sessionId) {
			const deleted = store.delete(sessionId);
			if (deleted) save();
			return deleted;
		},
		reset() {
			store.clear();
			persistence.file = null;
		},
	};
}
