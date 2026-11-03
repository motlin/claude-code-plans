// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {MetaLine} from "../src/components/sidebar/meta-line";

afterEach(cleanup);

const SLOTS = "df-meta-slots flex min-w-0 flex-1 items-center gap-2 text-ink-muted";
const LINE = "df-meta-line flex min-w-0 flex-1 items-center gap-2";
const ITEM = "shrink-0 whitespace-nowrap";
const PLACE = "df-meta-place shrink-0 whitespace-nowrap";

describe("MetaLine", () => {
	it("renders upstream's slots: the warning Waiting word, the reason bdi, then the place bdi", () => {
		const {container} = render(
			<MetaLine line={{word: "blocked", text: "Asked a question", place: {text: "ccp", spoken: true}}} />,
		);
		expect(container.innerHTML).toBe(
			`<span class="${SLOTS}" title="Waiting, Asked a question, ccp">` +
				`<span class="${LINE}">` +
				`<span class="${ITEM} text-upstream-warning" aria-hidden="true">Waiting</span>` +
				`<bdi class="${ITEM}">Asked a question</bdi>` +
				`</span>` +
				`<bdi class="${PLACE}">ccp</bdi>` +
				`</span>`,
		);
	});

	it("leaves the Idle word spoken", () => {
		const {container} = render(<MetaLine line={{word: "idle"}} />);
		expect(container.innerHTML).toBe(
			`<span class="${SLOTS}" title="Idle">` +
				`<span class="${LINE}">` +
				`<span class="${ITEM}">Idle</span>` +
				`</span>` +
				`</span>`,
		);
	});

	it("hides the whole line from assistive tech when it holds only an unspoken place", () => {
		const {container} = render(<MetaLine line={{place: {text: "ccp", spoken: false}}} />);
		expect(container.innerHTML).toBe(
			`<span class="${SLOTS}" title="ccp" aria-hidden="true">` +
				`<span class="${LINE}"></span>` +
				`<bdi class="${PLACE}" aria-hidden="true">ccp</bdi>` +
				`</span>`,
		);
	});

	it("labels every status word as upstream does", () => {
		const words = (["idle", "unread", "working", "blocked", "error"] as const).map((word) => {
			const {container} = render(<MetaLine line={{word}} />);
			const text = container.querySelector(".df-meta-line > span")?.textContent;
			cleanup();
			return text;
		});
		expect(words).toEqual(["Idle", "Done", "Working", "Waiting", "Error"]);
	});
});
