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

export function decodeTerminalBytes(value: string): Uint8Array {
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

/**
 * Shell tab wire protocol, mirroring claude.ai/code's desktop PTY: the client
 * sends `{resize, data, close}` and the server answers `{opened(buffered),
 * data, exit, error}`. Terminal text travels as base64 of its UTF-8 bytes.
 */
const MAXIMUM_SHELL_TEXT = 4 * 1024 * 1024;
const ShellTextSchema = z.string().max(MAXIMUM_SHELL_TEXT).regex(BASE64);
const ShellDimensionSchema = z.number().int().positive().max(1000);

const ShellClientFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("data"), data: ShellTextSchema }).strict(),
  z
    .object({ type: z.literal("resize"), cols: ShellDimensionSchema, rows: ShellDimensionSchema })
    .strict(),
  z.object({ type: z.literal("close") }).strict(),
]);

const ShellServerFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("opened"), buffered: ShellTextSchema }).strict(),
  z.object({ type: z.literal("data"), data: ShellTextSchema }).strict(),
  z
    .object({
      type: z.literal("exit"),
      exitCode: z.number().int(),
      signal: z.number().int().nullable(),
    })
    .strict(),
  z.object({ type: z.literal("error"), message: z.string().min(1) }).strict(),
]);

export type ShellClientFrame = z.infer<typeof ShellClientFrameSchema>;
export type ShellServerFrame = z.infer<typeof ShellServerFrameSchema>;

export function parseShellClientFrame(message: string): ShellClientFrame {
  return ShellClientFrameSchema.parse(JSON.parse(message));
}

export function parseShellServerFrame(message: string): ShellServerFrame {
  return ShellServerFrameSchema.parse(JSON.parse(message));
}

const BASE64_CHUNK = 0x8000;

export function encodeTerminalText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function decodeTerminalText(value: string): string {
  return new TextDecoder().decode(decodeTerminalBytes(value));
}
