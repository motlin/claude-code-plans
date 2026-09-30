/**
 * Shiki's default 500ms `tokenizeTimeLimit` is a wall-clock budget: on a busy
 * CPU (or while the JS regex engine compiles a cold grammar) it cuts a line
 * short and emits the remainder as one uncolored token. Bound the work by line
 * length instead (VS Code's `editor.maxTokenizationLineLength` default) so the
 * output depends only on the input.
 */
export const SHIKI_TOKENIZE_OPTIONS = {
	tokenizeTimeLimit: 0,
	tokenizeMaxLineLength: 20_000,
} as const;
