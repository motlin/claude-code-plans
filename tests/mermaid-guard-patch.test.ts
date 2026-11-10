// @vitest-environment jsdom

import mermaid from "mermaid";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {_test, registerMermaidCheck} from "../src/lib/mermaid-guard";

/*
 * patches/mermaid@11.17.2.patch gives mermaid the two calls upstream's guard relies on: each parsed diagram goes to
 * `__antMermaidGuard.parsed(diagram, renderId)` before it is drawn, and each label mermaid measures is charged
 * through `__antMermaidGuard.fit("text", label)`.
 */

interface GuardGlobal {
	drawing?: Set<(kind: string, text: unknown) => void>;
}

function guardGlobal(): GuardGlobal | undefined {
	const guard: unknown = Reflect.get(globalThis, "__antMermaidGuard");
	return typeof guard === "object" && guard !== null && "pending" in guard ? (guard as GuardGlobal) : undefined;
}

afterEach(() => {
	_test.reset();
	document.body.replaceChildren();
});

describe("the mermaid patch upstream's guard needs", () => {
	it("hands the parsed diagram to the guard under its render id, before drawing", async () => {
		mermaid.initialize({startOnLoad: false, securityLevel: "sandbox"});
		const parsed: {type: unknown; text: unknown; hasDb: boolean}[] = [];
		const handle = registerMermaidCheck("mermaid-patch", (diagram) => {
			const {type, text, db} = diagram as {type: unknown; text: unknown; db: unknown};
			parsed.push({type, text, hasDb: typeof db === "object" && db !== null});
			throw new Error("refused by the test");
		});
		const host = document.createElement("div");
		document.body.append(host);
		await expect(mermaid.render(handle?.id ?? "", 'pie\n  "Fabricated slice" : 1', host)).rejects.toThrow(
			"refused by the test",
		);
		handle?.done();
		expect(parsed).toStrictEqual([{type: "pie", text: 'pie\n  "Fabricated slice" : 1\n', hasDb: true}]);
	});

	it("charges each label mermaid measures to the drawing in progress", async () => {
		mermaid.initialize({startOnLoad: false, securityLevel: "sandbox"});
		const charged: unknown[] = [];
		const charge = (kind: string, text: unknown) => {
			charged.push([kind, text]);
			throw new Error("charged by the test");
		};
		const handle = registerMermaidCheck("mermaid-patch", () => {
			guardGlobal()?.drawing?.add(charge);
		});
		const host = document.createElement("div");
		document.body.append(host);
		await expect(
			mermaid.render(handle?.id ?? "", "sequenceDiagram\n  Fabricated->>Placeholder: hello", host),
		).rejects.toThrow("charged by the test");
		handle?.done();
		guardGlobal()?.drawing?.delete(charge);
		expect(charged.at(0)).toStrictEqual(["text", expect.any(String)]);
	});
});
