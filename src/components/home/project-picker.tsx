// Base UI Popover, not ui/popover: combobox picker, anchored like Add repository.
import {Popover} from "@base-ui/react/popover";
import {Check, ChevronDown, Folder} from "lucide-react";
import {type KeyboardEvent, type Ref, useId, useRef, useState} from "react";

import {useShortcut} from "../../hooks/use-shortcut";
import type {StartProject} from "../../lib/palette-start-session";
import {PLACE_CHIP_CLASS} from "../composer-tokens";

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

/** The start card's "Choose environment" row, which opens the same picker below it. */
const CHOOSE_CLASS =
	"group/choose flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px]/5 text-secondary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

interface ProjectPickerProps {
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	onSelect: (projectId: string) => void;
	/** `chip` is the composer's combobox chip; `choose` is the start card's "Choose environment" row. */
	variant?: "chip" | "choose";
	/** The trigger button, for callers that move focus to it. */
	triggerRef?: Ref<HTMLButtonElement> | undefined;
}

/** Restore focus to the trigger on close unless the selection handler already moved it elsewhere. */
function keepFocusInPopup(popup: HTMLElement | null): boolean {
	const active = document.activeElement;
	return active === null || active === document.body || popup?.contains(active) === true;
}

export function ProjectPicker({projects, selected, onSelect, variant = "chip", triggerRef}: ProjectPickerProps) {
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
	const active = filtered[activeIndex];

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
				setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
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

	return (
		<Popover.Root open={open} onOpenChange={handleOpenChange}>
			{variant === "choose" ? (
				<Popover.Trigger ref={triggerRef} aria-haspopup="dialog" aria-expanded={open} className={CHOOSE_CLASS}>
					<span className="truncate">Choose environment</span>
					<ChevronDown
						aria-hidden="true"
						className="size-3 shrink-0 text-ink-muted transition-colors group-hover/choose:text-secondary"
					/>
				</Popover.Trigger>
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
							aria-activedescendant={active === undefined ? undefined : `${baseId}-${active.id}`}
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
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
