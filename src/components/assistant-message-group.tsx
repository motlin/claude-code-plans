import {useState} from 'react';
import {ChevronDown, ChevronRight, Layers} from 'lucide-react';
import type {AssistantGroup} from '../lib/assistant-groups';

/** Groups with more than this many lines start collapsed. */
const COLLAPSE_THRESHOLD = 3;

export function AssistantMessageGroupHeader({
	group,
	expanded,
	onToggle,
}: {
	group: AssistantGroup;
	expanded: boolean;
	onToggle: () => void;
}) {
	const lineCount = group.lines.length;

	return (
		<button
			type="button"
			onClick={onToggle}
			className="flex items-center gap-2 py-1.5 px-2 -mx-2 text-sm leading-relaxed transition-colors cursor-pointer w-full text-left text-text-500 hover:text-text-300 rounded hover:bg-bg-200/50"
		>
			{expanded ? (
				<ChevronDown className="h-3.5 w-3.5 shrink-0" />
			) : (
				<ChevronRight className="h-3.5 w-3.5 shrink-0" />
			)}
			<Layers className="h-3 w-3 shrink-0 opacity-50" />
			<span className="text-[11px] font-medium bg-bg-200 rounded-full px-1.5 py-0.5 tabular-nums">
				{lineCount} messages
			</span>
		</button>
	);
}

export function useGroupExpansion(group: AssistantGroup): [boolean, () => void] {
	const [expanded, setExpanded] = useState(group.lines.length <= COLLAPSE_THRESHOLD);
	return [expanded, () => setExpanded((previous) => !previous)];
}
