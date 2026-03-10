import {
	MDXEditor,
	headingsPlugin,
	listsPlugin,
	quotePlugin,
	thematicBreakPlugin,
	markdownShortcutPlugin,
	linkPlugin,
	tablePlugin,
	codeBlockPlugin,
	codeMirrorPlugin,
	toolbarPlugin,
	BoldItalicUnderlineToggles,
	BlockTypeSelect,
	CreateLink,
	ListsToggle,
	InsertTable,
	InsertThematicBreak,
	CodeToggle,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

interface Props {
	markdown: string;
	onChange: (markdown: string) => void;
}

export function MarkdownEditor({markdown, onChange}: Props) {
	return (
		<div className="mdx-editor-wrapper [&_.mdxeditor]:bg-background [&_.mdxeditor]:text-foreground [&_.mdxeditor-toolbar]:bg-muted [&_.mdxeditor-toolbar]:border-border">
			<MDXEditor
				markdown={markdown}
				onChange={onChange}
				plugins={[
					headingsPlugin(),
					listsPlugin(),
					quotePlugin(),
					thematicBreakPlugin(),
					markdownShortcutPlugin(),
					linkPlugin(),
					tablePlugin(),
					codeBlockPlugin({defaultCodeBlockLanguage: ''}),
					codeMirrorPlugin({
						codeBlockLanguages: {
							ts: 'TypeScript',
							js: 'JavaScript',
							py: 'Python',
							sh: 'Shell',
							'': 'Plain text',
						},
					}),
					toolbarPlugin({
						toolbarContents: () => (
							<>
								<BlockTypeSelect />
								<BoldItalicUnderlineToggles />
								<CodeToggle />
								<ListsToggle />
								<CreateLink />
								<InsertTable />
								<InsertThematicBreak />
							</>
						),
					}),
				]}
			/>
		</div>
	);
}
