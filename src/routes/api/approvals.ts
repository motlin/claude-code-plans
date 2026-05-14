import {createFileRoute} from '@tanstack/react-router';
import {ApprovalsResponse} from '../../lib/api/approvals';

export const Route = createFileRoute('/api/approvals')({
	server: {
		handlers: {
			GET: async ({request}: {request: Request}) => {
				const {getPendingApprovals, getPendingApprovalsForProject} = await import(
					'../../lib/db/pending-approvals-cache'
				);
				const url = new URL(request.url);
				const projectId = url.searchParams.get('projectId');
				const approvals = projectId ? getPendingApprovalsForProject(projectId) : getPendingApprovals();
				return Response.json(ApprovalsResponse.parse({approvals}), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
