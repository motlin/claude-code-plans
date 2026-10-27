// Base UI Popover, not ui/popover: structurally anchored to its input.
import {Popover} from "@base-ui/react/popover";
import {Search} from "lucide-react";
import {useId, useMemo, useRef, useState} from "react";
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
	"flex w-full items-center gap-2 rounded-r6 h-auto !px-1 py-1.5 text-start text-body font-normal text-primary select-none outline-none hover:bg-fill-ghost-hover data-[highlighted]:bg-fill-ghost-hover";
// 20px icon + comfortable gap-sm (12px).
const INDENT_CLASS = "ps-[32px]";

function rowKey(row: SettingsResultRow): string {
	return row.kind === "child" ? `child/${row.tab}/${row.rowSlug}` : `${row.kind}/${row.tab}`;
}

/** Upstream's result row: a section hit (icon, name, optional via line), an indented child, or "+N more". */
function ResultRow({
	row,
	query,
	onChoose,
}: {
	row: SettingsResultRow;
	query: string;
	onChoose: (row: SettingsResultRow) => void;
}) {
	const section = settingsTabLabels[row.tab];
	if (row.kind === "hit") {
		const Icon = SETTINGS_TAB_ICONS[row.tab];
		return (
			<button
				type="button"
				onClick={() => {
					onChoose(row);
				}}
				className={ROW_CLASS}
			>
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
			type="button"
			aria-label={
				row.kind === "child"
					? `${row.title} in ${section}`
					: `${row.count} more ${row.count === 1 ? "match" : "matches"} in ${section}`
			}
			onClick={() => {
				onChoose(row);
			}}
			className={ROW_CLASS}
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
	const [dismissed, setDismissed] = useState(false);
	const [expanded, setExpanded] = useState<ReadonlySet<SettingsTab>>(() => new Set());
	const anchorRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const rows = useMemo(() => buildSettingsResultRows(query, expanded), [query, expanded]);
	const open = !dismissed && query.trim().length > 0;

	const choose = (row: SettingsResultRow) => {
		if (row.kind === "more") {
			setExpanded((previous) => new Set([...previous, row.tab]));
			return;
		}
		setQuery("");
		setDismissed(false);
		setExpanded(new Set());
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
						if (normalizeSettingsQuery(next) !== normalizeSettingsQuery(query)) setExpanded(new Set());
						setQuery(next);
						setDismissed(false);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape" && open) {
							event.preventDefault();
							event.stopPropagation();
							setDismissed(true);
						} else if (event.key === "Enter") {
							const [first] = rows;
							if (first !== undefined) {
								event.preventDefault();
								choose(first);
							}
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
					setDismissed(true);
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
							<p role="status" className="sr-only" />
							<div className="max-h-[min(320px,var(--available-height))] overflow-y-auto p-1">
								{rows.length === 0 ? (
									<p className="px-2.5 py-1.5 text-footnote text-[var(--settings-muted)]">
										No results
									</p>
								) : (
									rows.map((row) => (
										<ResultRow key={rowKey(row)} row={row} query={query} onChoose={choose} />
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
