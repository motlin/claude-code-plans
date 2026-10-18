import {stripFrontmatter} from "../components/customize/contents-order";

export interface MemoryFrontmatter {
	name: string | undefined;
	description: string | undefined;
	body: string;
}

/**
 * Memory files open with a `---` fenced YAML block (`name`, `description`,
 * and nested `metadata:` maps). Only the top-level scalar `name` and
 * `description` are surfaced; everything else in the fence is dropped.
 */
export function parseMemoryFrontmatter(markdown: string): MemoryFrontmatter {
	const body = stripFrontmatter(markdown);
	if (body === markdown) return {name: undefined, description: undefined, body};

	const fence = markdown.slice(4, markdown.indexOf("\n---", 3));
	const fields = new Map<string, string>();
	for (const line of fence.split("\n")) {
		const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (match?.[1] !== undefined && match[2]) fields.set(match[1], match[2].trim());
	}
	return {name: fields.get("name"), description: fields.get("description"), body};
}
