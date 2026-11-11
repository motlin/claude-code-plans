// @vitest-environment jsdom

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ExternalLinkHint, ExternalTextLink} from "../src/components/external-text-link";

afterEach(() => {
	cleanup();
});

describe("ExternalTextLink", () => {
	it("describes the link with a hidden sr-only hint, appending the hint id after the caller's ids", () => {
		render(
			<ExternalTextLink href="https://x.test" rel="noopener" aria-describedby="other">
				Docs
			</ExternalTextLink>,
		);

		const link = screen.getByRole("link", {name: "Docs", description: "(opens in new tab)"});
		const span = link.lastElementChild as HTMLElement;
		expect({
			link: {
				cds: link.getAttribute("data-cds"),
				href: link.getAttribute("href"),
				target: link.getAttribute("target"),
				rel: link.getAttribute("rel"),
				className: link.className,
				describedBy: link.getAttribute("aria-describedby"),
				text: link.textContent,
			},
			span: {
				tag: span.tagName,
				hidden: span.hidden,
				className: span.className,
				text: span.textContent,
				isLastChild: link.lastChild === span,
			},
		}).toStrictEqual({
			link: {
				cds: "TextLink",
				href: "https://x.test",
				target: "_blank",
				rel: "noopener",
				className: "cds-reset text-link inline cursor-pointer",
				describedBy: `other ${span.id}`,
				text: "Docs(opens in new tab)",
			},
			span: {
				tag: "SPAN",
				hidden: true,
				className: "sr-only",
				text: "(opens in new tab)",
				isLastChild: true,
			},
		});
	});

	it("uses only the hint id when the caller passes no describedby, and keeps a caller's target and className", () => {
		render(
			<ExternalTextLink href="https://x.test" rel="noopener noreferrer" target="docs" className="underline">
				Docs
			</ExternalTextLink>,
		);

		const link = screen.getByRole("link", {name: "Docs", description: "(opens in new tab)"});
		const span = link.querySelector("span")!;
		expect({
			target: link.getAttribute("target"),
			className: link.className,
			describedBy: link.getAttribute("aria-describedby"),
			idNonEmpty: span.id !== "",
		}).toStrictEqual({target: "docs", className: "underline", describedBy: span.id, idNonEmpty: true});
	});

	it("exports the bare hint for hand-built anchors", () => {
		const {container} = render(<ExternalLinkHint id="hint-1" />);

		expect(container.innerHTML).toBe('<span id="hint-1" hidden="" class="sr-only">(opens in new tab)</span>');
	});
});

describe("external link hints in src", () => {
	it("never embeds a visible (name-joining) '(opens in new tab)' span", () => {
		const SRC = "src";
		const offenders = readdirSync(SRC, {recursive: true, encoding: "utf8"})
			.filter((file) => file.endsWith(".tsx"))
			.flatMap((file) => {
				const text = readFileSync(join(SRC, file), "utf8");
				const matches = [...text.matchAll(/<span\b([^>]*)>\s*\(opens in new tab\)\s*<\/span>/g)];
				return matches.filter((m) => !/\bhidden\b/.test(m[1] ?? "")).map(() => file);
			});

		expect(offenders).toStrictEqual([]);
	});
});
