/**
 * The active chain of a CLI transcript, computed over the whole JSONL file.
 *
 * The CLI keeps abandoned branches in the file: a prompt pulled back and
 * resent, or an interrupted reply followed by a prompt re-parented onto the
 * same parent. Its resume loader walks `parentUuid` from the leaf, so those
 * rows are off the active chain. A plain leaf walk would also drop parallel
 * tool results and compaction preserved segments, which the CLI keeps, so the
 * rule here is narrower: hide only the subtrees of user-prompt siblings that
 * share a parent with an on-chain prompt.
 *
 * See .llm/upstream-sync/features/transcript-active-chain-paging.md.
 */

import {isRecord} from "./narrow";

type TranscriptRecord = Record<string, unknown>;

export interface AbandonedCut
{
	/** The parent both the abandoned prompt and its replacement hang off. */
	parentUuid: string;
	/** The on-chain sibling prompt that replaced the abandoned one (for a rewind with nothing sent since, the anchor). */
	replacementUuid: string;
	/** The root of the hidden subtree. */
	abandonedUuid: string;
	/** The abandoned prompt's timestamp. */
	at: string;
	/** Size of the hidden subtree, root included. */
	count: number;
}

export interface AbandonedBranches
{
	hidden: Set<string>;
	cuts: AbandonedCut[];
}

function stringField(record: TranscriptRecord, key: string): string | undefined
{
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function isMessage(record: TranscriptRecord): boolean
{
	return record["type"] === "user" || record["type"] === "assistant";
}

/** A user record's prompt text (its text blocks joined by spaces), or undefined for tool results and non-text content. */
export function promptText(record: TranscriptRecord): string | undefined
{
	const message = record["message"];
	if (!isRecord(message))
	{
		return undefined;
	}
	const content = message["content"];
	if (typeof content === "string")
	{
		return content;
	}
	if (!Array.isArray(content))
	{
		return undefined;
	}
	let hasToolResult = false;
	const texts: string[] = [];
	for (const block of content)
	{
		if (!isRecord(block))
		{
			continue;
		}
		if (block["type"] === "tool_result")
		{
			hasToolResult = true;
		}
		else if (block["type"] === "text" && typeof block["text"] === "string")
		{
			texts.push(block["text"]);
		}
	}
	return hasToolResult || texts.length === 0 ? undefined : texts.join(" ");
}

/** A user prompt: string content or a text block, not meta, not a tool result, not a task notification. */
export function isPrompt(record: TranscriptRecord): boolean
{
	if (record["type"] !== "user" || record["isMeta"] === true)
	{
		return false;
	}
	const text = promptText(record);
	return text !== undefined && text.trim() !== "" && !text.startsWith("<task-notification");
}

const SKELETON_FIELDS = [
	"type",
	"uuid",
	"parentUuid",
	"isSidechain",
	"isMeta",
	"timestamp",
	"leafUuid",
	"rewound",
	"cutUuid",
] as const;

/**
 * The part of a record `computeAbandoned` reads, so a cache can keep a whole
 * file's chain inputs without holding every message body. A prompt keeps only
 * its text; every other record drops `message`, which `computeAbandoned` reads
 * for nothing but prompt detection.
 */
export function chainSkeleton(record: TranscriptRecord): TranscriptRecord
{
	const skeleton: TranscriptRecord = {};
	for (const field of SKELETON_FIELDS)
	{
		if (Object.hasOwn(record, field)) skeleton[field] = record[field];
	}
	if (isPrompt(record))
		skeleton["message"] =
		{
			content: promptText(record),
		};
	return skeleton;
}

/** The nearest user/assistant row at or above `uuid`, or undefined when the walk leaves the file. */
function messageAncestor(byUuid: Map<string, TranscriptRecord>, start: string): string | undefined
{
	const seen = new Set<string>();
	let uuid: string | undefined = start;
	while (uuid !== undefined && !seen.has(uuid))
	{
		seen.add(uuid);
		const current = byUuid.get(uuid);
		if (current === undefined)
		{
			return undefined;
		}
		if (isMessage(current))
		{
			return uuid;
		}
		uuid = stringField(current, "parentUuid");
	}
	return undefined;
}

function findLeaf(byUuid: Map<string, TranscriptRecord>, records: TranscriptRecord[]): string | undefined
{
	for (const record of records.toReversed())
	{
		if (record["type"] !== "last-prompt")
		{
			continue;
		}
		// A `leafUuid: null` withdrawal has no string and falls through to the next older checkpoint, as the CLI does.
		const leafUuid = stringField(record, "leafUuid");
		if (leafUuid === undefined || !byUuid.has(leafUuid))
		{
			continue;
		}
		const leaf = messageAncestor(byUuid, leafUuid);
		if (leaf !== undefined)
		{
			return leaf;
		}
		break;
	}
	for (const record of records.toReversed())
	{
		const uuid = stringField(record, "uuid");
		if (uuid !== undefined && record["isSidechain"] !== true && isMessage(record))
		{
			return uuid;
		}
	}
	return undefined;
}

export function computeAbandoned(records: TranscriptRecord[]): AbandonedBranches
{
	const byUuid = new Map<string, TranscriptRecord>();
	/** Child uuids per parent uuid, in file order. */
	const children = new Map<string, string[]>();
	/** Each record's position in the file, so a rewind keeps rows written after its checkpoint. */
	const fileIndex = new Map<string, number>();
	for (const [index, record] of records.entries())
	{
		const uuid = stringField(record, "uuid");
		if (uuid === undefined || record["isSidechain"] === true)
		{
			continue;
		}
		byUuid.set(uuid, record);
		fileIndex.set(uuid, index);
		const parentUuid = stringField(record, "parentUuid");
		if (parentUuid !== undefined)
		{
			const siblings = children.get(parentUuid);
			if (siblings === undefined)
			{
				children.set(parentUuid, [uuid]);
			}
			else
			{
				siblings.push(uuid);
			}
		}
	}

	const chain = new Set<string>();
	let uuid = findLeaf(byUuid, records);
	while (uuid !== undefined && !chain.has(uuid))
	{
		const current = byUuid.get(uuid);
		if (current === undefined)
		{
			break;
		}
		chain.add(uuid);
		uuid = stringField(current, "parentUuid");
	}

	const hidden = new Set<string>();
	const cuts: AbandonedCut[] = [];
	/** Hides `root`'s subtree (rows before `limit` in file order only) and returns how many rows it hid. */
	const hideSubtree = (root: string, limit = Number.POSITIVE_INFINITY): number =>
	{
		let count = 0;
		const stack = [root];
		for (let next = stack.pop(); next !== undefined; next = stack.pop())
		{
			if (hidden.has(next) || (fileIndex.get(next) ?? 0) >= limit)
			{
				continue;
			}
			hidden.add(next);
			count++;
			stack.push(...(children.get(next) ?? []));
		}
		return count;
	};
	for (const [parentUuid, siblings] of children)
	{
		const prompts = siblings.filter((sibling) =>
		{
			const record = byUuid.get(sibling);
			return record !== undefined && isPrompt(record);
		});
		if (prompts.length < 2)
		{
			continue;
		}
		const replacementUuid = prompts.find((sibling) => chain.has(sibling));
		if (replacementUuid === undefined)
		{
			continue;
		}
		for (const abandonedUuid of prompts)
		{
			if (chain.has(abandonedUuid))
			{
				continue;
			}
			const count = hideSubtree(abandonedUuid);
			cuts.push(
				{
					parentUuid,
					replacementUuid,
					abandonedUuid,
					at: stringField(byUuid.get(abandonedUuid) ?? {}, "timestamp") ?? "",
					count,
				},
			);
		}
	}

	// Terminal rewinds: each rewound checkpoint whose anchor is on the chain cuts the anchor's off-chain children written before it.
	for (const [checkpointIndex, record] of records.entries())
	{
		if (record["type"] !== "last-prompt" || record["rewound"] !== true)
		{
			continue;
		}
		const leafUuid = stringField(record, "leafUuid");
		const anchor = leafUuid === undefined ? undefined : messageAncestor(byUuid, leafUuid);
		if (anchor === undefined || !chain.has(anchor))
		{
			continue;
		}
		const anchorChildren = children.get(anchor) ?? [];
		const offChain = anchorChildren.filter(
			(child) => !chain.has(child) && (fileIndex.get(child) ?? 0) < checkpointIndex,
		);
		const cutUuid = stringField(record, "cutUuid");
		const roots = cutUuid !== undefined && offChain.includes(cutUuid) ? [cutUuid] : offChain;
		const replacementUuid =
			anchorChildren.find((child) => chain.has(child) && (fileIndex.get(child) ?? 0) > checkpointIndex) ?? anchor;
		for (const abandonedUuid of roots)
		{
			if (hidden.has(abandonedUuid))
			{
				continue;
			}
			const count = hideSubtree(abandonedUuid, checkpointIndex);
			cuts.push(
				{
					parentUuid: anchor,
					replacementUuid,
					abandonedUuid,
					at: stringField(byUuid.get(abandonedUuid) ?? {}, "timestamp") ?? "",
					count,
				},
			);
		}
	}
	return {
		hidden,
		cuts,
	};
}
