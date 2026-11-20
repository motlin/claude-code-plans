interface ModuleNode
{
	file: string;
	importers: Set<string>;
}

/** The parts of the module runner's graph (vite's EvaluatedModules) that hold a node. */
export interface ModuleGraph
{
	idToModuleMap: Map<string, ModuleNode>;
	urlToIdModuleMap: Map<string, ModuleNode>;
	fileToModulesMap: Map<string, Set<ModuleNode>>;
}

/**
 * Takes a node out of the graph rather than clearing it in place: code still evaluating it writes its exports onto the
 * node it started with, and on a node still in the graph that write could land after the current file registered its
 * mocks, handing every later import exports built without them.
 */
function forgetModule(graph: ModuleGraph, id: string, node: ModuleNode): void
{
	graph.idToModuleMap.delete(id);
	graph.fileToModulesMap.get(node.file)?.delete(node);
	for (const [url, urlNode] of graph.urlToIdModuleMap) if (urlNode === node) graph.urlToIdModuleMap.delete(url);
}

/**
 * Drops every evaluated mock module from the graph, so the next import of a mocked path runs the current file's factory,
 * out of reach of an earlier file's factory still running when that file ended.
 */
export function forgetMockModules(graph: ModuleGraph): void
{
	for (const [id, node] of graph.idToModuleMap) if (id.startsWith("mock:")) forgetModule(graph, id, node);
}

/**
 * Drops every module that imports `id`, directly or through other modules, so the next import of one evaluates it
 * against a mock of `id` registered since. They were evaluated without it: an earlier file's late import ran them after
 * the reset but before the current file's vi.mock calls registered.
 */
export function forgetImporters(graph: ModuleGraph, id: string): void
{
	const pending = [...(graph.idToModuleMap.get(id)?.importers ?? [])];
	for (let importer = pending.pop(); importer !== undefined; importer = pending.pop())
	{
		const node = graph.idToModuleMap.get(importer);
		if (node === undefined) continue;
		forgetModule(graph, importer, node);
		pending.push(...node.importers);
	}
}
