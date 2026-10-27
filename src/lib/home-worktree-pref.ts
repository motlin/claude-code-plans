/** Upstream's `cc-landing-worktree-enabled`: whether new home sessions start in a git worktree. Per browser. */
export const HOME_WORKTREE_STORAGE_KEY = "cc-landing-worktree-enabled";

export function readHomeWorktreePref(): boolean {
	try {
		return localStorage.getItem(HOME_WORKTREE_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

export function writeHomeWorktreePref(enabled: boolean): void {
	try {
		localStorage.setItem(HOME_WORKTREE_STORAGE_KEY, String(enabled));
	} catch {
		// Storage can be unavailable (private mode); the switch still works for this visit.
	}
}
