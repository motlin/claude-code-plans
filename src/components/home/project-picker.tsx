// Base UI Popover, not ui/popover: combobox picker, anchored like Add repository.
import {Popover} from "@base-ui/react/popover";
import {Check, ChevronDown, Folder} from "lucide-react";
import {type KeyboardEvent, type Ref, useId, useRef, useState} from "react";

import {useShortcut} from "../../hooks/use-shortcut";
import type {StartProject} from "../../lib/palette-start-session";
import {PLACE_CHIP_CLASS} from "../composer-tokens";
import {MenuSwitch} from "../ui/menu-switch";

/*
 * The home composer's folder picker, copied from claude.ai/code's repository
 * picker: the environment bar's 24px place button opens a 320x360 popover above
 * it with an autofocused search field over a listbox of 24px options. Typing filters by
 * name or path, arrows move the active option, Enter or a click selects it.
 * The cloud-only "Troubleshoot GitHub connection" and "Refresh list" rows have
 * no local equivalent and are omitted.
 */

const POPUP_CLASS =
	"flex h-[360px] max-h-[var(--available-height)] w-[320px] max-w-[calc(100vw-32px)] flex-col rounded-r7 bg-[var(--menu-bg)] p-1 text-[13px]/[19px] text-primary shadow-[var(--menu-shadow)] outline-none";

const SEARCH_CLASS =
	"h-6 w-full shrink-0 rounded-r6 bg-transparent px-2 text-[13px] text-primary shadow-[inset_0_0_0_1px_var(--color-alpha-1)] outline-none placeholder:text-ink-muted focus:shadow-[inset_0_0_0_1px_var(--accent-100),0_0_0_6px_color-mix(in_srgb,var(--accent-100)_20%,transparent)]";

const OPTION_CLASS =
	"flex h-6 shrink-0 cursor-default items-center gap-1 rounded-r5 px-2 select-none data-[highlighted]:bg-fill-ghost-hover";

/** Upstream's compact `Menu.Separator`. */
const SEPARATOR_CLASS = "mx-2 my-1 h-px shrink-0 bg-border";

/** Upstream's compact `Menu.Item` (24px row, 6px gap, r6), as the folder menu footer's Worktree item. */
const WORKTREE_ROW_CLASS =
	"flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-r6 px-2 select-none data-[highlighted]:bg-fill-ghost-hover data-[disabled]:opacity-40 data-[disabled]:pointer-events-none";

/** The start card's "Choose environment" row, which opens the same picker below it. */
const CHOOSE_CLASS =
	"flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-[13px]/5 text-secondary outline-none group-hover/row:bg-fill-ghost-hover group-has-[:focus-visible]/row:bg-fill-ghost-hover group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden";

/** Upstream's CaretDown ink: muted at rest, secondary while the row is hovered, keyboard-focused or open. */
const CHOOSE_CARET_CLASS =
	"size-3 shrink-0 text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary";

/** The folder menu footer's Worktree switch (upstream `zae`), from `useHomeWorktree`. */
export interface ProjectPickerWorktree {
	enabled: boolean;
	supported: boolean;
	set: (enabled: boolean) => void;
	/** The selected folder's git status; false hides the footer, undefined (unknown) shows it. */
	isGitRepo?: boolean | undefined;
}

interface ProjectPickerProps {
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	onSelect: (projectId: string) => void;
	/** `chip` is the composer's combobox chip; `choose` is the start card's "Choose environment" row. */
	variant?: "chip" | "choose";
	/** The trigger button, for callers that move focus to it. */
	triggerRef?: Ref<HTMLButtonElement> | undefined;
	/** Adds upstream's folder menu footer (Separator + Worktree row) while the search is empty. */
	worktree?: ProjectPickerWorktree | undefined;
}

/** Restore focus to the trigger on close unless the selection handler already moved it elsewhere. */
function keepFocusInPopup(popup: HTMLElement | null): boolean {
	const active = document.activeElement;
	return active === null || active === document.body || popup?.contains(active) === true;
}

export function ProjectPicker({
	projects,
	selected,
	onSelect,
	variant = "chip",
	triggerRef,
	worktree,
}: ProjectPickerProps) {
	const baseId = useId();
	const popupRef = useRef<HTMLDivElement>(null);
	const listboxId = `${baseId}-listbox`;
	const searchRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);

	const needle = query.trim().toLowerCase();
	const filtered =
		needle === ""
			? projects
			: projects.filter(
					(p) => p.name.toLowerCase().includes(needle) || p.projectPath.toLowerCase().includes(needle),
				);
	// Upstream shows the footer only while the menu search is empty (`m&&!e`), and only for a git checkout.
	const showFooter = worktree !== undefined && worktree.isGitRepo !== false && needle === "";
	const footerIndex = showFooter ? filtered.length : -1;
	const lastIndex = showFooter ? footerIndex : filtered.length - 1;
	const active = filtered[activeIndex];
	const worktreeRowId = `${baseId}-worktree`;
	const activeDescendant =
		activeIndex === footerIndex ? worktreeRowId : active === undefined ? undefined : `${baseId}-${active.id}`;

	const toggleWorktree = () => {
		if (worktree?.supported !== true) return;
		worktree.set(!worktree.enabled);
	};

	const handleOpenChange = (next: boolean) => {
		if (next) {
			setQuery("");
			setActiveIndex(
				Math.max(
					0,
					projects.findIndex((p) => p.id === selected?.id),
				),
			);
		}
		setOpen(next);
	};

	// Upstream's ⌥⌘0 "New environment"; locally it opens the start card's Choose environment picker.
	useShortcut(
		"new_environment",
		() => {
			handleOpenChange(true);
		},
		{disabled: variant !== "choose"},
	);

	const choose = (project: StartProject | undefined) => {
		if (project === undefined) return;
		onSelect(project.id);
		setOpen(false);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
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
				if (activeIndex === footerIndex) toggleWorktree();
				else choose(active);
				break;
			case " ":
				// Upstream's keepOpen item toggles on Space too; elsewhere Space types into the search.
				if (activeIndex === footerIndex) {
					event.preventDefault();
					toggleWorktree();
				}
				break;
			default:
				break;
		}
	};

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
							<span className="min-w-0 max-w-full truncate">Choose environment</span>
						</span>
						<ChevronDown aria-hidden="true" className={CHOOSE_CARET_CLASS} />
					</Popover.Trigger>
				</div>
			) : (
				<Popover.Trigger
					// oxlint-disable-next-line jsx-a11y/role-has-required-aria-props -- Base UI's Popover.Trigger sets aria-controls to the popup it opens
					role="combobox"
					aria-label={selected === undefined ? "Select project" : `Folder: ${selected.name}`}
					aria-haspopup="dialog"
					aria-expanded={open}
					className={PLACE_CHIP_CLASS}
				>
					<Folder aria-hidden="true" className="-ms-1 size-4 shrink-0" />
					<span className="truncate">{selected?.name ?? "Select project…"}</span>
				</Popover.Trigger>
			)}
			<Popover.Portal>
				<Popover.Positioner
					side={variant === "choose" ? "bottom" : "top"}
					align={variant === "choose" ? "center" : "start"}
					sideOffset={6}
					className="z-[130] outline-none"
				>
					<Popover.Popup
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
							onChange={(event) => {
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
							className="mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto"
						>
							{filtered.length === 0 ? (
								<p className="px-2 py-1 text-ink-muted">No matching projects</p>
							) : (
								filtered.map((p, index) => {
									const isSelected = p.id === selected?.id;
									return (
										// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- an aria-activedescendant option: focus and arrow keys stay in the input that owns the list
										<div
											key={p.id}
											id={`${baseId}-${p.id}`}
											role="option"
											aria-selected={isSelected}
											title={p.projectPath}
											data-highlighted={index === activeIndex ? "" : undefined}
											onMouseEnter={() => {
												setActiveIndex(index);
											}}
											onMouseDown={(event) => {
												event.preventDefault();
											}}
											onClick={() => {
												choose(p);
											}}
											className={OPTION_CLASS}
										>
											<span className="min-w-0 flex-1 truncate">{p.name}</span>
											{isSelected ? (
												<Check
													aria-hidden="true"
													className="size-3.5 shrink-0 text-accent-100"
												/>
											) : null}
										</div>
									);
								})
							)}
							{showFooter ? (
								<>
									<div role="separator" className={SEPARATOR_CLASS} />
									{/* Upstream's footer is a Menu.Item (`role=menuitem`, keepOpen); here it is an option of the activedescendant listbox. */}
									{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- an aria-activedescendant option: Enter and Space are handled by the search input */}
									<div
										id={worktreeRowId}
										role="option"
										aria-selected={false}
										data-testid="environment-bar-worktree"
										data-highlighted={activeIndex === footerIndex ? "" : undefined}
										{...(worktree.supported ? {} : {"aria-disabled": true, "data-disabled": ""})}
										onMouseEnter={() => {
											setActiveIndex(footerIndex);
										}}
										onMouseDown={(event) => {
											event.preventDefault();
										}}
										onClick={toggleWorktree}
										className={WORKTREE_ROW_CLASS}
									>
										<span className="min-w-0 flex-1 truncate">Worktree</span>
										<span className="ms-3 flex shrink-0 items-center gap-1.5">
											<MenuSwitch
												checked={worktree.enabled}
												disabled={!worktree.supported}
												aria-label="Worktree"
											/>
										</span>
									</div>
								</>
							) : null}
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
