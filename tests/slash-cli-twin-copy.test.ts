import {describe, expect, it} from "vite-plus/test";
import
{
	BUILTIN_SLASH_COMMANDS,
	CLI_COMMAND_NAMES,
	CLI_TWIN_COPY,
	HIDES_CLI_ROW,
	SESSION_SLASH_COMMANDS,
} from "../src/lib/slash-commands";

describe("CLI_TWIN_COPY", () =>
{
	it("names only commands the CLI lists, and covers every intercepted built-in that has a CLI twin", () =>
	{
		const twinable = [...SESSION_SLASH_COMMANDS, ...BUILTIN_SLASH_COMMANDS]
			.filter((command) => command.hostHandled === true && !HIDES_CLI_ROW.has(command.name))
			.map((command) => command.name);

		expect(
			{
				notCliCommands: Object.keys(CLI_TWIN_COPY).filter((name) => !CLI_COMMAND_NAMES.has(name)),
				interceptedWithoutCopy: twinable.filter((name) => !Object.hasOwn(CLI_TWIN_COPY, name)),
			},
		).toStrictEqual(
			{
				notCliCommands: [],
				interceptedWithoutCopy: [],
			},
		);
	});
});
