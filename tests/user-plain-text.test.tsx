// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {UserInlineText, UserPlainText} from "../src/components/user-plain-text";

afterEach(cleanup);

const FAKE_GH = `ghp_${"A".repeat(36)}`;
const MASKED_GH = `ghp_AAAA${"•".repeat(32)}`;

describe("user text secret masking (upstream c59c32499 XF)", () => {
	it("masks a token in a user turn with no reveal button", () => {
		const {container} = render(<UserPlainText text={`use ${FAKE_GH} please`} />);
		expect({text: container.textContent, buttons: container.querySelectorAll("button").length}).toStrictEqual({
			text: `use ${MASKED_GH} please`,
			buttons: 0,
		});
	});

	it("masks a token inside a user fence", () => {
		const {container} = render(<UserPlainText text={`see\n\`\`\`\n${FAKE_GH}\n\`\`\``} />);
		expect(container.textContent.includes(FAKE_GH)).toBe(false);
	});

	it("masks inline user text", () => {
		const {container} = render(<UserInlineText text={`a ${FAKE_GH}`} codeSpans={false} />);
		expect(container.textContent).toBe(`a ${MASKED_GH}`);
	});
});
