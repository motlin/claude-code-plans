import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {plansQueryOptions} from '../queries/plans';

export const Route = createFileRoute('/plans')({
	component: PlansPage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(plansQueryOptions),
	head: () => ({
		meta: [{title: 'Claude Plans'}],
	}),
});

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	});
}

function PlansPage() {
	const {data: plans} = useSuspenseQuery(plansQueryOptions);
	const now = Date.now();
	const count = plans.length;
	const countLabel = count === 1 ? '1 plan' : `${count} plans`;

	return (
		<div>
			<h1 className="text-lg font-semibold">Claude Plans</h1>
			<p className="mt-1 text-sm text-text-500">{countLabel}</p>

			{count === 0 ? (
				<p className="mt-4 text-text-500">No plans found.</p>
			) : (
				<ul className="mt-4 space-y-2">
					{plans.map((plan, index) => {
						const ageHours = (now - new Date(plan.mtime).getTime()) / 3600000;
						return (
							<li key={plan.filename}>
								<Link
									to="/plan/$filename"
									params={{filename: plan.filename}}
									preload={index < 2 ? 'render' : 'intent'}
									className="flex items-center justify-between rounded-md border border-border-300/15 px-4 py-3 transition-colors hover:bg-bg-200/50"
								>
									<span className="flex items-center gap-2 text-sm font-medium">
										{plan.title}
										{ageHours < 1 && (
											<span className="rounded-full bg-success-900 px-2 py-0.5 text-xs font-semibold text-success-000">
												NEW
											</span>
										)}
									</span>
									<span className="ml-4 shrink-0 text-xs text-text-500">
										{formatDate(plan.mtime)}
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
