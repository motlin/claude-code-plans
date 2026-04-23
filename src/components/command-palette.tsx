import {Command} from 'cmdk';
import {useNavigate} from '@tanstack/react-router';
import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';
import {FileText, Brain, MessageSquare, FolderOpen, Search, Star, Home, FileJson} from 'lucide-react';
import {sessionsQueryOptions} from '../queries/sessions';

interface RecentSession {
	id: string;
	title: string;
	mtime: string;
}

function formatRelativeTime(mtime: string): string {
	const now = Date.now();
	const then = new Date(mtime).getTime();
	const diffMs = now - then;
	const diffMin = Math.floor(diffMs / 60_000);
	if (diffMin < 1) return 'just now';
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHours = Math.floor(diffMin / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	return new Date(mtime).toLocaleDateString();
}

export function CommandPalette({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
	const navigate = useNavigate();
	// Use the shared sessions query so the palette shares cache with routes and sidebar.
	// `enabled: open` avoids fetching until the palette is opened.
	const {data: groups} = useQuery({...sessionsQueryOptions, enabled: open});

	const recentSessions = useMemo<RecentSession[]>(() => {
		if (!groups) return [];
		return groups
			.flatMap((g) => g.sessions)
			.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
			.slice(0, 8)
			.map((s) => ({id: s.id, title: s.title, mtime: s.mtime}));
	}, [groups]);

	function select(callback: () => void) {
		onOpenChange(false);
		callback();
	}

	return (
		<Command.Dialog
			open={open}
			onOpenChange={onOpenChange}
			label="Command palette"
			loop
			overlayClassName="fixed inset-0 z-50 bg-black/50"
			contentClassName="fixed left-1/2 top-[20%] z-50 w-full max-w-[600px] -translate-x-1/2 rounded-xl border border-border-300/15 bg-bg-100 shadow-2xl"
		>
			<div className="flex items-center border-b border-border-300/15 px-3">
				<Search className="mr-2 h-4 w-4 shrink-0 text-text-500" />
				<Command.Input
					placeholder="Search or jump to..."
					className="flex h-11 w-full bg-transparent py-3 text-sm text-text-000 outline-none placeholder:text-text-500"
				/>
			</div>

			<Command.List className="max-h-[320px] overflow-y-auto px-2 py-2">
				<Command.Empty className="px-3 py-6 text-center text-sm text-text-500">No results found.</Command.Empty>

				<Command.Group
					heading="Quick Actions"
					className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-500"
				>
					<CommandItem
						icon={<Home className="h-4 w-4" />}
						onSelect={() => select(() => navigate({to: '/'}))}
					>
						Home
					</CommandItem>
					<CommandItem
						icon={<Search className="h-4 w-4" />}
						onSelect={() =>
							select(() => navigate({to: '/search', search: {q: '', mode: 'titles' as const}}))
						}
						shortcut="/"
					>
						Search
					</CommandItem>
				</Command.Group>

				{recentSessions.length > 0 && (
					<Command.Group
						heading="Recent Sessions"
						className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-500"
					>
						{recentSessions.map((session) => (
							<CommandItem
								key={session.id}
								icon={<MessageSquare className="h-4 w-4" />}
								onSelect={() => select(() => navigate({to: '/session/$id', params: {id: session.id}}))}
								metadata={formatRelativeTime(session.mtime)}
								keywords={[session.id]}
							>
								{session.title}
							</CommandItem>
						))}
					</Command.Group>
				)}

				<Command.Group
					heading="Navigation"
					className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-500"
				>
					<CommandItem
						icon={<Star className="h-4 w-4" />}
						onSelect={() => select(() => navigate({to: '/starred'}))}
					>
						Starred
					</CommandItem>
					<CommandItem
						icon={<FolderOpen className="h-4 w-4" />}
						onSelect={() => select(() => navigate({to: '/projects'}))}
					>
						Projects
					</CommandItem>
					<CommandItem
						icon={<FileText className="h-4 w-4" />}
						onSelect={() => select(() => navigate({to: '/plans'}))}
					>
						Plans
					</CommandItem>
					<CommandItem
						icon={<Brain className="h-4 w-4" />}
						onSelect={() => select(() => navigate({to: '/memories'}))}
					>
						Memories
					</CommandItem>
					<CommandItem
						icon={<MessageSquare className="h-4 w-4" />}
						onSelect={() => select(() => navigate({to: '/sessions'}))}
					>
						Sessions
					</CommandItem>
					<CommandItem
						icon={<FileJson className="h-4 w-4" />}
						onSelect={() => select(() => navigate({to: '/settings'}))}
					>
						Settings
					</CommandItem>
				</Command.Group>
			</Command.List>

			<div className="flex items-center gap-3 border-t border-border-300/15 px-3 py-2">
				<span className="flex items-center gap-1 text-[11px] text-text-500">
					Select{' '}
					<kbd className="rounded bg-bg-300/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-300">
						&uarr;&darr;
					</kbd>
				</span>
				<span className="flex items-center gap-1 text-[11px] text-text-500">
					Open{' '}
					<kbd className="rounded bg-bg-300/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-300">
						&crarr;
					</kbd>
				</span>
				<span className="flex items-center gap-1 text-[11px] text-text-500">
					Close{' '}
					<kbd className="rounded bg-bg-300/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-300">
						Esc
					</kbd>
				</span>
			</div>
		</Command.Dialog>
	);
}

function CommandItem({
	children,
	icon,
	onSelect,
	shortcut,
	metadata,
	keywords,
}: {
	children: React.ReactNode;
	icon: React.ReactNode;
	onSelect: () => void;
	shortcut?: string;
	metadata?: string;
	keywords?: string[];
}) {
	return (
		<Command.Item
			onSelect={onSelect}
			{...(keywords ? {keywords} : {})}
			className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-text-200 transition-colors select-none data-[selected=true]:bg-bg-300/50 data-[selected=true]:text-text-000"
		>
			<span className="flex h-5 w-5 shrink-0 items-center justify-center text-text-500">{icon}</span>
			<span className="flex-1 truncate">{children}</span>
			{metadata && <span className="shrink-0 text-xs text-text-500">{metadata}</span>}
			{shortcut && (
				<kbd className="shrink-0 rounded bg-bg-300/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-400">
					{shortcut}
				</kbd>
			)}
		</Command.Item>
	);
}
