// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {WaitingForInputNotice} from "../src/components/approval-card";
import {showsWaitingForInputNotice} from "../src/components/waiting-for-input-notice";

afterEach(cleanup);

describe("showsWaitingForInputNotice", () => {
	it("shows only for a waiting session with no card to dock and no Needs your input on the working line", () => {
		expect([
			showsWaitingForInputNotice({state: "waiting", hasDockedCard: false, workingLineWaits: false}),
			showsWaitingForInputNotice({state: "waiting", hasDockedCard: false, workingLineWaits: true}),
			showsWaitingForInputNotice({state: "waiting", hasDockedCard: true, workingLineWaits: false}),
			showsWaitingForInputNotice({state: "working", hasDockedCard: false, workingLineWaits: false}),
			showsWaitingForInputNotice({state: "ended", hasDockedCard: false, workingLineWaits: false}),
			showsWaitingForInputNotice({state: null, hasDockedCard: false, workingLineWaits: false}),
		]).toStrictEqual([true, false, false, false, false, false]);
	});
});

describe("WaitingForInputNotice", () => {
	it("sets its title in upstream's question-header weight, 580", () => {
		render(<WaitingForInputNotice />);

		expect(
			screen
				.getByText("Waiting for your input")
				.className.split(" ")
				.filter((name) => name.startsWith("font-")),
		).toStrictEqual(["font-[580]"]);
	});

	it("announces the wait with the awaiting dot and no controls", () => {
		const {container} = render(<WaitingForInputNotice />);

		const notice = screen.getByRole("status", {name: "Waiting for your input"});
		expect({
			text: notice.textContent,
			dot: container.querySelector(".status-dot")?.getAttribute("data-kind"),
			controls: container.querySelectorAll("button, textarea, input, [tabindex]").length,
		}).toStrictEqual({
			text: "Waiting for your inputAnswer in the terminal running this session.",
			dot: "awaiting",
			controls: 0,
		});
	});

	it("names the asking MCP server, then its message, then the terminal footnote", () => {
		const {container} = render(
			<WaitingForInputNotice
				title="my-mcp-server requests your input"
				message={"Please provide\nyour credentials"}
			/>,
		);

		const notice = screen.getByRole("status", {name: "my-mcp-server requests your input"});
		const lines = [...container.querySelectorAll("[data-waiting-input-notice] > span:last-child > span")];
		expect({
			text: notice.textContent,
			lines: lines.map((line) => ({text: line.textContent, className: line.className})),
		}).toStrictEqual({
			text: "my-mcp-server requests your inputPlease provide\nyour credentialsAnswer in the terminal running this session.",
			lines: [
				{text: "my-mcp-server requests your input", className: "font-[580]"},
				{
					text: "Please provide\nyour credentials",
					className:
						"text-footnote text-secondary whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]",
				},
				{text: "Answer in the terminal running this session.", className: "text-footnote text-secondary"},
			],
		});
	});
});
