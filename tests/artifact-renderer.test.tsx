// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {cleanup, createEvent, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionArtifactsList} from "../src/components/panes/artifacts-pane";
import {SessionChat} from "../src/components/session-chat";
import {getToolRenderer} from "../src/components/tool-renderers";
import {ArtifactRenderer} from "../src/components/tool-renderers/artifact-renderer";
import {FallbackRenderer} from "../src/components/tool-renderers/fallback-renderer";
import {buildClientToolCall, type ClientToolCall} from "../src/components/tool-renderers/types";
import {toolLabel} from "../src/lib/tool-labels";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug: false,
			codeThemeLight: "claude-light",
			codeThemeDark: "claude-dark",
		},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => (
{
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => (
{
	useClaudeEvents: () => (
	{
		failedTools: new Map(),
	}),
}));

class NoopResizeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
	takeRecords(): ResizeObserverEntry[]
	{
		return [];
	}
}

globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = () =>
{
};

afterEach(cleanup);

interface Sample
{
	input: Record<string, unknown>;
	tool_result_text: string;
	toolUseResult: unknown;
}

const SAMPLES = (
	JSON.parse(readFileSync(resolve(__dirname, "fixtures/artifact-tool-samples.json"), "utf8")) as
	{
		samples: Sample[];
	}
).samples;

function sample(predicate: (s: Sample) => boolean): Sample
{
	const found = SAMPLES.find(predicate);
	if (found === undefined) throw new Error("fixture sample missing");
	return found;
}

const PUBLISH = sample(
	(s) =>
		(
			s.toolUseResult as
			{
				title?: string;
			}
		).title === "Quarto Oracle",
);
const TYPE_CREATE = sample((s) => s.input["action"] === "publish");
const LIST = sample((s) => s.input["action"] === "list");
const READ = sample((s) => s.input["action"] === "read");
const READ_DB = sample((s) => s.input["action"] === "read_db");
const QUICKSTART = sample((s) => s.input["action"] === "quickstart");

const QUARTO_URL = "https://claude.ai/code/artifact/29d89ae8-e33b-4f55-bbbd-874d5d316169";
const QUARTO_TEXT = `Published /Users/craig/projects/quarto/dist/quarto.html at ${QUARTO_URL}\n\nLive subscription: armed`;
const PIN_URL = "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709";

/** Upstream's xs cds Card: a CardLink inside paints the fill-card after-layer, its hover and press fills and the focus ring. */
const CARD_CLASS =
	"group/card relative isolate flex flex-col rounded-card-xs after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] has-[[data-cds=CardLink]:focus-visible]:after:shadow-focus has-[[data-cds=CardLink]:active]:after:bg-neutral-hover has-[[data-cds=CardLink]]:after:bg-fill-card has-[[data-cds=CardLink]]:not-has-[[data-cds=CardLink]:active]:hover:after:bg-fill-card-hover self-start min-w-[min(100%,318px)] max-w-[min(100%,318px)] text-start";
const CARD_FILL_CLASS = "cds-card-fill pointer-events-none absolute inset-0 -z-[1] m-0 rounded-[inherit]";
const CARD_BODY_CLASS = "cds-card-body flex min-h-0 flex-1 flex-col self-stretch rounded-[inherit] p-p8";
const CARD_LINK_CLASS =
	"cds-reset outline-none after:absolute after:inset-0 after:rounded-card after:contain-paint after:content-[''] cursor-pointer";
const ICON_CLASS = "shrink-0 self-center text-muted-as-secondary";
const STATUS_CLASS = "shrink-0 text-footnote text-muted-as-secondary";

function transcriptRecords(
	input: Record<string, unknown>,
	resultText: string,
	toolUseResult: unknown,
	isError = false,
): unknown[]
{
	return [
		{
			type: "assistant",
			uuid: "a1",
			message:
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_art",
						name: "Artifact",
						input,
					},
				],
			},
		},
		{
			type: "user",
			uuid: "u1",
			toolUseResult,
			message:
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_art",
						content: resultText,
						is_error: isError,
					},
				],
			},
		},
	];
}

/** Runs a single Artifact call through the real transcript join and ClientToolCall builder. */
function transcriptCall(
	input: Record<string, unknown>,
	resultText: string,
	toolUseResult: unknown,
	isError = false,
): ClientToolCall
{
	const {toolResultMap} = processTranscript(transcriptRecords(input, resultText, toolUseResult, isError));
	return buildClientToolCall(
		{
			type: "tool_use",
			id: "toolu_art",
			name: "Artifact",
			input,
		},
		"a1",
		toolResultMap,
	);
}

function cardLink(container: HTMLElement)
{
	return container.querySelector('[aria-label^="Open artifact"]');
}

function cardSummary(container: HTMLElement)
{
	const link = cardLink(container);
	const card = link?.closest("[data-cds=Card]");
	return {
		wrapper: card?.parentElement?.className,
		card: card?.getAttribute("data-size"),
		cardClass: card?.className,
		cardKids: [...(card?.children ?? [])].map((child) => [
			child.tagName,
			child.className,
			child.getAttribute("aria-hidden"),
			child.hasAttribute("data-cds-card-body"),
		]),
		linkParent: link?.parentElement?.className,
		linkTag: link?.tagName,
		linkCds: link?.getAttribute("data-cds"),
		role: link?.getAttribute("role"),
		ariaLabel: link?.getAttribute("aria-label"),
		href: link?.getAttribute("href"),
		target: link?.getAttribute("target"),
		rel: link?.getAttribute("rel"),
		tabIndex: link?.getAttribute("tabindex"),
		linkClass: link?.className,
		rowClass: link?.firstElementChild?.className,
		label: link?.querySelector("span.truncate")?.textContent,
	};
}

/** The card row's children as [tag, class, text]; the icon and caret are summarized by tag. */
function cardChildren(container: HTMLElement)
{
	const row = cardLink(container)?.firstElementChild;
	return [...(row?.children ?? [])].map((child) => [child.tagName, child.getAttribute("class"), child.textContent]);
}

describe("Artifact tool labels", () =>
{
	it("labels each action with the upstream verb and meta", () =>
	{
		const label = (input: Record<string, unknown>) =>
			toolLabel(
				{
					name: "Artifact",
					input,
				},
			);

		expect(
			{
				publish: label(PUBLISH.input),
				explicitPublish: label(
					{
						action: "publish",
						file_path: "/tmp/x/report.html",
					},
				),
				typeCreate: label(TYPE_CREATE.input),
				pin: label(
					{
						action: "pin",
						url: PIN_URL,
					},
				),
				unpin: label(
					{
						action: "unpin",
						url: PIN_URL,
					},
				),
				list: label(LIST.input),
				read: label(READ.input),
				readDb: label(READ_DB.input),
				quickstart: label(QUICKSTART.input),
			},
		).toStrictEqual(
			{
				publish:
				{
					verb: "Published artifact",
					meta: "quarto.html",
				},
				explicitPublish:
				{
					verb: "Published artifact",
					meta: "report.html",
				},
				typeCreate:
				{
					verb: "Published artifact",
				},
				pin:
				{
					verb: "Pinned artifact",
				},
				unpin:
				{
					verb: "Unpinned artifact",
				},
				list:
				{
					verb: "Listed artifacts",
				},
				read:
				{
					verb: "Used artifact tool",
					meta: "read",
				},
				readDb:
				{
					verb: "Used artifact tool",
					meta: "read_db",
				},
				quickstart:
				{
					verb: "Used artifact tool",
					meta: "quickstart",
				},
			},
		);
	});
});

describe("Artifact transcript decoration", () =>
{
	it("attaches the parsed artifact with its toolUseResult title to a publish call", () =>
	{
		const call = transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult);

		expect(call.artifact).toStrictEqual(
			{
				url: QUARTO_URL,
				kind: "uuid",
				id: "29d89ae8-e33b-4f55-bbbd-874d5d316169",
				path: "/Users/craig/projects/quarto/dist/quarto.html",
				version: "1788236255-caec",
				title: "Quarto Oracle",
			},
		);
	});

	it("attaches the returned artifacts to a list call", () =>
	{
		const call = transcriptCall(LIST.input, LIST.tool_result_text, LIST.toolUseResult);

		expect(call.artifactList?.slice(0, 2)).toStrictEqual([
			{
				title: "Asap Ladder Rebalance",
				url: "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6",
				favicon: "🪜",
				updatedAt: "2026-09-13T19:09:36Z",
			},
			{
				title: "Asap Ladder Queue",
				url: "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709",
				favicon: "📌",
				updatedAt: "2026-09-11T01:40:38Z",
			},
		]);
	});

	it("leaves a failed publish undecorated", () =>
	{
		const call = transcriptCall(PUBLISH.input, "Error: upload failed", "Error: upload failed", true);

		expect(
			{
				artifact: call.artifact,
				artifactList: call.artifactList,
			},
		).toStrictEqual(
			{
				artifact: undefined,
				artifactList: undefined,
			},
		);
	});
});

describe("ArtifactRenderer", () =>
{
	it("is the registered body for Artifact", () =>
	{
		expect(getToolRenderer("Artifact")).not.toBe(getToolRenderer("Frobnicate"));
	});

	it("renders a publish as an Open artifact card titled from the toolUseResult", () =>
	{
		const call = transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult);
		const {container} = render(<ArtifactRenderer toolCall={call} />);

		expect(cardSummary(container)).toStrictEqual(
			{
				wrapper: "flex flex-col w-full my-[var(--chat-card-bump,6px)]",
				card: "xs",
				cardClass: CARD_CLASS,
				cardKids: [
					["SPAN", CARD_FILL_CLASS, "true", false],
					["DIV", CARD_BODY_CLASS, null, true],
				],
				linkParent: CARD_BODY_CLASS,
				linkTag: "SPAN",
				linkCds: "CardLink",
				role: "button",
				ariaLabel: "Open artifact Quarto Oracle",
				href: null,
				target: null,
				rel: null,
				tabIndex: "0",
				linkClass: CARD_LINK_CLASS,
				rowClass: "flex min-w-0 items-center gap-xs",
				label: "Quarto Oracle",
			},
		);
	});

	// Upstream `z`: "Published" for a publish/edit, "Opened" for an open, nothing for a publish that opened.
	it("ends the card with upstream's status text before a mirrored caret", () =>
	{
		const status = (input: Record<string, unknown>, text: string) =>
		{
			const {container} = render(<ArtifactRenderer toolCall={transcriptCall(input, text, undefined)} />);
			const children = cardChildren(container);
			cleanup();
			return children.slice(1);
		};
		const caret = ["SPAN", ICON_CLASS, ""];

		expect(
			{
				published: status(PUBLISH.input, QUARTO_TEXT),
				edited: status(
					{
						action: "edit",
						url: QUARTO_URL,
					},
					QUARTO_TEXT,
				),
				opened: status(
					{
						action: "open",
						url: PIN_URL,
					},
					`Opened the Artifact at ${PIN_URL}`,
				),
				publishThatOpened: status(
					{
						file_path: "/tmp/x/report.html",
					},
					`Opened the Artifact at ${PIN_URL}`,
				),
			},
		).toStrictEqual(
			{
				published: [
					["SPAN", "min-w-0 flex-1 text-body text-primary truncate", "quarto"],
					["SPAN", STATUS_CLASS, "Published"],
					caret,
				],
				edited: [
					["SPAN", "min-w-0 flex-1 text-body text-primary truncate", "quarto"],
					["SPAN", STATUS_CLASS, "Published"],
					caret,
				],
				opened: [
					["SPAN", "min-w-0 flex-1 text-body text-primary truncate", "Untitled artifact"],
					["SPAN", STATUS_CLASS, "Opened"],
					caret,
				],
				publishThatOpened: [["SPAN", "min-w-0 flex-1 text-body text-primary truncate", "report"], caret],
			},
		);
	});

	it("mirrors the caret in RTL", () =>
	{
		const {container} = render(
			<ArtifactRenderer toolCall={transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult)} />,
		);

		expect(
			cardLink(container)
				?.firstElementChild?.lastElementChild?.querySelector("svg")
				?.getAttribute("data-cds-mirror"),
		).toBe("");
	});

	it("draws no status text in the session Artifacts pane", () =>
	{
		const {container} = render(
			<SessionArtifactsList
				artifacts={[
					{
						url: QUARTO_URL,
						id: "29d89ae8-e33b-4f55-bbbd-874d5d316169",
						title: "Quarto Oracle",
						kind: "html",
						previewable: false,
						lastEventAt: 0,
					},
				]}
			/>,
		);

		expect(cardChildren(container).slice(1)).toStrictEqual([
			["SPAN", "min-w-0 flex-1 text-body text-primary truncate", "Quarto Oracle"],
			["SPAN", ICON_CLASS, ""],
		]);
	});

	it("falls back to the file basename without its extension when the result has no title", () =>
	{
		const call = transcriptCall(
			{
				file_path: "/Users/craig/projects/quarto/dist/quarto.html",
			},
			QUARTO_TEXT,
			undefined,
		);
		const {container} = render(<ArtifactRenderer toolCall={call} />);

		expect(
			{
				ariaLabel: cardSummary(container).ariaLabel,
				href: cardSummary(container).href,
			},
		).toStrictEqual(
			{
				ariaLabel: "Open artifact quarto",
				href: null,
			},
		);
	});

	it("renders a type-created publish with its title and slug URL", () =>
	{
		const call = transcriptCall(
			TYPE_CREATE.input,
			"Created a new Artifact at https://claude.ai/artifact/88kDDG41ePqvfVZNsq4HCF (version 1790103359-22eb) from the Artifact type https://claude.ai/artifact/Rp9naXUCj2xozpUkyQy19W",
			TYPE_CREATE.toolUseResult,
		);
		const {container} = render(<ArtifactRenderer toolCall={call} />);

		expect(
			{
				ariaLabel: cardSummary(container).ariaLabel,
				href: cardSummary(container).href,
				target: cardSummary(container).target,
			},
		).toStrictEqual(
			{
				ariaLabel: "Open artifact Blueprint Bot renderer routing",
				href: null,
				target: null,
			},
		);
	});

	// Upstream c33aef2b7 `L`: `Q$(…, "sm")` puts the typed mark's ink on the slot; untyped keeps the muted fallback.
	it("leads a Docs-type publish with the 16px tint-blue document glyph and a plain publish with the muted fallback", () =>
	{
		const typed = render(
			<ArtifactRenderer
				toolCall={transcriptCall(
					TYPE_CREATE.input,
					"Created a new Artifact at https://claude.ai/artifact/88kDDG41ePqvfVZNsq4HCF (version 1790103359-22eb) from the Artifact type https://claude.ai/artifact/Rp9naXUCj2xozpUkyQy19W",
					TYPE_CREATE.toolUseResult,
				)}
			/>,
		);
		const mark = typed.container.querySelector<HTMLElement>("[data-artifact-mark]");
		const typedState =
		{
			slot: mark?.parentElement?.className,
			mark: [mark?.dataset["artifactMark"], mark?.className],
			px: mark?.querySelector("svg")?.style.fontSize,
		};
		cleanup();
		const plain = render(
			<ArtifactRenderer toolCall={transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult)} />,
		);
		expect(
			{
				typed: typedState,
				plain:
				{
					marks: plain.container.querySelectorAll("[data-artifact-mark]").length,
					fallback: [
						cardLink(plain.container)?.firstElementChild?.firstElementChild?.className,
						cardLink(plain.container)?.querySelector("svg")?.getAttribute("class"),
					],
				},
			},
		).toStrictEqual(
			{
				typed:
				{
					slot: "flex shrink-0 self-center text-tint-blue",
					mark: ["document", "flex"],
					px: "calc(1rem * var(--cds-rem-scale, 1))",
				},
				plain:
				{
					marks: 0,
					fallback: [ICON_CLASS, "lucide lucide-app-window"],
				},
			},
		);
	});

	// Upstream `MF` drops a bare artifact id, so an unnamed card reads "Untitled artifact".
	it("names an open or a pathless publish Untitled artifact rather than by its id", () =>
	{
		const label = (input: Record<string, unknown>, text: string) =>
		{
			const {container} = render(<ArtifactRenderer toolCall={transcriptCall(input, text, undefined)} />);
			const ariaLabel = cardSummary(container).ariaLabel;
			cleanup();
			return ariaLabel;
		};

		expect(
			{
				open: label(
					{
						action: "open",
						url: PIN_URL,
					},
					`Opened the Artifact at ${PIN_URL}`,
				),
				pathless: label({}, `Published at ${PIN_URL}`),
			},
		).toStrictEqual(
			{
				open: "Open artifact Untitled artifact",
				pathless: "Open artifact Untitled artifact",
			},
		);
	});

	it("offers a Preview source link when the publish came from a local HTML or Markdown file", () =>
	{
		const call = transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult);
		render(<ArtifactRenderer toolCall={call} />);

		const link = screen.getByRole(
			"link",
			{
				name: "Preview source",
			},
		);
		expect(
			{
				href: link.getAttribute("href"),
				target: link.getAttribute("target"),
			},
		).toStrictEqual(
			{
				href: "/artifact/29d89ae8-e33b-4f55-bbbd-874d5d316169",
				target: null,
			},
		);
	});

	it("offers no Preview source link without a previewable local file", () =>
	{
		const call = transcriptCall(
			{
				action: "open",
				url: PIN_URL,
			},
			`Opened the Artifact at ${PIN_URL}`,
			undefined,
		);
		render(<ArtifactRenderer toolCall={call} />);

		expect(
			screen.queryByRole(
				"link",
				{
					name: "Preview source",
				},
			),
		).toBeNull();
	});

	// Upstream `R`/`N` with no pane opener: click, Enter and Space open the artifact in a new tab.
	it("opens the artifact in a new tab on click, Enter and Space, and on no other key", () =>
	{
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const call = transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult);
		render(<ArtifactRenderer toolCall={call} />);
		const card = screen.getByRole(
			"button",
			{
				name: "Open artifact Quarto Oracle",
			},
		);
		const press = (key: string) =>
		{
			const event = createEvent.keyDown(
				card,
				{
					key,
				},
			);
			fireEvent(card, event);
			return event.defaultPrevented;
		};

		fireEvent.click(card);
		const prevented =
		{
			enter: press("Enter"),
			space: press(" "),
			a: press("a"),
		};

		expect(
			{
				calls: open.mock.calls,
				prevented,
			},
		).toStrictEqual(
			{
				calls: [
					[QUARTO_URL, "_blank", "noopener,noreferrer"],
					[QUARTO_URL, "_blank", "noopener,noreferrer"],
					[QUARTO_URL, "_blank", "noopener,noreferrer"],
				],
				prevented:
				{
					enter: true,
					space: true,
					a: false,
				},
			},
		);
		open.mockRestore();
	});

	it("renders a list as link rows to each returned artifact", () =>
	{
		const call = transcriptCall(LIST.input, LIST.tool_result_text, LIST.toolUseResult);
		const {container} = render(<ArtifactRenderer toolCall={call} />);
		const links = [...container.querySelectorAll("a")].slice(0, 2).map((a) => (
		{
			text: a.textContent,
			href: a.getAttribute("href"),
			target: a.getAttribute("target"),
			rel: a.getAttribute("rel"),
		}));

		expect(
			{
				count: container.querySelectorAll("a").length,
				links,
			},
		).toStrictEqual(
			{
				count: (
					LIST.toolUseResult as
					{
						artifacts: unknown[];
					}
				).artifacts.length,
				links: [
					{
						text: "🪜Asap Ladder Rebalance",
						href: "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6",
						target: "_blank",
						rel: "noopener noreferrer",
					},
					{
						text: "📌Asap Ladder Queue",
						href: "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709",
						target: "_blank",
						rel: "noopener noreferrer",
					},
				],
			},
		);
	});

	it.each([
		["read", READ],
		["read_db", READ_DB],
		["quickstart", QUICKSTART],
	])("keeps the key/value body for %s", (_action, fixture) =>
	{
		const call = transcriptCall(fixture.input, fixture.tool_result_text, fixture.toolUseResult);
		const {container} = render(<ArtifactRenderer toolCall={call} />);
		const expected = render(<FallbackRenderer toolCall={call} />).container;

		// React numbers each render's ids (a param URL's "opens in new tab" note) on, so compare without them.
		const withoutIds = (html: string) => html.replaceAll(/_r_\w+_/g, "_r_");
		expect(
			{
				cards: container.querySelectorAll('[role="button"]').length,
				html: withoutIds(container.innerHTML),
			},
		).toStrictEqual(
			{
				cards: 0,
				html: withoutIds(expected.innerHTML),
			},
		);
	});

	it.each(["pin", "unpin"])("keeps the key/value body for %s", (action) =>
	{
		const call = transcriptCall(
			{
				action,
				url: PIN_URL,
			},
			`${action}ned ${PIN_URL}`,
			undefined,
		);
		const {container} = render(<ArtifactRenderer toolCall={call} />);
		const expected = render(<FallbackRenderer toolCall={call} />).container;
		// The linked URL's "(opens in new tab)" hint takes a per-render useId.
		const html = (element: HTMLElement) => element.innerHTML.replaceAll(/_r_\w+_/g, "id");

		expect(
			{
				cards: container.querySelectorAll('[role="button"]').length,
				html: html(container),
			},
		).toStrictEqual(
			{
				cards: 0,
				html: html(expected),
			},
		);
	});

	it("shows a failed publish as the key/value error body", () =>
	{
		const call = transcriptCall(PUBLISH.input, "Error: upload failed", "Error: upload failed", true);
		const {container} = render(<ArtifactRenderer toolCall={call} />);
		const expected = render(<FallbackRenderer toolCall={call} />).container;

		// React numbers each render's ids (a param URL's "opens in new tab" note) on, so compare without them.
		const withoutIds = (html: string) => html.replaceAll(/_r_\w+_/g, "_r_");
		expect(
			{
				cards: container.querySelectorAll('[role="button"]').length,
				html: withoutIds(container.innerHTML),
			},
		).toStrictEqual(
			{
				cards: 0,
				html: withoutIds(expected.innerHTML),
			},
		);
	});
});

describe("Artifact row in the session transcript", () =>
{
	// Upstream `qT`: the card replaces the tool row, with no label row above it.
	it.each([
		["publish", PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult, "Open artifact Quarto Oracle"],
		[
			"open",
			{
				action: "open",
				url: PIN_URL,
			},
			`Opened the Artifact at ${PIN_URL}`,
			undefined,
			"Open artifact Untitled artifact",
		],
	])(
		"draws a %s as the card alone, with no row label or disclosure",
		async (_action, input, text, toolUseResult, name) =>
		{
			const {lines, toolResultMap} = processTranscript(transcriptRecords(input, text, toolUseResult));
			const {container} = render(
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					showCompactSummaries
					showTranscriptOnly
				/>,
			);
			const card = await screen.findByRole(
				"button",
				{
					name,
				},
			);
			const row = card.closest("[data-cds=Card]")?.parentElement?.parentElement;

			expect(
				{
					expandables: container.querySelectorAll("[aria-expanded]").length,
					labels: screen.queryAllByText(/Published artifact|Used artifact tool/).length,
					row: [row?.className, row?.hasAttribute("data-tool-row")],
				},
			).toStrictEqual(
				{
					expandables: 0,
					labels: 0,
					row: ["contents", true],
				},
			);
		},
	);
});
