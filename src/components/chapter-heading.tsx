import {useEffect, useRef, useState} from "react";

import {renameChapter, useSessionChapters} from "../lib/chapter-store";
import {chapterAnchorId} from "../lib/session-chapters";
import {ChapterTitleReveal} from "./reveal-text";

const HEADING_CLASS_NAME = "text-body-semibold text-primary select-text scroll-mt-[56px]";
const INPUT_CLASS_NAME =
	"min-w-0 max-w-full rounded-r2 border-0 bg-transparent p-0 outline outline-[1.5px] outline-fill-accent outline-offset-[1px] [field-sizing:content]";

interface ChapterHeadingProps {
	/** The chapter's id: a chapter tool call's tool_use id, or a user chapter's `uch-` id. */
	id: string;
	title: string;
	/** Commits a rename; without it (or with an empty title) double-click does nothing, as upstream gates it. */
	onRename?: ((title: string) => void) | undefined;
}

/**
 * Upstream claude.ai/code's inline chapter heading (`FA`), inside the turn renderer's
 * assistant-text inset wrapper (`zfe`). It is not find-omitted, so find-in-page matches it.
 */
export function ChapterHeading({id, title, onRename}: ChapterHeadingProps) {
	const [editing, setEditing] = useState(false);
	const canRename = onRename !== undefined && title !== "";
	return (
		<div className="ps-[var(--cds-assistant-message-text-inset,0px)]">
			{editing && canRename ? (
				<h3 className={HEADING_CLASS_NAME}>
					<ChapterTitleInput
						title={title}
						onDone={(next) => {
							setEditing(false);
							if (next !== undefined) onRename(next);
						}}
					/>
				</h3>
			) : (
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- upstream's heading takes double-click as a pointer shortcut to rename, with no keyboard path of its own
				<h3
					id={chapterAnchorId(id)}
					title={title}
					aria-hidden={title === "" ? true : undefined}
					className={`line-clamp-2 ${HEADING_CLASS_NAME}`}
					onDoubleClick={
						canRename
							? () => {
									setEditing(true);
								}
							: undefined
					}
				>
					<ChapterTitleReveal text={title} />
				</h3>
			)}
		</div>
	);
}

/**
 * One of Claude's chapters (upstream's `IA`): drawn under the user's rename of it, renamed in place
 * by double-click, and not drawn at all once the user deleted it from the outline.
 */
export function ClaudeChapterHeading({sessionId, id, title}: {sessionId: string; id: string; title: string}) {
	const {hidden, renames} = useSessionChapters(sessionId);
	if (hidden.includes(id)) return null;
	return (
		<ChapterHeading
			id={id}
			title={renames[id] ?? title}
			onRename={(next) => {
				renameChapter(sessionId, id, next);
			}}
		/>
	);
}

/** The rename input: Enter or blur commits a trimmed, non-empty, changed value; Escape cancels. */
function ChapterTitleInput({title, onDone}: {title: string; onDone: (next: string | undefined) => void}) {
	const [value, setValue] = useState(title);
	const doneRef = useRef(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	const finish = (commit: boolean) => {
		if (doneRef.current) return;
		doneRef.current = true;
		const next = value.trim();
		onDone(commit && next !== "" && next !== title ? next : undefined);
	};

	return (
		<input
			ref={inputRef}
			aria-label="Chapter title"
			size={Math.min(Math.max(title.length, 10), 40)}
			className={INPUT_CLASS_NAME}
			value={value}
			onChange={(event) => {
				setValue(event.target.value);
			}}
			onBlur={() => {
				finish(true);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					finish(true);
				} else if (event.key === "Escape") {
					event.preventDefault();
					// The session page binds Escape to stopping the response; a rename's Escape must not reach it.
					event.stopPropagation();
					finish(false);
				}
			}}
		/>
	);
}
