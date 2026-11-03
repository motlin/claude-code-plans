import {formatCount} from "../lib/pluralize";

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

interface ProjectCounts {
	activeCount: number;
	sessionCount: number;
	planCount: number;
	memoryCount: number;
	taskCount: number;
	lastActivity: string;
}

export function ProjectCardCounts({project}: {project: ProjectCounts}) {
	return (
		<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-t6">
			{project.activeCount > 0 && (
				<>
					<span className="flex items-center gap-1 text-green-500">
						<span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
						{project.activeCount} active
					</span>
					<span>&middot;</span>
				</>
			)}
			<span>{formatCount(project.sessionCount, "session")}</span>
			{project.planCount > 0 && (
				<>
					<span>&middot;</span>
					<span>{formatCount(project.planCount, "plan")}</span>
				</>
			)}
			{project.memoryCount > 0 && (
				<>
					<span>&middot;</span>
					<span>{formatCount(project.memoryCount, "memory")}</span>
				</>
			)}
			{project.taskCount > 0 && (
				<>
					<span>&middot;</span>
					<span>{formatCount(project.taskCount, "task")}</span>
				</>
			)}
			<span>&middot;</span>
			<span>{formatDate(project.lastActivity)}</span>
		</div>
	);
}
