import type {PlanEntry} from './plans.js';

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PLAN_STYLE = `
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
h1 { border-bottom: 2px solid #e1e4e8; padding-bottom: 0.3em; }
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
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
.back { display: inline-block; margin-bottom: 1em; font-size: 0.9em; }
`;

const INDEX_STYLE = `
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
h1 { border-bottom: 2px solid #e1e4e8; padding-bottom: 0.3em; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
.plan-list { list-style: none; padding: 0; }
.plan-item { padding: 12px 16px; border: 1px solid #e1e4e8; border-radius: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
.plan-item:hover { background: #f6f8fa; }
.plan-title { font-size: 1.1em; font-weight: 500; }
.plan-date { color: #656d76; font-size: 0.85em; white-space: nowrap; margin-left: 16px; }
.plan-count { color: #656d76; font-size: 0.9em; margin-bottom: 1em; }
.new-marker { background: #dafbe1; color: #1a7f37; font-size: 0.75em; padding: 2px 8px; border-radius: 10px; margin-left: 8px; font-weight: 600; }
`;

const SSE_SCRIPT = `
<script>
const es = new EventSource('/api/events');
es.addEventListener('plans-updated', () => window.location.reload());
</script>
`;

export function renderIndexPage(plans: PlanEntry[]): string {
	const now = Date.now();
	const count = plans.length;

	let planList: string;
	if (count === 0) {
		planList = '<p>No plans found.</p>';
	} else {
		const items = plans.map((plan) => {
			const dateStr = plan.mtime.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'UTC',
			});
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
<style>${PLAN_STYLE}</style>
${SSE_SCRIPT}
</head>
<body>
<a class="back" href="/">&larr; All Plans</a>
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
<style>${PLAN_STYLE}</style>
</head>
<body>
<h1>404 — Not Found</h1>
<p>The requested plan was not found.</p>
<a href="/">&larr; Back to All Plans</a>
</body>
</html>`;
}
