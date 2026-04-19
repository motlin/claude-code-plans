export type Section =
	| 'active'
	| 'starred'
	| 'tasks'
	| 'projects'
	| 'plans'
	| 'memories'
	| 'sessions'
	| 'plugins'
	| 'setup';

export interface SubItem {
	id: string;
	label: string;
	to: string;
	params: Record<string, string>;
}

export interface ProjectDetail {
	sessions: Array<{id: string; title: string; gitBranch?: string | undefined}>;
	plans: Array<{filename: string; title: string}>;
	memories: Array<{filename: string; title: string; project: string}>;
	todoCounts: {total: number; pending: number; inProgress: number; completed: number};
}
