import { describe, expect, it, vi } from "vite-plus/test";

import {
  type ComposerPaneState,
  type ComposerSubmit,
  dispatchComposerSubmit,
  forkSubmitLabel,
  launchPromptFork,
  promptForkArgs,
  routeComposerSubmit,
} from "../src/lib/composer-fork-routing";

describe("composer fork routing", () => {
  it("routes live/idle/no-pane × Enter/⌥⌘⏎ to herdr prompt, fork stream or herdr launch", () => {
    const panes: ComposerPaneState[] = ["working", "idle", "none"];
    const submits: ComposerSubmit[] = ["send", "fork"];
    const matrix = panes.flatMap((pane) =>
      submits.map((submit) => [
        `${pane} × ${submit}`,
        routeComposerSubmit({ pane, writesEnabled: true, submit }),
      ]),
    );

    expect(Object.fromEntries(matrix)).toStrictEqual({
      "working × send": "herdr-prompt",
      "working × fork": "herdr-launch",
      "idle × send": "herdr-prompt",
      "idle × fork": "herdr-launch",
      "none × send": "fork-stream",
      "none × fork": "fork-stream",
    });
  });

  it("falls back to the fork stream when herdr writes are disabled", () => {
    expect([
      routeComposerSubmit({ pane: "idle", writesEnabled: false, submit: "send" }),
      routeComposerSubmit({ pane: "idle", writesEnabled: false, submit: "fork" }),
      routeComposerSubmit({ pane: "working", writesEnabled: false, submit: "fork" }),
    ]).toStrictEqual(["fork-stream", "fork-stream", "fork-stream"]);
  });

  it("builds the fork argv as `--resume <id> --fork-session` plus the launch flags", () => {
    expect([
      promptForkArgs("session-alice", {}),
      promptForkArgs("session-alice", {
        permissionMode: "plan",
        model: "opus",
        effort: "high",
      }),
    ]).toStrictEqual([
      ["--resume", "session-alice", "--fork-session"],
      [
        "--resume",
        "session-alice",
        "--fork-session",
        "--permission-mode",
        "plan",
        "--model",
        "opus",
        "--effort",
        "high",
      ],
    ]);
  });

  it("labels the fork as a forked-session send only when a live pane cannot launch", () => {
    expect([
      forkSubmitLabel({ pane: "idle", writesEnabled: true }),
      forkSubmitLabel({ pane: "working", writesEnabled: true }),
      forkSubmitLabel({ pane: "none", writesEnabled: true }),
      forkSubmitLabel({ pane: "idle", writesEnabled: false }),
    ]).toStrictEqual([
      "Fork with this prompt",
      "Fork with this prompt",
      "Fork with this prompt",
      "Send in a forked session",
    ]);
  });

  it("dispatches each route to its target with the prompt, options and argv array", () => {
    const panes: ComposerPaneState[] = ["working", "idle", "none"];
    const submits: ComposerSubmit[] = ["send", "fork"];
    const calls = panes.flatMap((pane) =>
      submits.map((submit) => {
        const targets = {
          sendLive: vi.fn<(prompt: string) => void>(),
          sendForkStream: vi.fn<(prompt: string, options: object) => void>(),
          launchFork: vi.fn<(launch: { cwd: string; prompt: string; args: string[] }) => void>(),
        };
        const route = dispatchComposerSubmit(
          {
            sessionId: "session-bob",
            cwd: "/Users/bob/project",
            pane,
            writesEnabled: true,
            submit,
            prompt: "Try Bob's idea",
            launchOptions: { model: "sonnet" },
          },
          targets,
        );
        return {
          case: `${pane} × ${submit}`,
          route,
          live: targets.sendLive.mock.calls,
          stream: targets.sendForkStream.mock.calls,
          launch: targets.launchFork.mock.calls,
        };
      }),
    );

    const launch = [
      [
        {
          cwd: "/Users/bob/project",
          prompt: "Try Bob's idea",
          args: ["--resume", "session-bob", "--fork-session", "--model", "sonnet"],
        },
      ],
    ];
    const stream = [["Try Bob's idea", { model: "sonnet" }]];
    const live = [["Try Bob's idea"]];
    expect(calls).toStrictEqual([
      { case: "working × send", route: "herdr-prompt", live, stream: [], launch: [] },
      { case: "working × fork", route: "herdr-launch", live: [], stream: [], launch },
      { case: "idle × send", route: "herdr-prompt", live, stream: [], launch: [] },
      { case: "idle × fork", route: "herdr-launch", live: [], stream: [], launch },
      { case: "none × send", route: "fork-stream", live: [], stream, launch: [] },
      { case: "none × fork", route: "fork-stream", live: [], stream, launch: [] },
    ]);
  });
});

describe("launchPromptFork", () => {
  const launch = {
    cwd: "/Users/alice/project",
    prompt: "Try Alice's idea",
    args: ["--resume", "session-alice", "--fork-session"],
  };

  it("launches the fork in herdr and navigates to it once it starts", async () => {
    const onLaunched = vi.fn();
    const toast = vi.fn();
    const launcher = vi.fn().mockResolvedValue({ sessionId: "session-fork" });

    const ok = await launchPromptFork(launch, "session-alice", {
      launch: launcher,
      onLaunched,
      toast,
      now: () => 1_000,
    });

    expect({
      ok,
      launched: launcher.mock.calls,
      pending: onLaunched.mock.calls,
      toasts: toast.mock.calls,
    }).toStrictEqual({
      ok: true,
      launched: [[launch]],
      pending: [
        [
          {
            cwd: "/Users/alice/project",
            since: 1_000,
            sessionId: "session-fork",
            parentSessionId: "session-alice",
          },
        ],
      ],
      toasts: [],
    });
  });

  it("toasts the herdr error when the launch fails", async () => {
    const onLaunched = vi.fn();
    const toast = vi.fn();

    const ok = await launchPromptFork(launch, "session-alice", {
      launch: vi.fn().mockRejectedValue(new Error("herdr is not running")),
      onLaunched,
      toast,
      now: () => 1_000,
    });

    expect({ ok, pending: onLaunched.mock.calls, toasts: toast.mock.calls }).toStrictEqual({
      ok: false,
      pending: [],
      toasts: [
        [
          {
            kind: "error",
            message: "Couldn’t fork the session. Try again.",
            description: "herdr is not running",
          },
        ],
      ],
    });
  });
});
