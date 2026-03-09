import {Link, useMatches} from '@tanstack/react-router';
import {FileText, Brain, MessageSquare} from 'lucide-react';

const navItems = [
	{to: '/plans', label: 'Plans', icon: FileText},
	{to: '/memories', label: 'Memories', icon: Brain},
	{to: '/sessions', label: 'Sessions', icon: MessageSquare},
] as const;

function SidebarToggleIcon() {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			className="h-5 w-5"
		>
			<path d="M16.5 4C17.3284 4 18 4.67157 18 5.5V14.5C18 15.3284 17.3284 16 16.5 16H3.5C2.67157 16 2 15.3284 2 14.5V5.5C2 4.67157 2.67157 4 3.5 4H16.5ZM7 15H16.5C16.7761 15 17 14.7761 17 14.5V5.5C17 5.22386 16.7761 5 16.5 5H7V15ZM3.5 5C3.22386 5 3 5.22386 3 5.5V14.5C3 14.7761 3.22386 15 3.5 15H6V5H3.5Z" />
		</svg>
	);
}

export function Sidebar({collapsed, onToggle}: {collapsed: boolean; onToggle: () => void}) {
	const matches = useMatches();
	const currentPath = matches[matches.length - 1]?.fullPath ?? '/';

	if (collapsed) {
		return (
			<button
				type="button"
				onClick={onToggle}
				className="absolute left-2 top-2 z-10 hidden h-8 w-8 items-center justify-center rounded-[6px] text-[rgb(20,20,19)] transition-colors hover:bg-black/5 dark:text-[rgb(235,235,230)] dark:hover:bg-white/10 md:flex"
				title="Open sidebar"
			>
				<SidebarToggleIcon />
			</button>
		);
	}

	return (
		<nav
			className="relative hidden h-full w-[288px] shrink-0 flex-col border-r-[0.5px] border-[rgba(31,30,29,0.15)] bg-[rgb(250,249,245)] md:flex dark:border-[rgba(255,255,255,0.1)] dark:bg-[hsl(220_13%_12%)]"
			style={{
				backgroundImage: 'linear-gradient(to top, rgba(245, 244, 237, 0.05), rgba(245, 244, 237, 0.3))',
			}}
		>
			<div className="absolute right-2 top-2">
				<button
					type="button"
					onClick={onToggle}
					className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[rgb(20,20,19)] transition-colors hover:bg-black/5 dark:text-[rgb(235,235,230)] dark:hover:bg-white/10"
					title="Close sidebar"
				>
					<SidebarToggleIcon />
				</button>
			</div>

			<div className="px-4 pt-12">
				<Link
					to="/"
					className="mb-4 flex items-center gap-2 text-sm font-semibold text-[rgb(20,20,19)] no-underline dark:text-[rgb(235,235,230)]"
				>
					<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#C87B3A]">
						<svg
							viewBox="0 0 32 32"
							className="h-4 w-4"
						>
							<path
								d="M16 5L17.5 13.5L26 16L17.5 18.5L16 27L14.5 18.5L6 16L14.5 13.5Z"
								fill="white"
								opacity="0.95"
							/>
						</svg>
					</span>
					Claude Code Viewer
				</Link>
			</div>

			<div className="flex-1 overflow-y-auto px-2">
				{navItems.map((item) => {
					const isActive = currentPath.startsWith(item.to);
					const Icon = item.icon;
					return (
						<Link
							key={item.to}
							to={item.to}
							className={`mb-0.5 flex h-8 items-center gap-2 rounded-[6px] px-4 py-1.5 text-xs no-underline transition-colors ${
								isActive
									? 'bg-black/5 font-medium text-[rgb(20,20,19)] dark:bg-white/10 dark:text-[rgb(235,235,230)]'
									: 'text-[rgb(61,61,58)] hover:bg-black/5 dark:text-[rgb(180,180,175)] dark:hover:bg-white/10'
							}`}
							style={{fontWeight: isActive ? 500 : 430, lineHeight: '16px'}}
						>
							<Icon className="h-4 w-4 shrink-0" />
							{item.label}
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
