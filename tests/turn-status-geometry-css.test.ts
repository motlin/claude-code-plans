import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {ruleDeclarations} from "./markdown-css";

const globalsCss = readFileSync(resolve(__dirname, "..", "src", "styles", "globals.css"), "utf8");
const flatten = (css: string) => css.replace(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");

const CARD_RESET_SELECTOR =
	'[data-cds="AssistantMessage"] :is([data-cds="Card"], [data-cds="Surface"], [data-cds="Panel"], [data-cds="Banner"], [data-cds="Aside"], [data-cds="Accordion"], [data-cds="PreviewCard"], [data-cds="Table"], [data-cds="DataTable"], [data-cds="AskUserQuestion"], [data-cds="CommentCard"], [data-cds="ChartContainer"], [data-cds="PointChartContainer"], [data-cds="CellChartContainer"], [data-cds="FileDiff"], [data-cds="UserMessage"])';

describe("TurnStatus row geometry tokens (c6a992d55 AssistantMessage)", () =>
{
	it("defines upstream's assistant text inset/stop on AssistantMessage, the card reset and the w-stretch utility", () =>
	{
		const css = flatten(globalsCss);

		expect(
			{
				tokens: ruleDeclarations(css, '[data-cds="AssistantMessage"]'),
				reset: ruleDeclarations(css, CARD_RESET_SELECTOR),
				stretch: ruleDeclarations(css, "@utility w-stretch"),
			},
		).toStrictEqual(
			{
				tokens:
				{
					"--cds-assistant-message-text-inset": "4px",
					"--cds-assistant-message-text-stop": "clamp(0px, (100% - 384px) * 0.175, 56px)",
				},
				reset:
				{
					"--cds-assistant-message-text-inset": "0px",
					"--cds-assistant-message-text-stop": "0px",
				},
				stretch:
				{
					width: "stretch",
				},
			},
		);
	});

	it("lists every w-stretch fallback in upstream's order", () =>
	{
		const body = /@utility w-stretch \{([^}]*)\}/.exec(flatten(globalsCss))?.[1]?.trim();

		expect(body).toBe("width: -webkit-fill-available; width: -moz-available; width: stretch;");
	});
});
