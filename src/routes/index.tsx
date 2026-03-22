import {createFileRoute, Link} from '@tanstack/react-router';
import {FileText, Brain, MessageSquare, FolderOpen, Blocks} from 'lucide-react';

export const Route = createFileRoute('/')({
	component: Home,
	head: () => ({
		meta: [{title: 'Claude Code Viewer'}],
	}),
});

const cards = [
	{
		to: '/projects',
		label: 'Projects',
		description: 'View sessions, memories, and plans by project',
		icon: FolderOpen,
	},
	{to: '/plans', label: 'Plans', description: 'Browse Claude Code plan files', icon: FileText},
	{to: '/memories', label: 'Memories', description: 'Browse Claude Code memory files by project', icon: Brain},
	{to: '/sessions', label: 'Sessions', description: 'Browse Claude Code session files', icon: MessageSquare},
	{
		to: '/plugins',
		label: 'Plugins',
		description: 'Browse installed plugins, skills, agents, and commands',
		icon: Blocks,
	},
] as const;

function Home() {
	return (
		<div>
			<h1 className="text-lg font-semibold">Claude Code Viewer</h1>
			<div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{cards.map((card) => {
					const Icon = card.icon;
					return (
						<Link
							key={card.to}
							to={card.to}
							className="group rounded-lg border border-border-300/15 p-6 transition-colors hover:bg-bg-200/50"
						>
							<div className="flex items-center gap-3">
								<Icon className="h-5 w-5 text-text-500 group-hover:text-text-100" />
								<h2 className="font-semibold">{card.label}</h2>
							</div>
							<p className="mt-2 text-sm text-text-500">{card.description}</p>
						</Link>
					);
				})}
			</div>
		</div>
	);
}
