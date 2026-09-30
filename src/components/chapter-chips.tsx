import {X} from "lucide-react";

import {removeChapter, useChapters} from "../lib/chapter-store";

/**
 * The session's "Pin as chapter" marks as jump chips, in transcript order.
 * A chip jumps to its message, paging history in when it is not loaded.
 */
export function ChapterChips({sessionId, onJump}: {sessionId: string; onJump: (uuid: string) => void}) {
	const chapters = useChapters(sessionId);
	if (chapters.length === 0) return null;
	return (
		<nav aria-label="Chapters" className="flex flex-wrap gap-1 py-1">
			{chapters.map((chapter) => (
				<span
					key={chapter.uuid}
					className="inline-flex max-w-[240px] min-w-0 items-center rounded-full border border-strong bg-fill-control text-[11px] font-medium text-secondary"
				>
					<button
						type="button"
						aria-label={`Jump to chapter: ${chapter.label}`}
						title={chapter.label}
						onClick={() => onJump(chapter.uuid)}
						className="min-w-0 cursor-pointer truncate py-0.5 pl-2 pr-1 transition-colors hover:text-primary"
					>
						{chapter.label}
					</button>
					<button
						type="button"
						aria-label={`Unpin chapter: ${chapter.label}`}
						onClick={() => removeChapter(sessionId, chapter.uuid)}
						className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors hover:text-primary mr-0.5"
					>
						<X aria-hidden="true" className="size-3" />
					</button>
				</span>
			))}
		</nav>
	);
}
