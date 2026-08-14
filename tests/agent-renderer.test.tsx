import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentRenderer } from "../src/components/tool-renderers/agent-renderer";
import type { ClientToolCall, SubagentInlineInfo } from "../src/components/tool-renderers/types";

function makeSubagentInfo(overrides: Partial<SubagentInlineInfo> = {}): SubagentInlineInfo {
  return {
    agentId: "agent-abc123",
    agentType: "Code",
    slug: "fix-auth-tests",
    description: "Fix auth test failures",
    startedAt: "2026-04-19T10:00:00Z",
    finishedAt: "2026-04-19T10:00:45Z",
    status: "done",
    ...overrides,
  };
}

function makeCall(overrides: Partial<ClientToolCall> = {}): ClientToolCall {
  return {
    id: "tool-agent-1",
    name: "Agent",
    input: { description: "Fix auth test failures", prompt: "Fix the failing auth tests" },
    param: "Fix auth test failures",
    result: "agentId: abc123\nAll 12 tests pass.",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

function renderAgent(overrides: Partial<ClientToolCall> = {}): string {
  return renderToStaticMarkup(<AgentRenderer toolCall={makeCall(overrides)} />);
}

/** Everything the renderer draws above the KeyValueCard, verbatim. */
function aboveCard(html: string): string {
  const cardStart = html.indexOf('<div class="flex w-full">');
  expect(cardStart, "no KeyValueCard in AgentRenderer output").toBeGreaterThan(-1);
  return html.slice(0, cardStart);
}

const NOTE = '<div class="mb-1 text-body text-secondary">';

describe("AgentRenderer status chrome", () => {
  it("draws no status pill for a finished agent, which upstream never labels", () => {
    const html = renderAgent({ subagentInfo: makeSubagentInfo() });

    expect(aboveCard(html)).toStrictEqual("");
  });

  it("draws no status pill for a failed agent, whose failure the pink body already carries", () => {
    const html = renderAgent({
      isError: true,
      result: "agentId: abc123\nBuild failed.",
      subagentInfo: makeSubagentInfo({ status: "error" }),
    });

    expect({
      aboveCard: aboveCard(html),
      pinkBody: html.includes("text-extended-pink"),
    }).toStrictEqual({ aboveCard: "", pinkBody: true });
  });

  it("keeps a still-running agent flagged, as plain body text rather than a pill", () => {
    const html = renderAgent({
      subagentInfo: makeSubagentInfo({ finishedAt: null, status: "running" }),
    });

    expect(aboveCard(html)).toStrictEqual(`${NOTE}running</div>`);
  });

  it("renders a parallel batch as plain body text rather than a pill", () => {
    const html = renderAgent({
      subagentInfo: makeSubagentInfo({ parallelGroupKey: "pg-0", parallelGroupSize: 3 }),
    });

    expect(aboveCard(html)).toStrictEqual(`${NOTE}parallel ×3</div>`);
  });

  it("flags a running agent inside a parallel batch with one note", () => {
    const html = renderAgent({
      subagentInfo: makeSubagentInfo({
        finishedAt: null,
        status: "running",
        parallelGroupKey: "pg-0",
        parallelGroupSize: 2,
      }),
    });

    expect(aboveCard(html)).toStrictEqual(`${NOTE}running · parallel ×2</div>`);
  });
});
