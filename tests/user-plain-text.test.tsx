// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {linkifyPlain} from "../src/components/linkify-plain";
import {UserInlineText, UserPlainText} from "../src/components/user-plain-text";

afterEach(cleanup);

const FAKE_GH = `ghp_${"A".repeat(36)}`;
const MASKED_GH = `ghp_AAAA${"•".repeat(32)}`;

describe("user text secret masking (upstream c59c32499 XF)", () =>
{
	it("masks a token in a user turn with no reveal button", () =>
	{
		const {container} = render(<UserPlainText text={`use ${FAKE_GH} please`} />);
		expect(
			{
				text: container.textContent,
				buttons: container.querySelectorAll("button").length,
			},
		).toStrictEqual(
			{
				text: `use ${MASKED_GH} please`,
				buttons: 0,
			},
		);
	});

	it("masks a token inside a user fence", () =>
	{
		const {container} = render(<UserPlainText text={`see\n\`\`\`\n${FAKE_GH}\n\`\`\``} />);
		expect(container.textContent.includes(FAKE_GH)).toBe(false);
	});

	it("masks inline user text", () =>
	{
		const {container} = render(<UserInlineText text={`a ${FAKE_GH}`} codeSpans={false} />);
		expect(container.textContent).toBe(`a ${MASKED_GH}`);
	});

	it("trims option description and user turn URLs with upstream's ts, as both paint through xr", () =>
	{
		const hrefs = (node: React.ReactElement) =>
		{
			const {container} = render(node);
			const result = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
			cleanup();
			return result;
		};
		expect([
			hrefs(<UserInlineText text="see https://e.com/x... and https://e.com/a[1]" codeSpans={false} />),
			hrefs(<UserPlainText text="see https://e.com/x... and https://e.com/y،." />),
		]).toStrictEqual([
			["https://e.com/x..", "https://e.com/a[1]"],
			["https://e.com/x..", "https://e.com/y"],
		]);
	});

	it("draws a user turn's links as upstream's xr under the transcript policy: TextLinks, markdown labels with the host disclosed, deceptive links confirmed or as words", () =>
	{
		const {container} = render(
			<UserPlainText text="see [docs](https://example.org/d) and https://user:pw@example.com/a and https://xn--e1afmkfd.example/b and https://example.com/c?open_in_browser=1" />,
		);
		expect(
			{
				links: [...container.querySelectorAll("a")].map((a) => [
					a.getAttribute("href"),
					a.getAttribute("rel"),
					a.getAttribute("dir"),
					a.textContent,
				]),
				words: [...container.querySelectorAll("p > span[dir=ltr]")].map((span) => span.textContent),
			},
		).toStrictEqual(
			{
				links: [
					["https://example.org/d", "noreferrer", "ltr", "docs (→ example.org)"],
					[
						"https://xn--e1afmkfd.example/b",
						"noopener noreferrer",
						"ltr",
						"https://xn--e1afmkfd.example/b(opens in new tab)",
					],
					["https://example.com/c", "noreferrer", "ltr", "https://example.com/c?open_in_browser=1"],
				],
				words: ["https://user:pw@example.com/a"],
			},
		);
	});

	it("draws a pending user turn's links as upstream's non-interactive words", () =>
	{
		const {container} = render(<UserPlainText text="see https://example.com/a" nonInteractive />);
		expect(
			{
				links: container.querySelectorAll("a").length,
				words: [...container.querySelectorAll("span[dir=ltr]")].map((span) => [
					span.className,
					span.textContent,
				]),
			},
		).toStrictEqual(
			{
				links: 0,
				words: [
					[
						"text-upstream-accent underline underline-offset-[3px] decoration-[color-mix(in_srgb,currentColor,transparent_60%)]",
						"https://example.com/a",
					],
				],
			},
		);
	});

	it("draws an option description's links under the option card policy: deceptive links as words, never the confirm", () =>
	{
		const {container} = render(
			<UserInlineText
				text="see [b](https://xn--e1afmkfd.example/b) or https://xn--e1afmkfd.example/c or https://example.com/d"
				codeSpans={false}
			/>,
		);
		expect(
			{
				links: [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
				words: [...container.querySelectorAll("span[dir=ltr]:not(.opacity-70)")].map(
					(span) => span.textContent,
				),
			},
		).toStrictEqual(
			{
				links: ["https://example.com/d"],
				words: ["b (→ xn--e1afmkfd.example)", "https://xn--e1afmkfd.example/c"],
			},
		);
	});
});

describe("linkifyPlain (upstream c40ad8c1e y with the tool body policy Zx and cap Qx)", () =>
{
	function anchors(text: string, maxLinks = Infinity)
	{
		const {container} = render(
			<div>
				{linkifyPlain(
					text,
					{
						maxLinks,
					},
				)}
			</div>,
		);
		// The external TextLink's hidden "(opens in new tab)" hint is its description, not visible text.
		const visible = container.cloneNode(true) as HTMLElement;
		for (const hint of visible.querySelectorAll("[hidden]")) hint.remove();
		return {
			text: visible.textContent,
			links: [...visible.querySelectorAll("a")].map((a) => (
			{
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

	it("links URLs as external TextLinks (upstream jq), trimming trailing punctuation and an unbalanced paren", () =>
	{
		expect(anchors("see https://e.com/x).")).toStrictEqual(
			{
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
			},
		);
	});

	it("links the bare status host and trims an unbalanced closing bracket", () =>
	{
		expect([
			anchors("down? status.claude.com").links.map((l) => [l.href, l.text]),
			anchors("[https://e.com/a]").links.map((l) => [l.href, l.text]),
		]).toStrictEqual([
			[["https://status.claude.com", "status.claude.com"]],
			[["https://e.com/a", "https://e.com/a"]],
		]);
	});

	it("trims each URL with upstream's ts on both sides of the bracket trim: one sentence mark, every RTL mark, never a balanced ]", () =>
	{
		expect(
			[
				"see https://e.com/x...",
				"see https://e.com/a[1].",
				"see https://e.com/y،.",
				"see (https://e.com/z))",
			].map((text) => anchors(text).links.map((l) => [l.href, l.text])),
		).toStrictEqual([
			[["https://e.com/x.", "https://e.com/x."]],
			[["https://e.com/a[1]", "https://e.com/a[1]"]],
			[["https://e.com/y", "https://e.com/y"]],
			[["https://e.com/z", "https://e.com/z"]],
		]);
	});

	it("stops linking after maxLinks matches", () =>
	{
		const urls = Array.from(
			{
				length: 201,
			},
			(_, i) => `https://e.com/${i}`,
		);
		const result = anchors(urls.join(" "), 200);
		expect(
			{
				count: result.links.length,
				last: result.links.at(-1)?.href,
				text: result.text,
			},
		).toStrictEqual(
			{
				count: 200,
				last: "https://e.com/199",
				text: urls.join(" "),
			},
		);
	});

	it("draws a URL that carries a secret as plain ltr words, not a link", () =>
	{
		expect(anchors(`https://e.com/?t=${FAKE_GH}`)).toStrictEqual(
			{
				text: `https://e.com/?t=${FAKE_GH}`,
				links: [],
				words: [`https://e.com/?t=${FAKE_GH}`],
			},
		);
	});
});
