// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {BashRenderer} from "../src/components/tool-renderers/bash-renderer";
import {ReadRenderer} from "../src/components/tool-renderers/read-renderer";
import {BlockedCallContext} from "../src/components/tool-renderers/blocked-call-context";
import {KeyValueCard, PolicyDenialReason} from "../src/components/tool-renderers/shared";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

vi.mock("../src/hooks/use-shiki", () => ({
	useHighlightedLines: () => null,
}));

afterEach(cleanup);

const DENIAL =
	"Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Credential Materialization]. If you have other tasks that don't depend on this action, continue working on those. IMPORTANT: You *may* attempt it another way.";
const BDI_CLASS = "text-primary whitespace-pre-wrap break-words select-text";
const ROOT_CLASS = "flex flex-col items-start gap-xs font-sans text-body text-secondary";

const BASH: ClientToolCall = {
	id: "tool-bash-1",
	name: "Bash",
	input: {command: "cat ~/.netrc", description: "Inspect candidate OpenRewrite session transcripts"},
	param: "cat ~/.netrc",
	result: DENIAL,
	isError: true,
	blocked: true,
	blockedReason: "[Credential Materialization]",
	sourceUuid: "uuid-1",
};

interface NodeShape {
	tag: string;
	attrs: Record<string, string>;
	text: string;
	children: NodeShape[];
}

function shape(node: Element): NodeShape {
	return {
		tag: node.tagName.toLowerCase(),
		attrs: Object.fromEntries(Array.from(node.attributes, (a) => [a.name, a.value])),
		text: node.textContent,
		children: Array.from(node.children, shape),
	};
}

describe("PolicyDenialReason", () => {
	it("reads 'Blocked by auto mode: ' with the classifier's reason in an isolated, findable bdi", () => {
		const {container} = render(<PolicyDenialReason call={{blockedReason: "[Credential Materialization]"}} />);
		expect(shape(container.firstElementChild!)).toStrictEqual({
			tag: "div",
			attrs: {class: ROOT_CLASS},
			text: "Blocked by auto mode: [Credential Materialization]",
			children: [
				{
					tag: "div",
					attrs: {"data-find-omitted": ""},
					text: "Blocked by auto mode: [Credential Materialization]",
					children: [
						{
							tag: "bdi",
							attrs: {"data-find-included": "", class: BDI_CLASS},
							text: "[Credential Materialization]",
							children: [],
						},
					],
				},
			],
		});
	});

	it("reads 'Blocked by auto mode' alone when the classifier gave no reason", () => {
		const {container} = render(<PolicyDenialReason call={{}} />);
		expect(shape(container.firstElementChild!)).toStrictEqual({
			tag: "div",
			attrs: {class: ROOT_CLASS},
			text: "Blocked by auto mode",
			children: [{tag: "div", attrs: {"data-find-omitted": ""}, text: "Blocked by auto mode", children: []}],
		});
	});

	it("masks the reason and shows its spoofing characters, as upstream's u9(ME(reason)) in cf67ed396", () => {
		const rlo = String.fromCodePoint(0x202e);
		const {container} = render(
			<PolicyDenialReason call={{blockedReason: `Reads ${rlo}cred ghp_${"A".repeat(36)}`}} />,
		);
		expect(container.querySelector("bdi")?.textContent).toBe(`Reads [U+202E]cred ghp_AAAA${"•".repeat(32)}`);
	});

	it("reads upstream's no-verdict sentence as a lone bdi", () => {
		const {container} = render(<PolicyDenialReason call={{blockedNoVerdict: "unanswered"}} />);
		expect(shape(container.firstElementChild!)).toStrictEqual({
			tag: "div",
			attrs: {class: ROOT_CLASS},
			text: "This did not run because auto mode’s check had no usable answer.",
			children: [
				{
					tag: "bdi",
					attrs: {"data-find-included": "", class: BDI_CLASS},
					text: "This did not run because auto mode’s check had no usable answer.",
					children: [],
				},
			],
		});
	});
});

describe("blocked tool bodies", () => {
	it("replaces a blocked Bash call's raw output with the reason after the command card", () => {
		const {container} = render(<BashRenderer toolCall={BASH} nested />);
		const column = container.firstElementChild!;
		expect({
			output: container.querySelector("[data-bash-output]"),
			children: Array.from(
				column.children,
				(child) => child.getAttribute("data-bash-code-card") ?? child.className,
			),
			important: container.textContent.includes("IMPORTANT:"),
			reason: column.lastElementChild?.textContent,
		}).toStrictEqual({
			output: null,
			children: ["", ROOT_CLASS],
			important: false,
			reason: "Blocked by auto mode: [Credential Materialization]",
		});
	});

	it("keeps a permission-rule failure's output in danger ink", () => {
		const call: ClientToolCall = {
			id: "tool-bash-2",
			name: "Bash",
			input: {command: "git push"},
			param: "git push",
			result: "Permission to use Bash has been denied.",
			isError: true,
			sourceUuid: "uuid-2",
		};
		const {container} = render(<BashRenderer toolCall={call} nested />);
		const output = container.querySelector("[data-bash-output]");
		expect([output?.textContent, output?.className.includes("text-danger-ink")]).toStrictEqual([
			"Permission to use Bash has been denied.",
			true,
		]);
	});

	it("shows a blocked Read's reason instead of its raw denial", () => {
		const call: ClientToolCall = {
			id: "tool-read-1",
			name: "Read",
			input: {file_path: "/r/.env"},
			param: "/r/.env",
			result: DENIAL,
			isError: true,
			blocked: true,
			blockedNoVerdict: "unanswered",
			sourceUuid: "uuid-3",
		};
		const {container} = render(<ReadRenderer toolCall={call} />);
		expect([container.textContent, container.querySelector(".text-danger-ink")]).toStrictEqual([
			"This did not run because auto mode’s check had no usable answer.",
			null,
		]);
	});

	it("puts a blocked call's reason where a generic card prints its error, hiding the raw output", () => {
		const {container} = render(
			<BlockedCallContext value={{blockedReason: "[Auto-Mode Bypass]"}}>
				<KeyValueCard isError params={[{key: "url", value: "https://x"}]} result={DENIAL} />
			</BlockedCallContext>,
		);
		const details = container.querySelector("[data-tool-call-details], .max-h-\\[400px\\]")!;
		expect({
			first: details.firstElementChild?.className,
			text: details.textContent,
			danger: container.querySelector(".text-danger-ink"),
		}).toStrictEqual({
			first: ROOT_CLASS,
			text: "Blocked by auto mode: [Auto-Mode Bypass]url: https://x(opens in new tab)",
			danger: null,
		});
	});
});
