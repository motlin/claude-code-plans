# Plan: Editable Memories and Plans with Open Source Markdown Editor

## Current State

The claude-code-plans server renders Claude Code plan/memory markdown files as read-only HTML pages. The server is a vanilla Node.js HTTP server (no framework) with:
- Server-rendered HTML with inline CSS/JS (no build step, no React)
- GitHub-style markdown rendering via `markdown-it` + `@shikijs/markdown-it`
- GitHub markdown CSS (`github-markdown-css`)
- Light/Dark/Auto theme toggle with localStorage persistence
- SSE-based live-reload via `chokidar` file watcher
- Routes: `/plan/:filename`, `/memory/:project/:filename` for detail pages

## Editor Evaluation

### Top 3 Candidates

#### 1. EasyMDE (Recommended)

A SimpleMDE fork with active maintenance. Purpose-built for markdown editing.

**Pros:**
- Single CSS + JS file via CDN -- no build step required
- Full toolbar out of the box (bold, italic, headings, lists, links, images, etc.)
- Built-in side-by-side live preview
- Spell checking, autosave, drag-and-drop image support
- Keyboard shortcuts (Ctrl+B, Ctrl+I, etc.) included
- Simple API: `new EasyMDE({ element: textarea })`
- MIT license
- ~496 KB uncompressed (~160 KB gzipped with CSS)

**Cons:**
- No native dark mode -- requires custom CSS overrides
- Built on CodeMirror 5 (older but stable)
- Preview rendering uses its own markdown parser (not our `markdown-it` pipeline)

#### 2. CodeMirror 6

The modern, modular code editor framework.

**Pros:**
- Excellent architecture, very modular, best tree-shaking
- Native dark mode support with theme switching
- Smallest core bundle (~135 KB gzipped)
- MIT license

**Cons:**
- Requires ESM modules -- no simple `<script>` tag loading
- No built-in toolbar or preview -- significant assembly required
- Would need a bundler or complex ESM CDN setup (esm.sh)
- Markdown support is syntax highlighting only, no editing shortcuts/toolbar
- Much more integration work for equivalent UX

#### 3. Monaco Editor

VS Code's editor component.

**Pros:**
- Full VS Code editing experience
- Native dark mode with multiple built-in themes
- MIT license

**Cons:**
- Very large: ~1.5-2 MB minimum for markdown-only config
- Requires AMD loader (RequireJS) or complex ESM setup
- Massive overkill for markdown editing
- No built-in markdown toolbar or preview
- Complex CDN integration

### Decision: EasyMDE

EasyMDE is the clear winner for this project because:
1. **Zero build step** -- aligns with the project's vanilla HTML architecture
2. **Complete markdown UX** -- toolbar, preview, shortcuts all included
3. **Trivial integration** -- two CDN tags + one JS constructor
4. **Dark mode gap is small** -- a few CSS overrides targeting `.EasyMDEContainer` in `html[data-theme="dark"]` context, matching the existing pattern in `html.ts`

## Architecture

### Edit Mode UX

**Toggle button approach** -- add an "Edit" button to plan/memory detail pages that switches between read (rendered HTML) and edit (EasyMDE textarea) modes.

```
[Read Mode]                          [Edit Mode]
+--------------------------+         +--------------------------+
| <- All Plans    [Edit]   |         | <- All Plans  [Cancel]   |
|                          |         |               [Save]     |
| <rendered markdown>      |         | [EasyMDE toolbar]        |
|                          |         | [raw markdown editor]    |
|                          |         |                          |
+--------------------------+         +--------------------------+
```

- Clicking "Edit" fetches raw markdown via `GET /api/plan/:filename` (new API endpoint)
- EasyMDE is loaded lazily (CDN script injected on first edit click)
- The rendered `<article>` is hidden; a `<textarea>` with EasyMDE is shown
- Clicking "Save" sends `PUT /api/plan/:filename` with the raw markdown body
- Clicking "Cancel" discards changes, hides editor, shows rendered content
- On save success, the page reloads (SSE watcher will detect the file change anyway)

### New API Endpoints

#### `GET /api/plan/:filename`
Returns raw markdown content as JSON: `{ "content": "# My Plan\n..." }`

#### `PUT /api/plan/:filename`
Accepts JSON body `{ "content": "# Updated\n..." }`, writes to disk, returns `{ "ok": true }`.
Must validate filename to prevent path traversal (reuse existing `readPlan` path logic).

#### `GET /api/memory/:project/:filename`
Returns raw markdown content as JSON for memory files.

#### `PUT /api/memory/:project/:filename`
Writes updated markdown content for memory files.
Must validate both project and filename parameters.

### File Save Flow

1. User clicks "Save" in the editor
2. Client JS sends `PUT /api/plan/:filename` with `Content-Type: application/json`
3. Server parses JSON body, extracts `content` string
4. Server validates filename (no `..`, no `/`, must end in `.md`)
5. Server writes content to the plan/memory file using `fs.writeFile`
6. Server responds `200 { "ok": true }`
7. The existing `chokidar` watcher detects the file change and broadcasts SSE
8. Client reloads the page showing the updated rendered content

### Integration Points

#### `src/server.ts`
- Add body parsing helper for JSON POST/PUT requests
- Add 4 new route handlers for the API endpoints listed above
- Add filename/path validation utility

#### `src/html.ts`
- Add "Edit" button to `renderPlanPage()` and `renderMemoryPage()`
- Add EasyMDE dark mode CSS overrides to `DARK_STYLE`
- Add editor toggle script (lazy-load EasyMDE from CDN, toggle read/edit modes, save handler)
- The edit script should be a new const like `EDITOR_SCRIPT` added to detail pages only

#### `src/plans.ts` / `src/memory.ts`
- Add `writePlan(plansDir, filename, content)` function
- Add `writeMemory(projectsDir, project, filename, content)` function
- Both should include path validation to prevent directory traversal

### EasyMDE Dark Mode CSS

Add to `DARK_STYLE` in `html.ts`, following the existing `html[data-theme="dark"]` pattern:

```css
html[data-theme="dark"] .EasyMDEContainer .CodeMirror {
  background: #0d1117;
  color: #f0f6fc;
  border-color: #3d444d;
}
html[data-theme="dark"] .editor-toolbar {
  border-color: #3d444d;
}
html[data-theme="dark"] .editor-toolbar button {
  color: #9198a1 !important;
}
html[data-theme="dark"] .editor-toolbar button:hover,
html[data-theme="dark"] .editor-toolbar button.active {
  background: #21262d;
  color: #f0f6fc !important;
}
html[data-theme="dark"] .editor-preview {
  background: #0d1117;
  color: #f0f6fc;
}
html[data-theme="dark"] .editor-statusbar {
  color: #9198a1;
}
```

### CDN Loading Strategy

Lazy-load EasyMDE only when the user clicks "Edit" to avoid impacting page load:

```javascript
function loadEasyMDE() {
  return new Promise((resolve) => {
    if (window.EasyMDE) return resolve(window.EasyMDE);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js';
    script.onload = () => resolve(window.EasyMDE);
    document.head.appendChild(script);
  });
}
```

## Test Strategy

### Unit Tests (vitest)

- **Path validation**: Test that filenames with `..`, `/`, or non-`.md` extensions are rejected
- **Write functions**: Test `writePlan` and `writeMemory` write correct content to correct paths
- **API endpoints**: Test `GET /api/plan/:filename` returns raw markdown JSON
- **API endpoints**: Test `PUT /api/plan/:filename` writes file and returns success
- **API endpoints**: Test PUT with invalid filename returns 400
- **API endpoints**: Test PUT with missing/invalid body returns 400
- **HTML output**: Test that `renderPlanPage` and `renderMemoryPage` include the edit button

### Manual Testing

- Toggle edit mode on plan and memory detail pages
- Verify EasyMDE toolbar, preview, and keyboard shortcuts work
- Verify dark mode styling of the editor
- Save edits and confirm the file is updated on disk
- Verify SSE reload triggers after save
- Test with large markdown files
- Test cancel discards unsaved changes

## Implementation Order

1. Add `writePlan`/`writeMemory` functions with path validation
2. Add JSON body parser utility in server
3. Add GET/PUT API routes for plans and memories
4. Add unit tests for new API endpoints
5. Add edit button + editor toggle script to detail page HTML
6. Add EasyMDE dark mode CSS
7. Manual testing of full edit flow
