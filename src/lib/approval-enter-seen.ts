/**
 * Which approval prompts this tab has already drawn, so upstream's 160ms enter fade
 * plays only for a live arrival: a remount or a reload of a seen prompt skips it.
 * Kept in a module set and in sessionStorage under the prompt's key.
 */
const STORAGE_PREFIX = "approval-enter-seen:";

const memory = new Set<string>();

function browserSessionStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

export function approvalEnterSeen(key: string): boolean {
	if (memory.has(key)) return true;
	try {
		const storage = browserSessionStorage();
		return storage !== null && storage.getItem(STORAGE_PREFIX + key) !== null;
	} catch {
		return false;
	}
}

export function markApprovalEnterSeen(key: string): void {
	memory.add(key);
	try {
		browserSessionStorage()?.setItem(STORAGE_PREFIX + key, "1");
	} catch {
		// Quota or denied storage: the in-memory set still covers remounts.
	}
}
