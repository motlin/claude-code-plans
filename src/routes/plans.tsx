import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {listPlans} from '../lib/plans';

const PLANS_DIR = process.env['PLANS_DIR'] ?? join(homedir(), '.claude', 'plans');

const getPlans = createServerFn({method: 'GET'}).handler(async () => {
	const plans = await listPlans(PLANS_DIR);
	return plans.map((p) => ({
		filename: p.filename,
		title: p.title,
		mtime: p.mtime.toISOString(),
	}));
});

export const Route = createFileRoute('/plans')({
	component: PlansPage,
	loader: () => getPlans(),
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
	const plans = Route.useLoaderData();
	const now = Date.now();
	const count = plans.length;
	const countLabel = count === 1 ? '1 plan' : `${count} plans`;

	return (
		<div>
			<h1 className="text-lg font-semibold">Claude Plans</h1>
			<p className="mt-1 text-sm text-muted-foreground">{countLabel}</p>

			{count === 0 ? (
				<p className="mt-4 text-muted-foreground">No plans found.</p>
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
									className="flex items-center justify-between rounded-md border border-border px-4 py-3 transition-colors hover:bg-muted/50"
								>
									<span className="flex items-center gap-2 text-sm font-medium">
										{plan.title}
										{ageHours < 1 && (
											<span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
												NEW
											</span>
										)}
									</span>
									<span className="ml-4 shrink-0 text-xs text-muted-foreground">
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
