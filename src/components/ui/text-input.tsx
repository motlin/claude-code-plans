/*
 * Upstream's cds `Field` (shared-frame `$_`) and `TextInput` (`Ef`).
 *
 * Copied: the class strings (`fG`, `uk`/`fT`, `Q2`, `zv`, `t5`, `Ab`, `a0`, `ZD`, `HG`), the slot form (a painted
 * wrapper with start/end slots around a bare `cds-input`) and the bare form (one input carrying the shell), the
 * click-to-focus wrapper, the nested ghost Clear (`clearable` true or "always"; untabbable and mousedown-guarded
 * while it has something to clear), Escape-to-clear after the consumer's handler, and the Field's
 * `data-invalid` / `data-filled` with `aria-invalid` on the input.
 *
 * `Field` is Base UI's Field.Root (validationMode "onBlur" by default) rendering a div that provides
 * `{invalid, disabled}` to the TextInput (upstream `Tb` / `Hr`); the TextInput's input is a Field.Control, so
 * the Field tracks filled/focused/touched/dirty and labels/describes the input. `size` sets `data-size`
 * (not "base") and shrinks the nested Clear to xs under sm/xs; `fullWidth` (default on) adds the width.
 *
 * Local tokens: upstream's `--cds-radius` is `--upstream-radius`, its stays-secondary slot ink is
 * `text-secondary` and its `placeholder:text-muted` is `placeholder:text-ink-muted`. Upstream's tailwind-merge
 * only matters here for a consumer width, so a `w-*` className drops `w-full`.
 */
import {Field as BaseField} from "@base-ui/react/field";
import {
	type ChangeEvent,
	type ComponentProps,
	createContext,
	type HTMLAttributes,
	type InputHTMLAttributes,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	type Ref,
	useContext,
	useRef,
	useState,
} from "react";

import {Icon} from "./icon";

const FIELD_CLASS = "flex flex-col gap-xs font-sans";

interface FieldState {
	invalid: boolean;
	disabled: boolean;
}

/** Upstream `Hr`: the Field's invalid/disabled state for the TextInput inside it. */
const FieldStateContext = createContext<FieldState | null>(null);

/** Upstream `pb`: one stable state object per (disabled, invalid) pair. */
const FIELD_STATES = {
	false: {false: {invalid: false, disabled: false}, true: {invalid: true, disabled: false}},
	true: {false: {invalid: false, disabled: true}, true: {invalid: true, disabled: true}},
} as const;

/** Upstream `Tb`: Field.Root's render, a div under the state provider. */
function renderField(props: HTMLAttributes<HTMLDivElement>, state: BaseField.Root.State) {
	return (
		<FieldStateContext value={FIELD_STATES[`${state.disabled}`][`${state.valid === false}`]}>
			<div {...props} />
		</FieldStateContext>
	);
}

/** Upstream `$_`: cds Field, Base UI Field.Root. */
export function Field({className, validationMode = "onBlur", ...props}: ComponentProps<typeof BaseField.Root>) {
	return (
		<BaseField.Root
			data-cds="Field"
			validationMode={validationMode}
			{...props}
			className={typeof className === "string" ? `${FIELD_CLASS} ${className}` : FIELD_CLASS}
			render={renderField}
		/>
	);
}

/** Upstream `fG`: the field paint. */
const FIELD_PAINT = "bg-fill-field shadow-field-ring data-[invalid]:shadow-field-invalid";
/** Upstream `Ab`: the hover ring, off while focused, invalid or disabled. */
const FIELD_HOVER =
	"[&:hover:not(:focus-visible):not(:has(:focus-visible)):not([data-invalid]):not([data-disabled])]:shadow-field-hover";
/** Upstream `uk` / `fT`: the TextInput shell. */
const TEXT_INPUT_SHELL = `h-control ps-md rounded ${FIELD_PAINT} font-sans text-body font-normal text-primary transition duration-fast`;
/** Upstream `HG`: the end inset while a nested control sits there. */
const NESTED_END_PAD = "pe-[calc((var(--cds-h-control)-var(--cds-h-control-nested))/2)]";
/** Upstream `ZD`. */
const SOLID_END_BUTTON_PAD =
	"has-[[data-cds-end-slot]_[data-cds=Button]:not([data-cds-ghost])]:pe-[calc((var(--cds-h-control)-var(--cds-h-control-nested))/2)]";
/** Upstream `zv` (slot form) and `t5` (bare form) focus rings. */
const FOCUS_WITHIN = "has-[:focus-visible]:shadow-focus data-[invalid]:has-[:focus-visible]:shadow-focus-danger";
const FOCUS_SELF = "focus-visible:shadow-focus data-[invalid]:focus-visible:shadow-focus-danger";
/** Upstream `Q2`, with the slot form's `disabled:opacity-100` (the wrapper dims instead). */
const SLOT_INPUT_CLASS =
	"cds-input cds-reset min-w-0 flex-1 h-full bg-transparent border-0 p-0 outline-none focus-visible:outline-hidden text-body font-normal text-primary focus-visible:shadow-none placeholder:text-ink-muted disabled:opacity-100";
/** Upstream `qf`: the slots' stays-secondary ink. */
const SLOT_INK = "text-secondary";
/** Upstream `a0`: sizes a solid button nested in the end slot. */
const NESTED_BUTTON_SIZING =
	"[&_[data-cds=Button]:not([data-cds-ghost])]:h-[var(--fhn)] [&_[data-cds=Button]:not([data-cds-ghost])]:rounded-[calc(var(--fr)-(var(--fh)-var(--fhn))/2)] [&_[data-cds=Button][data-cds-icon-only]:not([data-cds-ghost])]:w-[var(--fhn)]";
const END_SLOT_CLASS = `flex shrink-0 items-center gap-[var(--cds-pad-sm,6px)] ${SLOT_INK} [--fh:var(--cds-h-control)] [--fr:var(--upstream-radius)] [--fhn:var(--cds-h-control-nested)] ${NESTED_BUTTON_SIZING}`;
/** Upstream `ta`: a non-base size is marked with `data-size`. */
function sizeAttr(size: TextInputSize | undefined) {
	return size !== undefined && size !== "base" ? {"data-size": size} : {};
}

/** Upstream's sm ghost icon-only Button with the nested `!size-[var(--fhn)]` / radius overrides. */
export const TEXT_INPUT_CLEAR_CLASS =
	"flex shrink-0 items-center justify-center size-[var(--fhn)] rounded-[calc(var(--fr)-(var(--fh)-var(--fhn))/2)] text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's tailwind-merge drops `w-full` under a consumer width such as Customize's `w-64`. */
function withConsumer(base: string, className: string | undefined): string {
	if (className === undefined || className === "") return base;
	const sized = className.split(" ").some((name) => name.startsWith("w-"));
	const kept = sized ? base.split(" ").filter((name) => name !== "w-full") : base.split(" ");
	return [...kept, className].join(" ");
}

function preventMouseDown(event: MouseEvent) {
	event.preventDefault();
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
	if (typeof ref === "function") ref(value);
	else if (ref) ref.current = value;
}

export type TextInputSize = "xs" | "sm" | "base" | "lg";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
	ref?: Ref<HTMLInputElement>;
	size?: TextInputSize;
	/** Fill the container (default); off leaves the width to the consumer. */
	fullWidth?: boolean;
	slotStart?: ReactNode;
	slotEnd?: ReactNode;
	/** Offer Clear while there is a value, or always ("always"). */
	clearable?: boolean | "always";
	clearLabel?: string;
	onClear?: () => void;
}

export function TextInput({
	ref,
	className,
	size,
	fullWidth = true,
	slotStart,
	slotEnd,
	clearable = false,
	clearLabel = "Clear",
	onClear,
	onChange,
	onKeyDown,
	id,
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalidProp,
	disabled: disabledProp,
	...props
}: TextInputProps) {
	const field = useContext(FieldStateContext);
	const fieldInvalid = field?.invalid ?? false;
	const control = {id, "aria-describedby": ariaDescribedBy, disabled: disabledProp};
	const inputRef = useRef<HTMLInputElement | null>(null);
	const clearingEscape = useRef(false);
	const controlled = props.value !== undefined;
	const [uncontrolledFilled, setUncontrolledFilled] = useState(
		() => props.defaultValue !== undefined && String(props.defaultValue).length > 0,
	);
	const filled = controlled ? String(props.value).length > 0 : uncontrolledFilled;
	const disabled = disabledProp === true || (field?.disabled ?? false);
	const ariaInvalid = fieldInvalid || ariaInvalidProp;

	const setRef = (element: HTMLInputElement | null) => {
		inputRef.current = element;
		assignRef(ref, element);
	};

	const change = (event: ChangeEvent<HTMLInputElement>) => {
		if (clearable !== false && !controlled) setUncontrolledFilled(event.target.value.length > 0);
		onChange?.(event);
	};

	const clear = () => {
		const input = inputRef.current;
		if (!controlled && input) {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "");
			input.dispatchEvent(new Event("input", {bubbles: true}));
			setUncontrolledFilled(false);
		}
		onClear?.();
		input?.focus();
	};

	const showClear = (clearable === "always" || (clearable && filled)) && !disabled;
	// Clear only stays out of the tab order (and owns Escape) while it has something to clear.
	const clearsValue = showClear && filled && (!controlled || onClear !== undefined) && props.readOnly !== true;

	const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		onKeyDown?.(event);
		if (event.key === "Escape" && !event.repeat) clearingEscape.current = false;
		if (
			event.key !== "Escape" ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			event.shiftKey ||
			event.nativeEvent.isComposing ||
			// oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME keydowns only as keyCode 229, as upstream checks
			event.nativeEvent.keyCode === 229 ||
			event.defaultPrevented ||
			event.isPropagationStopped()
		) {
			return;
		}
		const stop = () => {
			event.preventDefault();
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation();
		};
		if (event.repeat) {
			if (clearingEscape.current) stop();
			return;
		}
		clearingEscape.current = clearsValue && event.currentTarget.value !== "";
		if (clearingEscape.current) {
			stop();
			clear();
		}
	};

	if (slotStart === undefined && slotEnd === undefined && clearable === false) {
		return (
			<BaseField.Control
				ref={setRef}
				{...control}
				render={
					<input
						data-cds="TextInput"
						{...sizeAttr(size)}
						data-invalid={fieldInvalid ? "" : undefined}
						aria-invalid={ariaInvalid}
						{...props}
						onChange={change}
						onKeyDown={keyDown}
						className={withConsumer(
							`cds-input cds-reset ${TEXT_INPUT_SHELL} pe-md${fullWidth ? " w-full" : ""} placeholder:text-ink-muted outline-none focus-visible:outline-hidden enabled:[&:hover:not(:focus):not([data-invalid])]:shadow-field-hover disabled:opacity-disabled ${FOCUS_SELF}`,
							className,
						)}
					/>
				}
			/>
		);
	}

	const clearButton = showClear ? (
		<button
			type="button"
			data-cds="Button"
			data-cds-ghost=""
			data-cds-icon-only=""
			data-size={size === "sm" || size === "xs" ? "xs" : "sm"}
			aria-label={clearLabel}
			tabIndex={clearsValue ? -1 : undefined}
			onMouseDown={preventMouseDown}
			onClick={clear}
			className={TEXT_INPUT_CLEAR_CLASS}
		>
			<Icon name="X" size="auto" />
		</button>
	) : null;

	const shell = withConsumer(
		[
			TEXT_INPUT_SHELL,
			clearButton === null ? "pe-md" : NESTED_END_PAD,
			SOLID_END_BUTTON_PAD,
			fullWidth ? "inline-flex w-full min-w-0" : "inline-flex",
			disabled ? "cursor-default" : "cursor-text",
			"items-center gap-[var(--cds-pad-sm,6px)]",
			FOCUS_WITHIN,
			"has-[input:disabled]:opacity-disabled",
			...(disabled ? [] : [FIELD_HOVER]),
		].join(" "),
		className,
	);

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- upstream's click-to-focus; the input inside is the keyboard control
		<div
			data-cds="TextInput"
			{...sizeAttr(size)}
			data-invalid={fieldInvalid ? "" : undefined}
			onMouseDown={(event) => {
				const input = inputRef.current;
				if (disabled || input === null || event.target === input) return;
				if (event.target instanceof Element && event.target.closest("button, a, input, [role=button]") !== null)
					return;
				event.preventDefault();
				input.focus();
			}}
			className={shell}
		>
			{slotStart !== undefined && <span className={`flex shrink-0 items-center ${SLOT_INK}`}>{slotStart}</span>}
			<BaseField.Control
				{...control}
				render={
					<input
						ref={setRef}
						aria-invalid={ariaInvalid}
						{...props}
						onChange={change}
						onKeyDown={keyDown}
						className={SLOT_INPUT_CLASS}
					/>
				}
			/>
			{(clearButton !== null || slotEnd !== undefined) && (
				<span data-cds-end-slot="" className={END_SLOT_CLASS}>
					{slotEnd}
					{clearButton}
				</span>
			)}
		</div>
	);
}
