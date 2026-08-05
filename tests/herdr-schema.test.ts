import { describe, expect, it } from "vite-plus/test";
import {
  HerdrErrorBodySchema,
  HerdrPaneAgentStatusChangedEventSchema,
  HerdrPaneInfoSchema,
  HerdrPongResultSchema,
  HerdrSessionSnapshotResultSchema,
} from "../src/lib/herdr/schema";

describe("herdr wire schemas", () => {
  it("parses the supported response and event shapes", () => {
    const pong = {
      type: "pong" as const,
      version: "99.0.0-test",
      protocol: 100,
      capabilities: {
        live_handoff: true,
        detached_server_daemon: false,
      },
    };
    const snapshot = {
      type: "session_snapshot" as const,
      snapshot: {
        version: "99.0.0-test",
        protocol: 100,
        workspaces: [],
        tabs: [],
        panes: [],
        layouts: [],
        agents: [],
        focused_workspace_id: null,
        focused_tab_id: null,
        focused_pane_id: null,
      },
    };
    const error = { code: "test_error", message: "fabricated test error" };
    const event = {
      type: "pane_agent_status_changed" as const,
      pane_id: "w100:p100",
      workspace_id: "w100",
      agent_status: "working",
      agent: "claude",
      display_agent: "Claude",
      state_labels: { phase: "test" },
      title: "Test agent",
    };

    expect({
      pong: HerdrPongResultSchema.parse(pong),
      snapshot: HerdrSessionSnapshotResultSchema.parse(snapshot),
      error: HerdrErrorBodySchema.parse(error),
      event: HerdrPaneAgentStatusChangedEventSchema.parse(event),
    }).toStrictEqual({ pong, snapshot, error, event });
  });

  it("preserves unknown fields and accepts future agent statuses", () => {
    const payload = {
      type: "session_snapshot" as const,
      future_result_field: "future-result-value",
      snapshot: {
        version: "99.0.0-test",
        protocol: 100,
        workspaces: [],
        tabs: [],
        panes: [
          {
            pane_id: "w100:p100",
            terminal_id: "term_test_100",
            workspace_id: "w100",
            tab_id: "w100:t100",
            focused: true,
            cwd: "/tmp/test/workspace",
            foreground_cwd: "/tmp/test/workspace/src",
            agent: "future-agent",
            agent_status: "waiting-for-review",
            agent_session: {
              source: "test-source",
              agent: "future-agent",
              kind: "id" as const,
              value: "session-test-100",
            },
            terminal_title: "Test terminal",
            scroll: {
              offset_from_bottom: 0,
              max_offset_from_bottom: 100,
              viewport_rows: 50,
            },
            revision: 100,
            future_pane_field: { enabled: true },
          },
        ],
        layouts: [],
        agents: [],
        focused_workspace_id: "w100",
        focused_tab_id: "w100:t100",
        focused_pane_id: "w100:p100",
        future_snapshot_field: 100,
      },
    };

    expect({
      snapshot: HerdrSessionSnapshotResultSchema.parse(payload),
      pane: HerdrPaneInfoSchema.parse(payload.snapshot.panes[0]),
    }).toStrictEqual({ snapshot: payload, pane: payload.snapshot.panes[0] });
  });
});
