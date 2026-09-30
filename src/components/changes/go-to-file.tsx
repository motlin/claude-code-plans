import {Search} from "lucide-react";
import {type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState} from "react";

import {useShortcut, useShortcutKeys} from "../../hooks/use-shortcut";
import {type MatchRange, goToFileFooter, searchPaths} from "../../lib/fuzzy-path";
import {getFileIcon} from "../file-tree";
import {Tooltip} from "../ui/tooltip";
import {DiffCounts} from "./changes-file-tree";

export interface GoToFileEntry {
	path: string;
	additions: number;
	deletions: number;
}

/** `text` (which starts at `offset` in the full path) with the matched characters lit. */
function Highlighted({text, offset, ranges}: {text: string; offset: number; ranges: readonly MatchRange[]}) {
	const parts: ReactNode[] = [];
	let cursor = 0;
	for (const [start, end] of ranges) {
		const from = Math.max(start - offset, cursor);
		const to = Math.min(end - offset, text.length);
		if (to <= from) continue;
		if (from > cursor) parts.push(text.slice(cursor, from));
		parts.push(
			<span key={from} data-lit="" className="font-semibold text-primary">
				{text.slice(from, to)}
			</span>,
		);
		cursor = to;
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return <>{parts}</>;
}

/**
 * claude.ai/code's Go to file (⌘P) for the Changes pane: a magnifier button
 * opening a 352px popup with a "Search changed files" combobox over the changed
 * files, fuzzy-matched on dir + name. Enter jumps to the highlighted file.
 */
export function GoToFile({
	files,
	onSelectFile,
}: {
	files: readonly GoToFileEntry[];
	onSelectFile: (path: string) => void;
}) {
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const keys = useShortcutKeys("go_to_file_in_changes");
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);

	const openPopup = () => {
		setQuery("");
		setActiveIndex(0);
		setOpen(true);
	};

	useShortcut("go_to_file_in_changes", openPopup);

	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: MouseEvent) => {
			if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [open]);

	const byPath = new Map(files.map((file) => [file.path, file]));
	const {results, more} = searchPaths(
		query,
		files.map((file) => file.path),
	);
	const footer = goToFileFooter(more);
	const active = results[Math.min(activeIndex, results.length - 1)];

	const choose = (path: string | undefined) => {
		if (path === undefined) return;
		setOpen(false);
		onSelectFile(path);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setActiveIndex((index) => Math.min(results.length - 1, index + 1));
				break;
			case "ArrowUp":
				event.preventDefault();
				setActiveIndex((index) => Math.max(0, index - 1));
				break;
			case "Enter":
				event.preventDefault();
				choose(active?.path);
				break;
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				triggerRef.current?.focus();
				break;
			default:
				break;
		}
	};

	return (
		<div ref={rootRef} className="relative">
			<Tooltip content="Go to file" shortcut={keys.keys}>
				<button
					ref={triggerRef}
					type="button"
					aria-label="Go to file"
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-keyshortcuts={keys.ariaKeyShortcuts}
					onClick={() => (open ? setOpen(false) : openPopup())}
					className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-expanded:bg-fill-control aria-expanded:text-primary"
				>
					<Search aria-hidden="true" className="size-4" />
				</button>
			</Tooltip>
			{open && (
				<div className="absolute top-full right-0 z-[140] mt-1 flex w-[352px] max-w-[calc(100vw-32px)] flex-col rounded-card bg-[var(--menu-bg)] p-1 shadow-[var(--menu-shadow)]">
					<input
						type="text"
						role="combobox"
						autoFocus
						aria-label="Search changed files"
						aria-expanded="true"
						aria-controls={listboxId}
						aria-autocomplete="list"
						aria-activedescendant={active === undefined ? undefined : `${baseId}-${active.path}`}
						placeholder="Search changed files"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(0);
						}}
						onKeyDown={handleKeyDown}
						className="h-7 w-full rounded-r6 bg-transparent px-2 text-body text-primary outline-none placeholder:text-ink-muted"
					/>
					{results.length === 0 ? (
						<p className="px-2 py-1.5 text-body text-ink-muted">No matching files</p>
					) : (
						<div
							id={listboxId}
							role="listbox"
							aria-label="Changed files"
							className="max-h-[320px] min-h-0 overflow-y-auto"
						>
							{results.map((result) => {
								const slash = result.path.lastIndexOf("/");
								const name = result.path.slice(slash + 1);
								const dir = slash === -1 ? "" : result.path.slice(0, slash);
								const file = byPath.get(result.path);
								const Icon = getFileIcon(name);
								const selected = result === active;
								return (
									<div
										key={result.path}
										id={`${baseId}-${result.path}`}
										role="option"
										aria-selected={selected}
										title={result.path}
										onMouseEnter={() => setActiveIndex(results.indexOf(result))}
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => choose(result.path)}
										className="flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-r5 px-2 text-body select-none aria-selected:bg-fill-ghost-hover"
									>
										<Icon aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
										<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
											<span className="shrink-0 truncate text-secondary">
												<Highlighted text={name} offset={slash + 1} ranges={result.ranges} />
											</span>
											{dir !== "" && (
												<span className="min-w-0 truncate text-footnote text-ink-muted">
													<Highlighted text={dir} offset={0} ranges={result.ranges} />
												</span>
											)}
										</span>
										{file && <DiffCounts additions={file.additions} deletions={file.deletions} />}
									</div>
								);
							})}
						</div>
					)}
					{footer !== null && (
						<p
							role="status"
							className="border-t border-border px-2 pt-1.5 pb-1 text-footnote text-ink-muted"
						>
							{footer}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
