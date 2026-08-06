import { describe, expect, it, vi } from "vite-plus/test";
import { createTerminalFrameConsumer } from "../src/lib/herdr/terminal-protocol";

function message(sequence: number, full: boolean, text: string): string {
  return JSON.stringify({
    type: "terminal.frame",
    seq: sequence,
    encoding: "ansi",
    width: 100,
    height: 30,
    full,
    bytes: btoa(text),
  });
}

function createWriter() {
  return {
    reset: vi.fn<() => void>(),
    resize: vi.fn<(columns: number, rows: number) => void>(),
    write: vi.fn<(bytes: Uint8Array) => void>(),
  };
}

describe("browser terminal frame consumer", () => {
  it("decodes ANSI bytes and tracks monotonic sequence state", () => {
    const writer = createWriter();
    const consumer = createTerminalFrameConsumer(writer);

    const records = [
      consumer.consume(message(100, true, "Alice full screen")),
      consumer.consume(message(200, false, "Alice incremental screen")),
    ];

    expect({
      records,
      sequence: consumer.sequence(),
      reset: writer.reset.mock.calls,
      resize: writer.resize.mock.calls,
      writes: writer.write.mock.calls,
    }).toStrictEqual({
      records: [
        JSON.parse(message(100, true, "Alice full screen")),
        JSON.parse(message(200, false, "Alice incremental screen")),
      ],
      sequence: 200,
      reset: [[]],
      resize: [[100, 30]],
      writes: [
        [new TextEncoder().encode("Alice full screen")],
        [new TextEncoder().encode("Alice incremental screen")],
      ],
    });
  });

  it("requires every reconnected socket to supply a fresh full keyframe", () => {
    const firstWriter = createWriter();
    const firstConnection = createTerminalFrameConsumer(firstWriter);
    firstConnection.consume(message(100, true, "Alice first connection"));

    const secondWriter = createWriter();
    const secondConnection = createTerminalFrameConsumer(secondWriter);
    expect(() => secondConnection.consume(message(200, false, "stale incremental"))).toThrow(
      "terminal observer did not begin with a full keyframe",
    );
    const recovered = secondConnection.consume(message(300, true, "Alice recovered screen"));

    expect({
      firstSequence: firstConnection.sequence(),
      secondSequence: secondConnection.sequence(),
      recovered,
      secondReset: secondWriter.reset.mock.calls,
      secondWrites: secondWriter.write.mock.calls,
    }).toStrictEqual({
      firstSequence: 100,
      secondSequence: 300,
      recovered: JSON.parse(message(300, true, "Alice recovered screen")),
      secondReset: [[]],
      secondWrites: [[new TextEncoder().encode("Alice recovered screen")]],
    });
  });

  it("rejects malformed records and non-advancing sequences", () => {
    const consumer = createTerminalFrameConsumer(createWriter());
    consumer.consume(message(100, true, "Alice full screen"));

    expect(() => consumer.consume('{"type":"terminal.frame"}')).toThrow();
    expect(() => consumer.consume(message(100, false, "Alice repeated frame"))).toThrow(
      "terminal frame sequence did not advance",
    );
  });
});
