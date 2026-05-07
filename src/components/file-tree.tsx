import {useState} from 'react';
import {Link} from '@tanstack/react-router';
import {ChevronRight, Folder, FileText, FileCode, FileJson, File} from 'lucide-react';
import type {FileTreeNodeData as FileTreeNode} from '../lib/api/plugins';

function getName(node: FileTreeNode) {
	const i = node.path.lastIndexOf('/');
	return i === -1 ? node.path : node.path.slice(i + 1);
}

function getFileIcon(name: string) {
	const ext = name.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'md':
			return FileText;
		case 'ts':
		case 'tsx':
		case 'js':
		case 'jsx':
		case 'py':
		case 'sh':
			return FileCode;
		case 'json':
			return FileJson;
		default:
			return File;
	}
}

function FileTreeItem({node, pluginId, depth}: {node: FileTreeNode; pluginId: string; depth: number}) {
	const [expanded, setExpanded] = useState(depth < 1);
	const name = getName(node);

	if (node.children) {
		return (
			<div>
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm text-text-200 transition-colors hover:bg-bg-200/50"
					style={{paddingLeft: `${depth * 16 + 8}px`}}
				>
					<ChevronRight
						className="h-3 w-3 shrink-0 text-text-500 transition-transform duration-200"
						style={{transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'}}
					/>
					<Folder className="h-3.5 w-3.5 shrink-0 text-text-400" />
					<span className="truncate">{name}</span>
				</button>
				{expanded && (
					<div>
						{node.children.map((child) => (
							<FileTreeItem
								key={child.path}
								node={child}
								pluginId={pluginId}
								depth={depth + 1}
							/>
						))}
					</div>
				)}
			</div>
		);
	}

	const pathParts = node.path.split('/');
	const type = pathParts[0] || '';
	const filePath = pathParts.slice(1).join('/');
	const Icon = getFileIcon(name);

	const isMd = name.endsWith('.md');

	if (isMd && filePath) {
		return (
			<Link
				to="/plugin/$id/$type/$"
				params={{id: pluginId, type, _splat: filePath}}
				className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-text-300 no-underline transition-colors hover:bg-bg-200/50 hover:text-text-200"
				style={{paddingLeft: `${depth * 16 + 8}px`}}
			>
				<span className="w-3" />
				<Icon className="h-3.5 w-3.5 shrink-0 text-text-500" />
				<span className="truncate">{name}</span>
			</Link>
		);
	}

	return (
		<div
			className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-text-500"
			style={{paddingLeft: `${depth * 16 + 8}px`}}
		>
			<span className="w-3" />
			<Icon className="h-3.5 w-3.5 shrink-0 text-text-500" />
			<span className="truncate">{name}</span>
		</div>
	);
}

export function FileTree({tree, pluginId}: {tree: FileTreeNode; pluginId: string}) {
	if (!tree.children || tree.children.length === 0) {
		return <p className="px-2 py-1 text-xs text-text-500">No files found.</p>;
	}

	return (
		<div className="space-y-px">
			{tree.children.map((child) => (
				<FileTreeItem
					key={child.path}
					node={child}
					pluginId={pluginId}
					depth={0}
				/>
			))}
		</div>
	);
}
