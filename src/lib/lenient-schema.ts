import {z} from "zod";

/**
 * Runtime parsing of data Claude Code writes (JSONL transcripts, settings,
 * hook payloads) must survive a new CLI version adding keys or enum values.
 * The schemas in `schemas.ts` stay deep-strict — they are the single source of
 * truth, the TypeScript types, and what the disk-validation tests and the
 * schema-choice registry check, so drift still fails `just verify`.
 * `toLenient` derives the forgiving runtime twin from a strict schema:
 *
 * - strict objects strip unknown keys instead of rejecting them;
 * - string enums accept any string (the unknown value passes through, and the
 *   exhaustive `assertNever` handlers tolerate it at runtime);
 * - enum-keyed records accept any string key;
 * - union discriminators stay closed: an unknown variant has no shape to parse,
 *   so it still fails and takes the caller's unparsed-record path;
 * - refinements, transforms, and every other check are kept.
 *
 * The output type is the strict schema's, so a passed-through enum value is
 * typed as a known one — that is the deliberate trade for keeping one type.
 */
export function toLenient<T extends z.ZodType>(schema: T): z.ZodType<z.output<T>, z.input<T>>;
export function toLenient(schema: z.ZodType): z.core.$ZodType {
	return transform(schema, undefined);
}

type Schema = z.core.$ZodType;

const memo = new WeakMap<Schema, Schema>();
// Discriminator-preserving transforms differ from plain ones, so cache them per key.
const memoKeyed = new WeakMap<Schema, Map<string, Schema>>();

/** `keepKey`: an enclosing discriminated union's discriminator, left closed. */
function transform(schema: Schema, keepKey: string | undefined): Schema {
	const byKey = keepKey === undefined ? undefined : (memoKeyed.get(schema) ?? new Map<string, Schema>());
	const cached = byKey === undefined || keepKey === undefined ? memo.get(schema) : byKey.get(keepKey);
	if (cached) return cached;
	const result = transformUncached(schema, keepKey);
	if (byKey === undefined || keepKey === undefined) {
		memo.set(schema, result);
	} else {
		byKey.set(keepKey, result);
		memoKeyed.set(schema, byKey);
	}
	return result;
}

function transformUncached(schema: Schema, keepKey: string | undefined): Schema {
	const clone = z.core.clone;
	if (schema instanceof z.core.$ZodObject) {
		const {def} = schema._zod;
		const shape: Record<string, Schema> = {};
		for (const [key, value] of Object.entries(def.shape)) {
			shape[key] = key === keepKey ? value : transform(value, undefined);
		}
		const {catchall, ...rest} = def;
		return clone(
			schema,
			catchall === undefined || catchall instanceof z.core.$ZodNever
				? {...rest, shape}
				: {...rest, shape, catchall: transform(catchall, undefined)},
		);
	}
	if (schema instanceof z.core.$ZodUnion) {
		const {def} = schema._zod;
		const discriminator = schema instanceof z.core.$ZodDiscriminatedUnion ? schema._zod.def.discriminator : keepKey;
		return clone(schema, {...def, options: def.options.map((option) => transform(option, discriminator))});
	}
	if (schema instanceof z.core.$ZodEnum) {
		const values = Object.values(schema._zod.def.entries);
		return keepKey === undefined && values.every((value) => typeof value === "string") ? z.string() : schema;
	}
	if (schema instanceof z.core.$ZodRecord) {
		const {def} = schema._zod;
		const keyType = def.keyType instanceof z.core.$ZodEnum ? z.string() : def.keyType;
		return clone(schema, {...def, keyType, valueType: transform(def.valueType, undefined)});
	}
	if (schema instanceof z.core.$ZodArray) {
		const {def} = schema._zod;
		return clone(schema, {...def, element: transform(def.element, undefined)});
	}
	if (schema instanceof z.core.$ZodTuple) {
		const {def} = schema._zod;
		const items = def.items.map((item) => transform(item, undefined));
		return clone(schema, {...def, items, rest: def.rest === null ? null : transform(def.rest, undefined)});
	}
	if (schema instanceof z.core.$ZodIntersection) {
		const {def} = schema._zod;
		return clone(schema, {...def, left: transform(def.left, keepKey), right: transform(def.right, keepKey)});
	}
	if (schema instanceof z.core.$ZodPipe) {
		const {def} = schema._zod;
		return clone(schema, {...def, in: transform(def.in, keepKey), out: transform(def.out, keepKey)});
	}
	if (
		schema instanceof z.core.$ZodOptional ||
		schema instanceof z.core.$ZodNullable ||
		schema instanceof z.core.$ZodDefault ||
		schema instanceof z.core.$ZodPrefault ||
		schema instanceof z.core.$ZodCatch ||
		schema instanceof z.core.$ZodNonOptional ||
		schema instanceof z.core.$ZodReadonly
	) {
		const {def} = schema._zod;
		return clone<typeof schema>(schema, {...def, innerType: transform(def.innerType, keepKey)});
	}
	if (schema instanceof z.core.$ZodLazy) {
		const {getter} = schema._zod.def;
		return z.lazy(() => transform(getter(), keepKey));
	}
	return schema;
}
