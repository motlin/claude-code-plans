import {describe, expect, it} from "vite-plus/test";
import {bridgeRenameCommand, sessionRenamePath} from "../src/lib/session-rename";

describe("sessionRenamePath", () => {
	it("pushes a bridged session's rename to claude.ai/code and saves any other locally", () => {
		expect([sessionRenamePath(true), sessionRenamePath(false)]).toStrictEqual(["bridge", "local"]);
	});
});

describe("bridgeRenameCommand", () => {
	it("types the title as one /rename line", () => {
		expect(bridgeRenameCommand("  Fix\n\tthe   build ")).toStrictEqual({
			title: "Fix the build",
			command: "/rename Fix the build",
		});
	});

	it("refuses a blank title, which /rename would replace with a generated name", () => {
		expect(bridgeRenameCommand(" \n ")).toBeNull();
	});
});
