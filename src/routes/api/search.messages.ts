import {createFileRoute} from '@tanstack/react-router';
import {MessageSearchResponse} from '../../lib/api/search';

export const Route = createFileRoute('/api/search/messages')({
	server: {
		handlers: {
			GET: async ({request}: {request: Request}) => {
				const url = new URL(request.url);
				const query = url.searchParams.get('query')?.trim() ?? '';
				if (!query) {
					return Response.json(MessageSearchResponse.parse([]), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				const {getDb} = await import('../../lib/db');
				const {searchMessageContentDb} = await import('../../lib/db/queries');
				const {index} = getDb();
				const results = searchMessageContentDb(index, query);

				return Response.json(MessageSearchResponse.parse(results), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
