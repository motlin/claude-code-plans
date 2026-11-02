import {describe, expect, it} from "vite-plus/test";
import {parseApiErrorDetails} from "../src/lib/api-error-details";

describe("parseApiErrorDetails", () =>
{
	it("strips the API Error prefix from a network error", () =>
	{
		expect(
			parseApiErrorDetails("API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)"),
		).toStrictEqual(
			{
				body: "Can't reach the API server — check your internet or DNS (ENOTFOUND)",
			},
		);
	});

	it("takes the status from the prefix and unwraps a JSON body to its error message", () =>
	{
		expect(
			parseApiErrorDetails(
				'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Bad thing"}}',
			),
		).toStrictEqual(
			{
				body: "Bad thing",
				status: "400",
			},
		);
	});

	it("takes the status from a parenthesised prefix", () =>
	{
		expect(parseApiErrorDetails("API Error (529): Overloaded")).toStrictEqual(
			{
				body: "Overloaded",
				status: "529",
			},
		);
	});

	it("reads an `API NNN` prefix and a leading status before text", () =>
	{
		expect(parseApiErrorDetails("API 529 Overloaded")).toStrictEqual(
			{
				body: "Overloaded",
				status: "529",
			},
		);
	});

	it("keeps the lines after a JSON first line", () =>
	{
		expect(parseApiErrorDetails('API Error: 500 {"error":"Boom"}\nmore context')).toStrictEqual(
			{
				body: "Boom\nmore context",
				status: "500",
			},
		);
	});

	it("takes a top-level message when the JSON has no error object", () =>
	{
		expect(parseApiErrorDetails('API Error: 400 {"message":"Top level"}')).toStrictEqual(
			{
				body: "Top level",
				status: "400",
			},
		);
	});

	it("leaves unparseable JSON-looking text as it is", () =>
	{
		expect(parseApiErrorDetails("API Error: 400 {not json")).toStrictEqual(
			{
				body: "{not json",
				status: "400",
			},
		);
	});

	it("drops the safeguards prefix", () =>
	{
		expect(parseApiErrorDetails("API Error: Opus 5.5's safeguards flagged this session.")).toStrictEqual(
			{
				body: "Opus 5.5's safeguards flagged this session.",
			},
		);
	});

	it("drops a trailing Request ID and Message ID block, since it is not trusted", () =>
	{
		expect(
			parseApiErrorDetails("API Error: Something odd\n\nRequest ID: req_1\n\nMessage ID: msg_1"),
		).toStrictEqual(
			{
				body: "Something odd",
			},
		);
	});

	it("leaves text holding two API Error lines unchanged", () =>
	{
		const text = "API Error: first failure\nAPI Error: second failure";
		expect(parseApiErrorDetails(text)).toStrictEqual(
			{
				body: text,
			},
		);
	});
});
