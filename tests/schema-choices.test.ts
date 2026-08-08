import { describe, expect, it } from "vite-plus/test";
import { HookEventEnvelope, ToolUseUnion } from "../src/lib/hook-events";
import { PluginFileSchema, PluginListResponse } from "../src/lib/api/plugins";
import { SessionSummaryStateSchema } from "../src/lib/api/sessions";
import { SourceFileResponse } from "../src/lib/api/source";
import { schemaChoiceRegistry } from "../src/lib/schema-choices";
import {
  AttachmentPayloadSchema,
  ClaudeSettingsSchema,
  ContentBlockSchema,
  JsonlRecordSchema,
  McpConfigSchema,
  SessionsIndexSchema,
  TaskFileSchema,
  TaskStatusSchema,
  UserRecordSchema,
} from "../src/lib/schemas";
import { RenderedLineSchema } from "../src/lib/transcript";

/**
 * Walks the Zod schema trees rooted below and records every "choice" node —
 * z.enum values and union variant tags (explicit discriminatedUnion, or plain
 * unions whose arms all share a single literal field, like HookEventEnvelope).
 * Each discovered node must have an entry in `schemaChoiceRegistry` whose key
 * set exactly matches the schema's values. A new enum value, a new union
 * variant, or an entirely new enum anywhere in these trees turns this test red
 * until the registry (and any designated exhaustive handler) is updated.
 */

// Specific schemas are listed before their containers so shared subtrees get
// claimed under their own exported names (the walker visits each node once).
const ROOTS: ReadonlyArray<readonly [string, unknown]> = [
  ["TaskStatusSchema", TaskStatusSchema],
  ["SessionSummaryStateSchema", SessionSummaryStateSchema],
  ["ContentBlockSchema", ContentBlockSchema],
  ["AttachmentPayloadSchema", AttachmentPayloadSchema],
  ["UserRecordSchema", UserRecordSchema],
  ["JsonlRecordSchema", JsonlRecordSchema],
  ["TaskFileSchema", TaskFileSchema],
  ["SessionsIndexSchema", SessionsIndexSchema],
  ["ClaudeSettingsSchema", ClaudeSettingsSchema],
  ["McpConfigSchema", McpConfigSchema],
  ["RenderedLineSchema", RenderedLineSchema],
  ["ToolUseUnion", ToolUseUnion],
  ["HookEventEnvelope", HookEventEnvelope],
  ["SourceFileResponse", SourceFileResponse],
  ["PluginFileSchema", PluginFileSchema],
  ["PluginListResponse", PluginListResponse],
];

interface DefLike {
  type: string;
  innerType?: unknown;
  discriminator?: unknown;
  values?: unknown[];
  checks?: Array<{
    _zod?: { def?: { format?: string; prefix?: string } };
  }>;
  element?: unknown;
  valueType?: unknown;
  getter?: () => unknown;
  items?: unknown[];
  left?: unknown;
  right?: unknown;
}

function defOf(schema: unknown): DefLike {
  return (schema as { def: DefLike }).def;
}

function shapeOf(schema: unknown): Record<string, unknown> {
  return (schema as { shape: Record<string, unknown> }).shape;
}

function optionsOf(schema: unknown): unknown[] {
  return (schema as { options: unknown[] }).options;
}

/** Strips optional/nullable/default wrappers. */
function unwrap(schema: unknown): unknown {
  let current = schema;
  let def = defOf(current);
  while (def.innerType !== undefined) {
    current = def.innerType;
    def = defOf(current);
  }
  return current;
}

/** Flattens nested unions into their object arms (unwrapping wrappers). */
function flattenUnionArms(schema: unknown): unknown[] {
  const arms: unknown[] = [];
  for (const option of optionsOf(schema)) {
    const inner = unwrap(option);
    if (defOf(inner).type === "union") {
      arms.push(...flattenUnionArms(inner));
    } else {
      arms.push(inner);
    }
  }
  return arms;
}

/** Literal or enum values of a variant's discriminator field. */
function tagsOfVariant(variant: unknown, discriminator: string): string[] {
  const field = unwrap(shapeOf(variant)[discriminator]);
  const def = defOf(field);
  if (def.type === "literal") {
    return (def.values ?? []).map(String);
  }
  if (def.type === "enum") {
    return optionsOf(field).map(String);
  }
  const startsWith = def.checks?.find((check) => check._zod?.def?.format === "starts_with")?._zod
    ?.def?.prefix;
  if (def.type === "string" && startsWith !== undefined) {
    return [`${startsWith}*`];
  }
  throw new Error(`Discriminator "${discriminator}" is neither literal nor enum`);
}

/**
 * For a plain union: if every flattened arm is an object sharing a common
 * literal-typed field, that field acts as a de-facto discriminator (e.g.
 * HookEventEnvelope's hook_event_name). When several fields qualify, the one
 * with the most distinct values across arms wins — inside a PreToolUse union
 * every arm has hook_event_name="PreToolUse", so tool_name is the real
 * discriminator. Returns undefined when no common literal field exists.
 */
function defactoDiscriminator(schema: unknown): string | undefined {
  const arms = flattenUnionArms(schema);
  if (arms.length === 0 || arms.some((arm) => defOf(arm).type !== "object")) {
    return undefined;
  }
  let candidates: string[] | undefined;
  for (const arm of arms) {
    const literalKeys = Object.entries(shapeOf(arm))
      .filter(([, field]) => {
        const def = defOf(unwrap(field));
        return (
          def.type === "literal" ||
          def.checks?.some((check) => check._zod?.def?.format === "starts_with")
        );
      })
      .map(([key]) => key);
    candidates =
      candidates === undefined
        ? literalKeys
        : candidates.filter((key) => literalKeys.includes(key));
  }
  const distinctValues = (key: string): number =>
    new Set(arms.flatMap((arm) => tagsOfVariant(arm, key))).size;
  return candidates?.sort().sort((a, b) => distinctValues(b) - distinctValues(a))[0];
}

function collectChoices(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const visited = new Set<unknown>();

  function record(path: string, values: string[]): void {
    found.set(path, [...new Set(values)].sort());
  }

  function walkUnion(schema: unknown, path: string, discriminator: string): void {
    const tags: string[] = [];
    for (const option of optionsOf(schema)) {
      const inner = unwrap(option);
      const innerDef = defOf(inner);
      const optionTags =
        innerDef.type === "union"
          ? flattenUnionArms(inner).flatMap((arm) => tagsOfVariant(arm, discriminator))
          : tagsOfVariant(inner, discriminator);
      tags.push(...optionTags);
      walk(inner, `${path}.<${[...new Set(optionTags)].sort().join("|")}>`);
    }
    record(path, tags);
  }

  function walk(schema: unknown, path: string): void {
    if (visited.has(schema)) return;
    visited.add(schema);
    const def = defOf(schema);
    switch (def.type) {
      case "enum":
        record(path, optionsOf(schema).map(String));
        return;
      case "union": {
        const discriminator =
          typeof def.discriminator === "string" ? def.discriminator : defactoDiscriminator(schema);
        if (discriminator !== undefined) {
          walkUnion(schema, path, discriminator);
        } else {
          for (const [index, option] of optionsOf(schema).entries()) {
            walk(option, `${path}|${index}`);
          }
        }
        return;
      }
      case "object":
        for (const [key, field] of Object.entries(shapeOf(schema))) {
          walk(field, `${path}.${key}`);
        }
        return;
      case "optional":
      case "nullable":
      case "default":
        walk(def.innerType, path);
        return;
      case "array":
        walk(def.element, `${path}[]`);
        return;
      case "record":
        walk(def.valueType, `${path}{}`);
        return;
      case "lazy":
        walk(def.getter?.(), path);
        return;
      case "tuple":
        for (const [index, item] of (def.items ?? []).entries()) {
          walk(item, `${path}.${index}`);
        }
        return;
      case "intersection":
        walk(def.left, path);
        walk(def.right, path);
        return;
      default:
        // Scalars, literals, pipes — no enumerable choices beneath.
        return;
    }
  }

  for (const [name, schema] of ROOTS) {
    walk(schema, name);
  }
  return found;
}

describe("schema choice registry", () => {
  const found = collectChoices();

  it("discovers choice nodes in the schema trees", () => {
    expect(found.size).toBeGreaterThan(0);
  });

  it("registers every choice node found in the schemas", () => {
    const problems: string[] = [];
    const sortedEntries = [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [path, values] of sortedEntries) {
      const entry = schemaChoiceRegistry[path];
      if (entry === undefined) {
        problems.push(`UNREGISTERED ${path}: [${values.join(", ")}]`);
        continue;
      }
      const registered = Object.keys(entry).sort();
      if (JSON.stringify(registered) !== JSON.stringify(values)) {
        problems.push(
          `MISMATCH ${path}: schema has [${values.join(", ")}] but registry has [${registered.join(", ")}]`,
        );
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("has no stale registry entries for removed choice nodes", () => {
    const stale = Object.keys(schemaChoiceRegistry).filter((path) => !found.has(path));
    expect(stale, `Registry paths no longer found in any schema: ${stale.join(", ")}`).toEqual([]);
  });
});
