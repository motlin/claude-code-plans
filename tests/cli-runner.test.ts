import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { spawnClaude } from "../src/lib/cli-runner";

function fakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("spawnClaude", () => {
  it("preserves multi-byte UTF-8 characters split across stdout chunks", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const expected = Buffer.from('{"message":"Alice 🌱"}\n');
    const characterStart = expected.indexOf(Buffer.from("🌱"));

    const { stream } = spawnClaude({
      sessionId: "session-test-100",
      prompt: "Review Alice's fixture",
      projectDir: "/fixture/alice-repository",
      environment: { FIXTURE: "alice" },
    });
    child.stdout!.emit("data", expected.subarray(0, characterStart + 2));
    child.stdout!.emit("data", expected.subarray(characterStart + 2));
    child.emit("close", 0);

    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toStrictEqual(
      new Uint8Array(expected),
    );
  });
});
