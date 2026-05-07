// This file is retained as a compatibility shim while Phase 2c migrates
// `getProject` and friends to REST endpoints. Re-export the new query options
// so existing imports keep working until callers are updated.
export {
	projectDetailQueryOptions,
	projectBranchesQueryOptions,
	projectSessionsQueryOptions,
	projectPlansQueryOptions,
	projectSubagentsQueryOptions,
	projectTasksQueryOptions,
} from '../lib/api/projects';
