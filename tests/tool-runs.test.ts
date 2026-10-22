import {describe, expect, it} from "vite-plus/test";

import {rendersBare, type RunCall, splitRuns, targetKey, toolBucket, type ToolBucket} from "../src/lib/tool-runs";

let nextId = 0;
function call(name: string, input: Record<string, unknown> = {}, extra: Partial<RunCall> = {}): RunCall {
	nextId += 1;
	return {id: `t${nextId}`, name, input, ...extra};
}

describe("toolBucket", () => {
	const cases: [string, RunCall, ToolBucket][] = [
		["AskUserQuestion", call("AskUserQuestion"), "standalone"],
		["ExitPlanMode", call("ExitPlanMode"), "standalone"],
		["SendUserMessage", call("SendUserMessage"), "standalone"],
		["SendUserFile", call("SendUserFile"), "standalone"],
		["Workflow", call("Workflow"), "standalone"],
		["ReportFindings", call("ReportFindings"), "standalone"],
		["ClaudeDesign", call("ClaudeDesign"), "standalone"],
		["mcp__ccd_turn__wrap_up", call("mcp__ccd_turn__wrap_up"), "standalone"],
		["Artifact {}", call("Artifact"), "default"],
		["Artifact read_db", call("Artifact", {action: "read_db"}), "default"],
		["Artifact quickstart", call("Artifact", {action: "quickstart"}), "default"],
		["Artifact list", call("Artifact", {action: "list"}), "default"],
		["Artifact path only", call("Artifact", {path: "x.html"}), "standalone"],
		["Artifact edit", call("Artifact", {action: "edit"}), "standalone"],
		["Artifact open", call("Artifact", {action: "open"}), "standalone"],
		["Artifact errored publish", call("Artifact", {action: "publish"}, {isError: true}), "standalone"],
		[
			"PushNotification requested",
			call("PushNotification", {}, {result: "Terminal notification sent. Mobile push requested."}),
			"default",
		],
		[
			"PushNotification remote control inactive",
			call(
				"PushNotification",
				{},
				{result: "Terminal notification sent. Mobile push not sent (Remote Control inactive)."},
			),
			"standalone",
		],
		[
			"PushNotification terminal active",
			call("PushNotification", {}, {result: "Not sent — this terminal is active…"}),
			"standalone",
		],
		["PushNotification pending", call("PushNotification", {}, {pending: true}), "standalone"],
		[
			"PushNotification isError",
			call("PushNotification", {}, {result: "Mobile push requested.", isError: true}),
			"standalone",
		],
		["Bash", call("Bash"), "default"],
		["Agent", call("Agent"), "default"],
		["Edit", call("Edit"), "default"],
		["ToolSearch", call("ToolSearch"), "default"],
	];

	it("classifies calls exactly like upstream", () => {
		expect(cases.map(([label, c]) => [label, toolBucket(c)])).toStrictEqual(
			cases.map(([label, , bucket]) => [label, bucket]),
		);
	});
});

describe("targetKey", () => {
	it("keys file tools by verb and path, folding MultiEdit into Edit", () => {
		expect([
			targetKey(call("Read", {file_path: "/a"})),
			targetKey(call("Write", {file_path: "/a"})),
			targetKey(call("Edit", {file_path: "/a"})),
			targetKey(call("MultiEdit", {file_path: "/a"})),
			targetKey(call("NotebookEdit", {notebook_path: "/n.ipynb"})),
			targetKey(call("Edit", {})),
			targetKey(call("Bash", {command: "ls"})),
		]).toStrictEqual(["Read /a", "Write /a", "Edit /a", "Edit /a", "NotebookEdit /n.ipynb", null, null]);
	});
});

describe("rendersBare", () => {
	const editA = () => call("Edit", {file_path: "/a"});
	const cases: [string, RunCall[], boolean][] = [
		["[Edit a]", [editA()], true],
		["[Edit a, Edit a]", [editA(), editA()], true],
		["[MultiEdit a, Edit a]", [call("MultiEdit", {file_path: "/a"}), editA()], true],
		["[Read a, Edit a]", [call("Read", {file_path: "/a"}), editA()], false],
		["[Write a, Edit a]", [call("Write", {file_path: "/a"}), editA()], false],
		["[Edit a, Bash]", [editA(), call("Bash", {command: "ls"})], false],
		["[]", [], false],
		["[Edit a] with task events", [call("Edit", {file_path: "/a"}, {hasTaskEvents: true})], false],
		[
			"[Edit a, Edit a] thinking after first",
			[editA(), call("Edit", {file_path: "/a"}, {precedingThinking: true})],
			false,
		],
		["[Edit a] thinking before first", [call("Edit", {file_path: "/a"}, {precedingThinking: true})], true],
	];

	it("is bare only when every call shares one file target", () => {
		expect(cases.map(([label, calls]) => [label, rendersBare(calls, {showThinking: true})])).toStrictEqual(
			cases.map(([label, , bare]) => [label, bare]),
		);
	});

	it("ignores preceding thinking when thinking is hidden", () => {
		expect(
			rendersBare([editA(), call("Edit", {file_path: "/a"}, {precedingThinking: true})], {showThinking: false}),
		).toStrictEqual(true);
	});
});

describe("splitRuns", () => {
	it("gives each standalone call its own run", () => {
		const write = call("Write", {file_path: "/a"});
		const exit = call("ExitPlanMode");
		const edit = call("Edit", {file_path: "/a"});
		expect(splitRuns([write, exit, edit])).toStrictEqual([[write], [exit], [edit]]);
	});

	it("joins consecutive default calls", () => {
		const edit = call("Edit", {file_path: "/a"});
		const bash = call("Bash", {command: "ls"});
		const grep = call("Grep", {pattern: "x"});
		expect(splitRuns([edit, bash, grep])).toStrictEqual([[edit, bash, grep]]);
	});

	it("never joins two standalone calls", () => {
		const first = call("ExitPlanMode");
		const second = call("ExitPlanMode");
		expect(splitRuns([first, second])).toStrictEqual([[first], [second]]);
	});

	it("returns no runs for no calls", () => {
		expect(splitRuns([])).toStrictEqual([]);
	});
});
