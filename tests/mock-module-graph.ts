interface ModuleNode
{
	file: string;
}

/** The parts of the module runner's graph (vite's EvaluatedModules) that hold a node. */
export interface ModuleGraph
{
	idToModuleMap: Map<string, ModuleNode>;
	urlToIdModuleMap: Map<string, ModuleNode>;
	fileToModulesMap: Map<string, Set<ModuleNode>>;
}

/**
 * Drops every evaluated mock module from the graph, so the next import of a mocked path runs the current file's factory.
 * The nodes leave the graph rather than being cleared in place: an earlier file's factory still running when that file
 * ended writes its exports onto the node it started with, and on a node still in the graph that write could land after
 * the current file registered its own mock, handing every later import the earlier file's exports.
 */
export function forgetMockModules(graph: ModuleGraph): void
{
	for (const [id, node] of graph.idToModuleMap)
	{
		if (!id.startsWith("mock:")) continue;
		graph.idToModuleMap.delete(id);
		graph.fileToModulesMap.get(node.file)?.delete(node);
		for (const [url, urlNode] of graph.urlToIdModuleMap) if (urlNode === node) graph.urlToIdModuleMap.delete(url);
	}
}
