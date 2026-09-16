const severityRank={critical:4,high:3,medium:2,low:1};

function clean(value,max=1200){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)}
function code(language,value){return {language,value:String(value||'').trim()}}

const RULES=[
  {
    match:i=>/content-security-policy|missing csp/i.test(`${i.id} ${i.title}`),
    cause:'The server response does not include a Content-Security-Policy header, so the browser has no application-defined allowlist for scripts, styles, frames and other resources.',
    impact:'A missing CSP does not prove the site is vulnerable, but it removes an important browser-side mitigation for cross-site scripting and unwanted resource execution.',
    fixes:['Start with a report-only policy so you can observe violations without breaking the site.','Inventory the first-party and third-party origins actually required by the application.','Move to an enforced policy after legitimate resources are covered, and avoid broad unsafe directives where possible.'],
    snippets:[code('http',`Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'`) ],
    verify:['Run WebDoctor again and confirm the missing-CSP finding disappears.','Open the browser console and check for CSP violations before switching from report-only to enforcement.'],
    confidence:'high'
  },
  {
    match:i=>/x-content-type-options/i.test(`${i.id} ${i.title}`),
    cause:'The response is missing the X-Content-Type-Options header.',
    impact:'Without nosniff, browsers have more freedom to infer resource MIME types. Explicit MIME handling is safer and easier to reason about.',
    fixes:['Add the header globally at the application, reverse-proxy or hosting layer.'],
    snippets:[code('http','X-Content-Type-Options: nosniff')],
    verify:['Rescan the page and confirm the header is present on HTML and other relevant responses.'],confidence:'high'
  },
  {
    match:i=>/referrer-policy/i.test(`${i.id} ${i.title}`),
    cause:'The server does not explicitly define a Referrer-Policy.',
    impact:'The browser will fall back to its default behavior, which may share more referrer information with other origins than the application intends.',
    fixes:['Choose a policy that fits the product. strict-origin-when-cross-origin is a sensible general default.','Set the header globally so all routes behave consistently.'],
    snippets:[code('http','Referrer-Policy: strict-origin-when-cross-origin')],
    verify:['Rescan and confirm the Referrer-Policy finding is gone.'],confidence:'high'
  },
  {
    match:i=>/strict-transport-security|missing hsts/i.test(`${i.id} ${i.title}`),
    cause:'HTTPS is available but the response does not instruct browsers to remember that the site should only be accessed over HTTPS.',
    impact:'HSTS reduces the chance of accidental HTTP downgrade after a user has visited the site over HTTPS.',
    fixes:['Only enable HSTS after HTTPS is working reliably for the whole hostname.','Start without includeSubDomains unless every subdomain is HTTPS-ready.'],
    snippets:[code('http','Strict-Transport-Security: max-age=31536000')],
    verify:['Rescan the HTTPS URL and confirm the header is present.'],confidence:'high'
  },
  {
    match:i=>/missing h1|h1-none/i.test(`${i.id} ${i.title}`),
    cause:'The rendered/document HTML does not contain a primary H1 heading for this page.',
    impact:'A clear primary heading improves document structure for screen-reader users and makes the page purpose easier for search engines and users to understand.',
    fixes:['Add one descriptive H1 that represents the page’s main purpose.','Keep visual styling separate from semantic heading level.'],
    snippets:[code('html','<h1>Turn your dreams into reality</h1>')],
    verify:['Rescan and confirm WebDoctor detects one H1.','Check that heading order remains logical on mobile and desktop.'],confidence:'high'
  },
  {
    match:i=>/missing page title|missing-title/i.test(`${i.id} ${i.title}`),
    cause:'The document has no usable <title> element.',impact:'The browser tab, bookmarks and search results may have weak or missing page identification.',
    fixes:['Add a short unique title for the route.','For SPAs, update document.title when routes change.'],snippets:[code('html','<title>Campaigns | FundRise</title>')],verify:['Reload the route directly and confirm the browser tab shows the expected title.','Run WebDoctor again.'],confidence:'high'
  },
  {
    match:i=>/meta description|missing-description/i.test(`${i.id} ${i.title}`),
    cause:'No meta description was detected in the HTML.',impact:'Search engines may generate their own snippet, which can reduce control over how the page is presented in search results.',
    fixes:['Add a concise route-specific description.'],snippets:[code('html','<meta name="description" content="Discover and support crowdfunding campaigns on FundRise.">')],verify:['View page source and confirm the tag appears inside <head>.'],confidence:'high'
  },
  {
    match:i=>/accessibility violations|axe/i.test(`${i.id} ${i.title}`),
    cause:'axe-core found one or more WCAG-related failures in the rendered browser DOM. The exact root cause depends on the reported rule and element evidence.',
    impact:'The affected UI may be difficult or impossible to use with assistive technology, keyboard navigation or low-vision settings.',
    fixes:['Open the finding evidence and identify the axe rule and affected element.','Fix the semantic/contrast/name issue at the component level rather than suppressing the rule.','Retest both desktop and mobile renderings.'],
    snippets:[code('html',`<!-- Example for an unnamed progressbar -->\n<div role="progressbar" aria-label="Campaign funding progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="65"></div>`) ],
    verify:['Run Browser QA again and confirm the axe rule no longer appears.','Keyboard-test the affected control and inspect its accessible name in DevTools.'],confidence:'medium'
  },
  {
    match:i=>/javascript console errors|console/i.test(`${i.id} ${i.title}`),
    cause:'The browser emitted a JavaScript console error while rendering or interacting with the page. Common causes include missing assets, rejected API calls, null/undefined state and failed dynamic imports.',
    impact:'Console errors can correspond to broken functionality even when the page still appears to render.',
    fixes:['Open the finding details and reproduce the exact console message.','Use the Network panel to identify the request/resource associated with the error.','Add explicit loading/error handling for expected failures; fix incorrect paths or runtime assumptions for unexpected ones.'],
    snippets:[code('javascript',`try {\n  const response = await fetch('/api/example');\n  if (!response.ok) throw new Error(\`Request failed: \${response.status}\`);\n} catch (error) {\n  console.error(error);\n  // Render a controlled error state instead of allowing the UI to crash.\n}`)],
    verify:['Reload the tested route with DevTools open and confirm the error is gone.','Rerun Browser QA and compare the before/after regression scan.'],confidence:'medium'
  },
  {
    match:i=>/first-party http errors|http-error|failed browser requests|first-party request/i.test(`${i.id} ${i.title}`),
    cause:'A request to the same application origin returned an unsuccessful HTTP response or failed to complete.',
    impact:'First-party request failures often map directly to missing content, broken API calls or route/configuration problems.',
    fixes:['Inspect the exact failing URL and status code in the finding evidence.','If it is a route, verify the deployment/router rewrites support direct navigation.','If it is an API request, inspect server logs and ensure the frontend handles non-2xx responses.'],
    snippets:[code('javascript',`const response = await fetch(url);\nif (!response.ok) {\n  // Handle 4xx/5xx explicitly\n  throw new Error(\`HTTP \${response.status}\`);\n}`)],
    verify:['Request the failing URL directly and confirm it returns the intended status.','Rerun Browser QA and confirm the request no longer appears as a first-party failure.'],confidence:'high'
  },
  {
    match:i=>/broken.*link|broken-link/i.test(`${i.id} ${i.title}`),
    cause:'A discovered link points to a destination that did not return a successful response during the audit.',impact:'Users can reach a dead end, and crawlers may waste time on invalid destinations.',
    fixes:['Correct the href if the destination moved.','Restore the intended route if it should exist.','Remove the link if the destination is no longer relevant.'],snippets:[],verify:['Open the destination directly.','Rescan and confirm the broken-link finding disappears.'],confidence:'high'
  },
  {
    match:i=>/slow server response|slow browser page load|slow-response|browser-slow/i.test(`${i.id} ${i.title}`),
    cause:'The measured response or render milestone exceeded WebDoctor’s current performance threshold.',impact:'Slow responses can increase bounce rate and make interactions feel unreliable, especially on mobile networks.',
    fixes:['Measure the slow route several times to separate one-off network variance from repeatable slowness.','Profile server/database work and cache stable responses where appropriate.','Reduce render-blocking scripts and expensive client-side work for browser-load findings.'],snippets:[],verify:['Run at least three scans and compare response distributions, not just one sample.','Use Capacity Lab to see whether latency degrades further under controlled load.'],confidence:'medium'
  },
  {
    match:i=>/maximum length|maxlength/i.test(`${i.id} ${i.title}`),
    cause:'The input does not advertise an explicit client-side maximum length.',impact:'Very large values can produce poor UX and may create unnecessary server/database work if the server also lacks limits.',
    fixes:['Choose a product-appropriate limit and enforce it on both client and server.','Return a clear validation message when the limit is exceeded.'],snippets:[code('html','<input name="title" maxlength="120" required>')],verify:['Run Validation QA again and confirm the long-input test is constrained.','Confirm the server independently rejects oversized payloads.'],confidence:'high'
  }
];

function generic(issue){return {
  cause:`WebDoctor observed: ${clean(issue.detail||issue.title)} The exact implementation-level root cause cannot be proven from external evidence alone.`,
  impact:'The finding may affect reliability, usability, security posture or discoverability depending on where it occurs.',
  fixes:[clean(issue.fix||issue.suggestion||'Reproduce the finding on the affected URL, inspect the related browser/network evidence, then correct the underlying implementation rather than masking the symptom.')],
  snippets:[],verify:['Rerun the same WebDoctor check after the change.','Use Regression to confirm the finding moved from Unchanged/New to Fixed without introducing new issues.'],confidence:'low'
}}

function priority(issue){const s=severityRank[String(issue.severity||'low').toLowerCase()]||1;return s>=4?'P0 — immediate':s===3?'P1 — high':s===2?'P2 — medium':'P3 — low'}

export function investigateIssue(issue={}){
 const normalized={id:clean(issue.id,120),title:clean(issue.title,240),severity:clean(issue.severity,40).toLowerCase()||'low',detail:clean(issue.detail,1600),fix:clean(issue.fix||issue.suggestion,1200),url:clean(issue.url,1000)};
 const rule=RULES.find(r=>r.match(normalized)); const body=rule?{cause:rule.cause,impact:rule.impact,fixes:rule.fixes,snippets:rule.snippets,verify:rule.verify,confidence:rule.confidence}:generic(normalized);
 return {issue:normalized,priority:priority(normalized),...body,disclaimer:'Diagnosis is based on observable WebDoctor evidence. It identifies likely causes and remediation paths; it cannot prove private server-side implementation details without source/log access.'};
}

export function investigateReport(issues=[],limit=5){
 const sorted=[...issues].sort((a,b)=>(severityRank[b.severity]||0)-(severityRank[a.severity]||0));
 return sorted.slice(0,Math.max(1,Math.min(Number(limit)||5,10))).map(investigateIssue);
}
