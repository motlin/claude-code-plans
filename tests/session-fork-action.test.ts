import { describe, expect, it, vi } from "vite-plus/test";

import type { ToastOptions } from "../src/components/toast";
import { launchHerdrSession } from "../src/lib/api/herdr";
import { validateClaudeLaunchArgs } from "../src/lib/claude-launch-command";
import {
  FORK_NAVIGATION_WINDOW_MS,
  findForkedSession,
  forkDisabledReason,
  forkSession,
  sessionForkArgs,
  sessionForkCommand,
  type ForkDependencies,
  type PendingFork,
} from "../src/lib/session-fork";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const FORK_ID = "1d2e3f40-5555-4666-8777-988889999000";
const CWD = "/Users/alice/my project";
const NOW = 1_780_000_000_000;

function dependencies(overrides: Partial<ForkDependencies> = {}) {
  const launch = vi.fn<ForkDependencies["launch"]>();
  const copy = vi.fn<ForkDependencies["copy"]>();
  const toast = vi.fn<(options: ToastOptions) => void>();
  const onLaunched = vi.fn<(pending: PendingFork) => void>();
  launch.mockResolvedValue({ sessionId: null });
  copy.mockResolvedValue(true);
  const deps: ForkDependencies = {
    herdrWritable: true,
    launch,
    copy,
    toast,
    onLaunched,
    now: () => NOW,
    ...overrides,
  };
  return { deps, launch, copy, toast, onLaunched };
}

describe("sessionForkArgs", () => {
  it("resumes the session as a fork, in a form the launch API accepts", () => {
    const args = sessionForkArgs(SESSION_ID);

    expect(args).toEqual(["--resume", SESSION_ID, "--fork-session"]);
    expect(validateClaudeLaunchArgs(args)).toBeNull();
  });
});

describe("sessionForkCommand", () => {
  it("cds into the quoted session directory before forking", () => {
    expect(sessionForkCommand(SESSION_ID, CWD)).toBe(
      `cd '/Users/alice/my project' && claude --resume ${SESSION_ID} --fork-session`,
    );
  });
});

describe("launchHerdrSession", () => {
  it("posts the fork argv without a prompt", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValue(
      Response.json({ ok: true, tabId: "w1:t2", paneId: "w1:p3", sessionId: null }),
    );

    await launchHerdrSession({ cwd: CWD, args: sessionForkArgs(SESSION_ID) }, fetcher);

    expect(fetcher.mock.calls).toEqual([
      [
        "/api/herdr/launch",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: CWD, args: ["--resume", SESSION_ID, "--fork-session"] }),
        },
      ],
    ]);
  });
});

describe("forkSession", () => {
  it("launches the fork in herdr and hands back the pending launch", async () => {
    const { deps, launch, copy, toast, onLaunched } = dependencies();
    launch.mockResolvedValue({ sessionId: FORK_ID });

    const outcome = await forkSession({ sessionId: SESSION_ID, cwd: CWD }, deps);

    expect(outcome).toBe("launched");
    expect(launch.mock.calls).toEqual([
      [{ cwd: CWD, args: ["--resume", SESSION_ID, "--fork-session"] }],
    ]);
    expect(onLaunched.mock.calls).toEqual([
      [{ cwd: CWD, since: NOW, sessionId: FORK_ID, parentSessionId: SESSION_ID }],
    ]);
    expect(copy).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("copies the exact fork command when herdr writes are disabled", async () => {
    const { deps, launch, copy, toast, onLaunched } = dependencies({ herdrWritable: false });

    const outcome = await forkSession({ sessionId: SESSION_ID, cwd: CWD }, deps);

    expect(outcome).toBe("copied");
    expect(launch).not.toHaveBeenCalled();
    expect(onLaunched).not.toHaveBeenCalled();
    expect(copy.mock.calls).toEqual([
      [`cd '/Users/alice/my project' && claude --resume ${SESSION_ID} --fork-session`],
    ]);
    expect(toast.mock.calls).toEqual([
      [
        {
          kind: "success",
          message: "Command copied. Paste it in a terminal to fork this session.",
        },
      ],
    ]);
  });

  it("falls back to copying the command when the herdr launch fails", async () => {
    const { deps, launch, copy, toast, onLaunched } = dependencies();
    launch.mockRejectedValue(new Error("herdr is not running"));

    const outcome = await forkSession({ sessionId: SESSION_ID, cwd: CWD }, deps);

    expect(outcome).toBe("copied");
    expect(onLaunched).not.toHaveBeenCalled();
    expect(copy.mock.calls).toEqual([
      [`cd '/Users/alice/my project' && claude --resume ${SESSION_ID} --fork-session`],
    ]);
    expect(toast.mock.calls).toEqual([
      [
        {
          kind: "success",
          message: "Command copied. Paste it in a terminal to fork this session.",
        },
      ],
    ]);
  });

  it("reports an error when the fallback copy fails too", async () => {
    const { deps, copy, toast } = dependencies({ herdrWritable: false });
    copy.mockResolvedValue(false);

    const outcome = await forkSession({ sessionId: SESSION_ID, cwd: CWD }, deps);

    expect(outcome).toBe("failed");
    expect(toast.mock.calls).toEqual([
      [{ kind: "error", message: "Couldn’t fork the session. Try again." }],
    ]);
  });
});

describe("forkDisabledReason", () => {
  it("disables forking while the session file is still being written", () => {
    expect(forkDisabledReason({ working: true, cwd: CWD })).toBe(
      "Session file is still being written",
    );
  });

  it("disables forking when the session directory is unknown", () => {
    expect(forkDisabledReason({ working: false, cwd: null })).toBe("Session directory is unknown");
  });

  it("allows forking an idle session with a directory", () => {
    expect(forkDisabledReason({ working: false, cwd: CWD })).toBeNull();
  });
});

describe("findForkedSession", () => {
  const pending: PendingFork = {
    cwd: CWD,
    since: NOW,
    sessionId: null,
    parentSessionId: SESSION_ID,
  };

  it("ignores the parent session resuming in the same directory", () => {
    expect(
      findForkedSession([{ sessionId: SESSION_ID, cwd: CWD, startedAt: NOW + 10 }], pending),
    ).toBeNull();
  });

  it("finds the fork's SessionStart in the session directory", () => {
    expect(
      findForkedSession(
        [
          { sessionId: SESSION_ID, cwd: CWD, startedAt: NOW + 10 },
          { sessionId: FORK_ID, cwd: `${CWD}/`, startedAt: NOW + 20 },
        ],
        pending,
      ),
    ).toBe(FORK_ID);
  });

  it("ignores sessions that started before the fork or long after it", () => {
    expect(
      findForkedSession(
        [
          { sessionId: "before", cwd: CWD, startedAt: NOW - 1 },
          { sessionId: "later", cwd: CWD, startedAt: NOW + FORK_NAVIGATION_WINDOW_MS + 1 },
        ],
        pending,
      ),
    ).toBeNull();
  });

  it("does not treat herdr's parent id as the fork", () => {
    expect(
      findForkedSession([{ sessionId: FORK_ID, cwd: "/elsewhere", startedAt: NOW + 5 }], {
        ...pending,
        sessionId: SESSION_ID,
      }),
    ).toBeNull();
    expect(
      findForkedSession([{ sessionId: FORK_ID, cwd: "/elsewhere", startedAt: NOW + 5 }], {
        ...pending,
        sessionId: FORK_ID,
      }),
    ).toBe(FORK_ID);
  });
});
