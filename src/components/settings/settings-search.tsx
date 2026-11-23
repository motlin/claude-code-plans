// Base UI Popover, not ui/popover: structurally anchored to its input.
import {Popover} from "@base-ui/react/popover";
import {useQuery} from "@tanstack/react-query";
import {type MouseEvent, type RefObject, useEffect, useId, useMemo, useRef, useState} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import
{
	customizeClaudeAiConnectorsQueryOptions,
	customizeMcpServersQueryOptions,
	customizeSkillsQueryOptions,
} from "../../lib/api/customize";
import {pluginsQueryOptions, userCommandsQueryOptions} from "../../lib/api/plugins";
import type {CustomizeSection, SettingsTab} from "../../lib/settings-hash";
import
{
	buildSettingsResultRows,
	customizeSectionOf,
	isCustomizeSearchSection,
	normalizeSettingsQuery,
	type SettingsResultRow,
	type SettingsSearchSection,
	settingsMatchStart,
	settingsSectionName,
	splitMatch,
} from "../../lib/settings-search";
import {buildCustomizeIndex} from "../../lib/settings-search-customize";
import type {CustomizeTarget} from "../customize/customize-navigation";
import {Icon} from "../ui/icon";
import {SHEET_BODY_CLASS} from "../ui/popover-sheet";
import {CUSTOMIZE_SECTION_ICONS, SETTINGS_TAB_ICONS} from "./settings-tab-icons";
import {overlayAttrs} from "../../lib/overlay";

/**
 * `label` with the query's first word-start (else first) occurrence in the accent color. Like upstream,
 * each non-empty part is its own span, and an unmatched label is a single span.
 */
function Highlighted({label, query}: {label: string; query: string})
{
	const start = settingsMatchStart(label, query);
	if (start === -1) return <span>{label}</span>;
	const parts = splitMatch(label, start, query.trim().length);
	return (
		<>
			{parts.before !== "" && <span>{parts.before}</span>}
			<span className="text-upstream-accent">{parts.match}</span>
			{parts.after !== "" && <span>{parts.after}</span>}
		</>
	);
}

// Upstream's cds popover body: the popup's one child, scrolling with a scroll-edge fade.
const POPOVER_BODY_CLASS = `${SHEET_BODY_CLASS} scroll-fade-y p-0`;

// Upstream's cds menu-item row at comfortable density (gap-xs 8, radius 8) plus `h-auto !px-1 py-1.5`.
const ROW_CLASS =
	"flex w-full items-center gap-2 rounded-r6 h-auto !px-1 py-1.5 text-start text-body font-normal text-primary select-none outline-none data-[highlighted]:bg-fill-ghost-hover";
// 20px icon + comfortable gap-sm (12px).
const INDENT_CLASS = "ps-[32px]";

/** Upstream's row mousedown: keep focus (and the open popover) in the search input. */
function keepInputFocus(event: MouseEvent)
{
	event.preventDefault();
}

/** What choosing a result opens: a settings tab (and row), or a Customize section, detail or seeded search. */
export type SettingsSearchChoice =
	|
	  {
			kind: "tab";
			tab: SettingsTab;
			row?: string;
	  }
	|
	  {
			kind: "customize";
			section: CustomizeSection;
			target?: CustomizeTarget;
			/** A Customize "+N more": open the section's Yours list with its header search set to this query. */
			seed?: string;
	  };

/** The section's nav glyph. */
function sectionIcon(section: SettingsSearchSection)
{
	return isCustomizeSearchSection(section)
		? CUSTOMIZE_SECTION_ICONS[customizeSectionOf(section)]
		: SETTINGS_TAB_ICONS[section];
}

function rowKey(row: SettingsResultRow): string
{
	return row.kind === "child" ? `child/${row.tab}/${row.rowSlug}/${row.title}` : `${row.kind}/${row.tab}`;
}

/** "3 more matches in Claude Code": the "+N more" row's label and, after "Showing ", its announcement. */
function moreMatches(count: number, section: string): string
{
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
})
{
	const section = settingsSectionName(row.tab);
	const rowProps =
	{
		type: "button",
		"data-highlighted": highlighted ? "" : undefined,
		onMouseDown: keepInputFocus,
		onMouseMove: onHighlight,
		onClick: () =>
		{
			onChoose(row);
		},
		className: ROW_CLASS,
	} as const;
	if (row.kind === "hit")
	{
		const TabIcon = sectionIcon(row.tab);
		return (
			<button {...rowProps}>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex items-center gap-3">
						<TabIcon aria-hidden="true" className="size-5 shrink-0 text-primary" />
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
 * match in the accent color. Like upstream, the index also holds the Customize Skills, Connectors and Plugins
 * rows, loaded on mount. Choosing a hit or child hands its tab (and row) or Customize target to `onSelect`;
 * "+N more" lists the rest of a settings tab in place, and opens a Customize section with its search seeded.
 */
export function SettingsSearch({
	onSelect,
	inputRef: givenInputRef,
}: {
	onSelect: (choice: SettingsSearchChoice) => void;
	/** The dialog's handle on the input, for its initial focus. */
	inputRef?: RefObject<HTMLInputElement | null>;
})
{
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<SettingsSearchSection>>(() => new Set());
	const [announcement, setAnnouncement] = useState("");
	const [active, setActive] = useState(0);
	const anchorRef = useRef<HTMLDivElement>(null);
	const ownInputRef = useRef<HTMLInputElement>(null);
	const inputRef = givenInputRef ?? ownInputRef;
	const scrollerRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	// Upstream's xn loads the Customize data with the dialog and folds it into the index as it lands.
	const skills = useQuery(customizeSkillsQueryOptions);
	const commands = useQuery(userCommandsQueryOptions);
	const servers = useQuery(customizeMcpServersQueryOptions);
	const claudeAi = useQuery(customizeClaudeAiConnectorsQueryOptions);
	const plugins = useQuery(pluginsQueryOptions);
	const customizeIndex = useMemo(
		() =>
			buildCustomizeIndex(
				{
					skills: skills.data ?? [],
					commands: commands.data ?? [],
					servers: servers.data ?? [],
					claudeAi: claudeAi.data ?? [],
					plugins: plugins.data ?? [],
				},
			),
		[skills.data, commands.data, servers.data, claudeAi.data, plugins.data],
	);
	// Upstream gates the no-match announcement on the skills and plugins hooks only.
	const customizeLoading = skills.isPending || plugins.isPending;
	const rows = useMemo(
		() => buildSettingsResultRows(query, expanded, customizeIndex),
		[query, expanded, customizeIndex],
	);
	const hasQuery = query.trim().length > 0;
	const open = hasQuery;

	// Upstream keeps the highlighted row in view as the arrows (or a re-ranked list) move it.
	useEffect(() =>
	{
		scrollerRef.current?.querySelector("[data-highlighted]")?.scrollIntoView(
			{
				block: "nearest",
			},
		);
	}, [active, rows]);

	const collapse = () =>
	{
		setExpanded(new Set());
		setAnnouncement("");
	};
	const clear = () =>
	{
		setQuery("");
		setActive(0);
		collapse();
	};
	// Upstream's dismissal (Escape, outside press, select): clear, then blur so a second Escape reaches the dialog.
	const reset = () =>
	{
		clear();
		inputRef.current?.blur();
	};

	// Upstream's ⌘F / Ctrl+F anywhere in Settings focuses and selects the field, instead of the browser's find.
	// It yields inside a nested dialog (e.g. a confirm), and is unbound once Settings closes.
	useShortcut(
		"settings_search",
		(event) =>
		{
			const input = inputRef.current;
			const settings = input?.closest('[role="dialog"]');
			const target = event.target instanceof Element ? event.target : null;
			const targetDialog = target?.closest('[role="dialog"],[role="alertdialog"]') ?? null;
			if (input === null || (targetDialog !== null && targetDialog !== settings)) return false;
			input.focus();
			input.select();
			return true;
		},
		{
			allowInModal: true,
			priority: 1,
		},
	);

	const choose = (row: SettingsResultRow) =>
	{
		const section = row.tab;
		if (row.kind === "more" && !isCustomizeSearchSection(section))
		{
			setExpanded((previous) => new Set([...previous, section]));
			setAnnouncement(`Showing ${moreMatches(row.count, settingsSectionName(section))}`);
			return;
		}
		const seed = query.trim();
		reset();
		if (!isCustomizeSearchSection(section))
		{
			onSelect(
				row.kind !== "more" && row.rowSlug !== undefined
					?
						{
							kind: "tab",
							tab: section,
							row: row.rowSlug,
						}
					:
						{
							kind: "tab",
							tab: section,
						},
			);
			return;
		}
		const customize = customizeSectionOf(section);
		if (row.kind === "more")
			onSelect(
				{
					kind: "customize",
					section: customize,
					seed,
				},
			);
		else
			onSelect(
				row.target === undefined
					?
						{
							kind: "customize",
							section: customize,
						}
					:
						{
							kind: "customize",
							section: customize,
							target: row.target,
						},
			);
	};

	return (
		<Popover.Root
			open={open}
			onOpenChange={(next, details) =>
			{
				if (next) return;
				// Clicks back into the field keep the results open.
				if (details.event.target instanceof Node && anchorRef.current?.contains(details.event.target) === true)
				{
					return;
				}
				reset();
			}}
		>
			{/* Upstream's field is the popover's trigger: a non-native button div around a plain input. */}
			<Popover.Trigger nativeButton={false} render={<div ref={anchorRef} />}>
				{/* Upstream's own field shell (not the cds TextInput) on the density tokens. Clicking anywhere focuses the input. */}
				{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream's pointer shortcut; the input inside is the keyboard control */}
				<div
					onClick={() => inputRef.current?.focus()}
					className="flex h-control w-full cursor-text items-center gap-sm rounded px-sm bg-fill-field shadow-field-ring field-fill transition duration-fast [&:hover:not(:focus-within)]:shadow-field-hover has-[:focus-visible]:shadow-focus contrast-more:focus-within:shadow-focus field-fill-hover"
				>
					<Icon name="Search" className="shrink-0 text-muted-as-secondary" />
					<input
						ref={inputRef}
						type="text"
						aria-label="Search settings"
						placeholder="Search"
						value={query}
						onChange={(event) =>
						{
							const next = event.target.value;
							if (normalizeSettingsQuery(next) !== normalizeSettingsQuery(query)) collapse();
							setQuery(next);
							setActive(0);
						}}
						onKeyDown={(event) =>
						{
							// Upstream ignores keys mid-composition and while the query is empty.
							if (event.nativeEvent.isComposing || !hasQuery) return;
							const count = rows.length;
							if (event.key === "Tab")
							{
								clear();
							}
							else if (event.key === "ArrowDown")
							{
								event.preventDefault();
								setActive((index) => (count === 0 ? 0 : (index + 1) % count));
							}
							else if (event.key === "ArrowUp")
							{
								event.preventDefault();
								setActive((index) => (count === 0 ? 0 : (index - 1 + count) % count));
							}
							else if (event.key === "Enter")
							{
								event.preventDefault();
								const row = rows[active];
								if (row !== undefined && !event.repeat) choose(row);
							}
							else if (event.key === "Escape")
							{
								event.preventDefault();
								event.stopPropagation();
								reset();
							}
						}}
						className="cds-input hide-focus-ring min-w-0 flex-1 border-0 bg-transparent p-0 text-body text-primary outline-none placeholder:text-ink-muted focus-visible:!shadow-none"
					/>
				</div>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner anchor={anchorRef} side="bottom" align="start" sideOffset={4} className="z-[60]">
					<Popover.Popup
						id={listId}
						data-cds="Popover"
						{...overlayAttrs}
						aria-label="Search results"
						initialFocus={false}
						finalFocus={false}
						className="w-[280px] rounded-card bg-[var(--menu-bg)] text-body font-normal text-primary shadow-[var(--menu-shadow)] outline-none"
					>
						<div
							tabIndex={-1}
							data-cds-popover-body=""
							data-cds-sheet-scroll=""
							className={POPOVER_BODY_CLASS}
						>
							<p role="status" className="sr-only">
								{rows.length === 0 ? (customizeLoading ? "" : "No matching settings") : announcement}
							</p>
							<div
								ref={scrollerRef}
								className="max-h-[min(320px,var(--available-height))] overflow-y-auto p-1"
							>
								{rows.length === 0 ? (
									// Upstream's xl search icon over "No matching settings"; gap-sm and px-md are 12px at comfortable density.
									<div className="flex min-h-[120px] flex-col items-center justify-center gap-3 px-3 text-center text-[var(--settings-muted)]">
										<Icon name="Search" size="xl" />
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
											onHighlight={() =>
											{
												setActive(index);
											}}
										/>
									))
								)}
							</div>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
