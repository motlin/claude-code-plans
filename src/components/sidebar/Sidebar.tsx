import {Link, useMatches} from '@tanstack/react-router';
import {ChevronRight} from 'lucide-react';
import {useEffect, useState} from 'react';
import type {Section} from './types';
import {useActiveSection} from './hooks';
import {navItems} from './navigation';
import {SidebarToggleIcon, SearchInput} from './primitives';
import {ActiveSubList, PlansSubList, ProjectsSubList, PluginsSubList, SubList} from './sublists';

export function Sidebar({collapsed, onToggle, mobile}: {collapsed: boolean; onToggle: () => void; mobile?: boolean}) {
	const matches = useMatches();
	const currentPath = matches[matches.length - 1]?.fullPath ?? '/';
	const {section: activeSection, activeItemId} = useActiveSection(matches);
	const [collapsedSections, setCollapsedSections] = useState<Set<Section>>(new Set());

	function toggleSection(section: Section) {
		setCollapsedSections((prev) => {
			const next = new Set(prev);
			if (next.has(section)) {
				next.delete(section);
			} else {
				next.add(section);
			}
			return next;
		});
	}

	// Auto-expand the active section and auto-collapse irrelevant sections when navigation changes
	useEffect(() => {
		if (!activeSection) return;

		setCollapsedSections((prev) => {
			const next = new Set(prev);

			// Expand the active section
			next.delete(activeSection);

			// Collapse sections that don't contain the current view
			// But only collapse if there's an active item (navigated to a specific item)
			if (activeItemId) {
				for (const item of navItems) {
					if (item.section !== activeSection && item.section !== 'starred' && item.section !== 'active') {
						next.add(item.section);
					}
				}
			}

			return next;
		});
	}, [activeSection, activeItemId]);

	if (collapsed && !mobile) {
		return (
			<button
				type="button"
				onClick={onToggle}
				className="absolute left-2 top-2 z-10 hidden h-8 w-8 items-center justify-center rounded-[6px] text-text-000 transition-colors hover:bg-bg-300/50 md:flex"
				title="Open sidebar"
			>
				<SidebarToggleIcon />
			</button>
		);
	}

	return (
		<nav
			className={
				mobile
					? 'relative flex h-full w-[288px] shrink-0 flex-col border-r-[0.5px] border-border-300/15 bg-bg-200'
					: 'relative hidden h-full w-[288px] shrink-0 flex-col border-r-[0.5px] border-border-300/15 bg-bg-200 md:flex'
			}
		>
			<div className="flex items-center justify-between px-4 pt-3 pb-3">
				<Link
					to="/"
					className="flex items-center gap-2.5 text-base font-bold text-text-000 no-underline"
				>
					<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#C87B3A]">
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
				<button
					type="button"
					onClick={onToggle}
					className="flex h-8 w-8 items-center justify-center rounded-[6px] text-text-000 transition-colors hover:bg-bg-300/50"
					title="Close sidebar"
				>
					<SidebarToggleIcon />
				</button>
			</div>

			<SearchInput />

			<div className="flex-1 overflow-y-auto px-2">
				{navItems.map((item) => {
					const isActive = currentPath.startsWith(item.to);
					const Icon = item.icon;
					const isExpanded = !collapsedSections.has(item.section);
					return (
						<div key={item.to}>
							<div className="flex items-center">
								<button
									type="button"
									onClick={() => toggleSection(item.section)}
									className="flex h-8 w-6 shrink-0 items-center justify-center text-text-500 transition-colors hover:text-text-200"
									title={isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
								>
									<ChevronRight
										className="h-3 w-3 transition-transform duration-200"
										style={{transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}}
									/>
								</button>
								<Link
									to={item.to}
									className={`mb-0.5 flex h-8 flex-1 items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs no-underline transition-colors ${
										isActive
											? 'bg-bg-300/50 font-medium text-text-000'
											: 'text-text-200 hover:bg-bg-300/50'
									}`}
									style={{fontWeight: isActive ? 500 : 430, lineHeight: '16px'}}
								>
									<Icon className="h-4 w-4 shrink-0" />
									{item.label}
								</Link>
							</div>
							{isExpanded &&
								item.section !== 'starred' &&
								item.section !== 'settings' &&
								item.section !== 'setup' &&
								(item.section === 'active' ? (
									<ActiveSubList />
								) : item.section === 'projects' ? (
									<ProjectsSubList activeItemId={activeItemId} />
								) : item.section === 'plans' ? (
									<PlansSubList activeItemId={activeItemId} />
								) : item.section === 'plugins' ? (
									<PluginsSubList />
								) : (
									<SubList
										section={item.section}
										activeItemId={activeItemId}
									/>
								))}
						</div>
					);
				})}
			</div>
		</nav>
	);
}
