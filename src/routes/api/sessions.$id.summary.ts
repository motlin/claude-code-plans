import {createFileRoute} from '@tanstack/react-router';
import {SummaryMutationResponse} from '../../lib/api/sessions';

export const Route = createFileRoute('/api/sessions/$id/summary')({
	server: {
		handlers: {
			POST: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import('../../lib/db');
				const {generateSummary} = await import('../../lib/summaries');
				const {summaries} = getDb();
				const summary = await generateSummary(summaries, params.id);
				return Response.json(SummaryMutationResponse.parse({summary}), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
