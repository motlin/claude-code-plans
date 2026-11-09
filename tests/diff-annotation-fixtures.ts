/** Upstream's live diff-comment test prompt (2026-11-03), shared by the parser and user-row tests. */

export const LONG_BODY =
	"This is a deliberately long comment body that keeps going so the tile has to clamp it, " +
	"with enough words to run past five lines at caption size and show that the quote text is " +
	"collapsed and capped the way upstream caps it.";

export const LONG_PATH =
	"packages/web/src/components/a-very-long-directory-name/another-nested-folder/component-file-name.tsx";

/** The prompt upstream's live test session sent (tiptap paragraphs joined by single newlines). */
export const LIVE_PROMPT = [
	"[upstream-sync test] Reply with only the word ok. Do nothing else: no tools, no files, no commands.",
	"In `src/demo.ts` at line 3:",
	"```ts",
	"const answer = 42;",
	"```",
	"Rename this constant to something clearer",
	"",
	"In `src/demo.ts` at lines 5-7 (before changes):",
	"```ts",
	"- removedA();",
	"- removedB();",
	"- removedC();",
	"```",
	LONG_BODY,
	"",
	`In \`${LONG_PATH}\` at line 120:`,
	"```tsx",
	'<div className="x" />',
	"```",
	"",
	"",
	"Thanks",
].join("\n");
