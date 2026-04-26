import {Link} from '@tanstack/react-router';
import {Bot, ChevronDown, ChevronRight} from 'lucide-react';
import {useState} from 'react';
import type {SubagentTreeEntry, SubagentTreeNode, ParallelGroup, DbSubagent} from '../lib/db/queries';
import {formatDuration} from './tool-renderers/shared';

const AGENT_TYPE_STYLES: Record<string, string> = {
	Explore: 'bg-blue-500/15 text-blue-400',
	Plan: 'bg-purple-500/15 text-purple-400',
	'build:precommit-runner': 'bg-yellow-500/15 text-yellow-400',
	'git:commit-handler': 'bg-green-500/15 text-green-400',
	'git:rebaser': 'bg-pink-500/15 text-pink-400',
	'markdown-tasks:do-task': 'bg-orange-500/15 text-orange-400',
	'general-purpose': 'bg-gray-500/15 text-gray-400',
};

function getTypeStyle(agentType: string | null): string {
	if (!agentType) return 'bg-gray-500/15 text-gray-400';
	return AGENT_TYPE_STYLES[agentType] ?? 'bg-gray-500/15 text-gray-400';
}

function getShortType(agentType: string | null): string {
	if (!agentType) return 'agent';
	const parts = agentType.split(':');
	return parts[parts.length - 1]!;
}

function getDurationMs(agent: DbSubagent): number | null {
	if (!agent.startedAt || !agent.finishedAt) return null;
	return new Date(agent.finishedAt).getTime() - new Date(agent.startedAt).getTime();
}

function formatTime(iso: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	return d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
}

function TreeNode({node, depth}: {node: SubagentTreeNode; depth: number}) {
	const hasChildren = node.children.length > 0;
	const [expanded, setExpanded] = useState(true);
	const durationMs = getDurationMs(node.agent);

	return (
		<div>
			<div
				className="flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-bg-200/50 cursor-pointer group"
				onClick={() => hasChildren && setExpanded(!expanded)}
			>
				<span className="w-4 flex-shrink-0 text-text-500">
					{hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
				</span>
				<span
					className={`rounded px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0 ${getTypeStyle(node.agent.agentType)}`}
				>
					{getShortType(node.agent.agentType)}
				</span>
				<span className="text-xs text-text-100 truncate min-w-0">
					{node.agent.description ?? node.agent.slug ?? node.agent.id}
				</span>
				{durationMs !== null && (
					<span className="text-[10px] text-text-500 flex-shrink-0 tabular-nums">
						{formatDuration(durationMs)}
					</span>
				)}
				<span className="text-[10px] text-text-500 flex-shrink-0 ml-auto">
					{formatTime(node.agent.startedAt)}
				</span>
				<Link
					to="/session/$id"
					params={{id: node.agent.id}}
					className="hidden group-hover:inline-flex items-center gap-1 text-[10px] text-accent-100 hover:underline flex-shrink-0"
					onClick={(e) => e.stopPropagation()}
				>
					<Bot size={10} />
					view
				</Link>
			</div>
			{hasChildren && expanded && (
				<div className="ml-5 pl-3 border-l border-border-300/20">
					<TreeEntries
						entries={node.children}
						depth={depth + 1}
					/>
				</div>
			)}
		</div>
	);
}

function ParallelGroupNode({group, depth}: {group: ParallelGroup; depth: number}) {
	const [expanded, setExpanded] = useState(true);

	return (
		<div>
			<div
				className="flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-bg-200/50 cursor-pointer"
				onClick={() => setExpanded(!expanded)}
			>
				<span className="w-4 flex-shrink-0 text-text-500">
					{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</span>
				<span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent-000/12 text-accent-100 flex-shrink-0">
					parallel &times;{group.children.length}
				</span>
				<span className="text-xs text-text-500 truncate min-w-0">{summarizeParallelGroup(group)}</span>
				<span className="text-[10px] text-text-500 flex-shrink-0 tabular-nums ml-auto">
					{formatDuration(group.wallClockMs)}
				</span>
			</div>
			{expanded && (
				<div className="ml-5 pl-3 border-l border-accent-000/15">
					{group.children.map((child) => (
						<TreeNode
							key={child.agent.id}
							node={child}
							depth={depth + 1}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function summarizeParallelGroup(group: ParallelGroup): string {
	const types = new Set(group.children.map((c) => getShortType(c.agent.agentType)));
	if (types.size === 1) {
		const type = [...types][0]!;
		return `${type} tasks`;
	}
	return [...types].join(', ');
}

function isParallelGroup(entry: SubagentTreeEntry): entry is ParallelGroup {
	return 'type' in entry && entry.type === 'parallel';
}

function TreeEntries({entries, depth}: {entries: SubagentTreeEntry[]; depth: number}) {
	return (
		<>
			{entries.map((entry, i) =>
				isParallelGroup(entry) ? (
					<ParallelGroupNode
						key={`parallel-${i}`}
						group={entry}
						depth={depth}
					/>
				) : (
					<TreeNode
						key={entry.agent.id}
						node={entry}
						depth={depth}
					/>
				),
			)}
		</>
	);
}

export function SubagentTree({tree}: {tree: SubagentTreeEntry[]}) {
	if (tree.length === 0) return null;

	return (
		<TreeEntries
			entries={tree}
			depth={0}
		/>
	);
}
