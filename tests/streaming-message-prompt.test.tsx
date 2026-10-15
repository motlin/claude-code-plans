// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {StreamingMessage} from "../src/components/streaming-message";

afterEach(cleanup);

describe("StreamingMessage sent prompt", () => {
	it("draws the pending prompt as a user bubble does: verbatim text with inline code chips", () => {
		Element.prototype.scrollIntoView = () => {};
		const {container} = render(
			<StreamingMessage
				text=""
				isComplete={false}
				sentPrompt={"From github.com:x\n * branch   main   -> FETCH_HEAD\nrun `just release`"}
			/>,
		);
		const bubble = container.querySelector(".user-message-bubble");

		expect({
			paragraphs: Array.from(bubble?.querySelectorAll("p") ?? [], (paragraph) => paragraph.textContent),
			lists: bubble?.querySelectorAll("ul, ol").length,
			code: Array.from(bubble?.querySelectorAll("code") ?? [], (code) => code.textContent),
		}).toStrictEqual({
			paragraphs: ["From github.com:x\n * branch   main   -> FETCH_HEAD\nrun just release"],
			lists: 0,
			code: ["just release"],
		});
	});
});
