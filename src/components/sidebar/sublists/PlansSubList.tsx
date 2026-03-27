import {Link} from '@tanstack/react-router';
import {ChevronRight} from 'lucide-react';
import {useEffect, useState} from 'react';
import {getPlansGrouped} from '../../../lib/server-fns';
import {useSectionRefreshKey} from '../../../hooks/use-claude-events';
import {getCached, setCache} from '../../../lib/sidebar-cache';
import {LoadingBars} from '../primitives/LoadingBars';

interface PlanGroup {
	projectId: string;
	projectName: string;
	plans: Array<{filename: string; title: string; mtime: string}>;
}

export function PlansSubList({activeItemId}: {activeItemId: string | null}) {
	const refreshKey = useSectionRefreshKey('plans');
	const [groups, setGroups] = useState<PlanGroup[] | null>(null);
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

	useEffect(() => {
		let cancelled = false;

		async function fetchPlans() {
			const cached = getCached<PlanGroup[]>('sidebar:plans');
			if (cached) {
				if (!cancelled) setGroups(cached);
				return;
			}
			const result = await getPlansGrouped();
			if (!cancelled) {
				setGroups(result);
				setCache('sidebar:plans', result);
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
									? 'bg-bg-300/50 font-medium text-text-000'
									: 'text-text-500 hover:bg-bg-300/50 hover:text-text-200'
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
							className="mb-px flex w-full items-center gap-1 rounded-[4px] px-2 py-1 text-xs text-text-500 transition-colors hover:bg-bg-300/50 hover:text-text-200"
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
												? 'bg-bg-300/50 font-medium text-text-000'
												: 'text-text-500 hover:bg-bg-300/50 hover:text-text-200'
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
