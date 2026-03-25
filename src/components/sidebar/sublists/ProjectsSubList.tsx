import {Link} from '@tanstack/react-router';
import {ChevronRight} from 'lucide-react';
import {useEffect, useState} from 'react';
import {getProjects, getProject} from '../../../lib/server-fns';
import {useSectionRefreshKey} from '../../../hooks/use-claude-events';
import {getCached, setCache} from '../../../lib/sidebar-cache';
import type {ProjectDetail} from '../types';
import {LoadingBars} from '../primitives/LoadingBars';

export function ProjectsSubList({activeItemId}: {activeItemId: string | null}) {
	const refreshKey = useSectionRefreshKey('projects');
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
			type ProjectList = typeof projects;
			const cached = getCached<NonNullable<ProjectList>>('sidebar:projects');
			if (cached) {
				if (!cancelled) setProjects(cached);
				return;
			}
			const result = await getProjects();
			if (!cancelled) {
				setProjects(result);
				setCache('sidebar:projects', result);
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
								todoCounts: detail.todoCounts,
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
						todoCounts: detail.todoCounts,
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
			isActive ? 'bg-bg-300/50 font-medium text-text-000' : 'text-text-500 hover:bg-bg-300/50 hover:text-text-200'
		}`;

	const labelClass =
		'mb-px flex w-full items-center gap-1 rounded-[4px] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-400';

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
								className="flex h-5 w-4 shrink-0 items-center justify-center text-text-500 transition-colors hover:text-text-200"
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
														style={{paddingLeft: '1.5rem'}}
													>
														{sess.title}
													</Link>
												))}
												{detail.sessions.length > 10 && (
													<Link
														to="/project/$id"
														params={{id: project.id}}
														className="mb-px block truncate rounded-[4px] py-1 text-[10px] italic text-text-400 no-underline hover:text-text-500"
														style={{paddingLeft: '1.5rem', paddingRight: '0.5rem'}}
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
														style={{paddingLeft: '1.5rem'}}
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
														style={{paddingLeft: '1.5rem'}}
													>
														{mem.title}
													</Link>
												))}
											</div>
										)}
										{(detail.todoCounts.pending > 0 || detail.todoCounts.inProgress > 0) && (
											<div>
												<div className={labelClass}>Tasks</div>
												<Link
													to="/project/$id"
													params={{id: project.id}}
													className={linkClass(false)}
													style={{paddingLeft: '1.5rem'}}
												>
													{detail.todoCounts.pending > 0 &&
														`${detail.todoCounts.pending} pending`}
													{detail.todoCounts.pending > 0 &&
														detail.todoCounts.inProgress > 0 &&
														', '}
													{detail.todoCounts.inProgress > 0 &&
														`${detail.todoCounts.inProgress} in progress`}
												</Link>
											</div>
										)}
										{detail.sessions.length === 0 &&
											detail.plans.length === 0 &&
											detail.memories.length === 0 &&
											detail.todoCounts.total === 0 && (
												<div className="px-2 py-1 text-[10px] italic text-text-400">
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
