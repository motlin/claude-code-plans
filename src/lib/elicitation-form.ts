import {z} from "zod";

import {asRecord} from "./narrow";

/*
 * Upstream's MCP elicitation form card logic (claude.ai/code, flag `__gb__1345712912`,
 * cloud sessions only): `_y` supportability (c5da7eb42), `uo` defaults and `lo` FormData
 * parse (ce3d4614c), the field helpers (c57db9d85) and `validateFieldValue` (`M` + `Te`,
 * c9e77b76c), with upstream's exact messages.
 */

export type ElicitationFieldSchema = Record<string, unknown>;

export interface ElicitationFormSchema {
	type: "object";
	properties: Record<string, ElicitationFieldSchema>;
	required?: string[];
	[key: string]: unknown;
}

export interface ElicitationForm {
	schema: ElicitationFormSchema;
	/** The fields in draw order: the server's `property_order` keys first, then the rest. */
	fieldNames: string[];
	message: string;
}

/** The value a cleared select submits, which counts as an explicit empty answer. */
export const ELICIT_SELECT_EMPTY_VALUE = "__elicit_empty_value__";

const MAX_PROPERTIES = 64;
const MAX_CHOICES = 256;
const MAX_SCHEMA_CHARS = 262_144;
const SUPPORTED_FORMATS = new Set(["email", "uri", "date", "date-time"]);

/** Upstream's `UG`: a schema value as text. */
export function schemaText(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	return "";
}

/** Upstream's `pF`: text without control characters, trimmed. */
function cleanText(text: string): string {
	// oxlint-disable-next-line no-control-regex -- strips terminal control characters from server text
	return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
}

/** A server name folded for the impersonation check: NFKD, marks dropped, lowercased. */
function foldName(name: string): string {
	return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Upstream's `zD`: a server name that passes itself off as Claude or Anthropic. */
function impersonates(name: string): boolean {
	const folded = foldName(name);
	return folded.includes("claude") || folded.includes("anthropic");
}

/** Upstream's `my`: an object schema within the property, choice and size limits. */
function withinLimits(schema: Record<string, unknown>): boolean {
	const properties = asRecord(schema["properties"]);
	if (properties === undefined) return false;
	const fields = Object.values(properties);
	const choices = [schema["required"], ...fields]
		.flatMap((entry) => {
			const record = asRecord(entry);
			return record === undefined ? [entry] : [record, record["items"]];
		})
		.flatMap((entry) => {
			const record = asRecord(entry);
			return record === undefined ? [entry] : [record["enum"], record["oneOf"], record["anyOf"]];
		});
	if (fields.length > MAX_PROPERTIES || choices.some((list) => Array.isArray(list) && list.length > MAX_CHOICES)) {
		return false;
	}
	try {
		return JSON.stringify(schema).length <= MAX_SCHEMA_CHARS;
	} catch {
		return false;
	}
}

/** Upstream's c57db9d85 `a`: a multi-select of enum or anyOf items. */
export function isMultiSelect(field: ElicitationFieldSchema): boolean {
	const items = asRecord(field["items"]);
	return field["type"] === "array" && items !== undefined && ("enum" in items || "anyOf" in items);
}

/** Upstream's field label: the cleaned title, else the key. */
export function fieldLabel(key: string, field: ElicitationFieldSchema): string {
	return cleanText(schemaText(field["title"])) || cleanText(key);
}

/** Upstream's `hy` + c57db9d85 `i`: a field the card can draw. */
function supportedField(key: string, value: unknown): value is ElicitationFieldSchema {
	const field = asRecord(value);
	if (key === "__proto__" || field === undefined || "pattern" in field) return false;
	const format = field["format"];
	if (format !== undefined && !(typeof format === "string" && SUPPORTED_FORMATS.has(format))) return false;
	const drawable = isMultiSelect(field) || ["boolean", "number", "integer", "string"].includes(String(field["type"]));
	return drawable && fieldLabel(key, field) !== "";
}

function isFormSchema(schema: Record<string, unknown>): schema is ElicitationFormSchema {
	const properties = asRecord(schema["properties"]);
	return (
		schema["type"] === "object" &&
		properties !== undefined &&
		withinLimits(schema) &&
		Object.entries(properties).every(([key, field]) => supportedField(key, field))
	);
}

/** Upstream's `gy`: the server's ordered keys that exist, then the remaining keys in schema order. */
function orderFields(properties: Record<string, unknown>, propertyOrder: unknown): string[] {
	const keys = Object.keys(properties);
	if (!Array.isArray(propertyOrder)) return keys;
	const known = new Set(keys);
	const ordered = new Set(propertyOrder.filter((key): key is string => typeof key === "string" && known.has(key)));
	return [...ordered, ...keys.filter((key) => !ordered.has(key))];
}

/**
 * Upstream's `_y`: the form card for an elicitation, or null when upstream draws none
 * (url mode, an empty or impersonating server name, or a schema it can't draw).
 */
export function elicitationForm(
	request: {mode?: string; serverName: string; message: string; requestedSchema?: unknown},
	propertyOrder?: unknown,
): ElicitationForm | null {
	if (request.mode !== undefined && request.mode !== "form") return null;
	const folded = foldName(request.serverName);
	if (cleanText(folded) === "" || impersonates(request.serverName)) return null;
	const schema = asRecord(request.requestedSchema);
	if (schema === undefined || !isFormSchema(schema)) return null;
	return {schema, fieldNames: orderFields(schema.properties, propertyOrder), message: request.message};
}

export type ElicitationValue = string | number | boolean | string[];

/** Upstream's `uo`: the schema defaults that prefill fields. */
export function elicitationFormDefaults(schema: ElicitationFormSchema): Record<string, ElicitationValue> {
	const defaults: Record<string, ElicitationValue> = {};
	for (const [key, field] of Object.entries(schema.properties)) {
		const value = field["default"];
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") defaults[key] = value;
		else if (Array.isArray(value)) defaults[key] = value.filter((item): item is string => typeof item === "string");
	}
	return defaults;
}

function parseField(raw: FormDataEntryValue | null, field: ElicitationFieldSchema): unknown {
	const text = typeof raw === "string" ? raw : "";
	switch (field["type"]) {
		case "number":
		case "integer":
			return text === "" ? "" : Number(text);
		case "boolean":
			return text === "true" ? true : text === "false" ? false : "";
		case "array":
			try {
				const parsed: unknown = JSON.parse(text === "" ? "[]" : text);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		default: {
			if (field["format"] !== "date-time" || text === "") return text;
			const date = new Date(text);
			return Number.isNaN(date.getTime()) ? text : date.toISOString();
		}
	}
}

/**
 * Upstream's `lo`: the form's answer and the fields that fail validation. Numbers,
 * booleans, JSON arrays and date-times become values, empty optional fields are
 * dropped, and a cleared select answers "".
 */
export function parseElicitationForm(
	formData: FormData,
	schema: ElicitationFormSchema,
): {data: Record<string, unknown>; invalidFields: Set<string>} {
	const data: Record<string, unknown> = {};
	const invalidFields = new Set<string>();
	for (const [key, field] of Object.entries(schema.properties)) {
		const raw = formData.get(key);
		const cleared = raw === ELICIT_SELECT_EMPTY_VALUE;
		const value = parseField(cleared ? "" : raw, field);
		const required = schema.required?.includes(key) ?? false;
		const empty = (value === "" && !cleared) || (Array.isArray(value) && value.length === 0);
		if (!empty || required) data[key] = value;
		if (!cleared && validateFieldValue(value, field, required) !== null) invalidFields.add(key);
	}
	return {data, invalidFields};
}

function numberLimit(field: ElicitationFieldSchema, key: string): number | undefined {
	const value = field[key];
	return typeof value === "number" ? value : undefined;
}

function stringSchema(field: ElicitationFieldSchema): z.ZodType {
	let schema = z.string();
	const minLength = numberLimit(field, "minLength");
	if (minLength !== undefined) schema = schema.min(minLength, {error: `Must be at least ${minLength} characters.`});
	const maxLength = numberLimit(field, "maxLength");
	if (maxLength !== undefined) schema = schema.max(maxLength, {error: `Must be at most ${maxLength} characters.`});
	const pattern = field["pattern"];
	if (typeof pattern === "string" && pattern.length <= 200) {
		try {
			schema = schema.regex(new RegExp(pattern), {error: "Invalid format."});
		} catch {
			// An invalid pattern validates nothing, as upstream.
		}
	}
	switch (field["format"]) {
		case "email":
			return schema.pipe(z.email({error: "Enter a valid email address."}));
		case "uri":
			return schema
				.pipe(z.url({error: "Enter a valid URL."}))
				.refine((url) => /^https?:\/\//i.test(url), {error: "URL must start with http:// or https://."});
		case "date":
			return schema
				.pipe(z.iso.date({error: "Enter a valid date (YYYY-MM-DD)."}))
				.refine((date) => Number(date.slice(0, 4)) >= 1000, {error: "Enter a four-digit year."});
		case "date-time":
			return schema.refine((date) => !Number.isNaN(Date.parse(date)), {error: "Enter a valid date and time."});
		default:
			return schema;
	}
}

function numberSchema(field: ElicitationFieldSchema): z.ZodType {
	let schema = z.number({
		error: (issue) => (issue.input === undefined ? undefined : "Must be a valid number."),
	});
	if (field["type"] === "integer") schema = schema.int({error: "Must be a whole number."});
	const minimum = numberLimit(field, "minimum");
	if (minimum !== undefined) schema = schema.min(minimum, {error: `Must be at least ${minimum}.`});
	const maximum = numberLimit(field, "maximum");
	if (maximum !== undefined) schema = schema.max(maximum, {error: `Must be at most ${maximum}.`});
	return schema;
}

function arraySchema(field: ElicitationFieldSchema): z.ZodType {
	let schema = z.array(z.unknown());
	const minItems = numberLimit(field, "minItems");
	if (minItems !== undefined) schema = schema.min(minItems, {error: `Select at least ${minItems}.`});
	const maxItems = numberLimit(field, "maxItems");
	if (maxItems !== undefined) schema = schema.max(maxItems, {error: `Select at most ${maxItems}.`});
	return schema;
}

/** Upstream's `Te`: the field's value check. */
function fieldValueSchema(field: ElicitationFieldSchema): z.ZodType {
	switch (field["type"]) {
		case "array":
			return arraySchema(field);
		case "string":
			return stringSchema(field);
		case "number":
		case "integer":
			return numberSchema(field);
		default:
			return z.unknown();
	}
}

function isEmptyValue(value: unknown): boolean {
	return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Upstream's `validateFieldValue`: the field's first error message, or null when the value is valid. */
export function validateFieldValue(value: unknown, field: ElicitationFieldSchema, required: boolean): string | null {
	if (required) {
		if (field["type"] === "boolean") {
			if (value !== true) return "This field must be checked.";
		} else if (field["type"] === "array") {
			if (!Array.isArray(value) || value.length === 0) return "Please select at least one option.";
		} else if (isEmptyValue(value) || (typeof value === "string" && value.trim() === "")) {
			return "This field is required.";
		}
	}
	if (isEmptyValue(value)) return null;
	const result = fieldValueSchema(field).safeParse(value);
	return result.success ? null : (result.error.issues[0]?.message ?? null);
}
