import {describe, expect, it} from "vite-plus/test";

import {
	ELICIT_SELECT_EMPTY_VALUE,
	elicitationForm,
	elicitationFormDefaults,
	parseElicitationForm,
	validateFieldValue,
	type ElicitationFieldSchema,
	type ElicitationFormSchema,
} from "../src/lib/elicitation-form";

const credentials: ElicitationFormSchema = {
	type: "object",
	properties: {
		username: {type: "string", title: "Username"},
		password: {type: "string"},
	},
	required: ["username"],
};

describe("elicitationForm (upstream _y)", () => {
	it("draws a supported form in schema order, and puts property_order's keys first", () => {
		expect([
			elicitationForm({
				mode: "form",
				serverName: "my-mcp-server",
				message: "Sign in",
				requestedSchema: credentials,
			}),
			elicitationForm({serverName: "my-mcp-server", message: "Sign in", requestedSchema: credentials}, [
				"password",
				"missing",
				7,
			]),
		]).toStrictEqual([
			{schema: credentials, fieldNames: ["username", "password"], message: "Sign in"},
			{schema: credentials, fieldNames: ["password", "username"], message: "Sign in"},
		]);
	});

	it("refuses url mode, an empty or impersonating server name, and unsupported schemas", () => {
		const form = (serverName: string, requestedSchema: unknown, mode?: string) =>
			elicitationForm({serverName, message: "m", requestedSchema, ...(mode === undefined ? {} : {mode})});
		const manyEnum = {type: "string", enum: Array.from({length: 257}, (_, index) => `v${index}`)};
		expect([
			form("srv", credentials, "url"),
			form("  ", credentials),
			form("My Claude Helper", credentials),
			form("ＡＮＴＨＲＯＰＩＣ tools", credentials),
			form("Cláude", credentials),
			form("srv", {type: "array", properties: {}}),
			form("srv", {type: "object"}),
			form("srv", {type: "object", properties: {code: {type: "string", pattern: "^\\d+$"}}}),
			form("srv", {type: "object", properties: {when: {type: "string", format: "time"}}}),
			form("srv", {type: "object", properties: {blob: {type: "object"}}}),
			form("srv", {type: "object", properties: {tags: {type: "array", items: {type: "string"}}}}),
			form("srv", {type: "object", properties: {pick: manyEnum}}),
			form("srv", {type: "object", properties: {"  ": {type: "string", title: " "}}}),
			form("srv", {
				type: "object",
				properties: Object.fromEntries(Array.from({length: 65}, (_, index) => [`f${index}`, {type: "string"}])),
			}),
		]).toStrictEqual(Array.from({length: 14}, () => null));
	});

	it("accepts every supported field type and format", () => {
		const schema: ElicitationFormSchema = {
			type: "object",
			properties: {
				email: {type: "string", format: "email"},
				site: {type: "string", format: "uri"},
				day: {type: "string", format: "date"},
				at: {type: "string", format: "date-time"},
				count: {type: "integer"},
				ratio: {type: "number"},
				ok: {type: "boolean"},
				tags: {type: "array", items: {enum: ["a", "b"]}},
			},
		};
		expect(elicitationForm({serverName: "srv", message: "", requestedSchema: schema})?.fieldNames).toStrictEqual([
			"email",
			"site",
			"day",
			"at",
			"count",
			"ratio",
			"ok",
			"tags",
		]);
	});
});

describe("elicitationFormDefaults (upstream uo)", () => {
	it("prefills string, number and boolean defaults, and the strings of an array default", () => {
		expect(
			elicitationFormDefaults({
				type: "object",
				properties: {
					name: {type: "string", default: "Ada"},
					count: {type: "integer", default: 3},
					ok: {type: "boolean", default: false},
					tags: {type: "array", items: {enum: ["a", "b"]}, default: ["a", 1, "b"]},
					none: {type: "string"},
					odd: {type: "string", default: {nested: true}},
				},
			}),
		).toStrictEqual({name: "Ada", count: 3, ok: false, tags: ["a", "b"]});
	});
});

function formData(entries: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.append(key, value);
	return data;
}

describe("parseElicitationForm (upstream lo)", () => {
	const schema: ElicitationFormSchema = {
		type: "object",
		properties: {
			name: {type: "string"},
			count: {type: "integer"},
			ok: {type: "boolean"},
			tags: {type: "array", items: {enum: ["a", "b"]}},
			at: {type: "string", format: "date-time"},
			note: {type: "string"},
			pick: {type: "string", enum: ["x", "y"]},
		},
		required: ["name"],
	};

	it("turns numbers, booleans, JSON arrays and date-times into values, and drops empty optional fields", () => {
		expect(
			parseElicitationForm(
				formData({
					name: "Ada",
					count: "42",
					ok: "true",
					tags: '["a","b"]',
					at: "2026-10-29T09:30",
					note: "",
					pick: ELICIT_SELECT_EMPTY_VALUE,
				}),
				schema,
			),
		).toStrictEqual({
			data: {
				name: "Ada",
				count: 42,
				ok: true,
				tags: ["a", "b"],
				at: new Date("2026-10-29T09:30").toISOString(),
				pick: "",
			},
			invalidFields: new Set(),
		});
	});

	it("marks invalid and missing required fields", () => {
		expect(
			parseElicitationForm(formData({name: " ", count: "1.5", ok: "false", tags: "[]"}), schema),
		).toStrictEqual({
			data: {name: " ", count: 1.5, ok: false},
			invalidFields: new Set(["name", "count"]),
		});
	});
});

describe("validateFieldValue (upstream M / Te)", () => {
	const cases: [unknown, ElicitationFieldSchema, boolean, string | null][] = [
		["", {type: "string"}, true, "This field is required."],
		["  ", {type: "string"}, true, "This field is required."],
		[false, {type: "boolean"}, true, "This field must be checked."],
		[true, {type: "boolean"}, true, null],
		[[], {type: "array", items: {enum: ["a"]}}, true, "Please select at least one option."],
		[["a"], {type: "array", items: {enum: ["a", "b"]}, minItems: 2}, false, "Select at least 2."],
		[["a", "b"], {type: "array", items: {enum: ["a", "b"]}, maxItems: 1}, false, "Select at most 1."],
		["ab", {type: "string", minLength: 3}, false, "Must be at least 3 characters."],
		["abcd", {type: "string", maxLength: 3}, false, "Must be at most 3 characters."],
		["abc", {type: "string", pattern: "^\\d+$"}, false, "Invalid format."],
		["nope", {type: "string", format: "email"}, false, "Enter a valid email address."],
		["ada@example.com", {type: "string", format: "email"}, false, null],
		["not a url", {type: "string", format: "uri"}, false, "Enter a valid URL."],
		["ftp://example.com", {type: "string", format: "uri"}, false, "URL must start with http:// or https://."],
		["https://example.com", {type: "string", format: "uri"}, false, null],
		["2026-13-01", {type: "string", format: "date"}, false, "Enter a valid date (YYYY-MM-DD)."],
		["0999-01-01", {type: "string", format: "date"}, false, "Enter a four-digit year."],
		["2026-10-29", {type: "string", format: "date"}, false, null],
		["soon", {type: "string", format: "date-time"}, false, "Enter a valid date and time."],
		["abc", {type: "number"}, false, "Must be a valid number."],
		[1.5, {type: "integer"}, false, "Must be a whole number."],
		[1, {type: "number", minimum: 2}, false, "Must be at least 2."],
		[5, {type: "number", maximum: 4}, false, "Must be at most 4."],
		["", {type: "string", minLength: 3}, false, null],
	];

	it.each(cases)("validates %j against %j (required %s)", (value, schema, required, expected) => {
		expect(validateFieldValue(value, schema, required)).toBe(expected);
	});
});
