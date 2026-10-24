import {describe, expect, it} from "vite-plus/test";

import {turnUndoPrompt} from "../src/lib/turn-undo-prompt";

describe("turnUndoPrompt", () => {
	it("asks to restore one file by its full path", () => {
		expect(turnUndoPrompt(["/repo/src/a.ts"])).toStrictEqual(
			"Undo the changes you made to `/repo/src/a.ts` in your last turn and restore it to its previous state.",
		);
	});

	it("lists several files one per line", () => {
		expect(turnUndoPrompt(["/repo/a.ts", "/repo/b.ts", "/repo/c.ts"])).toStrictEqual(
			[
				"Undo the changes you made to these 3 files in your last turn and restore them to their previous state:",
				"- `/repo/a.ts`",
				"- `/repo/b.ts`",
				"- `/repo/c.ts`",
			].join("\n"),
		);
	});

	it("strips backticks and line breaks from a path", () => {
		expect(turnUndoPrompt(["/repo/we`ird\r\nna\u2028me\u2029.ts"])).toStrictEqual(
			"Undo the changes you made to `/repo/weirdname.ts` in your last turn and restore it to its previous state.",
		);
	});
});
