import {createFileRoute} from '@tanstack/react-router';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {listPlans} from '../../lib/plans';

const PLANS_DIR = process.env['PLANS_DIR'] ?? join(homedir(), '.claude', 'plans');

export const Route = createFileRoute('/api/count')({
	server: {
		handlers: {
			GET: async () => {
				const plans = await listPlans(PLANS_DIR);
				return Response.json({count: plans.length});
			},
		},
	},
});
