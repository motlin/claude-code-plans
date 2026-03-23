export type Section = 'active' | 'starred' | 'projects' | 'plans' | 'memories' | 'sessions' | 'plugins';

export interface SubItem {
	id: string;
	label: string;
	to: string;
	params: Record<string, string>;
}

export interface ProjectDetail {
	sessions: Array<{id: string; title: string}>;
	plans: Array<{filename: string; title: string}>;
	memories: Array<{filename: string; title: string; project: string}>;
}
