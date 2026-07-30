export interface SearchableTask {
  taskId: string;
  subject: string;
  description: string;
  activeForm: string | null;
  owner: string | null;
}

export function taskMatchesSearch(task: SearchableTask, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return true;

  return [
    task.taskId,
    task.subject,
    task.description,
    task.activeForm ?? "",
    task.owner ?? "",
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function filterTasks<T extends SearchableTask>(tasks: T[], query: string): T[] {
  return tasks.filter((task) => taskMatchesSearch(task, query));
}
