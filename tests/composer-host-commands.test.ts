import {describe, expect, it} from "vite-plus/test";
import {type HostCommandContext, parseHostCommand} from "../src/lib/composer-host-commands";
import {EFFORT_LEVELS, MORE_MODELS, PRIMARY_MODELS} from "../src/lib/launch-options";

const ctx: HostCommandContext = {
	effortLevels: EFFORT_LEVELS,
	models: [...PRIMARY_MODELS, ...MORE_MODELS].map((model) => model.id),
	menusAvailable: true,
};
const locked: HostCommandContext = {...ctx, menusAvailable: false};

describe("parseHostCommand", () => {
	it.each([
		["/model", {kind: "open", menu: "model", name: "model"}],
		["  /MODEL  ", {kind: "open", menu: "model", name: "model"}],
		["/effort", {kind: "open", menu: "effort", name: "effort"}],
		["/permissions", {kind: "open", menu: "mode", name: "permissions"}],
		["/allowed-tools", {kind: "open", menu: "mode", name: "allowed-tools"}],
		["/effort high", {kind: "effort", level: "high", name: "effort"}],
		["/effort HIGH", {kind: "effort", level: "high", name: "effort"}],
		["/model opus", {kind: "model", model: "opus", name: "model"}],
		["/model:opus", {kind: "model", model: "opus", name: "model"}],
		["/model, opus", {kind: "model", model: "opus", name: "model"}],
		["/model.opus", {kind: "model", model: "opus", name: "model"}],
		["/model OPUS", {kind: "model", model: "opus", name: "model"}],
		["/model claude-opus-4-6", {kind: "model", model: "claude-opus-4-6", name: "model"}],
	])("%j opens or applies", (text, expected) => {
		expect(parseHostCommand(text, ctx)).toStrictEqual(expected);
	});

	it.each([
		["/model gpt5", {kind: "refuse", toast: "“gpt5” isn’t an available model."}],
		[
			"/permissions plan",
			{
				kind: "band",
				text: "/permissions doesn’t take arguments here. Remove the text after the command, then send it again.",
			},
		],
		[
			"/permissions\nx",
			{
				kind: "band",
				text: "/permissions only works on a single line. Remove the extra lines, then send it again.",
			},
		],
	])("%j refuses with copy", (text, expected) => {
		expect(parseHostCommand(text, ctx)).toStrictEqual(expected);
	});

	it.each([
		["/model", {kind: "refuse", toast: "Model can’t be changed for this session right now."}],
		["/model opus", {kind: "refuse", toast: "Model can’t be changed for this session right now."}],
		["/effort", {kind: "refuse", toast: "The model is still loading. Try /effort again in a moment."}],
		["/effort high", {kind: "refuse", toast: "The model is still loading. Try /effort again in a moment."}],
		["/permissions", {kind: "refuse", toast: "The permission mode can’t be changed for this session."}],
		["/allowed-tools", {kind: "refuse", toast: "The permission mode can’t be changed for this session."}],
	])("%j refuses while menus are unavailable", (text, expected) => {
		expect(parseHostCommand(text, locked)).toStrictEqual(expected);
	});

	it.each(["/effort foo", "/modelx", "/btw hi", "hello /model", "", "/", "/compact"])(
		"%j is sent as typed",
		(text) => {
			expect(parseHostCommand(text, ctx)).toBeNull();
		},
	);

	it("leaves /effort to the CLI when the model has no effort levels", () => {
		expect(parseHostCommand("/effort", {...ctx, effortLevels: []})).toBeNull();
	});
});
