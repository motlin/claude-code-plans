export function layoutGraph(tasks: GraphTask[]): {
	nodes: NodePos[];
	width: number;
	height: number;
} {
	const byId = new Map(tasks.map((t) => [t.taskId, t]));
	const taskIds = new Set(tasks.map((t) => t.taskId));

	// Assign layers via longest path from roots (tasks with no blockedBy within this set)
	const layerOf = new Map<string, number>();

	function getLayer(id: string, visited: Set<string>): number {
		if (layerOf.has(id)) return layerOf.get(id)!;
		if (visited.has(id)) return 0; // cycle guard
		visited.add(id);
		const task = byId.get(id);
		if (!task) return 0;
		const deps = task.blockedBy.filter((d) => taskIds.has(d));
		const layer = deps.length === 0 ? 0 : Math.max(...deps.map((d) => getLayer(d, visited))) + 1;
		layerOf.set(id, layer);
		return layer;
	}

	for (const t of tasks) getLayer(t.taskId, new Set());

	// Group by layer
	const layers = new Map<number, GraphTask[]>();
	for (const t of tasks) {
		const l = layerOf.get(t.taskId) ?? 0;
		let list = layers.get(l);
		if (!list) {
			list = [];
			layers.set(l, list);
		}
		list.push(t);
	}

	const maxLayer = Math.max(0, ...layers.keys());
	const nodes: NodePos[] = [];

	for (let l = 0; l <= maxLayer; l++) {
		const layerTasks = layers.get(l) ?? [];
		for (let i = 0; i < layerTasks.length; i++) {
			nodes.push({
				x: PADDING + l * LAYER_GAP_X,
				y: PADDING + i * NODE_GAP_Y,
				layer: l,
				task: layerTasks[i]!,
			});
		}
	}

	const width = nodes.length > 0 ? Math.max(...nodes.map((n) => n.x)) + NODE_W + PADDING : 300;
	const height = nodes.length > 0 ? Math.max(...nodes.map((n) => n.y)) + NODE_H + PADDING : 200;

	return {nodes, width, height};
}

export interface GraphTask {
	taskId: string;
	projectDir: string;
	subject: string;
	status: string;
	blocks: string[];
	blockedBy: string[];
}

export interface NodePos {
	x: number;
	y: number;
	layer: number;
	task: GraphTask;
}

export const NODE_W = 180;

export const NODE_H = 48;

const LAYER_GAP_X = 220;

const NODE_GAP_Y = 64;

const PADDING = 40;
