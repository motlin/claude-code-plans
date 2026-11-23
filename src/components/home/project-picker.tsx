// Base UI Popover, not ui/popover: combobox picker, anchored like Add repository.
import {Popover} from "@base-ui/react/popover";
import {Check, ChevronDown, Folder} from "lucide-react";
import {type KeyboardEvent, type Ref, useContext, useId, useMemo, useRef, useState} from "react";

import {useShortcut} from "../../hooks/use-shortcut";
import type {StartProject} from "../../lib/palette-start-session";
import {folderName, folderParent, inferHome, shortenCwd} from "../../lib/folder-row-names";
import {PLACE_CHIP_CLASS, PLACE_CHIP_LABEL_CLASS, PLACE_CHIP_LABEL_WRAPPER_CLASS} from "../composer-tokens";
import {overlayAttrs} from "../../lib/overlay";
import {useDensity} from "../ui/density-context";
import {MENU_HEADER_CLASS} from "../ui/menu";
import {PathBreak} from "../ui/path-break";
import {Tooltip} from "../ui/tooltip";
import {EnvironmentBarIconOnlyContext} from "../use-environment-bar-icon-only";

/*
 * The home composer's folder picker, copied from claude.ai/code's repository
 * picker: the environment bar's 24px place button opens a 320x360 popover above
 * it with an autofocused search field over a listbox of 24px options. Rows follow upstream's
 * "Choose a folder" menu (cc43287c9 `c8`): the eight most recent folders under "Recent" (the selected
 * one pinned in), each titled by its basename with the parent folder below it on a basename collision.
 * Typing filters every folder by absolute or `~/…` path, arrows move the active option, Enter or a
 * click selects it. Upstream shows its search only past eight recents; local keeps it always, since
 * it has no "Open folder…" escape hatch. The cloud-only "Troubleshoot GitHub connection" and
 * "Refresh list" rows have no local equivalent and are omitted.
 */

const POPUP_CLASS =
	"flex h-[360px] max-h-[var(--available-height)] w-[320px] max-w-[calc(100vw-32px)] flex-col rounded-r7 bg-[var(--menu-bg)] p-1 text-body font-normal text-primary shadow-[var(--menu-shadow)] outline-none";

/**
 * Upstream's cds Select search (shared-frame `aO`): a full-width field bled over the popup's menu gutter with a
 * bottom rule; `--cds-border` is local `border-border` and `text-muted` is local `text-ink-muted`.
 */
const SEARCH_CLASS =
	"-mx-[var(--cds-menu-gutter,0.25rem)] -mt-[var(--cds-menu-gutter,0.25rem)] mb-1 block w-[calc(100%+2*var(--cds-menu-gutter,0.25rem))] shrink-0 cds-reset bg-transparent border-0 border-b border-b-border outline-none focus-visible:outline-hidden px-[calc(var(--cds-pad-md)+var(--cds-menu-gutter,0.25rem))] py-2 text-body font-normal text-primary placeholder:text-ink-muted";

/** Upstream's recent-folder count for the menu with no query. */
const FOLDER_MENU_RECENT_LIMIT = 8;

const OPTION_CLASS =
	"flex min-h-6 shrink-0 cursor-default items-center gap-1 rounded-r5 px-2 select-none data-[highlighted]:bg-fill-ghost-hover";

/**
 * Upstream's described Menu.Item (`ot`): the body line centred in a control-height row on top, and the
 * (h-control − body size − footnote leading + footnote size) / 2 bottom pad, 2.5px / 4px at compact (40.5px).
 */
const DESCRIBED_OPTION_CLASS = `${OPTION_CLASS} py-[calc((var(--cds-h-control)-var(--upstream-leading-body))/2)] pb-[calc((var(--cds-h-control)-var(--upstream-text-body)-var(--upstream-leading-footnote)+var(--upstream-text-footnote))/2)]`;

/**
 * Upstream's Menu.Item description, `text-footnote text-muted`, unclamped; inside a popup upstream's muted is
 * the fizzy secondary (local `--menu-muted`, `rgba(255,255,255,0.57)` dark).
 */
const FOLDER_DESCRIPTION_CLASS = "break-words text-footnote text-[var(--menu-muted)]";

/** Upstream's eight most recent folders, the selection pinned in after them when it falls outside (`Bx`). */
function recentFolders(projects: readonly StartProject[], selected: StartProject | undefined): readonly StartProject[]
{
	const recent = projects.slice(0, FOLDER_MENU_RECENT_LIMIT);
	if (selected === undefined || recent.some((p) => p.id === selected.id)) return recent;
	return projects.some((p) => p.id === selected.id) ? [...recent, selected] : recent;
}

/**
 * Upstream's collapsed place-chip tooltip box, `max-w-[min(480px,var(--available-width))]`; the local tooltip is not
 * Base UI-positioned, so the viewport less its 8px insets stands in for `--available-width`.
 */
const PLACE_TOOLTIP_MAX_WIDTH = "max-w-[min(480px,calc(100vw-16px))]";

/**
 * Upstream's place-chip icon margins inside the Button's `-ms-1` icon slot: `ms-0.5 me-0.5` at rest, `ms-0.5 -me-0.5`
 * once the bar collapses to icons, where a placeholder chip's icon also takes the muted ink.
 */
function placeIconMargins(iconOnly: boolean, placeholder: boolean): string
{
	if (!iconOnly) return "ms-0.5 me-0.5";
	return placeholder ? "ms-0.5 -me-0.5 text-muted-control" : "ms-0.5 -me-0.5";
}

/** The start card's "Choose environment" row, which opens the same picker below it. */
const CHOOSE_CLASS =
	"flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-body leading-5 text-secondary-control outline-none group-hover/row:bg-fill-ghost-hover group-has-[:focus-visible]/row:bg-fill-ghost-hover group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden";

/** Upstream's CaretDown ink: muted at rest, secondary while the row is hovered, keyboard-focused or open. */
const CHOOSE_CARET_CLASS =
	"size-3 shrink-0 text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary";

interface ProjectPickerProps
{
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	onSelect: (projectId: string) => void;
	/** `chip` is the composer's combobox chip; `choose` is the start card's "Choose environment" row. */
	variant?: "chip" | "choose";
	/** The trigger button, for callers that move focus to it. */
	triggerRef?: Ref<HTMLButtonElement> | undefined;
}

/** Restore focus to the trigger on close unless the selection handler already moved it elsewhere. */
function keepFocusInPopup(popup: HTMLElement | null): boolean
{
	const active = document.activeElement;
	return active === null || active === document.body || popup?.contains(active) === true;
}

export function ProjectPicker({projects, selected, onSelect, variant = "chip", triggerRef}: ProjectPickerProps)
{
	const baseId = useId();
	const popupRef = useRef<HTMLDivElement>(null);
	const listboxId = `${baseId}-listbox`;
	const searchRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	/* Upstream's cds Portal copies the opener's density, so the popup's body/footnote type and control height follow it. */
	const density = useDensity();
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const iconOnly = useContext(EnvironmentBarIconOnlyContext);
	const placeLabel = selected?.name ?? "Select project…";
	const selectedPath = selected?.projectPath;
	const placeTooltip = useMemo(
		() => (selectedPath === undefined ? placeLabel : <PathBreak path={selectedPath} />),
		[selectedPath, placeLabel],
	);

	const needle = query.trim().toLowerCase();
	const recent = recentFolders(projects, selected);
	const filtered =
		needle === ""
			? recent
			: projects.filter(
					(p) =>
						p.projectPath.toLowerCase().includes(needle) ||
						shortenCwd(p.projectPath).toLowerCase().includes(needle),
				);
	// Upstream names the rows being shown, so a partner the query filters out drops the description.
	const shownPaths = filtered.map((p) => p.projectPath);
	const home = inferHome(projects.map((p) => p.projectPath));
	const recentLabelId = `${baseId}-recent`;
	const lastIndex = filtered.length - 1;
	const active = filtered[activeIndex];
	const activeDescendant = active === undefined ? undefined : `${baseId}-${active.id}`;

	const handleOpenChange = (next: boolean) =>
	{
		if (next)
		{
			setQuery("");
			setActiveIndex(
				Math.max(
					0,
					recent.findIndex((p) => p.id === selected?.id),
				),
			);
		}
		setOpen(next);
	};

	// Upstream's ⌥⌘0 "New environment"; locally it opens the start card's Choose environment picker.
	useShortcut(
		"new_environment",
		() =>
		{
			handleOpenChange(true);
		},
		{
			disabled: variant !== "choose",
		},
	);

	const choose = (project: StartProject | undefined) =>
	{
		if (project === undefined) return;
		onSelect(project.id);
		setOpen(false);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) =>
	{
		switch (event.key)
		{
			case "ArrowDown":
				event.preventDefault();
				setActiveIndex((index) => Math.min(lastIndex, index + 1));
				break;
			case "ArrowUp":
				event.preventDefault();
				setActiveIndex((index) => Math.max(0, index - 1));
				break;
			case "Enter":
				event.preventDefault();
				choose(active);
				break;
			default:
				break;
		}
	};

	const options = filtered.map((p, index) =>
	{
		const isSelected = p.id === selected?.id;
		const name = folderName(p.projectPath);
		const parent = folderParent(p.projectPath, shownPaths, home);
		return (
			// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- an aria-activedescendant option: focus and arrow keys stay in the input that owns the list
			<div
				key={p.id}
				id={`${baseId}-${p.id}`}
				role="option"
				aria-selected={isSelected}
				title={p.projectPath}
				data-highlighted={index === activeIndex ? "" : undefined}
				onMouseEnter={() =>
				{
					setActiveIndex(index);
				}}
				onMouseDown={(event) =>
				{
					event.preventDefault();
				}}
				onClick={() =>
				{
					choose(p);
				}}
				className={parent === undefined ? OPTION_CLASS : DESCRIBED_OPTION_CLASS}
			>
				{parent === undefined ? (
					<span data-folder-name className="min-w-0 flex-1 truncate">
						{name}
					</span>
				) : (
					<span className="flex min-w-0 flex-1 flex-col">
						<span data-folder-name className="truncate">
							{name}
						</span>
						<span data-folder-description className={FOLDER_DESCRIPTION_CLASS}>
							{parent}
						</span>
					</span>
				)}
				{isSelected ? (
					<Check
						aria-hidden="true"
						className={`size-3.5 shrink-0 text-accent-100${parent === undefined ? "" : " mt-[2.5px] self-start"}`}
					/>
				) : null}
			</div>
		);
	});

	return (
		<Popover.Root open={open} onOpenChange={handleOpenChange}>
			{variant === "choose" ? (
				<div className="group/row relative">
					<Popover.Trigger
						ref={triggerRef}
						aria-haspopup="dialog"
						aria-expanded={open}
						className={CHOOSE_CLASS}
					>
						<span className="flex min-w-0 flex-1 items-center gap-1">
							<span className="min-w-0 max-w-full truncate text-secondary-control">
								Choose environment
							</span>
						</span>
						<ChevronDown aria-hidden="true" className={CHOOSE_CARET_CLASS} />
					</Popover.Trigger>
				</div>
			) : (
				<Tooltip
					content={placeTooltip}
					openWhen={() => iconOnly}
					maxWidth={PLACE_TOOLTIP_MAX_WIDTH}
					className="flex min-w-0"
				>
					<Popover.Trigger
						// oxlint-disable-next-line jsx-a11y/role-has-required-aria-props -- Base UI's Popover.Trigger sets aria-controls to the popup it opens
						role="combobox"
						aria-label={selected === undefined ? "Select project" : `Folder: ${selected.name}`}
						aria-haspopup="dialog"
						aria-expanded={open}
						data-icon-only={iconOnly ? "" : undefined}
						title={iconOnly ? undefined : selected?.projectPath}
						className={PLACE_CHIP_CLASS}
					>
						<span className="-ms-1 inline-flex">
							<Folder
								aria-hidden="true"
								className={`${placeIconMargins(iconOnly, selected === undefined)} size-4 shrink-0`}
							/>
						</span>
						<span className={iconOnly ? "sr-only" : PLACE_CHIP_LABEL_WRAPPER_CLASS}>
							<span className={PLACE_CHIP_LABEL_CLASS}>{placeLabel}</span>
						</span>
					</Popover.Trigger>
				</Tooltip>
			)}
			<Popover.Portal>
				<Popover.Positioner
					side={variant === "choose" ? "bottom" : "top"}
					align={variant === "choose" ? "center" : "start"}
					sideOffset={6}
					data-density={density}
					className="z-[130] outline-none"
				>
					<Popover.Popup
						{...overlayAttrs}
						ref={popupRef}
						initialFocus={searchRef}
						finalFocus={() => keepFocusInPopup(popupRef.current)}
						className={POPUP_CLASS}
					>
						<input
							ref={searchRef}
							type="text"
							autoFocus
							aria-label="Search projects"
							aria-controls={listboxId}
							aria-activedescendant={activeDescendant}
							placeholder="Search projects…"
							value={query}
							onChange={(event) =>
							{
								setQuery(event.target.value);
								setActiveIndex(0);
							}}
							onKeyDown={handleKeyDown}
							className={SEARCH_CLASS}
						/>
						<div
							id={listboxId}
							role="listbox"
							aria-label="Projects"
							className="flex min-h-0 flex-1 flex-col overflow-y-auto"
						>
							{filtered.length === 0 ? (
								<div className="px-2 py-1 text-footnote text-muted-as-secondary">No matches</div>
							) : needle === "" ? (
								<div role="group" aria-labelledby={recentLabelId} className="flex flex-col">
									<div id={recentLabelId} aria-hidden="true" className={MENU_HEADER_CLASS}>
										Recent
									</div>
									{options}
								</div>
							) : (
								options
							)}
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
