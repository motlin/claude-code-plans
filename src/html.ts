import type {PlanEntry} from './plans.js';
import type {ProjectGroup} from './memory.js';

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(date: Date): string {
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	});
}

const D = 'html[data-theme="dark"]';
const DARK_STYLE = `
${D} body { background: #0d1117; color: #e6edf3; }
${D} h1, ${D} h2 { border-color: #30363d; }
${D} a { color: #58a6ff; }
${D} code { background: #161b22; color: #e6edf3; }
${D} pre { background: #161b22; border-color: #30363d; }
${D} pre code { background: none; color: inherit; }
${D} th, ${D} td { border-color: #30363d; }
${D} th { background: #161b22; }
${D} strong { color: #e6edf3; }
${D} ::selection { background: #264f78; color: #e6edf3; }
${D} .plan-item, ${D} .memory-item { border-color: #30363d; }
${D} .plan-item:hover, ${D} .memory-item:hover { background: #161b22; }
${D} .plan-date, ${D} .memory-date, ${D} .plan-count, ${D} .memory-count, ${D} .project-label { color: #8b949e; }
${D} .card { border-color: #30363d; }
${D} .card:hover { background: #161b22; }
${D} .card p { color: #8b949e; }
${D} .new-marker { background: #1a3a2a; color: #3fb950; }
${D} .shiki, ${D} .shiki span { color: var(--shiki-dark) !important; background-color: var(--shiki-dark-bg) !important; font-style: var(--shiki-dark-font-style) !important; font-weight: var(--shiki-dark-font-weight) !important; }
${D} .theme-toggle { border-color: #30363d; }
${D} .theme-toggle button { color: #8b949e; }
${D} .theme-toggle button:hover { background: #161b22; color: #e6edf3; }
${D} .theme-toggle button.active { background: #161b22; color: #e6edf3; }
`;

const THEME_TOGGLE_STYLE = `
.theme-toggle { position: fixed; top: 12px; right: 20px; display: inline-flex; border: 1px solid #e1e4e8; border-radius: 6px; overflow: hidden; font-size: 0.8em; z-index: 100; }
.theme-toggle button { background: none; border: none; padding: 4px 10px; cursor: pointer; color: #656d76; font-family: inherit; }
.theme-toggle button:hover { background: #f6f8fa; color: #1a1a1a; }
.theme-toggle button.active { background: #f6f8fa; color: #1a1a1a; font-weight: 600; }
`;

const BASE_STYLE = `
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
h1 { border-bottom: 2px solid #e1e4e8; padding-bottom: 0.3em; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
${THEME_TOGGLE_STYLE}
${DARK_STYLE}`;

const DETAIL_STYLE = `${BASE_STYLE}
h2 { border-bottom: 1px solid #e1e4e8; padding-bottom: 0.3em; margin-top: 2em; }
h3 { margin-top: 1.5em; }
code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
pre { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 16px; overflow-x: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #d0d7de; padding: 8px 12px; text-align: left; }
th { background: #f6f8fa; font-weight: 600; }
ul, ol { padding-left: 2em; }
li { margin: 0.3em 0; }
.back { display: inline-block; margin-bottom: 1em; font-size: 0.9em; }
.project-label { color: #656d76; font-size: 0.85em; margin-left: 8px; }
`;

const INDEX_STYLE = `${BASE_STYLE}
h2 { margin-top: 2em; border-bottom: 1px solid #e1e4e8; padding-bottom: 0.3em; }
.plan-list, .memory-list { list-style: none; padding: 0; }
.plan-item, .memory-item { padding: 12px 16px; border: 1px solid #e1e4e8; border-radius: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
.plan-item:hover, .memory-item:hover { background: #f6f8fa; }
.plan-title, .memory-title { font-size: 1.1em; font-weight: 500; }
.plan-date, .memory-date { color: #656d76; font-size: 0.85em; white-space: nowrap; margin-left: 16px; }
.plan-count, .memory-count { color: #656d76; font-size: 0.9em; margin-bottom: 1em; }
.new-marker { background: #dafbe1; color: #1a7f37; font-size: 0.75em; padding: 2px 8px; border-radius: 10px; margin-left: 8px; font-weight: 600; }
.home { display: inline-block; margin-bottom: 1em; font-size: 0.9em; }
`;

const LANDING_STYLE = `${BASE_STYLE}
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px; }
.card { padding: 24px; border: 1px solid #e1e4e8; border-radius: 8px; }
.card:hover { background: #f6f8fa; }
.card h2 { margin: 0 0 8px 0; border: none; padding: 0; }
.card p { margin: 0; color: #656d76; }
`;

const FAVICON =
	"<link rel=\"icon\" type=\"image/svg+xml\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23C87B3A'/%3E%3Cpath d='M16 5L17.5 13.5L26 16L17.5 18.5L16 27L14.5 18.5L6 16L14.5 13.5Z' fill='white' opacity='0.95'/%3E%3C/svg%3E\">";

const THEME_INIT_SCRIPT = `
<script>
(function(){
  var s = localStorage.getItem('theme') || 'auto';
  var dark = s === 'dark' || (s === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
})();
</script>
`;

const THEME_TOGGLE_SCRIPT = `
<script>
(function(){
  var pref = localStorage.getItem('theme') || 'auto';
  function apply(mode) {
    pref = mode;
    localStorage.setItem('theme', mode);
    var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.querySelectorAll('.theme-toggle button').forEach(function(b) {
      b.classList.toggle('active', b.dataset.theme === mode);
    });
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
    if (pref === 'auto') apply('auto');
  });
  document.addEventListener('DOMContentLoaded', function() {
    var toggle = document.createElement('div');
    toggle.className = 'theme-toggle';
    toggle.innerHTML = '<button data-theme="light">Light</button><button data-theme="auto">Auto</button><button data-theme="dark">Dark</button>';
    document.body.appendChild(toggle);
    toggle.querySelectorAll('button').forEach(function(b) {
      b.addEventListener('click', function() { apply(b.dataset.theme); });
    });
    apply(pref);
  });
})();
</script>
`;

const SSE_SCRIPT = `
<script>
const es = new EventSource('/api/events');
es.addEventListener('content-updated', () => window.location.reload());
</script>
`;

export function renderLandingPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Code Viewer</title>
${FAVICON}
<style>${LANDING_STYLE}</style>
${THEME_INIT_SCRIPT}
${SSE_SCRIPT}
${THEME_TOGGLE_SCRIPT}
</head>
<body>
<h1>Claude Code Viewer</h1>
<div class="cards">
<a class="card" href="/plans"><h2>Plans</h2><p>Browse Claude Code plan files</p></a>
<a class="card" href="/memories"><h2>Memories</h2><p>Browse Claude Code memory files by project</p></a>
</div>
</body>
</html>`;
}

export function renderIndexPage(plans: PlanEntry[]): string {
	const now = Date.now();
	const count = plans.length;

	let planList: string;
	if (count === 0) {
		planList = '<p>No plans found.</p>';
	} else {
		const items = plans.map((plan) => {
			const dateStr = formatDate(plan.mtime);
			const ageHours = (now - plan.mtime.getTime()) / 3600000;
			const newTag = ageHours < 1 ? '<span class="new-marker">NEW</span>' : '';
			const safeTitle = escapeHtml(plan.title);
			const safeFilename = escapeHtml(plan.filename);
			return `<li class="plan-item"><span class="plan-title"><a href="/plan/${safeFilename}">${safeTitle}</a>${newTag}</span><span class="plan-date">${dateStr}</span></li>`;
		});
		planList = items.join('\n');
	}

	const countLabel = count === 1 ? '1 plan' : `${count} plans`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Plans</title>
${FAVICON}
<style>${INDEX_STYLE}</style>
${THEME_INIT_SCRIPT}
${SSE_SCRIPT}
${THEME_TOGGLE_SCRIPT}
</head>
<body>
<a class="home" href="/">&larr; Home</a>
<h1>Claude Plans</h1>
<p class="plan-count">${countLabel}</p>
<ul class="plan-list">
${planList}
</ul>
</body>
</html>`;
}

export function renderPlanPage(title: string, bodyHtml: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${FAVICON}
<style>${DETAIL_STYLE}</style>
${THEME_INIT_SCRIPT}
${SSE_SCRIPT}
${THEME_TOGGLE_SCRIPT}
</head>
<body>
<a class="back" href="/plans">&larr; All Plans</a>
${bodyHtml}
</body>
</html>`;
}

export function renderMemoryIndexPage(groups: ProjectGroup[]): string {
	let content: string;
	if (groups.length === 0) {
		content = '<p>No memory files found.</p>';
	} else {
		content = groups
			.map((group) => {
				const safeProjectName = escapeHtml(group.projectName);
				const items = group.memories
					.map((mem) => {
						const dateStr = formatDate(mem.mtime);
						const safeTitle = escapeHtml(mem.title);
						const safeProject = escapeHtml(mem.project);
						const safeFilename = escapeHtml(mem.filename);
						return `<li class="memory-item"><span class="memory-title"><a href="/memory/${safeProject}/${safeFilename}">${safeTitle}</a></span><span class="memory-date">${dateStr}</span></li>`;
					})
					.join('\n');
				return `<h2>${safeProjectName}</h2>\n<ul class="memory-list">\n${items}\n</ul>`;
			})
			.join('\n');
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Memories</title>
${FAVICON}
<style>${INDEX_STYLE}</style>
${THEME_INIT_SCRIPT}
${SSE_SCRIPT}
${THEME_TOGGLE_SCRIPT}
</head>
<body>
<a class="home" href="/">&larr; Home</a>
<h1>Claude Memories</h1>
${content}
</body>
</html>`;
}

export function renderMemoryPage(projectName: string, title: string, bodyHtml: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${FAVICON}
<style>${DETAIL_STYLE}</style>
${THEME_INIT_SCRIPT}
${SSE_SCRIPT}
${THEME_TOGGLE_SCRIPT}
</head>
<body>
<a class="back" href="/memories">&larr; All Memories</a>
<span class="project-label">${escapeHtml(projectName)}</span>
${bodyHtml}
</body>
</html>`;
}

export function render404Page(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 — Not Found</title>
${FAVICON}
<style>${DETAIL_STYLE}</style>
${THEME_INIT_SCRIPT}
${THEME_TOGGLE_SCRIPT}
</head>
<body>
<h1>404 — Not Found</h1>
<p>The requested page was not found.</p>
<a href="/">&larr; Home</a>
</body>
</html>`;
}
