import {describe, expect, it} from "vite-plus/test";

import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {toolCardStage, toolGroupStage} from "../src/lib/tool-card-stage";

function call(fields: Partial<ClientToolCall>): ClientToolCall
{
	return {
		id: "t",
		name: "Bash",
		input: {},
		param: "",
		sourceUuid: "s",
		...fields,
	};
}

describe("toolCardStage", () =>
{
	it.each([
		[
			"settled input, no result",
			call(
				{
					input:
					{
						command: "ls",
					},
				},
			),
			"input_settled",
		],
		[
			"empty input",
			call(
				{
					input: {},
				},
			),
			"partial_input",
		],
		[
			"empty input with a paired result",
			call(
				{
					input: {},
					resultUuid: "u",
				},
			),
			"result",
		],
		[
			"a live failure without resultUuid",
			call(
				{
					input:
					{
						a: 1,
					},
					result: "",
					isError: true,
				},
			),
			"result",
		],
		[
			"null input",
			call(
				{
					input: null as unknown as ClientToolCall["input"],
				},
			),
			"partial_input",
		],
	])("%s", (_name, toolCall, expected) =>
	{
		expect(toolCardStage(toolCall)).toEqual(expected);
	});
});

describe("toolGroupStage", () =>
{
	const settledNoResult = call(
		{
			input:
			{
				command: "ls",
			},
		},
	);
	const withResult = call(
		{
			input:
			{
				command: "pwd",
			},
			resultUuid: "u",
		},
	);
	const emptyInput = call(
		{
			input: {},
		},
	);

	it.each([
		["one call still waiting", [settledNoResult, withResult], "input_settled"],
		["every call has a result", [withResult, withResult], "result"],
		["one call still streaming its input", [emptyInput, withResult], "partial_input"],
	])("%s", (_name, calls, expected) =>
	{
		expect(toolGroupStage(calls)).toEqual(expected);
	});
});
