import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownArticle } from "../../components/markdown-article";

const meta = {
  title: "Shared/MarkdownArticle",
  component: MarkdownArticle,
} satisfies Meta<typeof MarkdownArticle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RenderedMarkdown: Story = {
  args: {
    html: '<h1>Hello World</h1><p>This is a <strong>bold</strong> paragraph with a <a href="#">link</a>.</p><ul><li>Item one</li><li>Item two</li></ul><pre><code>const x = 42;</code></pre>',
  },
};

export const EmptyContent: Story = {
  args: {
    html: "",
  },
};

export const LongContent: Story = {
  args: {
    html: Array.from(
      { length: 20 },
      (_, i) =>
        `<h2>Section ${i + 1}</h2><p>${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(5)}</p>`,
    ).join(""),
  },
};

export const FromMarkdown: Story = {
  args: {
    markdown:
      "# Hello World\n\nThis is a **bold** paragraph with a [link](#).\n\n- Item one\n- Item two\n\n```js\nconst x = 42;\n```",
  },
};

export const MarkdownWithTaskList: Story = {
  args: {
    markdown: "## Tasks\n\n- [ ] Unchecked item\n- [x] Checked item\n- [ ] Another unchecked",
  },
};
