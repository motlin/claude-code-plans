import { describe, it, expect } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { AttachmentBanner } from "../src/components/attachment-banner";
import { AttachmentPayloadSchema, type AttachmentPayload } from "../src/lib/schemas";

function renderBanner(payload: AttachmentPayload): string {
  return renderToStaticMarkup(<AttachmentBanner attachmentJson={JSON.stringify(payload)} />);
}

const MINIMAL_BY_TYPE: Record<string, AttachmentPayload> = {
  plan_mode: { type: "plan_mode" },
  auto_mode: { type: "auto_mode" },
  plan_file_reference: { type: "plan_file_reference" },
  nested_memory: { type: "nested_memory" },
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
  deferred_tools_delta: { type: "deferred_tools_delta" },
  mcp_instructions_delta: { type: "mcp_instructions_delta" },
  skill_listing: { type: "skill_listing" },
  task_reminder: { type: "task_reminder" },
  todo_reminder: { type: "todo_reminder" },
  edited_text_file: { type: "edited_text_file", filename: "f.ts" },
  file: { type: "file", filename: "f.ts" },
  directory: { type: "directory" },
  compact_file_reference: { type: "compact_file_reference" },
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
      expect(html).toContain("Command rejected by policy");
      expect(html).toContain("text-text-600");
    });

    it("does not render a blocking message when blockingError is absent", () => {
      const html = renderBanner({
        type: "hook_blocking_error",
        hookName: "policy-guard",
        hookEvent: "PreToolUse",
      });
      expect(html).not.toContain("text-text-600");
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
});
