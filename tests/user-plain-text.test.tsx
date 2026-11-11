// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {linkifyPlain} from "../src/components/linkify-plain";
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

describe("linkifyPlain (upstream c40ad8c1e y with the tool body policy Zx and cap Qx)", () => {
	function anchors(text: string, maxLinks = Infinity) {
		const {container} = render(<div>{linkifyPlain(text, {maxLinks})}</div>);
		// The external TextLink's hidden "(opens in new tab)" hint is its description, not visible text.
		const visible = container.cloneNode(true) as HTMLElement;
		for (const hint of visible.querySelectorAll("[hidden]")) hint.remove();
		return {
			text: visible.textContent,
			links: [...visible.querySelectorAll("a")].map((a) => ({
				href: a.getAttribute("href"),
				text: a.textContent,
				target: a.getAttribute("target"),
				rel: a.getAttribute("rel"),
				dir: a.getAttribute("dir"),
				cds: a.getAttribute("data-cds"),
				className: a.className,
			})),
			words: [...container.querySelectorAll("span[dir=ltr]")].map((span) => span.textContent),
		};
	}

	it("links URLs as external TextLinks (upstream jq), trimming trailing punctuation and an unbalanced paren", () => {
		expect(anchors("see https://e.com/x).")).toStrictEqual({
			text: "see https://e.com/x).",
			links: [
				{
					href: "https://e.com/x",
					text: "https://e.com/x",
					target: "_blank",
					rel: "noopener noreferrer",
					dir: "ltr",
					cds: "TextLink",
					className: "cds-reset text-link inline cursor-pointer",
				},
			],
			words: [],
		});
	});

	it("links the bare status host and trims an unbalanced closing bracket", () => {
		expect([
			anchors("down? status.claude.com").links.map((l) => [l.href, l.text]),
			anchors("[https://e.com/a]").links.map((l) => [l.href, l.text]),
		]).toStrictEqual([
			[["https://status.claude.com", "status.claude.com"]],
			[["https://e.com/a", "https://e.com/a"]],
		]);
	});

	it("stops linking after maxLinks matches", () => {
		const urls = Array.from({length: 201}, (_, i) => `https://e.com/${i}`);
		const result = anchors(urls.join(" "), 200);
		expect({count: result.links.length, last: result.links.at(-1)?.href, text: result.text}).toStrictEqual({
			count: 200,
			last: "https://e.com/199",
			text: urls.join(" "),
		});
	});

	it("draws a URL that carries a secret as plain ltr words, not a link", () => {
		expect(anchors(`https://e.com/?t=${FAKE_GH}`)).toStrictEqual({
			text: `https://e.com/?t=${FAKE_GH}`,
			links: [],
			words: [`https://e.com/?t=${FAKE_GH}`],
		});
	});
});
