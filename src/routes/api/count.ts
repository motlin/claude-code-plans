import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/api/count')({
	server: {
		handlers: {
			GET: async () => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {listPlans} = await import('../../lib/plans');
				const plansDir = join(homedir(), '.claude', 'plans');
				const plans = await listPlans(plansDir);
				return Response.json({count: plans.length});
			},
		},
	},
});
