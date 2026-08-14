// @vitest-environment jsdom

import { describe, it, expect } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { AttachmentBanner } from "../src/components/attachment-banner";
import { AttachmentPayloadSchema, type AttachmentPayload } from "../src/lib/schemas";

function renderBanner(payload: AttachmentPayload): string {
  return renderToStaticMarkup(<AttachmentBanner attachmentJson={JSON.stringify(payload)} />);
}

async function renderBannerWithRouter(payload: AttachmentPayload): Promise<string> {
  const rootRoute = createRootRoute({
    component: () => <AttachmentBanner attachmentJson={JSON.stringify(payload)} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const html = view.container.innerHTML;
  view.unmount();
  return html;
}

const MINIMAL_BY_TYPE: Record<string, AttachmentPayload> = {
  plan_mode: { type: "plan_mode" },
  auto_mode: { type: "auto_mode" },
  auto_mode_exit: { type: "auto_mode_exit" },
  plan_file_reference: { type: "plan_file_reference" },
  nested_memory: { type: "nested_memory" },
  team_context: { type: "team_context" },
  plan_mode_exit: { type: "plan_mode_exit" },
  plan_mode_reentry: { type: "plan_mode_reentry" },
  hook_success: {
    type: "hook_success",
    hookName: "h",
    hookEvent: "PreToolUse",
  },
  hook_non_blocking_error: {
    type: "hook_non_blocking_error",
    hookName: "h",
    hookEvent: "PreToolUse",
  },
  hook_blocking_error: {
    type: "hook_blocking_error",
    hookName: "h",
    hookEvent: "PreToolUse",
  },
  hook_cancelled: {
    type: "hook_cancelled",
    hookName: "h",
    hookEvent: "PreToolUse",
  },
  hook_system_message: {
    type: "hook_system_message",
    hookName: "h",
    hookEvent: "PreToolUse",
  },
  hook_additional_context: {
    type: "hook_additional_context",
    hookName: "h",
    hookEvent: "PreToolUse",
  },
  async_hook_response: {
    type: "async_hook_response",
    processId: "async-hook-100",
    hookName: "PreToolUse:Read",
    hookEvent: "PreToolUse",
  },
  deferred_tools_delta: { type: "deferred_tools_delta" },
  agent_listing_delta: { type: "agent_listing_delta" },
  mcp_instructions_delta: { type: "mcp_instructions_delta" },
  skill_listing: { type: "skill_listing" },
  dynamic_skill: { type: "dynamic_skill" },
  task_reminder: { type: "task_reminder" },
  todo_reminder: { type: "todo_reminder" },
  total_tokens_reminder: {
    type: "total_tokens_reminder",
    text: "<total_tokens>10000000 tokens left</total_tokens>",
  },
  task_status: { type: "task_status", taskId: "100", status: "completed" },
  edited_text_file: { type: "edited_text_file", filename: "f.ts" },
  file: { type: "file", filename: "f.ts" },
  already_read_file: { type: "already_read_file", filename: "/tmp/test/example.ts" },
  directory: { type: "directory" },
  compact_file_reference: { type: "compact_file_reference" },
  read_truncation_notice: {
    type: "read_truncation_notice",
    banner: "[Truncated: showing lines 1-100 of 200 total.]",
    toolUseID: "toolu_100",
  },
  date_change: { type: "date_change", newDate: "2026-05-14" },
  command_permissions: { type: "command_permissions" },
  diagnostics: { type: "diagnostics" },
  queued_command: { type: "queued_command" },
  selected_lines_in_ide: { type: "selected_lines_in_ide" },
  opened_file_in_ide: { type: "opened_file_in_ide" },
  companion_intro: { type: "companion_intro" },
  invoked_skills: { type: "invoked_skills" },
  ultrathink_effort: { type: "ultrathink_effort" },
  max_turns_reached: { type: "max_turns_reached" },
  workflow_keyword_request: { type: "workflow_keyword_request" },
};

describe("AttachmentBanner", () => {
  const schemaTypes = AttachmentPayloadSchema.options.map((opt) => opt.shape.type.value);

  it("covers every attachment type declared in AttachmentPayloadSchema", () => {
    const fixtureTypes = Object.keys(MINIMAL_BY_TYPE).sort();
    expect(fixtureTypes).toEqual([...schemaTypes].sort());
  });

  it("keeps provider-less fixtures free of plan file paths", () => {
    expect(
      Object.entries(MINIMAL_BY_TYPE).filter(([, payload]) => "planFilePath" in payload),
    ).toStrictEqual([]);
  });

  for (const type of schemaTypes) {
    it(`renders ${type} without throwing`, () => {
      const payload = MINIMAL_BY_TYPE[type];
      expect(payload, `fixture for ${type} missing`).toBeDefined();
      // Schema must accept the fixture, otherwise the rendering test below is meaningless.
      expect(AttachmentPayloadSchema.safeParse(payload).success).toBe(true);
      expect(() => renderBanner(payload!)).not.toThrow();
    });
  }

  describe("hook_blocking_error", () => {
    it("renders the nested blocking message when blockingError carries a message string", () => {
      const html = renderBanner({
        type: "hook_blocking_error",
        hookName: "policy-guard",
        hookEvent: "PreToolUse",
        blockingError: { message: "Command rejected by policy" },
      });
      expect(html.match(/<span class="text-t6">[^<]+<\/span>/g) ?? []).toStrictEqual([
        '<span class="text-t6">Command rejected by policy</span>',
      ]);
    });

    it("does not render a blocking message when blockingError is absent", () => {
      const html = renderBanner({
        type: "hook_blocking_error",
        hookName: "policy-guard",
        hookEvent: "PreToolUse",
      });
      expect(html.match(/<span class="text-t6">[^<]+<\/span>/g) ?? []).toStrictEqual([]);
    });
  });

  it("renders read truncation notices", () => {
    const html = renderBanner({
      type: "read_truncation_notice",
      banner: "[Truncated: showing lines 1-100 of 200 total.]",
      toolUseID: "toolu_100",
    });

    expect(html).toStrictEqual(
      '<div class="flex flex-wrap items-center gap-2 py-1.5 px-3 text-xs text-t6 bg-surface-1 rounded-md border border-subtle"><span class="shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert h-3.5 w-3.5" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg></span><span>Read output truncated</span><pre class="w-full mt-1 text-[10px] leading-tight text-t6 bg-surface-0 rounded px-2 py-1 whitespace-pre-wrap break-all">[Truncated: showing lines 1-100 of 200 total.]</pre></div>',
    );
  });

  it("renders total token reminders", () => {
    const html = renderBanner({
      type: "total_tokens_reminder",
      text: "<total_tokens>10000000 tokens left</total_tokens>",
    });

    expect(html).toStrictEqual(
      '<div class="flex flex-wrap items-center gap-2 py-1.5 px-3 text-xs text-t6 bg-surface-1 rounded-md border border-subtle"><span class="shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hourglass h-3.5 w-3.5" aria-hidden="true"><path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path></svg></span><span>Token budget reminder</span><pre class="w-full mt-1 text-[10px] leading-tight text-t6 bg-surface-0 rounded px-2 py-1 whitespace-pre-wrap break-all">&lt;total_tokens&gt;10000000 tokens left&lt;/total_tokens&gt;</pre></div>',
    );
  });

  describe("queued_command", () => {
    it("renders a relative timestamp with an absolute title when timestamp is present", () => {
      const html = renderBanner({
        type: "queued_command",
        prompt: "do the thing",
        timestamp: "2020-01-15T08:30:00.000Z",
      });
      expect(html).toContain("ago");
      expect(html).toContain("2020");
    });

    it("omits the timestamp span when no timestamp is present", () => {
      const html = renderBanner({
        type: "queued_command",
        prompt: "do the thing",
      });
      expect(html).not.toContain("ago");
    });
  });

  describe("deferred_tools_delta", () => {
    it("appends a pluralized pending MCP server count to the banner label", () => {
      const html = renderBanner({
        type: "deferred_tools_delta",
        addedNames: ["WebFetch"],
        pendingMcpServers: ["context7", "github"],
      });
      expect(html).toContain("2 MCP servers pending");
    });

    it("uses the singular form for a single pending MCP server", () => {
      const html = renderBanner({
        type: "deferred_tools_delta",
        pendingMcpServers: ["context7"],
      });
      expect(html).toContain("1 MCP server pending");
      expect(html).not.toContain("1 MCP servers pending");
    });

    it("omits the pending segment when there are no pending MCP servers", () => {
      const html = renderBanner({
        type: "deferred_tools_delta",
        addedNames: ["WebFetch"],
      });
      expect(html).not.toContain("MCP server");
    });
  });

  it("links team context to tasks and identifies its source files", async () => {
    const html = await renderBannerWithRouter({
      type: "team_context",
      agentId: "agent-100",
      agentName: "alice",
      teamName: "webapp",
      teamConfigPath: "/Users/craig/.claude/teams/webapp/config.json",
      taskListPath: "/Users/craig/.claude/tasks/webapp/tasks.json",
    });

    expect(html).toContain("Team: alice (webapp)");
    expect(html).toContain('href="/tasks"');
    expect(html).toContain("View tasks");
    expect(html).toContain("/Users/craig/.claude/teams/webapp/config.json");
    expect(html).toContain('title="/Users/craig/.claude/tasks/webapp/tasks.json"');
  });
});
