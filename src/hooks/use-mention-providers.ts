import {useEffect, useMemo, useState} from "react";

import type {MentionOption, MentionProvider} from "../lib/mention-options";

type Answer = readonly MentionOption[] | Promise<readonly MentionOption[]>;

interface Settled
{
	answers: readonly Answer[];
	/** Each promise slot's options once it settles. */
	lists: readonly (readonly MentionOption[] | undefined)[];
}

const NO_ANSWERS: readonly Answer[] = [];

function ask(provider: MentionProvider, query: string): Answer
{
	try
	{
		return provider.fetchOptions(query);
	}
	catch
	{
		return [];
	}
}

/**
 * Each provider's answer to `query` (upstream's mention extension): a synchronous answer is used in the same render,
 * so a cached lookup costs no extra commit; a promise leaves its slot undefined until it settles, and a failed lookup
 * answers `[]`. A null query clears every slot.
 */
export function useMentionProviders(
	providers: readonly MentionProvider[],
	query: string | null,
): readonly (readonly MentionOption[] | undefined)[]
{
	// Asked once per (providers, query), as upstream's extension asks on each query change.
	const answers = useMemo(
		() => (query === null ? NO_ANSWERS : providers.map((provider): Answer => ask(provider, query))),
		[providers, query],
	);
	const [settled, setSettled] = useState<Settled>(
		{
			answers: NO_ANSWERS,
			lists: [],
		},
	);

	useEffect(() =>
	{
		let live = true;
		for (const [index, answer] of answers.entries())
		{
			if (!(answer instanceof Promise)) continue;
			const settle = (options: readonly MentionOption[]) =>
			{
				if (!live) return;
				setSettled((current) =>
				{
					const lists = current.answers === answers ? [...current.lists] : [];
					lists[index] = options;
					return {
						answers,
						lists,
					};
				});
			};
			answer.then(settle, () =>
			{
				settle([]);
			});
		}
		return () =>
		{
			live = false;
		};
	}, [answers]);

	return useMemo(
		() =>
			answers.map((answer, index) =>
				answer instanceof Promise ? (settled.answers === answers ? settled.lists[index] : undefined) : answer,
			),
		[answers, settled],
	);
}
