/** What the file list knows about a file beyond its patch: upstream `xd.set(S,{…})`'s note inputs. */
export interface DiffFileFacts
{
	status?: "added" | "deleted" | "modified" | "renamed" | undefined;
	binary?: boolean | undefined;
	/** No hunks to show despite non-zero counts (upstream `Ji`). */
	tooLarge?: boolean | undefined;
	/** Hide whitespace folded every hunk away. */
	whitespaceOnly?: boolean | undefined;
	modeChange?:
		|
		  {
				previous: string;
				next: string;
		  }
		| undefined;
}

export interface DiffFileHeaderNote
{
	key: string;
	/** The text shown in the header row. */
	row: string;
	/** Folds into the name tooltip: `{path}` is the running tooltip text. */
	tooltip: string;
	/** New/Deleted file read out to screen readers only; their ink carries them visually. */
	srOnly: boolean;
}

/** Upstream `Js`: only the plain executable-bit flips get a note. */
function executableChange(modeChange: DiffFileFacts["modeChange"]): "set" | "cleared" | undefined
{
	if (modeChange?.previous === "100644" && modeChange.next === "100755") return "set";
	if (modeChange?.previous === "100755" && modeChange.next === "100644") return "cleared";
	return undefined;
}

/**
 * Upstream `Vs`'s notes in their fixed order (`Bs` messages): new/deleted, binary, too large, whitespace only, made
 * executable, no longer executable.
 */
export function headerNotes(facts: DiffFileFacts): DiffFileHeaderNote[]
{
	const notes: DiffFileHeaderNote[] = [];
	if (facts.status === "added")
		notes.push(
			{
				key: "newFile",
				row: "New file",
				tooltip: "{path} (new file)",
				srOnly: true,
			},
		);
	if (facts.status === "deleted")
		notes.push(
			{
				key: "deletedFile",
				row: "Deleted file",
				tooltip: "{path} (deleted file)",
				srOnly: true,
			},
		);
	if (facts.binary === true)
		notes.push(
			{
				key: "binary",
				row: "Binary file",
				tooltip: "{path} (binary file)",
				srOnly: false,
			},
		);
	if (facts.tooLarge === true)
		notes.push(
			{
				key: "tooLarge",
				row: "Too large to show",
				tooltip: "{path} (too large to show)",
				srOnly: false,
			},
		);
	if (facts.whitespaceOnly === true)
		notes.push(
			{
				key: "whitespaceOnly",
				row: "Whitespace only",
				tooltip: "{path} (whitespace only)",
				srOnly: false,
			},
		);
	const executable = executableChange(facts.modeChange);
	if (executable === "set")
		notes.push(
			{
				key: "madeExecutable",
				row: "Made executable",
				tooltip: "{path} (made executable)",
				srOnly: false,
			},
		);
	if (executable === "cleared")
		notes.push(
			{
				key: "noLongerExecutable",
				row: "No longer executable",
				tooltip: "{path} (no longer executable)",
				srOnly: false,
			},
		);
	return notes;
}
