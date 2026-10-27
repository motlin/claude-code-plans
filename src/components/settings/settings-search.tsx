// Base UI Popover, not ui/popover: structurally anchored to its input.
import {Popover} from "@base-ui/react/popover";
import {Search, SearchX} from "lucide-react";
import {type MouseEvent, useEffect, useId, useMemo, useRef, useState} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import {settingsTabLabels} from "../../lib/schema-choices";
import type {SettingsTab} from "../../lib/settings-hash";
import {
	buildSettingsResultRows,
	normalizeSettingsQuery,
	type SettingsResultRow,
	settingsMatchStart,
	splitMatch,
} from "../../lib/settings-search";
import {SETTINGS_TAB_ICONS} from "./settings-tab-icons";

/** `label` with the query's first word-start (else first) occurrence in the accent color. */
function Highlighted({label, query}: {label: string; query: string}) {
	const start = settingsMatchStart(label, query);
	if (start === -1) return label;
	const parts = splitMatch(label, start, query.trim().length);
	return (
		<>
			{parts.before}
			<span className="text-upstream-accent">{parts.match}</span>
			{parts.after}
		</>
	);
}

// Upstream's cds menu-item row at comfortable density (gap-xs 8, radius 8) plus `h-auto !px-1 py-1.5`.
const ROW_CLASS =
	"flex w-full items-center gap-2 rounded-r6 h-auto !px-1 py-1.5 text-start text-body font-normal text-primary select-none outline-none data-[highlighted]:bg-fill-ghost-hover";
// 20px icon + comfortable gap-sm (12px).
const INDENT_CLASS = "ps-[32px]";

/** Upstream's row mousedown: keep focus (and the open popover) in the search input. */
function keepInputFocus(event: MouseEvent) {
	event.preventDefault();
}

function rowKey(row: SettingsResultRow): string {
	return row.kind === "child" ? `child/${row.tab}/${row.rowSlug}` : `${row.kind}/${row.tab}`;
}

/** "3 more matches in Claude Code": the "+N more" row's label and, after "Showing ", its announcement. */
function moreMatches(count: number, section: string): string {
	return `${count} more ${count === 1 ? "match" : "matches"} in ${section}`;
}

/** Upstream's result row: a section hit (icon, name, optional via line), an indented child, or "+N more". */
function ResultRow({
	row,
	query,
	highlighted,
	onChoose,
	onHighlight,
}: {
	row: SettingsResultRow;
	query: string;
	highlighted: boolean;
	onChoose: (row: SettingsResultRow) => void;
	onHighlight: () => void;
}) {
	const section = settingsTabLabels[row.tab];
	const rowProps = {
		type: "button",
		"data-highlighted": highlighted ? "" : undefined,
		onMouseDown: keepInputFocus,
		onMouseMove: onHighlight,
		onClick: () => {
			onChoose(row);
		},
		className: ROW_CLASS,
	} as const;
	if (row.kind === "hit") {
		const Icon = SETTINGS_TAB_ICONS[row.tab];
		return (
			<button {...rowProps}>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex items-center gap-3">
						<Icon aria-hidden="true" className="size-5 shrink-0 p-0.5 text-secondary" />
						<span className="min-w-0 flex-1 truncate">
							<Highlighted label={section} query={query} />
						</span>
					</span>
					{row.via !== undefined && (
						<span className={`truncate ${INDENT_CLASS} text-footnote text-[var(--settings-muted)]`}>
							<Highlighted label={row.via} query={query} />
						</span>
					)}
				</span>
			</button>
		);
	}
	return (
		<button
			{...rowProps}
			aria-label={row.kind === "child" ? `${row.title} in ${section}` : moreMatches(row.count, section)}
		>
			<span className={`flex min-w-0 flex-1 items-center gap-3 ${INDENT_CLASS}`}>
				{row.kind === "child" ? (
					<span className="min-w-0 flex-1 truncate">
						<Highlighted label={row.title} query={query} />
					</span>
				) : (
					<span className="min-w-0 flex-1 truncate text-[var(--settings-muted)]">{`+${row.count} more`}</span>
				)}
			</span>
		</button>
	);
}

/**
 * The Settings nav search field. Typing opens upstream's 280px results popover (padding 4) of
 * section hits, indented child rows and "+N more" rows (see `buildSettingsResultRows`), with the
 * match in the accent color. Choosing a hit or child hands its tab (and row, when it names one) to
 * `onSelect`; "+N more" lists the rest of that section in place.
 */
export function SettingsSearch({onSelect}: {onSelect: (tab: SettingsTab, row?: string) => void}) {
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<SettingsTab>>(() => new Set());
	const [announcement, setAnnouncement] = useState("");
	const [active, setActive] = useState(0);
	const anchorRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const rows = useMemo(() => buildSettingsResultRows(query, expanded), [query, expanded]);
	const hasQuery = query.trim().length > 0;
	const open = hasQuery;

	// Upstream keeps the highlighted row in view as the arrows (or a re-ranked list) move it.
	useEffect(() => {
		scrollerRef.current?.querySelector("[data-highlighted]")?.scrollIntoView({block: "nearest"});
	}, [active, rows]);

	const collapse = () => {
		setExpanded(new Set());
		setAnnouncement("");
	};
	const clear = () => {
		setQuery("");
		setActive(0);
		collapse();
	};
	// Upstream's dismissal (Escape, outside press, select): clear, then blur so a second Escape reaches the dialog.
	const reset = () => {
		clear();
		inputRef.current?.blur();
	};

	// Upstream's ⌘F / Ctrl+F anywhere in Settings focuses and selects the field, instead of the browser's find.
	// It yields inside a nested dialog (e.g. a confirm), and is unbound once Settings closes.
	useShortcut(
		"settings_search",
		(event) => {
			const input = inputRef.current;
			const settings = input?.closest('[role="dialog"]');
			const target = event.target instanceof Element ? event.target : null;
			const targetDialog = target?.closest('[role="dialog"],[role="alertdialog"]') ?? null;
			if (input === null || (targetDialog !== null && targetDialog !== settings)) return false;
			input.focus();
			input.select();
			return true;
		},
		{allowInModal: true, priority: 1},
	);

	const choose = (row: SettingsResultRow) => {
		if (row.kind === "more") {
			setExpanded((previous) => new Set([...previous, row.tab]));
			setAnnouncement(`Showing ${moreMatches(row.count, settingsTabLabels[row.tab])}`);
			return;
		}
		reset();
		onSelect(row.tab, row.rowSlug);
	};

	return (
		<>
			<div
				ref={anchorRef}
				className="flex h-8 shrink-0 items-center gap-3 rounded-r6 bg-[var(--settings-field-bg)] px-2 text-secondary shadow-[inset_0_0_0_1px_var(--color-border)] not-dark:shadow-[inset_0_0_0_1px_rgb(11_11_11/0.1)] not-dark:has-[:focus-visible]:shadow-[inset_0_0_0_1px_#fcfcfb,0_0_0_1px_#2a78d6,0_0_6px_1px_#cde2fb] dark:focus-within:ring-2 dark:focus-within:ring-accent-100/40"
			>
				<Search aria-hidden="true" className="size-5 shrink-0" />
				<input
					ref={inputRef}
					type="text"
					role="combobox"
					aria-label="Search settings"
					aria-expanded={open}
					aria-controls={open ? listId : undefined}
					aria-autocomplete="list"
					placeholder="Search"
					value={query}
					onChange={(event) => {
						const next = event.target.value;
						if (normalizeSettingsQuery(next) !== normalizeSettingsQuery(query)) collapse();
						setQuery(next);
						setActive(0);
					}}
					onKeyDown={(event) => {
						// Upstream ignores keys mid-composition and while the query is empty.
						if (event.nativeEvent.isComposing || !hasQuery) return;
						const count = rows.length;
						if (event.key === "Tab") {
							clear();
						} else if (event.key === "ArrowDown") {
							event.preventDefault();
							setActive((index) => (count === 0 ? 0 : (index + 1) % count));
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setActive((index) => (count === 0 ? 0 : (index - 1 + count) % count));
						} else if (event.key === "Enter") {
							event.preventDefault();
							const row = rows[active];
							if (row !== undefined && !event.repeat) choose(row);
						} else if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							reset();
						}
					}}
					className="min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-[var(--settings-muted)]"
				/>
			</div>
			<Popover.Root
				open={open}
				onOpenChange={(next, details) => {
					if (next) return;
					// Clicks back into the field keep the results open.
					if (
						details.event.target instanceof Node &&
						anchorRef.current?.contains(details.event.target) === true
					) {
						return;
					}
					reset();
				}}
			>
				<Popover.Portal>
					<Popover.Positioner
						anchor={anchorRef}
						side="bottom"
						align="start"
						sideOffset={4}
						className="z-[60]"
					>
						<Popover.Popup
							id={listId}
							data-cds="Popover"
							aria-label="Search results"
							initialFocus={false}
							finalFocus={false}
							className="w-[280px] rounded-card bg-[var(--menu-bg)] text-body font-normal text-primary shadow-[var(--menu-shadow)] outline-none"
						>
							<p role="status" className="sr-only">
								{announcement}
							</p>
							<div
								ref={scrollerRef}
								className="max-h-[min(320px,var(--available-height))] overflow-y-auto p-1"
							>
								{rows.length === 0 ? (
									// Upstream's xl search icon over "No matching settings"; gap-sm and px-md are 12px at comfortable density.
									<div className="flex min-h-[120px] flex-col items-center justify-center gap-3 px-3 text-center text-[var(--settings-muted)]">
										<SearchX aria-hidden="true" className="size-7" />
										<span className="text-body">No matching settings</span>
									</div>
								) : (
									rows.map((row, index) => (
										<ResultRow
											key={rowKey(row)}
											row={row}
											query={query}
											highlighted={index === active}
											onChoose={choose}
											onHighlight={() => {
												setActive(index);
											}}
										/>
									))
								)}
							</div>
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			</Popover.Root>
		</>
	);
}
