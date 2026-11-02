import {Check, ChevronDown} from "lucide-react";
import {type CSSProperties, type KeyboardEvent, useEffect, useId, useRef, useState} from "react";

import {useSettingsRowIds} from "./settings-row-context";
import {POPUP_LIST_GUTTER_CLASS, POPUP_LIST_SCROLL_CLASS, POPUP_LISTBOX_CLASS} from "../ui/popup-list-classes";

/*
 * The claude.ai/code settings Combobox: a full-width 32px trigger whose popup
 * holds a filter input over a listbox with a check on the current option.
 * Typing narrows the options and clears the active option until an arrow
 * key moves onto a match; Enter selects the active option and closes. Selection applies immediately (no Save),
 * and choosing the current value is ignored (upstream `U`'s onChange guard). In the field look Escape is left
 * to bubble so, as upstream, it also closes the surrounding Settings dialog. A short list (Code font size) drops
 * the filter (`filterable={false}`): the listbox itself takes focus and the arrow keys. The `ghost` variant is
 * upstream's borderless fizzy `type` trigger (cebb16f99 `U` over `E8`), whose popup is w-56 and aligned to the
 * trigger's end edge; its Escape closes only the popup and refocuses the trigger.
 */

interface ComboboxOption<T extends string>
{
	value: T;
	label: string;
	/** Shown (and checked when current) but not selectable, like upstream's uninstalled output style. */
	disabled?: boolean;
	/** Inline style for the option's label (a font option set in its own family). */
	labelStyle?: CSSProperties;
}

interface ThemedComboboxProps<T extends string>
{
	value: T;
	onValueChange: (value: T) => void;
	options: ReadonlyArray<ComboboxOption<T>>;
	"aria-label": string;
	className?: string;
	disabled?: boolean;
	/** False drops the popup's filter input, for a short fixed list. */
	filterable?: boolean;
	variant?: "field" | "ghost";
	/** Trigger text in place of the current option's label ("Default · 13 px"). */
	triggerLabel?: string;
}

export function ThemedCombobox<T extends string>({
	value,
	onValueChange,
	options,
	"aria-label": ariaLabel,
	className,
	disabled = false,
	filterable = true,
	variant = "field",
	triggerLabel,
}: ThemedComboboxProps<T>)
{
	const row = useSettingsRowIds();
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listboxRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);

	const ghost = variant === "ghost";
	const needle = filterable ? query.trim().toLowerCase() : "";
	const filtered = options.filter((option) => option.label.toLowerCase().includes(needle));
	const current = options.find((option) => option.value === value);

	useEffect(() =>
	{
		if (!open) return undefined;
		const handlePointerDown = (event: PointerEvent | MouseEvent) =>
		{
			if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
			setOpen(false);
		};
		if (!filterable) listboxRef.current?.focus();
		document.addEventListener("mousedown", handlePointerDown);
		return () =>
		{
			document.removeEventListener("mousedown", handlePointerDown);
		};
	}, [open, filterable]);

	const openPopup = () =>
	{
		setQuery("");
		setActiveIndex(
			Math.max(
				0,
				options.findIndex((option) => option.value === value),
			),
		);
		setOpen(true);
	};

	const choose = (option: ComboboxOption<T> | undefined) =>
	{
		if (option === undefined || option.disabled === true) return;
		if (option.value !== value) onValueChange(option.value);
		setOpen(false);
		triggerRef.current?.focus();
	};

	const handleListKeyDown = (event: KeyboardEvent<HTMLElement>) =>
	{
		switch (event.key)
		{
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
				if (ghost)
				{
					event.preventDefault();
					event.stopPropagation();
				}
				setOpen(false);
				if (ghost || !filterable) triggerRef.current?.focus();
				break;
			default:
				break;
		}
	};

	const activeOption = filtered[activeIndex];
	const activeDescendant = activeOption === undefined ? undefined : `${baseId}-${activeOption.value}`;

	return (
		<div
			ref={rootRef}
			data-cds="Combobox"
			className={
				ghost
					? `group/cbx relative inline-flex items-center gap-1.5 h-8 rounded-r6 bg-transparent hover:bg-fill-ghost-hover aria-expanded:bg-fill-ghost-hover has-[[aria-expanded=true]]:bg-fill-ghost-hover ps-0 pe-2 has-[:focus-visible]:shadow-focus shrink-0${className === undefined ? "" : ` ${className}`}`
					: `relative ${className ?? "w-56"}`
			}
		>
			<button
				ref={triggerRef}
				type="button"
				role="combobox"
				aria-label={ariaLabel}
				aria-describedby={row?.descriptionId}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listboxId : undefined}
				aria-disabled={disabled ? true : undefined}
				disabled={disabled}
				onClick={() =>
				{
					if (open) setOpen(false);
					else openPopup();
				}}
				onKeyDown={(event) =>
				{
					if (event.key === "ArrowDown" && !open)
					{
						event.preventDefault();
						openPopup();
					}
				}}
				className={
					ghost
						? "flex h-8 min-w-0 flex-1 items-center gap-1.5 ps-2 text-start bg-transparent text-body text-primary outline-none disabled:opacity-50 hide-focus-ring focus-visible:outline-hidden"
						: "flex h-8 w-full items-center justify-between gap-2 rounded-r6 border border-border bg-[var(--settings-field-bg)] pr-2 pl-3 text-left text-body text-primary outline-none enabled:hover:bg-fill-ghost-hover disabled:opacity-50 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
				}
			>
				<span className={ghost ? "min-w-0 flex-1 truncate" : "min-w-0 truncate"}>
					{triggerLabel ?? current?.label ?? value}
				</span>
				<ChevronDown
					aria-hidden="true"
					className={
						ghost
							? "size-4 me-0.5 shrink-0 text-[var(--settings-muted)] group-hover/cbx:text-secondary"
							: "size-4 shrink-0 text-[var(--settings-muted)]"
					}
				/>
			</button>
			{open ? (
				<div
					className={`absolute top-full z-[140] mt-1 flex max-h-72 flex-col rounded-card bg-[var(--menu-bg)] shadow-[var(--menu-shadow)] ${ghost ? "end-0 w-56" : "left-0 w-full min-w-[12rem]"}`}
				>
					{filterable ? (
						<div className="border-b border-subtle p-1">
							<input
								type="search"
								autoFocus
								aria-label={ariaLabel}
								aria-controls={listboxId}
								aria-activedescendant={activeDescendant}
								value={query}
								onChange={(event) =>
								{
									setQuery(event.target.value);
									setActiveIndex(-1);
								}}
								onKeyDown={handleListKeyDown}
								className="h-8 w-full rounded-r6 bg-transparent px-2.5 text-body text-primary outline-none"
							/>
						</div>
					) : null}
					<div className={POPUP_LIST_GUTTER_CLASS}>
						<div data-cds-sheet-scroll="" className={POPUP_LIST_SCROLL_CLASS}>
							<div
								ref={listboxRef}
								id={listboxId}
								role="listbox"
								aria-label={ariaLabel}
								tabIndex={filterable ? undefined : -1}
								aria-activedescendant={filterable ? undefined : activeDescendant}
								onKeyDown={filterable ? undefined : handleListKeyDown}
								className={POPUP_LISTBOX_CLASS}
							>
								{filtered.length === 0 ? (
									<div className="px-2.5 py-1.5 text-body text-[var(--settings-muted)]">
										No results
									</div>
								) : (
									filtered.map((option, index) =>
									{
										const selected = option.value === value;
										return (
											// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- an aria-activedescendant option: focus and arrow keys stay in the input that owns the list
											<div
												key={option.value}
												id={`${baseId}-${option.value}`}
												role="option"
												aria-selected={selected}
												aria-disabled={option.disabled === true ? true : undefined}
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
													choose(option);
												}}
												className="flex h-8 cursor-default items-center gap-1 rounded-r6 px-2.5 text-body text-primary select-none data-[highlighted]:bg-fill-ghost-hover aria-disabled:opacity-50"
											>
												<span className="min-w-0 flex-1 truncate" style={option.labelStyle}>
													{option.label}
												</span>
												<span className="-mr-1 flex size-5 shrink-0 items-center justify-center">
													{selected ? <Check aria-hidden="true" className="size-4" /> : null}
												</span>
											</div>
										);
									})
								)}
							</div>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
