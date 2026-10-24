import {Select as BaseSelect} from "@base-ui/react/select";
import {Check, ChevronDown} from "lucide-react";
import {useId} from "react";

/*
 * Upstream's cds Select: its Combobox (`u5`) in `mode:"select"` with `searchable:false`, a labelled
 * outline trigger with a CaretDown, and a popover listbox whose selected row carries a bold check.
 * Local mapping: h-control is h-8, the comfortable radius is rounded-r6, pad-sm/md are 2/3,
 * opacity-disabled is opacity-50 and duration-fast is Tailwind's default transition.
 */

/** Upstream's `gap-xs flex-col font-sans` field around the label and trigger. */
const FIELD_CLASS = "flex w-full flex-col gap-1.5 font-sans";
const LABEL_CLASS = "text-body text-primary font-medium leading-none";
/** Upstream's `y$ Gv.outline tt.select pe-sm w-full min-w-0`. */
const CONTROL_CLASS =
	"group/cbx inline-flex items-center gap-1.5 h-8 rounded-r6 font-sans text-body font-normal text-primary outline-none transition data-[disabled]:opacity-50 data-[disabled]:pointer-events-none bg-fill-field shadow-field-ring [&:hover:not(:has(:focus-visible)):not([data-disabled])]:shadow-field-hover ps-0 has-[:focus-visible]:shadow-focus pe-2 w-full min-w-0";
/** Upstream's `JR`: the trigger button fills the control. */
const TRIGGER_CLASS =
	"flex min-w-0 flex-1 items-center gap-1.5 self-stretch ps-2 text-start border-0 bg-transparent p-0 outline-none focus-visible:outline-hidden";
const CARET_CLASS = "me-0.5 size-4 shrink-0 text-muted-as-secondary transition-colors group-hover/cbx:text-secondary";
/** Upstream's popover popup (`oe` + `Yv`), as wide as the trigger and at least 12rem. */
const POPUP_CLASS =
	"flex w-[var(--anchor-width)] min-w-[12rem] max-h-[min(var(--available-height,100dvh),320px)] flex-col rounded-[calc(var(--radius-r6)+0.25rem)] bg-[var(--menu-bg)] text-body font-normal text-primary shadow-[var(--menu-shadow)] outline-none data-[anchor-hidden]:invisible";
const LIST_CLASS = "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto rounded-[inherit] p-1 outline-none";
/** Upstream's `vE` row. */
const ITEM_CLASS =
	"group/cbx-item flex w-full items-center gap-2 min-h-8 px-3 py-1 rounded-r6 text-body font-normal text-primary select-none outline-none data-[highlighted]:bg-fill-ghost-hover data-[disabled]:opacity-50 data-[disabled]:pointer-events-none";

export interface SelectItem<T extends string> {
	value: T;
	label: string;
}

export interface SelectProps<T extends string> {
	label: string;
	items: readonly SelectItem<T>[];
	value: T;
	onChange: (value: T) => void;
	disabled?: boolean;
}

export function Select<T extends string>({label, items, value, onChange, disabled = false}: SelectProps<T>) {
	const triggerId = useId();
	return (
		<div className={FIELD_CLASS}>
			<label htmlFor={triggerId} className={LABEL_CLASS}>
				{label}
			</label>
			<BaseSelect.Root
				items={items}
				value={value}
				disabled={disabled}
				onValueChange={(next) => {
					const item = items.find((candidate) => candidate.value === next);
					if (item !== undefined) onChange(item.value);
				}}
			>
				<div data-cds="Combobox" data-disabled={disabled ? "" : undefined} className={CONTROL_CLASS}>
					<BaseSelect.Trigger id={triggerId} className={TRIGGER_CLASS}>
						<BaseSelect.Value className="min-w-0 flex-1 truncate" />
						<ChevronDown aria-hidden="true" strokeWidth={2} className={CARET_CLASS} />
					</BaseSelect.Trigger>
				</div>
				<BaseSelect.Portal>
					<BaseSelect.Positioner
						className="z-[130] outline-none"
						side="bottom"
						align="start"
						sideOffset={4}
						alignItemWithTrigger={false}
					>
						<BaseSelect.Popup data-cds="Combobox" className={POPUP_CLASS}>
							<BaseSelect.List className={LIST_CLASS}>
								{items.map((item) => (
									<BaseSelect.Item key={item.value} value={item.value} className={ITEM_CLASS}>
										<BaseSelect.ItemText className="min-w-0 flex-1 truncate">
											{item.label}
										</BaseSelect.ItemText>
										<BaseSelect.ItemIndicator className="shrink-0 text-fill-accent">
											<Check aria-hidden="true" strokeWidth={3} className="size-4" />
										</BaseSelect.ItemIndicator>
									</BaseSelect.Item>
								))}
							</BaseSelect.List>
						</BaseSelect.Popup>
					</BaseSelect.Positioner>
				</BaseSelect.Portal>
			</BaseSelect.Root>
		</div>
	);
}
