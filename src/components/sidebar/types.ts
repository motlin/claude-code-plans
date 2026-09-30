import type {NavSection} from "../../lib/nav-sections";

export type Section = NavSection;

export interface SidebarProjectDetail {
	sessions: Array<{
		id: string;
		title: string;
		gitBranch?: string | undefined;
	}>;
	plans: Array<{filename: string; title: string}>;
	memories: Array<{filename: string; title: string; project: string}>;
	todoCounts: {
		total: number;
		pending: number;
		inProgress: number;
		completed: number;
	};
}
