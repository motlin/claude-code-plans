import {Link, useMatches, useNavigate} from '@tanstack/react-router';
import {FileText, Brain, MessageSquare, FolderOpen, ChevronRight, Search, Star} from 'lucide-react';
import {useEffect, useState} from 'react';
import {getPlans, getPlansGrouped, getMemories, getSessions, getProjects, getProject} from '../lib/server-fns';

const navItems = [
	{to: '/starred', label: 'Starred', icon: Star, section: 'starred' as const},
	{to: '/projects', label: 'Projects', icon: FolderOpen, section: 'projects' as const},
	{to: '/plans', label: 'Plans', icon: FileText, section: 'plans' as const},
	{to: '/memories', label: 'Memories', icon: Brain, section: 'memories' as const},
	{to: '/sessions', label: 'Sessions', icon: MessageSquare, section: 'sessions' as const},
];

type Section = 'starred' | 'projects' | 'plans' | 'memories' | 'sessions';

interface SubItem {
	id: string;
	label: string;
	to: string;
	params: Record<string, string>;
}

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

function useActiveSection(matches: ReturnType<typeof useMatches>): {
	section: Section | null;
	activeItemId: string | null;
	projectId: string | null;
} {
	const lastMatch = matches[matches.length - 1];
	const path = lastMatch?.fullPath ?? '/';
	const params = lastMatch?.params as Record<string, string> | undefined;

	if (path.startsWith('/starred')) {
		return {section: 'starred', activeItemId: null, projectId: null};
	}
	if (path.startsWith('/project') && !path.startsWith('/projects')) {
		return {
			section: 'projects',
			activeItemId: params?.['id'] ?? null,
			projectId: params?.['id'] ?? null,
		};
	}
	if (path === '/projects') {
		return {
			section: 'projects',
			activeItemId: null,
			projectId: null,
		};
	}
	if (path.startsWith('/plan') || path === '/plans') {
		return {
			section: 'plans',
			activeItemId: params?.['filename'] ?? null,
			projectId: null,
		};
	}
	if (path.startsWith('/memor') || path === '/memories') {
		return {
			section: 'memories',
			activeItemId:
				params?.['project'] && params?.['filename'] ? `${params['project']}/${params['filename']}` : null,
			projectId: params?.['project'] ?? null,
		};
	}
	if (path.startsWith('/session') || path === '/sessions') {
		return {
			section: 'sessions',
			activeItemId: params?.['id'] ?? null,
			projectId: null,
		};
	}
	return {section: null, activeItemId: null, projectId: null};
}

function LoadingBars() {
	return (
		<div className="space-y-1.5 py-1">
			<div className="h-3 w-3/4 animate-pulse rounded bg-black/5 dark:bg-white/5" />
			<div className="h-3 w-1/2 animate-pulse rounded bg-black/5 dark:bg-white/5" />
			<div className="h-3 w-2/3 animate-pulse rounded bg-black/5 dark:bg-white/5" />
		</div>
	);
}

function SubList({
	section,
	activeItemId,
	refreshKey,
}: {
	section: Section;
	activeItemId: string | null;
	refreshKey: number;
}) {
	const [items, setItems] = useState<SubItem[] | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function fetchItems() {
			let result: SubItem[] = [];

			if (section === 'projects') {
				const projects = await getProjects();
				result = projects.map((p) => ({
					id: p.id,
					label: p.name,
					to: '/project/$id',
					params: {id: p.id},
				}));
			} else if (section === 'plans') {
				const plans = await getPlans();
				result = plans.map((p) => ({
					id: p.filename,
					label: p.title,
					to: '/plan/$filename',
					params: {filename: p.filename},
				}));
			} else if (section === 'memories') {
				const groups = await getMemories();
				const all = groups
					.flatMap((g) => g.memories)
					.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
					.slice(0, 20);
				result = all.map((m) => ({
					id: `${m.project}/${m.filename}`,
					label: m.title,
					to: '/memory/$project/$filename',
					params: {project: m.project, filename: m.filename},
				}));
			} else if (section === 'sessions') {
				const groups = await getSessions();
				const all = groups
					.flatMap((g) => g.sessions)
					.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
					.slice(0, 20);
				result = all.map((s) => ({
					id: s.id,
					label: s.title,
					to: '/session/$id',
					params: {id: s.id},
				}));
			}

			if (!cancelled) {
				setItems(result);
			}
		}

		fetchItems();
		return () => {
			cancelled = true;
		};
	}, [section, refreshKey]);

	if (items === null) {
		return (
			<div className="pl-10">
				<LoadingBars />
			</div>
		);
	}

	if (items.length === 0) {
		return null;
	}

	return (
		<div className="pl-10">
			{items.map((item) => {
				const isActive = item.id === activeItemId;
				return (
					<Link
						key={item.id}
						to={item.to as string}
						params={item.params}
						className={`mb-px block truncate rounded-[4px] px-2 py-1 text-xs no-underline transition-colors ${
							isActive
								? 'bg-black/5 font-medium text-[rgb(20,20,19)] dark:bg-white/10 dark:text-[rgb(235,235,230)]'
								: 'text-[rgb(115,114,108)] hover:bg-black/5 hover:text-[rgb(61,61,58)] dark:text-[rgb(150,150,145)] dark:hover:bg-white/5 dark:hover:text-[rgb(200,200,195)]'
						}`}
					>
						{item.label}
					</Link>
				);
			})}
		</div>
	);
}

interface PlanGroup {
	projectId: string;
	projectName: string;
	plans: Array<{filename: string; title: string; mtime: string}>;
}

function PlansSubList({activeItemId, refreshKey}: {activeItemId: string | null; refreshKey: number}) {
	const [groups, setGroups] = useState<PlanGroup[] | null>(null);
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

	useEffect(() => {
		let cancelled = false;

		async function fetchPlans() {
			const result = await getPlansGrouped();
			if (!cancelled) {
				setGroups(result);
			}
		}

		fetchPlans();
		return () => {
			cancelled = true;
		};
	}, [refreshKey]);

	// Auto-expand/collapse groups based on active plan
	useEffect(() => {
		if (!groups || !activeItemId) return;

		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			const activeGroupId = groups.find((g) => g.plans.some((p) => p.filename === activeItemId))?.projectId;

			// Expand the group containing the active plan
			if (activeGroupId) {
				next.delete(activeGroupId);
			}

			// Collapse all other groups
			for (const group of groups) {
				if (group.projectId !== activeGroupId) {
					next.add(group.projectId);
				}
			}

			return next;
		});
	}, [activeItemId, groups]);

	function toggleGroup(projectId: string) {
		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(projectId)) {
				next.delete(projectId);
			} else {
				next.add(projectId);
			}
			return next;
		});
	}

	if (groups === null) {
		return (
			<div className="pl-10">
				<LoadingBars />
			</div>
		);
	}

	if (groups.length === 0) {
		return null;
	}

	// If there's only one group, render flat (no nesting needed)
	if (groups.length === 1 && groups[0]) {
		return (
			<div className="pl-10">
				{groups[0].plans.map((plan) => {
					const isActive = plan.filename === activeItemId;
					return (
						<Link
							key={plan.filename}
							to="/plan/$filename"
							params={{filename: plan.filename}}
							className={`mb-px block truncate rounded-[4px] px-2 py-1 text-xs no-underline transition-colors ${
								isActive
									? 'bg-black/5 font-medium text-[rgb(20,20,19)] dark:bg-white/10 dark:text-[rgb(235,235,230)]'
									: 'text-[rgb(115,114,108)] hover:bg-black/5 hover:text-[rgb(61,61,58)] dark:text-[rgb(150,150,145)] dark:hover:bg-white/5 dark:hover:text-[rgb(200,200,195)]'
							}`}
						>
							{plan.title}
						</Link>
					);
				})}
			</div>
		);
	}

	return (
		<div className="pl-10">
			{groups.map((group) => {
				const isExpanded = !collapsedGroups.has(group.projectId);
				return (
					<div key={group.projectId}>
						<button
							type="button"
							onClick={() => toggleGroup(group.projectId)}
							className="mb-px flex w-full items-center gap-1 rounded-[4px] px-2 py-1 text-xs text-[rgb(115,114,108)] transition-colors hover:bg-black/5 hover:text-[rgb(61,61,58)] dark:text-[rgb(150,150,145)] dark:hover:bg-white/5 dark:hover:text-[rgb(200,200,195)]"
						>
							<ChevronRight
								className="h-2.5 w-2.5 shrink-0 transition-transform duration-200"
								style={{transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}}
							/>
							<span className="truncate font-medium">{group.projectName}</span>
							<span className="ml-auto shrink-0 text-[10px] opacity-60">{group.plans.length}</span>
						</button>
						{isExpanded &&
							group.plans.map((plan) => {
								const isActive = plan.filename === activeItemId;
								return (
									<Link
										key={plan.filename}
										to="/plan/$filename"
										params={{filename: plan.filename}}
										className={`mb-px block truncate rounded-[4px] py-1 pl-5 pr-2 text-xs no-underline transition-colors ${
											isActive
												? 'bg-black/5 font-medium text-[rgb(20,20,19)] dark:bg-white/10 dark:text-[rgb(235,235,230)]'
												: 'text-[rgb(115,114,108)] hover:bg-black/5 hover:text-[rgb(61,61,58)] dark:text-[rgb(150,150,145)] dark:hover:bg-white/5 dark:hover:text-[rgb(200,200,195)]'
										}`}
									>
										{plan.title}
									</Link>
								);
							})}
					</div>
				);
			})}
		</div>
	);
}

interface ProjectDetail {
	sessions: Array<{id: string; title: string}>;
	plans: Array<{filename: string; title: string}>;
	memories: Array<{filename: string; title: string; project: string}>;
}

function ProjectsSubList({activeItemId, refreshKey}: {activeItemId: string | null; refreshKey: number}) {
	const [projects, setProjects] = useState<Array<{
		id: string;
		name: string;
		sessionCount: number;
		memoryCount: number;
	}> | null>(null);
	const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
	const [projectDetails, setProjectDetails] = useState<Map<string, ProjectDetail>>(new Map());
	const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());

	useEffect(() => {
		let cancelled = false;
		async function fetchProjects() {
			const result = await getProjects();
			if (!cancelled) {
				setProjects(result);
			}
		}
		fetchProjects();
		return () => {
			cancelled = true;
		};
	}, [refreshKey]);

	// Auto-expand/collapse projects based on active project
	useEffect(() => {
		if (!projects || !activeItemId) return;

		const activeProject = projects.find((p) => p.id === activeItemId);

		if (activeProject) {
			// Ensure the active project is expanded
			setExpandedProjects((prev) => new Set(prev).add(activeProject.id));

			// Auto-load details if not already loaded
			if (!projectDetails.has(activeProject.id)) {
				(async () => {
					setLoadingDetails((prev) => new Set(prev).add(activeProject.id));
					const detail = await getProject({data: activeProject.id});
					if (detail) {
						setProjectDetails((prev) => {
							const next = new Map(prev);
							next.set(activeProject.id, {
								sessions: detail.sessions.map((s) => ({id: s.id, title: s.title})),
								plans: detail.plans.map((p) => ({filename: p.filename, title: p.title})),
								memories: detail.memories.map((m) => ({
									filename: m.filename,
									title: m.title,
									project: m.project,
								})),
							});
							return next;
						});
					}
					setLoadingDetails((prev) => {
						const next = new Set(prev);
						next.delete(activeProject.id);
						return next;
					});
				})();
			}
		}
	}, [activeItemId, projects, projectDetails]);

	async function toggleProject(projectId: string) {
		if (expandedProjects.has(projectId)) {
			setExpandedProjects((prev) => {
				const next = new Set(prev);
				next.delete(projectId);
				return next;
			});
			return;
		}

		setExpandedProjects((prev) => new Set(prev).add(projectId));

		if (!projectDetails.has(projectId)) {
			setLoadingDetails((prev) => new Set(prev).add(projectId));
			const detail = await getProject({data: projectId});
			if (detail) {
				setProjectDetails((prev) => {
					const next = new Map(prev);
					next.set(projectId, {
						sessions: detail.sessions.map((s) => ({id: s.id, title: s.title})),
						plans: detail.plans.map((p) => ({filename: p.filename, title: p.title})),
						memories: detail.memories.map((m) => ({
							filename: m.filename,
							title: m.title,
							project: m.project,
						})),
					});
					return next;
				});
			}
			setLoadingDetails((prev) => {
				const next = new Set(prev);
				next.delete(projectId);
				return next;
			});
		}
	}

	if (projects === null) {
		return (
			<div className="pl-10">
				<LoadingBars />
			</div>
		);
	}

	if (projects.length === 0) {
		return null;
	}

	const linkClass = (isActive: boolean) =>
		`mb-px block truncate rounded-[4px] px-2 py-1 text-xs no-underline transition-colors ${
			isActive
				? 'bg-black/5 font-medium text-[rgb(20,20,19)] dark:bg-white/10 dark:text-[rgb(235,235,230)]'
				: 'text-[rgb(115,114,108)] hover:bg-black/5 hover:text-[rgb(61,61,58)] dark:text-[rgb(150,150,145)] dark:hover:bg-white/5 dark:hover:text-[rgb(200,200,195)]'
		}`;

	const labelClass =
		'mb-px flex w-full items-center gap-1 rounded-[4px] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[rgb(155,154,148)] dark:text-[rgb(120,120,115)]';

	return (
		<div className="pl-10">
			{projects.map((project) => {
				const isActive = project.id === activeItemId;
				const isExpanded = expandedProjects.has(project.id);
				const detail = projectDetails.get(project.id);
				const isLoading = loadingDetails.has(project.id);

				return (
					<div key={project.id}>
						<div className="flex items-center">
							<button
								type="button"
								onClick={() => toggleProject(project.id)}
								className="flex h-5 w-4 shrink-0 items-center justify-center text-[rgb(115,114,108)] transition-colors hover:text-[rgb(61,61,58)] dark:text-[rgb(150,150,145)] dark:hover:text-[rgb(200,200,195)]"
							>
								<ChevronRight
									className="h-2.5 w-2.5 transition-transform duration-200"
									style={{transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}}
								/>
							</button>
							<Link
								to="/project/$id"
								params={{id: project.id}}
								className={linkClass(isActive)}
								style={{flex: 1, minWidth: 0}}
							>
								{project.name}
							</Link>
						</div>
						{isExpanded && (
							<div className="pl-4">
								{isLoading && <LoadingBars />}
								{detail && (
									<>
										{detail.sessions.length > 0 && (
											<div>
												<div className={labelClass}>Sessions</div>
												{detail.sessions.slice(0, 10).map((sess) => (
													<Link
														key={sess.id}
														to="/session/$id"
														params={{id: sess.id}}
														className={linkClass(false)}
													>
														{sess.title}
													</Link>
												))}
												{detail.sessions.length > 10 && (
													<Link
														to="/project/$id"
														params={{id: project.id}}
														className="mb-px block truncate rounded-[4px] px-2 py-1 text-[10px] italic text-[rgb(155,154,148)] no-underline hover:text-[rgb(115,114,108)] dark:text-[rgb(120,120,115)] dark:hover:text-[rgb(150,150,145)]"
													>
														+{detail.sessions.length - 10} more...
													</Link>
												)}
											</div>
										)}
										{detail.plans.length > 0 && (
											<div>
												<div className={labelClass}>Plans</div>
												{detail.plans.map((plan) => (
													<Link
														key={plan.filename}
														to="/plan/$filename"
														params={{filename: plan.filename}}
														className={linkClass(false)}
													>
														{plan.title}
													</Link>
												))}
											</div>
										)}
										{detail.memories.length > 0 && (
											<div>
												<div className={labelClass}>Memories</div>
												{detail.memories.map((mem) => (
													<Link
														key={mem.filename}
														to="/memory/$project/$filename"
														params={{project: mem.project, filename: mem.filename}}
														className={linkClass(false)}
													>
														{mem.title}
													</Link>
												))}
											</div>
										)}
										{detail.sessions.length === 0 &&
											detail.plans.length === 0 &&
											detail.memories.length === 0 && (
												<div className="px-2 py-1 text-[10px] italic text-[rgb(155,154,148)] dark:text-[rgb(120,120,115)]">
													No items
												</div>
											)}
									</>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function SearchInput() {
	const [query, setQuery] = useState('');
	const navigate = useNavigate();

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!query.trim()) return;
		navigate({to: '/search', search: {q: query.trim(), mode: 'titles' as const}});
		setQuery('');
	}

	return (
		<form
			onSubmit={handleSubmit}
			className="px-4 pb-2"
		>
			<div className="relative">
				<Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[rgb(115,114,108)] dark:text-[rgb(150,150,145)]" />
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search..."
					className="w-full rounded-md border border-[rgba(31,30,29,0.1)] bg-white/50 py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-[rgb(115,114,108)] focus:border-[rgba(31,30,29,0.3)] dark:border-[rgba(255,255,255,0.1)] dark:bg-white/5 dark:placeholder:text-[rgb(150,150,145)] dark:focus:border-[rgba(255,255,255,0.2)]"
				/>
			</div>
		</form>
	);
}

export function Sidebar({
	collapsed,
	onToggle,
	refreshKey,
}: {
	collapsed: boolean;
	onToggle: () => void;
	refreshKey: number;
}) {
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
					if (item.section !== activeSection && item.section !== 'starred') {
						next.add(item.section);
					}
				}
			}

			return next;
		});
	}, [activeSection, activeItemId]);

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
									className="flex h-8 w-6 shrink-0 items-center justify-center text-[rgb(115,114,108)] transition-colors hover:text-[rgb(61,61,58)] dark:text-[rgb(150,150,145)] dark:hover:text-[rgb(200,200,195)]"
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
											? 'bg-black/5 font-medium text-[rgb(20,20,19)] dark:bg-white/10 dark:text-[rgb(235,235,230)]'
											: 'text-[rgb(61,61,58)] hover:bg-black/5 dark:text-[rgb(180,180,175)] dark:hover:bg-white/10'
									}`}
									style={{fontWeight: isActive ? 500 : 430, lineHeight: '16px'}}
								>
									<Icon className="h-4 w-4 shrink-0" />
									{item.label}
								</Link>
							</div>
							{isExpanded &&
								item.section !== 'starred' &&
								(item.section === 'projects' ? (
									<ProjectsSubList
										activeItemId={activeItemId}
										refreshKey={refreshKey}
									/>
								) : item.section === 'plans' ? (
									<PlansSubList
										activeItemId={activeItemId}
										refreshKey={refreshKey}
									/>
								) : (
									<SubList
										section={item.section}
										activeItemId={activeItemId}
										refreshKey={refreshKey}
									/>
								))}
						</div>
					);
				})}
			</div>
		</nav>
	);
}
