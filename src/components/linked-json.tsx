import {resolveLink} from "./linked-json-links";
import type {LinkedJsonContext} from "./linked-json-links";
import {isRecord} from "../lib/narrow";

interface LinkedJsonProps {
	value: unknown;
	context: LinkedJsonContext;
}

/**
 * Recursive JSON renderer that syntax-colors tokens and turns recognized
 * string values into navigable links. Keys stay inert; only values link.
 */
export function LinkedJson({value, context}: LinkedJsonProps) {
	return (
		<pre className="bg-surface-1 text-primary text-xs font-mono whitespace-pre-wrap break-all rounded p-3 overflow-x-auto leading-relaxed">
			<JsonValue value={value} path={[]} ctx={context} indent={0} />
		</pre>
	);
}

const INDENT_SIZE = 2;

function indentStr(level: number): string {
	return " ".repeat(level * INDENT_SIZE);
}

function JsonValue({
	value,
	path,
	ctx,
	indent,
}: {
	value: unknown;
	path: string[];
	ctx: LinkedJsonContext;
	indent: number;
}) {
	if (value === null) return <span className="text-t6 italic">null</span>;
	if (value === undefined) return <span className="text-t6 italic">undefined</span>;
	if (Array.isArray(value)) return <JsonArray items={value} path={path} ctx={ctx} indent={indent} />;
	if (isRecord(value)) return <JsonObject obj={value} path={path} ctx={ctx} indent={indent} />;

	switch (typeof value) {
		case "string":
			return <StringValue value={value} path={path} ctx={ctx} />;
		case "number":
			return <span className="text-[#b5cea8]">{String(value)}</span>;
		case "boolean":
			return <span className="text-[#569cd6]">{String(value)}</span>;
		default:
			return <span className="text-secondary">{JSON.stringify(value)}</span>;
	}
}

function JsonArray({
	items,
	path,
	ctx,
	indent,
}: {
	items: unknown[];
	path: string[];
	ctx: LinkedJsonContext;
	indent: number;
}) {
	if (items.length === 0) return <span className="text-secondary">[]</span>;

	return (
		<>
			<span className="text-secondary">{"["}</span>
			{"\n"}
			{items.map((item, i) => (
				<span key={i}>
					{indentStr(indent + 1)}
					<JsonValue value={item} path={[...path, String(i)]} ctx={ctx} indent={indent + 1} />
					{i < items.length - 1 ? <span className="text-secondary">,</span> : null}
					{"\n"}
				</span>
			))}
			{indentStr(indent)}
			<span className="text-secondary">{"]"}</span>
		</>
	);
}

function JsonObject({
	obj,
	path,
	ctx,
	indent,
}: {
	obj: Record<string, unknown>;
	path: string[];
	ctx: LinkedJsonContext;
	indent: number;
}) {
	const keys = Object.keys(obj);
	if (keys.length === 0) return <span className="text-secondary">{"{}"}</span>;

	return (
		<>
			<span className="text-secondary">{"{"}</span>
			{"\n"}
			{keys.map((key, i) => (
				<span key={key}>
					{indentStr(indent + 1)}
					<span className="text-[#9cdcfe]">"{key}"</span>
					<span className="text-secondary">: </span>
					<JsonValue value={obj[key]} path={[...path, key]} ctx={ctx} indent={indent + 1} />
					{i < keys.length - 1 ? <span className="text-secondary">,</span> : null}
					{"\n"}
				</span>
			))}
			{indentStr(indent)}
			<span className="text-secondary">{"}"}</span>
		</>
	);
}

// --- Link resolution ---

function StringValue({value, path, ctx}: {value: string; path: string[]; ctx: LinkedJsonContext}) {
	const key = path[path.length - 1] ?? "";
	const resolved = resolveLink(value, key, ctx);

	const truncateDisplay = value.length > 500;
	const displayValue = truncateDisplay ? value.slice(0, 500) + "..." : value;
	const escaped = displayValue
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");

	if (!resolved) {
		return <span className="text-[#ce9178]">"{escaped}"</span>;
	}

	if (resolved.isExternal) {
		return (
			<span className="text-[#ce9178]">
				"
				<a
					href={resolved.href}
					target="_blank"
					rel="noopener noreferrer"
					title={resolved.title}
					className="text-accent-100 hover:text-accent-000 underline decoration-dotted hover:decoration-solid"
				>
					{escaped}
					{resolved.icon}
				</a>
				"
			</span>
		);
	}

	return (
		<span className="text-[#ce9178]">
			"
			<a
				href={resolved.href}
				title={resolved.title}
				className="text-accent-100 hover:text-accent-000 underline decoration-dotted hover:decoration-solid"
			>
				{escaped}
				{resolved.icon}
			</a>
			"
		</span>
	);
}
