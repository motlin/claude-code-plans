import {useMemo, useState, useCallback} from "react";
import {useResolvedTheme} from "./theme-context";
import {layoutGraph, type GraphTask, NODE_H, NODE_W, type NodePos} from "./task-dependency-graph-layout";

export interface TaskGraphGroup {
	projectDir: string;
	tasks: GraphTask[];
}

const statusColors: Record<string, {bg: string; border: string; text: string}> = {
	pending: {bg: "#f3f4f6", border: "#d1d5db", text: "#4b5563"},
	in_progress: {bg: "#dbeafe", border: "#93c5fd", text: "#2563eb"},
	completed: {bg: "#dcfce7", border: "#86efac", text: "#16a34a"},
};

const statusColorsDark: Record<string, {bg: string; border: string; text: string}> = {
	pending: {bg: "#1f2937", border: "#4b5563", text: "#9ca3af"},
	in_progress: {bg: "#1e3a5f", border: "#3b82f6", text: "#93c5fd"},
	completed: {bg: "#14532d", border: "#22c55e", text: "#86efac"},
};

function truncate(text: string, max: number): string {
	return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}

export function TaskDependencyGraph({groups}: {groups: TaskGraphGroup[]}) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const isDark = useResolvedTheme() === "dark";

	const allTasks = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);

	const {nodes, width, height} = useMemo(() => layoutGraph(allTasks), [allTasks]);
	const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.task.taskId, n])), [nodes]);

	const colors = isDark ? statusColorsDark : statusColors;
	const fallback = isDark
		? {bg: "#1f2937", border: "#4b5563", text: "#9ca3af"}
		: {bg: "#f3f4f6", border: "#d1d5db", text: "#4b5563"};

	// Edges: from dependency to dependent (blockedBy → task)
	const edges = useMemo(() => {
		const result: {from: NodePos; to: NodePos; key: string}[] = [];
		for (const node of nodes) {
			for (const depId of node.task.blockedBy) {
				const dep = nodeMap.get(depId);
				if (dep) {
					result.push({
						from: dep,
						to: node,
						key: `${depId}->${node.task.taskId}`,
					});
				}
			}
		}
		return result;
	}, [nodes, nodeMap]);

	// Highlight connected edges on hover
	const highlightedEdges = useMemo(() => {
		if (!hoveredId) return new Set<string>();
		const set = new Set<string>();
		for (const e of edges) {
			if (e.from.task.taskId === hoveredId || e.to.task.taskId === hoveredId) {
				set.add(e.key);
			}
		}
		return set;
	}, [hoveredId, edges]);

	const handleMouseEnter = useCallback((id: string) => {
		setHoveredId(id);
	}, []);
	const handleMouseLeave = useCallback(() => {
		setHoveredId(null);
	}, []);

	if (allTasks.length === 0) {
		return <p className="mt-4 text-t6">No tasks to display.</p>;
	}

	const edgeColor = isDark ? "#4b5563" : "#d1d5db";
	const edgeHighlight = isDark ? "#60a5fa" : "#3b82f6";
	const arrowId = "dep-arrow";
	const arrowHighlightId = "dep-arrow-hl";

	return (
		<div className="mt-4 overflow-auto rounded-lg border border-strong">
			<svg width={width} height={height} className="block">
				<defs>
					<marker
						id={arrowId}
						viewBox="0 0 10 7"
						refX="10"
						refY="3.5"
						markerWidth="8"
						markerHeight="6"
						orient="auto"
					>
						<polygon points="0 0, 10 3.5, 0 7" fill={edgeColor} />
					</marker>
					<marker
						id={arrowHighlightId}
						viewBox="0 0 10 7"
						refX="10"
						refY="3.5"
						markerWidth="8"
						markerHeight="6"
						orient="auto"
					>
						<polygon points="0 0, 10 3.5, 0 7" fill={edgeHighlight} />
					</marker>
				</defs>

				{/* Edges */}
				{edges.map((e) => {
					const x1 = e.from.x + NODE_W;
					const y1 = e.from.y + NODE_H / 2;
					const x2 = e.to.x;
					const y2 = e.to.y + NODE_H / 2;
					const midX = (x1 + x2) / 2;
					const highlighted = highlightedEdges.has(e.key);
					return (
						<path
							key={e.key}
							d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
							fill="none"
							stroke={highlighted ? edgeHighlight : edgeColor}
							strokeWidth={highlighted ? 2 : 1.5}
							markerEnd={`url(#${highlighted ? arrowHighlightId : arrowId})`}
							opacity={hoveredId && !highlighted ? 0.2 : 1}
							style={{transition: "opacity 0.15s, stroke 0.15s"}}
						/>
					);
				})}

				{/* Nodes */}
				{nodes.map((n) => {
					const c = colors[n.task.status] ?? fallback;
					const dimmed =
						hoveredId !== null &&
						hoveredId !== n.task.taskId &&
						!highlightedEdges.has(`${hoveredId}->${n.task.taskId}`) &&
						!highlightedEdges.has(`${n.task.taskId}->${hoveredId}`);
					return (
						<g
							key={n.task.taskId}
							onMouseEnter={() => {
								handleMouseEnter(n.task.taskId);
							}}
							onMouseLeave={handleMouseLeave}
							style={{
								cursor: "default",
								opacity: dimmed ? 0.3 : 1,
								transition: "opacity 0.15s",
							}}
						>
							<rect
								x={n.x}
								y={n.y}
								width={NODE_W}
								height={NODE_H}
								rx={8}
								fill={c.bg}
								stroke={c.border}
								strokeWidth={hoveredId === n.task.taskId ? 2 : 1.5}
							/>
							<text x={n.x + 10} y={n.y + 20} fontSize={12} fontWeight={600} fill={c.text}>
								#{n.task.taskId}
							</text>
							<text x={n.x + 10} y={n.y + 36} fontSize={11} fill={c.text} opacity={0.8}>
								{truncate(n.task.subject, 22)}
							</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
}
