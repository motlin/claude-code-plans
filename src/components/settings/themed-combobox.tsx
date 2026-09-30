import {Check, ChevronDown} from "lucide-react";
import {type KeyboardEvent, useEffect, useId, useRef, useState} from "react";

import {useSettingsRowIds} from "./settings-row";

/*
 * The claude.ai/code settings Combobox: a full-width 32px trigger whose popup
 * holds a filter input over a listbox with a check on the current option.
 * Typing narrows the options, arrows move the active option, Enter selects
 * it and closes. Selection applies immediately (no Save). Escape is left to
 * bubble so, as upstream, it also closes the surrounding Settings dialog.
 */

interface ComboboxOption<T extends string> {
	value: T;
	label: string;
}

interface ThemedComboboxProps<T extends string> {
	value: T;
	onValueChange: (value: T) => void;
	options: ReadonlyArray<ComboboxOption<T>>;
	"aria-label": string;
	className?: string;
}

export function ThemedCombobox<T extends string>({
	value,
	onValueChange,
	options,
	"aria-label": ariaLabel,
	className,
}: ThemedComboboxProps<T>) {
	const row = useSettingsRowIds();
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);

	const needle = query.trim().toLowerCase();
	const filtered = options.filter((option) => option.label.toLowerCase().includes(needle));
	const current = options.find((option) => option.value === value);

	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent | MouseEvent) => {
			if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [open]);

	const openPopup = () => {
		setQuery("");
		setActiveIndex(
			Math.max(
				0,
				options.findIndex((option) => option.value === value),
			),
		);
		setOpen(true);
	};

	const choose = (option: ComboboxOption<T> | undefined) => {
		if (option === undefined) return;
		onValueChange(option.value);
		setOpen(false);
		triggerRef.current?.focus();
	};

	const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
				choose(filtered[activeIndex]);
				break;
			case "Escape":
				setOpen(false);
				break;
			default:
				break;
		}
	};

	const activeOption = filtered[activeIndex];

	return (
		<div ref={rootRef} className={`relative ${className ?? "w-56"}`}>
			<button
				ref={triggerRef}
				type="button"
				role="combobox"
				aria-label={ariaLabel}
				aria-describedby={row?.descriptionId}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listboxId : undefined}
				onClick={() => (open ? setOpen(false) : openPopup())}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown" && !open) {
						event.preventDefault();
						openPopup();
					}
				}}
				className="flex h-8 w-full items-center justify-between gap-2 rounded-r6 border border-border bg-[var(--settings-field-bg)] pr-2 pl-3 text-left text-body text-primary outline-none hover:bg-fill-ghost-hover focus-visible:ring-2 focus-visible:ring-accent-100/40"
			>
				<span className="min-w-0 truncate">{current?.label ?? value}</span>
				<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--settings-muted)]" />
			</button>
			{open ? (
				<div className="absolute top-full left-0 z-[140] mt-1 flex max-h-72 w-full min-w-[12rem] flex-col rounded-card bg-[var(--menu-bg)] shadow-[var(--menu-shadow)]">
					<div className="border-b border-subtle p-1">
						<input
							type="search"
							autoFocus
							aria-label={`Search ${ariaLabel}`}
							aria-controls={listboxId}
							aria-activedescendant={
								activeOption === undefined ? undefined : `${baseId}-${activeOption.value}`
							}
							placeholder="Search…"
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setActiveIndex(0);
							}}
							onKeyDown={handleSearchKeyDown}
							className="h-8 w-full rounded-r6 bg-transparent px-2.5 text-body text-primary outline-none placeholder:text-[var(--settings-muted)]"
						/>
					</div>
					<div id={listboxId} role="listbox" aria-label={ariaLabel} className="min-h-0 overflow-y-auto p-1">
						{filtered.length === 0 ? (
							<div className="px-2.5 py-1.5 text-body text-[var(--settings-muted)]">No matches</div>
						) : (
							filtered.map((option, index) => {
								const selected = option.value === value;
								return (
									<div
										key={option.value}
										id={`${baseId}-${option.value}`}
										role="option"
										aria-selected={selected}
										data-highlighted={index === activeIndex ? "" : undefined}
										onMouseEnter={() => setActiveIndex(index)}
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => choose(option)}
										className="flex h-8 cursor-default items-center gap-1 rounded-r6 px-2.5 text-body text-primary select-none data-[highlighted]:bg-fill-ghost-hover"
									>
										<span className="min-w-0 flex-1 truncate">{option.label}</span>
										<span className="-mr-1 flex size-5 shrink-0 items-center justify-center">
											{selected ? <Check aria-hidden="true" className="size-4" /> : null}
										</span>
									</div>
								);
							})
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
