import {useMemo} from 'react';
import {DiffView, DiffModeEnum} from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view.css';
import type {ToolRendererProps} from './types';
import {DiffStats, ErrorBorder} from './shared';
import {useResolvedTheme} from '../theme-provider';

const SUPPORTED_LANGS = new Set([
	'bash',
	'c',
	'cpp',
	'cs',
	'css',
	'diff',
	'docker',
	'dockerfile',
	'go',
	'html',
	'java',
	'javascript',
	'json',
	'jsx',
	'kotlin',
	'makefile',
	'markdown',
	'python',
	'rust',
	'shell',
	'sql',
	'swift',
	'tsx',
	'txt',
	'typescript',
	'xml',
	'yaml',
]);

const EXT_TO_LANG: Record<string, string> = {
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	sh: 'bash',
	zsh: 'bash',
	yml: 'yaml',
	yaml: 'yaml',
	md: 'markdown',
	mdx: 'markdown',
};

function resolveLang(filePath: string): string {
	const name = filePath.split('/').pop() ?? '';
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	const mapped = EXT_TO_LANG[ext] ?? ext;
	return SUPPORTED_LANGS.has(mapped) ? mapped : 'txt';
}

export function EditRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const {diffData, result, isError} = toolCall;
	const theme = useResolvedTheme();

	const viewData = useMemo(() => {
		if (!diffData?.unifiedHunk) return null;
		const lang = resolveLang(diffData.filePath ?? filePath);
		return {
			oldFile: {fileName: filePath, fileLang: lang, content: diffData.oldContent ?? ''},
			newFile: {fileName: filePath, fileLang: lang, content: diffData.newContent ?? ''},
			hunks: [diffData.unifiedHunk],
		};
	}, [diffData, filePath]);

	if (!diffData) {
		return (
			<ErrorBorder isError={isError}>
				<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap">{result}</pre>
			</ErrorBorder>
		);
	}

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2 flex-wrap mb-2">
				<code className="text-xs font-mono text-text-500 bg-bg-100 px-1 py-0.5 rounded truncate">
					{filePath}
				</code>
				<DiffStats
					added={diffData.added}
					removed={diffData.removed}
				/>
			</div>
			{viewData && (
				<div className="rounded border border-border-300/15 overflow-hidden text-xs">
					<DiffView
						data={viewData}
						diffViewMode={DiffModeEnum.Unified}
						diffViewTheme={theme}
						diffViewHighlight
						diffViewWrap
						diffViewFontSize={12}
					/>
				</div>
			)}
		</ErrorBorder>
	);
}
