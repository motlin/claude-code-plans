import {RotateCcw} from "lucide-react";
import {useId, useState, type KeyboardEvent, type SubmitEvent, type ReactNode} from "react";

import {
	elicitationFormDefaults,
	fieldLabel,
	isMultiSelect,
	parseElicitationForm,
	schemaText,
	validateFieldValue,
	type ElicitationFieldSchema,
	type ElicitationFormSchema,
	type ElicitationValue,
} from "../lib/elicitation-form";
import {asRecord} from "../lib/narrow";
import {APPROVAL_CARD_TITLE, ApprovalActionButton, ApprovalCardShell} from "./approval-card";

/*
 * Upstream's MCP elicitation form card (`rs` in cc32965c2, fields from
 * `ElicitationField` in c9e77b76c). Upstream draws it only for cloud sessions
 * behind flag `__gb__1345712912`; locally nothing docks it until the CLI dialog
 * can be typed into field by field (elicitation-form-card-herdr-typing).
 */

export type ElicitationAnswer = {action: "accept"; content: Record<string, unknown>} | {action: "decline"};

/** Upstream's `kE`: server text is capped at 4000 characters. */
const TEXT_MAX = 4000;
/** Upstream draws a required oneOf with at most this many described options as radios. */
const RADIO_MAX = 8;

const MUTED = "text-body text-muted-as-secondary";
const CONTROL =
	"w-full min-w-0 rounded-r6 bg-fill-field px-2 text-body text-primary shadow-field-ring outline-none transition hover:shadow-field-hover focus-visible:shadow-focus disabled:opacity-50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-danger-000)]";
const INPUT = `${CONTROL} h-8`;
const TEXTAREA = `${CONTROL} min-h-8 resize-none py-[6px] [field-sizing:content]`;

type FieldValue = ElicitationValue | undefined;

/** Upstream's `ns`: Esc never declines the form, unless an IME is composing. */
function swallowEscape(event: KeyboardEvent<HTMLDivElement>) {
	// oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME keydowns only as keyCode 229, as upstream checks
	if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
		event.preventDefault();
	}
}

/** Upstream's `pe`: an RFC 3339 date-time as a `datetime-local` value in local time. */
function datetimeLocal(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
	const pad = (part: number) => String(part).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function initialFieldValue(field: ElicitationFieldSchema, value: FieldValue): FieldValue {
	if (typeof value !== "string") return value;
	if (field["format"] === "date-time") return datetimeLocal(value);
	return field["format"] === "date" ? value.slice(0, 10) : value;
}

/** Upstream's dirty check: empty values (and an untouched unchecked checkbox) compare equal. */
function valueKey(value: FieldValue, boolean: boolean, initial: FieldValue): string {
	if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "__empty__";
	if (boolean && initial === undefined && value === false) return "__empty__";
	return JSON.stringify(Array.isArray(value) ? value.toSorted() : value);
}

interface Option {
	value: string;
	label: string;
	description?: string;
}

function cappedText(value: unknown): string {
	return schemaText(value).trim().slice(0, TEXT_MAX);
}

/** Upstream's `he`: a multi-select's options from items.anyOf or items.enum. */
function multiOptions(field: ElicitationFieldSchema): Option[] {
	const items = asRecord(field["items"]);
	const anyOf = items?.["anyOf"];
	if (Array.isArray(anyOf)) {
		return anyOf.map((option) => {
			const record = asRecord(option);
			const value = schemaText(record?.["const"]);
			return {value, label: schemaText(record?.["title"]).trim() || value.trim()};
		});
	}
	const values = items?.["enum"];
	return Array.isArray(values)
		? values.map((value) => ({value: schemaText(value), label: schemaText(value).trim()}))
		: [];
}

/** A string field's options from enum (+ enumNames) or oneOf, or null for free text. */
function singleOptions(field: ElicitationFieldSchema): Option[] | null {
	const values = field["enum"];
	if (Array.isArray(values)) {
		const names = Array.isArray(field["enumNames"]) ? field["enumNames"] : [];
		return values.map((value, index) => ({
			value: schemaText(value),
			label: schemaText(names[index]).trim() || schemaText(value).trim(),
		}));
	}
	const oneOf = field["oneOf"];
	if (!Array.isArray(oneOf)) return null;
	return oneOf.map((option) => {
		const record = asRecord(option);
		const value = schemaText(record?.["const"]);
		const description = cappedText(record?.["description"]);
		return {
			value,
			label: schemaText(record?.["title"]).trim() || value.trim(),
			...(description === "" ? {} : {description}),
		};
	});
}

/** Upstream's `xe`: the input type for a string format. */
function formatInput(format: unknown): {type: string; inputMode?: "url" | "email"; dir?: "ltr"; step?: string} {
	switch (format) {
		case "uri":
			return {type: "text", inputMode: "url", dir: "ltr"};
		case "email":
			return {type: "text", inputMode: "email", dir: "ltr"};
		case "date-time":
			return {type: "datetime-local", step: "any"};
		case "date":
			return {type: "date"};
		default:
			return {type: "text"};
	}
}

/** Upstream's integer field blocks the keys that start a fraction or exponent. */
function blockFraction(event: KeyboardEvent<HTMLInputElement>) {
	if (event.key === "." || event.key === "e" || event.key === "E") event.preventDefault();
}

function ElicitationField({
	name,
	field,
	required,
	initialValue,
	hasSubmitError,
	clearSubmitError,
	disabled,
}: {
	name: string;
	field: ElicitationFieldSchema;
	required: boolean;
	initialValue: FieldValue;
	hasSubmitError: boolean;
	clearSubmitError: (name: string) => void;
	disabled: boolean;
}) {
	const id = useId();
	const labelId = `${id}-label`;
	const descriptionId = `${id}-description`;
	const errorId = `${id}-error`;
	const initial = initialFieldValue(field, initialValue);
	const [value, setValue] = useState<FieldValue>(initial);
	const [liveError, setLiveError] = useState<string | null>(null);
	const error = liveError ?? (hasSubmitError ? validateFieldValue(value, field, required) : null);

	const validateNow = () => {
		setLiveError(validateFieldValue(value, field, required));
	};
	const clearLiveError = () => {
		setLiveError(null);
	};
	/** A pick that validates at once (numbers, checkboxes, dates). */
	const pick = (next: FieldValue) => {
		setValue(next);
		clearSubmitError(name);
		setLiveError(validateFieldValue(next, field, required));
	};
	/** A typed or chosen value that waits for blur to validate. */
	const type = (next: FieldValue) => {
		setValue(next);
		clearSubmitError(name);
	};
	const reset = () => {
		setValue(initial);
		setLiveError(null);
		clearSubmitError(name);
	};

	const boolean = field["type"] === "boolean";
	const dirty = valueKey(value, boolean, initial) !== valueKey(initial, boolean, initial);
	const title = fieldLabel(name, field);
	const description = cappedText(field["description"]);
	const describedBy = [description === "" ? null : descriptionId, error === null ? null : errorId]
		.filter((part) => part !== null)
		.join(" ");
	const aria = {
		"aria-labelledby": labelId,
		"aria-required": required || undefined,
		"aria-invalid": error === null ? undefined : true,
		...(describedBy === "" ? {} : {"aria-describedby": describedBy}),
	};
	const label = (
		<>
			{title}
			{required && (
				<span aria-hidden="true" className="ms-0.5 text-danger-000">
					*
				</span>
			)}
		</>
	);

	const frame = (control: ReactNode, inline = false) => (
		<div data-elicitation-field className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between gap-1">
				{inline ? (
					control
				) : (
					<span id={labelId} data-field-label className="text-body font-medium text-primary">
						{label}
					</span>
				)}
				{dirty && !disabled && (
					<button
						type="button"
						aria-label={`Reset ${title}`}
						onClick={reset}
						className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r4 text-secondary hover:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden"
					>
						<RotateCcw aria-hidden="true" className="size-3" />
					</button>
				)}
			</div>
			{!inline && control}
			{description !== "" && (
				<span id={descriptionId} className="text-footnote text-secondary">
					<span className="[unicode-bidi:plaintext]">{description}</span>
				</span>
			)}
			{error !== null && (
				<span id={errorId} className="text-footnote text-danger-000">
					{error}
				</span>
			)}
		</div>
	);

	if (isMultiSelect(field)) {
		const selected = Array.isArray(value) ? value : [];
		const toggle = (option: string) => {
			pick(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
		};
		return frame(
			<>
				<input type="hidden" name={name} value={JSON.stringify(selected)} disabled={disabled} />
				<div className="flex flex-col gap-1.5" role="group" {...aria}>
					{multiOptions(field).map((option) => (
						<label key={option.value} className="flex items-center gap-2 text-body">
							<input
								type="checkbox"
								checked={selected.includes(option.value)}
								onChange={() => {
									toggle(option.value);
								}}
							/>
							{option.label}
						</label>
					))}
				</div>
			</>,
		);
	}

	if (boolean) {
		return frame(
			<>
				<input type="hidden" name={name} value={value === undefined ? "" : String(value)} disabled={disabled} />
				<label id={labelId} data-field-label="" className="flex items-center gap-2 text-body text-primary">
					<input
						type="checkbox"
						aria-required={required || undefined}
						aria-invalid={error === null ? undefined : true}
						{...(describedBy === "" ? {} : {"aria-describedby": describedBy})}
						checked={value === true}
						onChange={(event) => {
							pick(event.currentTarget.checked);
						}}
					/>
					<span>{label}</span>
				</label>
			</>,
			true,
		);
	}

	if (field["type"] === "number" || field["type"] === "integer") {
		const integer = field["type"] === "integer";
		return frame(
			<input
				name={name}
				type="number"
				autoComplete="off"
				step={integer ? 1 : "any"}
				className={INPUT}
				{...aria}
				value={value === undefined ? "" : String(value)}
				onChange={(event) => {
					const text = event.currentTarget.value;
					if (text === "") {
						pick("");
						return;
					}
					const number = Number(text);
					if (Number.isNaN(number) || (integer && !Number.isInteger(number))) return;
					pick(number);
				}}
				onKeyDown={integer ? blockFraction : undefined}
				onBlur={validateNow}
			/>,
		);
	}

	const options = singleOptions(field);
	if (options !== null) {
		const current = value === undefined ? "" : String(value);
		const radios = Array.isArray(field["oneOf"]) && required && options.length <= RADIO_MAX;
		if (radios && options.some((option) => option.description !== undefined)) {
			const checked = options.some((option) => option.value === current) ? current : "";
			return frame(
				<>
					<input type="hidden" name={name} value={checked} disabled={disabled} />
					<div role="radiogroup" className="flex flex-col gap-1.5" {...aria}>
						{options.map((option) => (
							<label key={option.value} className="flex items-start gap-2 text-body">
								<input
									type="radio"
									name={`${id}-radio`}
									checked={checked === option.value}
									onChange={() => {
										type(option.value);
										setLiveError(null);
									}}
								/>
								<span className="flex flex-col">
									{option.label}
									{option.description !== undefined && (
										<span className="text-footnote text-secondary [unicode-bidi:plaintext]">
											{option.description}
										</span>
									)}
								</span>
							</label>
						))}
					</div>
				</>,
			);
		}
		return frame(
			<select
				name={name}
				className={INPUT}
				{...aria}
				value={current}
				onChange={(event) => {
					type(event.currentTarget.value);
				}}
				onFocus={clearLiveError}
				onBlur={() => {
					if (value !== undefined) validateNow();
				}}
			>
				<option value="" />
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>,
		);
	}

	const format = field["format"];
	if (format === undefined) {
		return frame(
			<textarea
				name={name}
				autoComplete="off"
				rows={1}
				className={TEXTAREA}
				{...aria}
				value={typeof value === "string" ? value : ""}
				onChange={(event) => {
					type(event.currentTarget.value);
				}}
				onFocus={clearLiveError}
				onBlur={validateNow}
			/>,
		);
	}
	return frame(
		<input
			name={name}
			autoComplete="off"
			className={INPUT}
			{...formatInput(format)}
			{...aria}
			value={value === undefined ? "" : String(value)}
			onChange={(event) => {
				(format === "date" ? pick : type)(event.currentTarget.value);
			}}
			onFocus={clearLiveError}
			onBlur={validateNow}
		/>,
	);
}

/**
 * Upstream's elicitation form card: "{server} requests your input", the message,
 * one field per `fieldNames` entry, the caution line, and Decline / Submit.
 * Submit validates every field first; a sent answer holds both buttons until the
 * card goes, and a failed one shows its error and re-enables them.
 */
export function ElicitationFormCard({
	serverName,
	message,
	schema,
	fieldNames,
	onAnswer,
}: {
	serverName: string;
	message: string;
	schema: ElicitationFormSchema;
	fieldNames: readonly string[];
	onAnswer: (answer: ElicitationAnswer) => Promise<void>;
}) {
	const formId = useId();
	const [defaults] = useState(() => elicitationFormDefaults(schema));
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(() => new Set());
	const title = `${serverName} requests your input`;
	const shownMessage = message.slice(0, TEXT_MAX).trim();

	const answer = async (result: ElicitationAnswer) => {
		if (sending) return;
		setError(null);
		setSending(true);
		try {
			await onAnswer(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to answer the request");
			setSending(false);
		}
	};
	const clearSubmitError = (name: string) => {
		setInvalidFields((current) => {
			if (!current.has(name)) return current;
			const next = new Set(current);
			next.delete(name);
			return next;
		});
	};
	const onSubmitCapture = (event: SubmitEvent<HTMLFormElement>) => {
		setInvalidFields(parseElicitationForm(new FormData(event.currentTarget), schema).invalidFields);
	};
	const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const {data, invalidFields: invalid} = parseElicitationForm(new FormData(event.currentTarget), schema);
		if (invalid.size === 0) void answer({action: "accept", content: data});
	};

	return (
		<ApprovalCardShell
			label={title}
			onKeyDown={swallowEscape}
			body={
				<>
					<div className="flex min-h-6 flex-col gap-[2px] text-primary">
						<span data-approval-card-title className={`${APPROVAL_CARD_TITLE} min-w-0 break-words`}>
							{title}
						</span>
						{shownMessage !== "" && (
							<div
								data-elicitation-message
								className={`${MUTED} whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]`}
							>
								{shownMessage}
							</div>
						)}
					</div>
					<form
						id={formId}
						noValidate
						data-testid="epitaxy-elicitation-form"
						data-owns-typing-and-pastes=""
						{...(sending ? {"data-disabled": ""} : {})}
						className="flex flex-col gap-2"
						onSubmitCapture={onSubmitCapture}
						onSubmit={onSubmit}
					>
						<fieldset disabled={sending} className="contents">
							{fieldNames.map((name) => {
								const field = schema.properties[name];
								if (field === undefined) return null;
								return (
									<ElicitationField
										key={name}
										name={name}
										field={field}
										required={schema.required?.includes(name) ?? false}
										initialValue={Object.hasOwn(defaults, name) ? defaults[name] : undefined}
										hasSubmitError={invalidFields.has(name)}
										clearSubmitError={clearSubmitError}
										disabled={sending}
									/>
								);
							})}
						</fieldset>
					</form>
					{error !== null && (
						<p role="alert" className="text-footnote text-extended-pink">
							{error}
						</p>
					)}
				</>
			}
			note={
				<p className={MUTED} data-testid="epitaxy-elicitation-caution">
					Don’t enter passwords or verification codes here.
				</p>
			}
			actions={
				<>
					<ApprovalActionButton
						variant="secondary"
						disabled={sending}
						onClick={() => void answer({action: "decline"})}
					>
						Decline
					</ApprovalActionButton>
					<span className="contents" data-approval-allow="">
						<ApprovalActionButton
							variant="primary"
							data-approval-primary=""
							disabled={sending}
							onClick={() => {
								const form = document.getElementById(formId);
								if (form instanceof HTMLFormElement) form.requestSubmit();
							}}
						>
							Submit
						</ApprovalActionButton>
					</span>
				</>
			}
		/>
	);
}
