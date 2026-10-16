import {describe, expect, it} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {AgentRenderer} from "../src/components/tool-renderers/agent-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

/** Params render as separate key and value spans, so match on text rather than markup. */
function visibleText(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

function makeToolCall(name: string, input: ClientToolCall["input"]): ClientToolCall {
	return {
		id: crypto.randomUUID(),
		name,
		input,
		param: "",
		result: "",
		sourceUuid: "",
	};
}

describe("Agent effort rendering", () => {
	it("shows effort in Agent tool details", () => {
		const html = renderToStaticMarkup(
			createElement(AgentRenderer, {
				toolCall: makeToolCall("Agent", {
					prompt: "Inspect the code",
					subagent_type: "Explore",
					effort: "high",
				}),
			}),
		);

		expect(visibleText(html)).toContain("effort: high");
	});
});
