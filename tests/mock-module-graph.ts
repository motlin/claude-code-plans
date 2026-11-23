interface ModuleNode
{
	file: string;
	importers: Set<string>;
	imports: Set<string>;
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

/** A module from the project's own source, which a file loads afresh, rather than node_modules, a builtin or a mock. */
function isSourceModule(id: string): boolean
{
	return id.startsWith("/") && !id.includes("/node_modules/");
}

/**
 * Drops every module that imports `id`, directly or through other modules, so the next import of one evaluates it
 * against a mock of `id` registered since. They were evaluated without it: an earlier file's late import ran them after
 * the reset but before the current file's vi.mock calls registered.
 *
 * A direct importer can also hand the real module to source modules it imports, which import nothing of `id`
 * themselves: use-shrinkwrap gives the engine to shrinkwrap-loader, which tooltips read it from. Those are dropped too,
 * with their importers, or the fresh importer would provide the mock to a stale module that keeps the real one.
 */
export function forgetImporters(graph: ModuleGraph, id: string): void
{
	const direct = [...(graph.idToModuleMap.get(id)?.importers ?? [])];
	const handedTo = direct.flatMap((importer) =>
		[...(graph.idToModuleMap.get(importer)?.imports ?? [])].filter(
			(imported) => imported !== id && isSourceModule(imported),
		),
	);
	const pending = [...direct, ...handedTo];
	for (let stale = pending.pop(); stale !== undefined; stale = pending.pop())
	{
		const node = graph.idToModuleMap.get(stale);
		if (node === undefined) continue;
		forgetModule(graph, stale, node);
		pending.push(...node.importers);
	}
}
