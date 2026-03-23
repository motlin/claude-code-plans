import {Link} from '@tanstack/react-router';
import {useEffect, useState} from 'react';
import {getPluginsList, getUserCommandsList} from '../../../lib/server-fns';
import {LoadingBars} from '../primitives/LoadingBars';

export function PluginsSubList({refreshKey}: {refreshKey: number}) {
	const [items, setItems] = useState<Array<
		{type: 'plugin'; id: string; label: string} | {type: 'command'; source: string; filename: string; label: string}
	> | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function fetch() {
			const [plugins, commands] = await Promise.all([getPluginsList(), getUserCommandsList()]);
			const result: typeof items = [];
			for (const p of plugins) {
				result.push({type: 'plugin', id: p.id, label: p.name});
			}
			for (const g of commands) {
				for (const c of g.commands) {
					result.push({type: 'command', source: g.source, filename: c.filename, label: c.name});
				}
			}
			if (!cancelled) setItems(result);
		}
		fetch();
		return () => {
			cancelled = true;
		};
	}, [refreshKey]);

	if (items === null) {
		return (
			<div className="pl-10">
				<LoadingBars />
			</div>
		);
	}

	if (items.length === 0) return null;

	return (
		<div className="pl-10">
			{items.map((item) => {
				if (item.type === 'plugin') {
					return (
						<Link
							key={item.id}
							to="/plugins"
							hash={item.id}
							className="mb-px block truncate rounded-[4px] px-2 py-1 text-xs text-text-500 no-underline transition-colors hover:bg-bg-300/50 hover:text-text-200"
						>
							{item.label}
						</Link>
					);
				}
				return (
					<Link
						key={`${item.source}/${item.filename}`}
						to="/command/$source/$filename"
						params={{source: item.source, filename: item.filename}}
						className="mb-px block truncate rounded-[4px] px-2 py-1 text-xs text-text-500 no-underline transition-colors hover:bg-bg-300/50 hover:text-text-200"
					>
						{item.label}
					</Link>
				);
			})}
		</div>
	);
}
