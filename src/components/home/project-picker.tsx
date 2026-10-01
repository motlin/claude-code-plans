import {Popover} from "@base-ui/react/popover";
import {Check, ChevronDown, Folder} from "lucide-react";
import {type KeyboardEvent, useId, useRef, useState} from "react";

import type {StartProject} from "../../lib/palette-start-session";

/*
 * The home composer's project chip, copied from claude.ai/code's repository
 * picker: a 24px combobox chip that opens a 320x360 popover above it with an
 * autofocused search field over a listbox of 24px options. Typing filters by
 * name or path, arrows move the active option, Enter or a click selects it.
 * The cloud-only "Troubleshoot GitHub connection" and "Refresh list" rows have
 * no local equivalent and are omitted.
 */

const CHIP_CLASS =
	"flex h-6 max-w-[240px] min-w-0 items-center gap-1.5 rounded-r6 bg-surface-3 px-1.5 text-[13px] text-secondary shadow-[inset_0_0_0_1px_var(--color-alpha-1),0_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

const POPUP_CLASS =
	"flex h-[360px] max-h-[var(--available-height)] w-[320px] max-w-[calc(100vw-32px)] flex-col rounded-r7 bg-[var(--menu-bg)] p-1 text-[13px]/[19px] text-primary shadow-[var(--menu-shadow)] outline-none";

const SEARCH_CLASS =
	"h-6 w-full shrink-0 rounded-r6 bg-transparent px-2 text-[13px] text-primary shadow-[inset_0_0_0_1px_var(--color-alpha-1)] outline-none placeholder:text-ink-muted focus:shadow-[inset_0_0_0_1px_var(--accent-100),0_0_0_6px_color-mix(in_srgb,var(--accent-100)_20%,transparent)]";

const OPTION_CLASS =
	"flex h-6 shrink-0 cursor-default items-center gap-1 rounded-r5 px-2 select-none data-[highlighted]:bg-fill-ghost-hover";

interface ProjectPickerProps {
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	onSelect: (projectId: string) => void;
}

export function ProjectPicker({projects, selected, onSelect}: ProjectPickerProps) {
	const baseId = useId();
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
			<Popover.Trigger
				role="combobox"
				aria-label="Select project"
				aria-haspopup="dialog"
				aria-expanded={open}
				className={CHIP_CLASS}
			>
				<Folder aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="truncate">{selected?.name ?? "+ Select project…"}</span>
				<ChevronDown aria-hidden="true" className="size-3 shrink-0" />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side="top" align="start" sideOffset={6} className="z-[130] outline-none">
					<Popover.Popup initialFocus={searchRef} className={POPUP_CLASS}>
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
										<div
											key={p.id}
											id={`${baseId}-${p.id}`}
											role="option"
											aria-selected={isSelected}
											title={p.projectPath}
											data-highlighted={index === activeIndex ? "" : undefined}
											onMouseEnter={() => setActiveIndex(index)}
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => choose(p)}
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
