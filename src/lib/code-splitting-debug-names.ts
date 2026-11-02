function isObject(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null;
}

/**
 * Nitro's server build splits node_modules into per-package chunks through a code-splitting group whose `name` is a
 * function, and rolldown warns on every build until such a group carries a `debugName` for its timing report.
 * Nitro's `rollup:before` hook hands over the config the server environment builds with, so this labels it in place.
 */
export function nameCodeSplittingGroups(config: unknown, debugName: string): void
{
	if (!isObject(config)) return;
	const outputs: unknown[] = Array.isArray(config["output"]) ? config["output"] : [config["output"]];
	for (const output of outputs)
	{
		if (!isObject(output) || !isObject(output["codeSplitting"])) continue;
		const groups: unknown = output["codeSplitting"]["groups"];
		if (!Array.isArray(groups)) continue;
		for (const group of groups as unknown[])
		{
			if (isObject(group) && typeof group["name"] === "function") group["debugName"] ??= debugName;
		}
	}
}
