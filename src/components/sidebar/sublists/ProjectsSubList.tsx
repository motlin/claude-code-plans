import {Link} from '@tanstack/react-router';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {ChevronRight} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {projectQueryOptions, projectsQueryOptions} from '../../../queries/projects';
import type {ProjectDetail} from '../types';
import {LoadingBars} from '../primitives/LoadingBars';

export function ProjectsSubList({activeItemId}: {activeItemId: string | null}) {
	const {data: projects} = useQuery(projectsQueryOptions);
	const queryClient = useQueryClient();
	const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

	// Auto-expand the active project and prefetch its detail into the shared
	// TanStack Query cache so sidebar + /project/$id share the same data.
	useEffect(() => {
		if (!projects || !activeItemId) return;

		const activeProject = projects.find((p) => p.id === activeItemId);
		if (!activeProject) return;

		setExpandedProjects((prev) => (prev.has(activeProject.id) ? prev : new Set(prev).add(activeProject.id)));
		void queryClient.prefetchQuery(projectQueryOptions(activeProject.id));
	}, [activeItemId, projects, queryClient]);

	function toggleProject(projectId: string) {
		if (expandedProjects.has(projectId)) {
			setExpandedProjects((prev) => {
				const next = new Set(prev);
				next.delete(projectId);
				return next;
			});
			return;
		}

		setExpandedProjects((prev) => new Set(prev).add(projectId));
		// Prefetch the project detail through the shared query cache.
		void queryClient.prefetchQuery(projectQueryOptions(projectId));
	}

	if (projects === undefined) {
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
							<ExpandedProjectDetail
								projectId={project.id}
								labelClass={labelClass}
								linkClass={linkClass}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}

// Per-project expanded detail reads from the shared project query cache so
// sidebar + /project/$id route share a single fetch per project.
function ExpandedProjectDetail({
	projectId,
	labelClass,
	linkClass,
}: {
	projectId: string;
	labelClass: string;
	linkClass: (isActive: boolean) => string;
}) {
	const {data: raw, isFetching} = useQuery(projectQueryOptions(projectId));

	const detail: ProjectDetail | undefined = useMemo(() => {
		if (!raw) return undefined;
		return {
			sessions: raw.sessions.map((s) => ({id: s.id, title: s.title})),
			plans: raw.plans.map((p) => ({filename: p.filename, title: p.title})),
			memories: raw.memories.map((m) => ({
				filename: m.filename,
				title: m.title,
				project: m.project,
			})),
			todoCounts: raw.todoCounts,
		};
	}, [raw]);

	return (
		<div className="pl-4">
			{!detail && isFetching && <LoadingBars />}
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
									params={{id: projectId}}
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
								params={{id: projectId}}
								className={linkClass(false)}
								style={{paddingLeft: '1.5rem'}}
							>
								{detail.todoCounts.pending > 0 && `${detail.todoCounts.pending} pending`}
								{detail.todoCounts.pending > 0 && detail.todoCounts.inProgress > 0 && ', '}
								{detail.todoCounts.inProgress > 0 && `${detail.todoCounts.inProgress} in progress`}
							</Link>
						</div>
					)}
					{detail.sessions.length === 0 &&
						detail.plans.length === 0 &&
						detail.memories.length === 0 &&
						detail.todoCounts.total === 0 && (
							<div className="px-2 py-1 text-[10px] italic text-text-400">No items</div>
						)}
				</>
			)}
		</div>
	);
}
