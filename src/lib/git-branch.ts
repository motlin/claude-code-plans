/**
 * Normalize a recorded git branch name. Claude Code records the literal
 * string "HEAD" when the repository is in a detached-HEAD state; that is an
 * artifact, not a branch, so it is treated the same as no branch at all.
 */
export function normalizeGitBranch(branch: string | null | undefined): string | null {
  if (branch === undefined || branch === null || branch === "HEAD") return null;
  return branch;
}
