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

const BASE_STYLE = `
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
h1 { border-bottom: 2px solid #e1e4e8; padding-bottom: 0.3em; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
`;

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
<style>${LANDING_STYLE}</style>
${SSE_SCRIPT}
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
<style>${INDEX_STYLE}</style>
${SSE_SCRIPT}
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
<style>${DETAIL_STYLE}</style>
${SSE_SCRIPT}
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
<style>${INDEX_STYLE}</style>
${SSE_SCRIPT}
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
<style>${DETAIL_STYLE}</style>
${SSE_SCRIPT}
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
<style>${DETAIL_STYLE}</style>
</head>
<body>
<h1>404 — Not Found</h1>
<p>The requested page was not found.</p>
<a href="/">&larr; Home</a>
</body>
</html>`;
}
