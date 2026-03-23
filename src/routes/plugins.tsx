import {createFileRoute, Link} from '@tanstack/react-router';
import {getPluginGroups, getUserCommandsList, getPluginTree} from '../lib/server-fns';
import {ChevronRight, ChevronDown, Blocks, Terminal, Bot, Sparkles, BookOpen, Store, FolderTree} from 'lucide-react';
import {useState} from 'react';
import type {PluginInfo, PluginGroup, UserCommandGroup, FileTreeNode} from '../lib/plugins';
import {FileTree} from '../components/file-tree';

type PluginGroupWithOfficial = PluginGroup & {isOfficial: boolean};

export const Route = createFileRoute('/plugins')({
	component: PluginsPage,
	loader: async () => {
		const [groups, userCommands] = await Promise.all([getPluginGroups(), getUserCommandsList()]);
		const pluginCount = groups.reduce((n, g) => n + g.plugins.length, 0);
		return {pluginCount, groups, userCommands};
	},
	head: () => ({
		meta: [{title: 'Claude Plugins'}],
	}),
});

function MarketplaceGroup({group, defaultExpanded}: {group: PluginGroupWithOfficial; defaultExpanded: boolean}) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const pluginCount = group.plugins.length;

	return (
		<div className="rounded-lg border border-border-300/15">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-3 px-4 py-3 text-left"
			>
				<Store className="h-4 w-4 shrink-0 text-text-500" />
				<div className="min-w-0 flex-1">
					<span className="font-semibold text-sm">{group.marketplace.displayName}</span>
					<span className="ml-2 text-xs text-text-500">
						{pluginCount} plugin{pluginCount !== 1 && 's'}
					</span>
				</div>
				{expanded ? (
					<ChevronDown className="h-4 w-4 shrink-0 text-text-500" />
				) : (
					<ChevronRight className="h-4 w-4 shrink-0 text-text-500" />
				)}
			</button>

			{expanded && (
				<div className="border-t border-border-300/10 px-3 pb-3 pt-2 space-y-2">
					{group.plugins.map((plugin) => (
						<PluginCard
							key={plugin.id}
							plugin={plugin}
						/>
					))}
				</div>
			)}
		</div>
	);
}

type PluginTab = 'contents' | 'files';

function PluginCard({plugin}: {plugin: PluginInfo}) {
	const [expanded, setExpanded] = useState(false);
	const [activeTab, setActiveTab] = useState<PluginTab>('contents');
	const [fileTree, setFileTree] = useState<FileTreeNode | null>(null);
	const [treeLoading, setTreeLoading] = useState(false);
	const [treeLoaded, setTreeLoaded] = useState(false);
	const totalItems = plugin.agents.length + plugin.commands.length + plugin.skills.length;

	async function loadFileTree() {
		if (treeLoaded) return;
		setTreeLoading(true);
		const tree = await getPluginTree({data: {pluginId: plugin.id}});
		setFileTree(tree);
		setTreeLoaded(true);
		setTreeLoading(false);
	}

	function switchTab(tab: PluginTab) {
		setActiveTab(tab);
		if (tab === 'files') {
			loadFileTree();
		}
	}

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
								{plugin.commands.length} command
								{plugin.commands.length !== 1 && 's'}
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

			{expanded && (
				<div className="border-t border-border-300/10 px-4 pb-3 pt-2">
					<div className="mb-2 flex gap-1">
						<button
							type="button"
							onClick={() => switchTab('contents')}
							className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
								activeTab === 'contents'
									? 'bg-bg-300/60 text-text-100'
									: 'text-text-500 hover:bg-bg-200/50 hover:text-text-300'
							}`}
						>
							<Blocks className="h-3 w-3" />
							Contents
						</button>
						<button
							type="button"
							onClick={() => switchTab('files')}
							className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
								activeTab === 'files'
									? 'bg-bg-300/60 text-text-100'
									: 'text-text-500 hover:bg-bg-200/50 hover:text-text-300'
							}`}
						>
							<FolderTree className="h-3 w-3" />
							Files
						</button>
					</div>

					{activeTab === 'contents' && totalItems > 0 && (
						<>
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
										params: {
											id: plugin.id,
											type: 'commands',
											_splat: c.filename,
										},
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
										params: {
											id: plugin.id,
											type: 'skills',
											_splat: `${s.dirname}/SKILL.md`,
										},
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
						</>
					)}
					{activeTab === 'contents' && totalItems === 0 && (
						<p className="py-2 text-xs text-text-500">No agents, commands, or skills found.</p>
					)}

					{activeTab === 'files' && (
						<div className="mt-1">
							{treeLoading && (
								<div className="space-y-1.5 py-2">
									<div className="h-3 w-3/4 animate-pulse rounded bg-bg-300/50" />
									<div className="h-3 w-1/2 animate-pulse rounded bg-bg-300/50" />
									<div className="h-3 w-2/3 animate-pulse rounded bg-bg-300/50" />
								</div>
							)}
							{!treeLoading && fileTree && (
								<FileTree
									tree={fileTree}
									pluginId={plugin.id}
								/>
							)}
							{!treeLoading && !fileTree && treeLoaded && (
								<p className="py-2 text-xs text-text-500">Could not read plugin directory.</p>
							)}
						</div>
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
		children?: Array<{
			label: string;
			to: string;
			params: Record<string, string>;
		}>;
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
	const {pluginCount, groups, userCommands} = Route.useLoaderData();
	const commandGroupCount = userCommands.length;

	return (
		<div>
			<h1 className="text-lg font-semibold">Plugins</h1>
			<p className="mt-1 text-sm text-text-500">
				{pluginCount} installed plugin{pluginCount !== 1 && 's'}
				{' across '}
				{groups.length} marketplace{groups.length !== 1 && 's'}
				{commandGroupCount > 0 &&
					`, ${userCommands.reduce((n: number, g: UserCommandGroup) => n + g.commands.length, 0)} user command${userCommands.reduce((n: number, g: UserCommandGroup) => n + g.commands.length, 0) !== 1 ? 's' : ''}`}
			</p>

			{groups.length > 0 && (
				<div className="mt-6 space-y-4">
					{groups.map((group: PluginGroupWithOfficial) => (
						<MarketplaceGroup
							key={group.marketplace.id}
							group={group}
							defaultExpanded={!group.isOfficial}
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
