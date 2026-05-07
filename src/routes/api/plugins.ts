import {createFileRoute} from '@tanstack/react-router';
import {PluginListResponse} from '../../lib/api/plugins';

export const Route = createFileRoute('/api/plugins')({
	server: {
		handlers: {
			GET: async () => {
				const {listPlugins} = await import('../../lib/plugins');
				const plugins = await listPlugins();
				return Response.json(PluginListResponse.parse(plugins), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
