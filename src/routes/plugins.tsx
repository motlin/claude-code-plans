import {createFileRoute, Link} from '@tanstack/react-router';
import {getPluginsList, getUserCommandsList} from '../lib/server-fns';
import {ChevronRight, Blocks, Terminal, Bot, Sparkles, BookOpen} from 'lucide-react';
import {useState} from 'react';
import type {PluginInfo, UserCommandGroup} from '../lib/plugins';

export const Route = createFileRoute('/plugins')({
	component: PluginsPage,
	loader: async () => {
		const [plugins, userCommands] = await Promise.all([getPluginsList(), getUserCommandsList()]);
		return {plugins, userCommands};
	},
	head: () => ({
		meta: [{title: 'Claude Plugins'}],
	}),
});

function PluginCard({plugin}: {plugin: PluginInfo}) {
	const [expanded, setExpanded] = useState(false);
	const totalItems = plugin.agents.length + plugin.commands.length + plugin.skills.length;

	return (
		<div className="rounded-lg border border-border-300/15 transition-colors hover:bg-bg-200/30">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-start gap-3 p-4 text-left"
			>
				<Blocks className="mt-0.5 h-5 w-5 shrink-0 text-text-500" />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="font-semibold">{plugin.name}</span>
						<span className="text-xs text-text-500">v{plugin.version}</span>
					</div>
					{plugin.description && (
						<p className="mt-0.5 text-sm text-text-500 line-clamp-2">{plugin.description}</p>
					)}
					<div className="mt-2 flex gap-3 text-xs text-text-400">
						{plugin.agents.length > 0 && (
							<span className="flex items-center gap-1">
								<Bot className="h-3 w-3" />
								{plugin.agents.length} agent{plugin.agents.length !== 1 && 's'}
							</span>
						)}
						{plugin.commands.length > 0 && (
							<span className="flex items-center gap-1">
								<Terminal className="h-3 w-3" />
								{plugin.commands.length} command{plugin.commands.length !== 1 && 's'}
							</span>
						)}
						{plugin.skills.length > 0 && (
							<span className="flex items-center gap-1">
								<Sparkles className="h-3 w-3" />
								{plugin.skills.length} skill{plugin.skills.length !== 1 && 's'}
							</span>
						)}
					</div>
				</div>
				<ChevronRight
					className="mt-1 h-4 w-4 shrink-0 text-text-500 transition-transform duration-200"
					style={{transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'}}
				/>
			</button>

			{expanded && totalItems > 0 && (
				<div className="border-t border-border-300/10 px-4 pb-3 pt-2">
					{plugin.agents.length > 0 && (
						<ContentSection
							label="Agents"
							icon={<Bot className="h-3 w-3" />}
							items={plugin.agents.map((a) => ({
								label: a.name,
								to: '/plugin/$id/$type/$',
								params: {id: plugin.id, type: 'agents', _splat: a.filename},
							}))}
						/>
					)}
					{plugin.commands.length > 0 && (
						<ContentSection
							label="Commands"
							icon={<Terminal className="h-3 w-3" />}
							items={plugin.commands.map((c) => ({
								label: c.name,
								to: '/plugin/$id/$type/$',
								params: {id: plugin.id, type: 'commands', _splat: c.filename},
							}))}
						/>
					)}
					{plugin.skills.length > 0 && (
						<ContentSection
							label="Skills"
							icon={<Sparkles className="h-3 w-3" />}
							items={plugin.skills.map((s) => ({
								label: s.name,
								to: '/plugin/$id/$type/$',
								params: {id: plugin.id, type: 'skills', _splat: `${s.dirname}/SKILL.md`},
								children: [
									...s.references.map((r) => ({
										label: r.name,
										to: '/plugin/$id/$type/$' as const,
										params: {
											id: plugin.id,
											type: 'skills',
											_splat: `${s.dirname}/references/${r.filename}`,
										},
									})),
									...s.examples.map((e) => ({
										label: e.name,
										to: '/plugin/$id/$type/$' as const,
										params: {
											id: plugin.id,
											type: 'skills',
											_splat: `${s.dirname}/examples/${e.filename}`,
										},
									})),
								],
							}))}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function ContentSection({
	label,
	icon,
	items,
}: {
	label: string;
	icon: React.ReactNode;
	items: Array<{
		label: string;
		to: string;
		params: Record<string, string>;
		children?: Array<{label: string; to: string; params: Record<string, string>}>;
	}>;
}) {
	return (
		<div className="mt-2 first:mt-0">
			<div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-400">
				{icon}
				{label}
			</div>
			<div className="mt-1 space-y-px">
				{items.map((item) => (
					<div key={item.params['_splat'] || item.label}>
						<Link
							to={item.to as string}
							params={item.params}
							className="block rounded-md px-2 py-1.5 text-sm text-text-200 no-underline transition-colors hover:bg-bg-200/50"
						>
							{item.label}
						</Link>
						{item.children && item.children.length > 0 && (
							<div className="pl-4">
								{item.children.map((child) => (
									<Link
										key={child.params['_splat'] || child.label}
										to={child.to as string}
										params={child.params}
										className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-400 no-underline transition-colors hover:bg-bg-200/50 hover:text-text-200"
									>
										<BookOpen className="h-3 w-3 shrink-0" />
										{child.label}
									</Link>
								))}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function PluginsPage() {
	const {plugins, userCommands} = Route.useLoaderData();
	const pluginCount = plugins.length;
	const commandGroupCount = userCommands.length;

	return (
		<div>
			<h1 className="text-lg font-semibold">Plugins</h1>
			<p className="mt-1 text-sm text-text-500">
				{pluginCount} installed plugin{pluginCount !== 1 && 's'}
				{commandGroupCount > 0 &&
					`, ${userCommands.reduce((n: number, g: UserCommandGroup) => n + g.commands.length, 0)} user command${userCommands.reduce((n: number, g: UserCommandGroup) => n + g.commands.length, 0) !== 1 ? 's' : ''}`}
			</p>

			{pluginCount > 0 && (
				<div className="mt-6 space-y-3">
					{plugins.map((plugin: PluginInfo) => (
						<PluginCard
							key={plugin.id}
							plugin={plugin}
						/>
					))}
				</div>
			)}

			{commandGroupCount > 0 && (
				<div className="mt-8">
					<h2 className="text-base font-semibold">User Commands</h2>
					{userCommands.map((group: UserCommandGroup) => (
						<div
							key={group.source}
							className="mt-4"
						>
							<h3 className="text-xs font-semibold uppercase tracking-wider text-text-400">
								{group.sourceName}
							</h3>
							<ul className="mt-2 space-y-1">
								{group.commands.map((cmd) => (
									<li key={cmd.filename}>
										<Link
											to="/command/$source/$filename"
											params={{source: group.source, filename: cmd.filename}}
											className="block rounded-md border border-border-300/15 px-4 py-3 text-sm font-medium text-text-200 no-underline transition-colors hover:bg-bg-200/50"
										>
											{cmd.name}
										</Link>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			)}

			{pluginCount === 0 && commandGroupCount === 0 && (
				<p className="mt-4 text-text-500">No plugins or commands found.</p>
			)}
		</div>
	);
}
