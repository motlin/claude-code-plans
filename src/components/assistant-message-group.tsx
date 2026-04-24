import {useState} from 'react';
import {ChevronDown, ChevronRight} from 'lucide-react';
import type {AssistantGroup} from '../lib/assistant-groups';
import {useSettings} from './settings-provider';

export function AssistantMessageGroupHeader({
	group,
	expanded,
	onToggle,
}: {
	group: AssistantGroup;
	expanded: boolean;
	onToggle: () => void;
}) {
	if (!group.summary) return null;

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
			<span className="text-[11px] font-medium">{group.summary}</span>
		</button>
	);
}

export function useGroupExpansion(group: AssistantGroup): [boolean, () => void] {
	const {settings} = useSettings();
	const [expanded, setExpanded] = useState(group.lines.length <= settings.collapseThreshold);
	return [expanded, () => setExpanded((previous) => !previous)];
}
