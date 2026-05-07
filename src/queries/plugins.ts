// Compatibility shim — the canonical query options now live in
// `src/lib/api/plugins.ts`. Re-export them so existing imports keep working.
export {
	pluginsQueryOptions,
	userCommandsQueryOptions,
	pluginTreeQueryOptions,
	pluginFileQueryOptions,
	userCommandFileQueryOptions,
} from '../lib/api/plugins';
