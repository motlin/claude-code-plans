import { z } from "zod";

const BASE64 = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/;

const HerdrTerminalFrameSchema = z
  .object({
    type: z.literal("terminal.frame"),
    seq: z.number().int().nonnegative(),
    encoding: z.literal("ansi"),
    width: z.number().int().positive().max(1000),
    height: z.number().int().positive().max(1000),
    full: z.boolean(),
    bytes: z
      .string()
      .max(4 * 1024 * 1024)
      .regex(BASE64),
  })
  .strict();

const HerdrTerminalClosedSchema = z.object({ type: z.literal("terminal.closed") }).passthrough();

export const HerdrTerminalRecordSchema = z.union([
  HerdrTerminalFrameSchema,
  HerdrTerminalClosedSchema,
]);

export type HerdrTerminalRecord = z.infer<typeof HerdrTerminalRecordSchema>;

const TerminalObserverConnectedSchema = z.object({ type: z.literal("connected") }).strict();
const TerminalObserverErrorSchema = z
  .object({
    type: z.literal("observer.error"),
    message: z.string().min(1),
  })
  .strict();
const TerminalObserverMessageSchema = z.union([
  HerdrTerminalRecordSchema,
  TerminalObserverConnectedSchema,
  TerminalObserverErrorSchema,
]);
type TerminalObserverMessage = z.infer<typeof TerminalObserverMessageSchema>;

export interface TerminalFrameWriter {
  reset: () => void;
  resize: (columns: number, rows: number) => void;
  write: (bytes: Uint8Array) => void;
}

export interface TerminalFrameConsumer {
  consume: (message: string) => TerminalObserverMessage;
  sequence: () => number | null;
}

function decodeTerminalBytes(value: string): Uint8Array {
  if (!BASE64.test(value)) throw new Error("terminal frame bytes are not valid base64");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** A new consumer is required per WebSocket so reconnects must begin with a keyframe. */
export function createTerminalFrameConsumer(writer: TerminalFrameWriter): TerminalFrameConsumer {
  let lastSequence: number | null = null;

  return {
    consume(message) {
      const record = TerminalObserverMessageSchema.parse(JSON.parse(message));
      if (record.type !== "terminal.frame") return record;

      if (lastSequence === null && !record.full) {
        throw new Error("terminal observer did not begin with a full keyframe");
      }
      if (lastSequence !== null && record.seq <= lastSequence) {
        throw new Error("terminal frame sequence did not advance");
      }

      if (record.full) {
        writer.reset();
        writer.resize(record.width, record.height);
      }
      writer.write(decodeTerminalBytes(record.bytes));
      lastSequence = record.seq;
      return record;
    },
    sequence: () => lastSequence,
  };
}
