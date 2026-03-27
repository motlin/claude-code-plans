import {Link} from '@tanstack/react-router';
import {useEffect, useState} from 'react';
import {getPlans, getMemories, getSessions, getProjects} from '../../../lib/server-fns';
import {useSectionRefreshKey} from '../../../hooks/use-claude-events';
import {getCached, setCache} from '../../../lib/sidebar-cache';
import type {Section, SubItem} from '../types';
import {LoadingBars} from '../primitives/LoadingBars';

export function SubList({section, activeItemId}: {section: Section; activeItemId: string | null}) {
	const refreshKey = useSectionRefreshKey(section);
	const [items, setItems] = useState<SubItem[] | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function fetchItems() {
			const cached = getCached<SubItem[]>(`sidebar:${section}`);
			if (cached) {
				if (!cancelled) setItems(cached);
				return;
			}

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
				setCache(`sidebar:${section}`, result);
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
								? 'bg-bg-300/50 font-medium text-text-000'
								: 'text-text-500 hover:bg-bg-300/50 hover:text-text-200'
						}`}
					>
						{item.label}
					</Link>
				);
			})}
		</div>
	);
}
