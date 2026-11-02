// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";
import
{
	_test,
	checkGitgraphText,
	checkMermaidLength,
	checkParsedDiagram,
	detectedMermaidType,
	isMermaidRefusal,
	mermaidMaxText,
	mermaidRefusal,
	registerMermaidCheck,
	repairSequenceText,
	type MermaidDrawSeen,
} from "../src/lib/mermaid-guard";

/* Upstream's mermaid guard (c763d2034, the current crawl's c763d2034-D4c37qUA.js). */

interface GuardGlobal
{
	pending: Map<string, unknown>;
	parsed: (diagram: unknown, id: string) => void;
	fit?: (kind: string, text: unknown) => void;
}

function guardGlobal(): GuardGlobal | undefined
{
	const guard: unknown = Reflect.get(globalThis, "__antMermaidGuard");
	return typeof guard === "object" && guard !== null && "pending" in guard ? (guard as GuardGlobal) : undefined;
}

/** A refusal's flag, own fields, name and message. */
function refusalOf(run: () => void): Record<string, unknown>
{
	try
	{
		run();
	}
	catch (error)
	{
		if (!(error instanceof Error)) throw error;
		const fields = Object.fromEntries(Object.entries(error));
		return {
			refusal: isMermaidRefusal(error),
			...fields,
			name: error.name,
			message: error.message,
		};
	}
	throw new Error("expected a refusal");
}

const now = () => 0;
const seen = (): MermaidDrawSeen => (
{
	ran: false,
	diagramType: "other",
});
const nodes = (count: number) =>
	Array.from(
		{
			length: count,
		},
		(_, index) => (
		{
			id: `n${index}`,
		}),
	);

afterEach(() =>
{
	_test.reset();
});

describe("checkMermaidLength (upstream ye) and mermaidMaxText (N)", () =>
{
	it("refuses text longer than mermaid's maxTextSize, capped at 20,000", () =>
	{
		expect(mermaidMaxText(100)).toBe(100);
		expect(mermaidMaxText(50_000)).toBe(20_000);
		expect(mermaidMaxText(undefined)).toBe(20_000);
		expect(() =>
		{
			checkMermaidLength("x".repeat(20_000), 20_000);
		}).not.toThrow();
		expect(
			refusalOf(() =>
			{
				checkMermaidLength("x".repeat(20_001), 20_000);
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "length",
				name: "MermaidRefusedLength",
				message:
					"not drawn: the diagram's text, after mermaid-render.ts's clean-up passes, is longer than 20,000 characters, the longest that is drawn",
			},
		);
	});
});

describe("checkParsedDiagram (upstream Se)", () =>
{
	it("refuses a type missing from the limits table and the types listed as not drawn", () =>
	{
		const unknown = seen();
		expect(
			refusalOf(() =>
			{
				checkParsedDiagram(
					{
						type: "zenuml",
						text: "zenuml",
						db: {},
					},
					unknown,
					now,
				);
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "type",
				diagramType: "other",
				name: "MermaidRefusedType",
				message: "not drawn: this diagram's type has no entry in the limits table in mermaid-guard.ts",
			},
		);
		expect(unknown).toStrictEqual(
			{
				ran: true,
				enteredAt: 0,
				diagramType: "other",
			},
		);
		expect(
			refusalOf(() =>
			{
				checkParsedDiagram(
					{
						type: "eventmodeling",
						text: "eventmodeling",
						db: {},
					},
					seen(),
					now,
				);
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "type",
				diagramType: "eventmodeling",
				name: "MermaidRefusedType",
				message: 'not drawn: the type "eventmodeling" is listed as not drawn in mermaid-guard.ts',
			},
		);
	});

	it("refuses parsed text that still holds shape data, or a dollar sign in a sequence diagram", () =>
	{
		expect(
			refusalOf(() =>
			{
				checkParsedDiagram(
					{
						type: "sequence",
						text: "sequenceDiagram\nA->>B: $5",
						db: {},
					},
					seen(),
					now,
				);
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "unprepared",
				diagramType: "sequence",
				name: "MermaidRefusedUnprepared",
				message:
					"not drawn: the text mermaid parsed held a shape-data opener, or a dollar sign in a sequence diagram, both of which mermaid-render.ts's passes take out before mermaid reads a text. Either a text got past those passes or the installed mermaid has changed: see checkParsedDiagram in mermaid-guard.ts",
			},
		);
		expect(
			refusalOf(() =>
			{
				checkParsedDiagram(
					{
						type: "pie",
						db: {},
					},
					seen(),
					now,
				);
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "unprepared",
				diagramType: "pie",
				unreadable: true,
				name: "MermaidRefusedUnprepared",
				message:
					"not drawn: the check could not read the text mermaid parsed; the installed mermaid may have changed: see checkParsedDiagram in mermaid-guard.ts",
			},
		);
	});

	it("refuses a flowchart over 620 nodes and reports one over 329", () =>
	{
		const db = (count: number) => (
		{
			getData: () => (
			{
				nodes: nodes(count),
				edges: [],
			}),
		});
		expect(
			refusalOf(() =>
			{
				checkParsedDiagram(
					{
						type: "flowchart-v2",
						text: "graph TD",
						db: db(621),
					},
					seen(),
					now,
				);
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "graph",
				diagramType: "flowchart-v2",
				name: "MermaidRefusedGraph",
				message: 'not drawn: this diagram is over the "graph" limit on how much work one drawing may take',
			},
		);
		const reported = seen();
		checkParsedDiagram(
			{
				type: "flowchart-v2",
				text: "graph TD",
				db: db(330),
			},
			reported,
			now,
		);
		expect(reported).toStrictEqual(
			{
				ran: true,
				enteredAt: 0,
				diagramType: "flowchart-v2",
				overLimit: "graph",
			},
		);
		const plain = seen();
		checkParsedDiagram(
			{
				type: "flowchart-v2",
				text: "graph TD",
				db: db(329),
			},
			plain,
			now,
		);
		expect(plain).toStrictEqual(
			{
				ran: true,
				enteredAt: 0,
				diagramType: "flowchart-v2",
			},
		);
	});

	it("calls a diagram unreadable when its db lacks the method the check reads", () =>
	{
		expect(
			refusalOf(() =>
			{
				checkParsedDiagram(
					{
						type: "mindmap",
						text: "mindmap",
						db: {},
					},
					seen(),
					now,
				);
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "mindmap",
				diagramType: "mindmap",
				unreadable: true,
				name: "MermaidRefusedMindmap",
				message:
					'not drawn: the "mindmap" check could not read mermaid\'s data for this diagram; the installed mermaid may have changed',
			},
		);
	});
});

describe("checkGitgraphText (upstream Ce)", () =>
{
	it("refuses a gitGraph whose text the clean-up passes changed", () =>
	{
		const gitGraph = (): MermaidDrawSeen => (
		{
			ran: true,
			diagramType: "gitGraph",
		});
		expect(() =>
		{
			checkGitgraphText("gitGraph\n  commit\n", "gitGraph\ncommit", gitGraph());
		}).not.toThrow();
		expect(
			refusalOf(() =>
			{
				checkGitgraphText('gitGraph\ncommit id: "a@{b}"', 'gitGraph\ncommit id: "a"', gitGraph());
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "altered",
				diagramType: "gitGraph",
				name: "MermaidRefusedAltered",
				message:
					"not drawn: mermaid-render.ts's passes changed this gitGraph's text, or it holds \"%%}%%\", so the drawing could show ids, tags, names or settings other than those written: see checkGitgraphText in mermaid-guard.ts",
			},
		);
	});
});

describe("registerMermaidCheck (upstream Ye) and the patched mermaid's hook", () =>
{
	it("hands the parsed diagram of one render id to its check, then forgets the id", () =>
	{
		const parsed: unknown[] = [];
		const handle = registerMermaidCheck("mermaid-r0", (diagram) => parsed.push(diagram));
		expect(handle?.id).toMatch(/^mermaid-r0-r\d+-[0-9a-f]{16}$/);
		const id = handle?.id ?? "";
		guardGlobal()?.parsed(
			{
				type: "pie",
			},
			id,
		);
		guardGlobal()?.parsed(
			{
				type: "pie",
			},
			"mermaid-other",
		);
		handle?.done();
		guardGlobal()?.parsed(
			{
				type: "late",
			},
			id,
		);
		expect(
			{
				parsed,
				pending: guardGlobal()?.pending.has(id),
			},
		).toStrictEqual(
			{
				parsed: [
					{
						type: "pie",
					},
				],
				pending: false,
			},
		);
	});

	it("charges every measured label of the drawing in progress and refuses past 13,000 units", () =>
	{
		const drawSeen = seen();
		const handle = registerMermaidCheck("mermaid-r1", (diagram) =>
		{
			checkParsedDiagram(diagram, drawSeen, now);
		});
		guardGlobal()?.parsed(
			{
				type: "pie",
				text: "pie",
				db: {},
			},
			handle?.id ?? "",
		);
		// One single-line 100-char label weighs textTextWeight * (1 + 1/1000 + 100/100) = 8.004 units.
		const label = "x".repeat(100);
		for (let index = 0; index < 1624; index++) guardGlobal()?.fit?.("text", label);
		expect(drawSeen.overLimit).toBe("text");
		expect(
			refusalOf(() =>
			{
				guardGlobal()?.fit?.("text", label);
			}),
		).toStrictEqual(
			{
				refusal: true,
				refusedBy: "text",
				diagramType: "pie",
				name: "MermaidRefusedText",
				message: "not drawn: measuring this diagram's text is more work than one drawing may take",
			},
		);
		handle?.done();
		expect(() => guardGlobal()?.fit?.("text", label)).not.toThrow();
	});
});

describe("mermaidRefusal (upstream w)", () =>
{
	it("names a hookless mermaid without a refusal reason", () =>
	{
		expect(
			refusalOf(() =>
			{
				throw mermaidRefusal("MermaidGuardNotRun");
			}),
		).toStrictEqual(
			{
				refusal: true,
				name: "MermaidGuardNotRun",
				message:
					"not shown: no check against the limits ran for this diagram; the installed mermaid may lack its patch (see patches/mermaid@11.17.2.patch)",
			},
		);
	});
});

describe("detectedMermaidType (upstream xe)", () =>
{
	it("names the type mermaid detects in the first 2000 characters", () =>
	{
		const lengths: number[] = [];
		const detect = (text: string) =>
		{
			lengths.push(text.length);
			return "sequence";
		};
		expect(
			{
				sequence: detectedMermaidType(detect, "x".repeat(3000)),
				other: detectedMermaidType(() => "zenuml", "zenuml"),
				none: detectedMermaidType(() =>
				{
					throw new Error("No diagram type detected");
				}, "???"),
				lengths,
			},
		).toStrictEqual(
			{
				sequence: "sequence",
				other: "other",
				none: "none",
				lengths: [2000],
			},
		);
	});
});

describe("repairSequenceText (upstream m)", () =>
{
	it("turns a semicolon inside message text into its entity code", () =>
	{
		expect(repairSequenceText("sequenceDiagram\nA->>B: hi; there", new Error("Parse error"))).toStrictEqual(
			{
				text: "sequenceDiagram\nA->>B: hiﬂ°°59¶ß there",
				repair: "semicolon",
			},
		);
	});

	it("keeps semicolons that end statements", () =>
	{
		expect(repairSequenceText("sequenceDiagram\nA->>B: hi;\nB->>A: yo", new Error("Parse error"))).toBeUndefined();
	});

	it("blanks a deactivation of a participant that was never activated", () =>
	{
		expect(
			repairSequenceText(
				"sequenceDiagram\nA->>B: x\ndeactivate B",
				new Error("Trying to inactivate an inactive participant (B)"),
			),
		).toStrictEqual(
			{
				text: `sequenceDiagram\nA->>B: x\n${" ".repeat(12)}`,
				repair: "deactivate",
			},
		);
	});
});
