import {ChevronDown, ChevronUp, X} from "lucide-react";
import type {KeyboardEvent, RefObject} from "react";

import {findCounterText} from "../../lib/find-in-file";

const BAR_BUTTON =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r3 text-secondary hover:bg-fill-ghost-hover hover:text-primary disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

export function FindBar({
	inputRef,
	query,
	active,
	total,
	onQueryChange,
	onStep,
	onClose,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	query: string;
	active: number;
	total: number;
	onQueryChange: (query: string) => void;
	onStep: (direction: 1 | -1) => void;
	onClose: () => void;
}) {
	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			onStep(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
	};
	return (
		// A zero-height sticky row keeps the bar in view whether the viewer or the page scrolls.
		<div className="sticky top-1 z-10 flex h-0 justify-end px-3">
			<div
				role="search"
				className="flex h-fit items-center gap-0.5 rounded-r5 border border-strong bg-surface-1 p-0.5 shadow-[var(--menu-shadow)]"
			>
				<input
					ref={inputRef}
					type="text"
					aria-label="Find in file"
					placeholder="Find in file…"
					spellCheck={false}
					autoComplete="off"
					value={query}
					onChange={(event) => {
						onQueryChange(event.target.value);
					}}
					onKeyDown={handleKeyDown}
					className="h-6 w-44 bg-transparent px-1.5 text-xs text-primary outline-none placeholder:text-t6"
				/>
				{query !== "" && (
					<span
						data-find-counter=""
						aria-live="polite"
						className="shrink-0 px-1 text-footnote whitespace-nowrap text-t6 tabular-nums"
					>
						{findCounterText(active, total)}
					</span>
				)}
				<button
					type="button"
					aria-label="Previous match"
					title="Previous match (⇧Enter)"
					disabled={total === 0}
					onClick={() => {
						onStep(-1);
					}}
					className={BAR_BUTTON}
				>
					<ChevronUp aria-hidden="true" className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Next match"
					title="Next match (Enter)"
					disabled={total === 0}
					onClick={() => {
						onStep(1);
					}}
					className={BAR_BUTTON}
				>
					<ChevronDown aria-hidden="true" className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Close find bar"
					title="Close find bar"
					onClick={onClose}
					className={BAR_BUTTON}
				>
					<X aria-hidden="true" className="size-4" />
				</button>
			</div>
		</div>
	);
}
