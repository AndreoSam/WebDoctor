import dns from 'node:dns/promises';

const DEFAULT_LIMIT = 25;
const REQUEST_TIMEOUT_MS = 12000;

function normalizeUrl(input) {
  let value = String(input || '').trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  url.hash = '';
  return url;
}

function sameOrigin(a, b) {
  return new URL(a).origin === new URL(b).origin;
}

function absolutize(base, href) {
  try {
    if (!href || /^(mailto:|tel:|javascript:|data:|#)/i.test(href)) return null;
    const u = new URL(href, base);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function unique(arr) {
  return [...new Set(arr)];
}

function extractAll(html, regex, group = 1) {
  const values = [];
  let match;
  while ((match = regex.exec(html)) !== null) values.push(match[group]);
  return values;
}

function decodeEntities(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getAttr(tag, attr) {
  const m = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? decodeEntities(m[1].trim()) : '';
}

function pageFacts(html, url) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
  const descriptionTag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0] ||
    html.match(/<meta[^>]+content=["'][^"']*["'][^>]+name=["']description["'][^>]*>/i)?.[0] || '';
  const description = getAttr(descriptionTag, 'content');
  const canonicalTag = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i)?.[0] || '';
  const canonical = getAttr(canonicalTag, 'href');
  const htmlTag = html.match(/<html[^>]*>/i)?.[0] || '';
  const lang = getAttr(htmlTag, 'lang');

  const linkTags = extractAll(html, /<a\b[^>]*>/gi, 0);
  const links = unique(linkTags.map(tag => absolutize(url, getAttr(tag, 'href'))).filter(Boolean));

  const imgTags = extractAll(html, /<img\b[^>]*>/gi, 0);
  const images = imgTags.map(tag => ({ src: absolutize(url, getAttr(tag, 'src')), alt: getAttr(tag, 'alt') }));

  const formTags = extractAll(html, /<form\b[^>]*>/gi, 0);
  const forms = formTags.map(tag => ({
    action: absolutize(url, getAttr(tag, 'action') || url),
    method: (getAttr(tag, 'method') || 'GET').toUpperCase()
  }));

  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const passwordInputs = (html.match(/<input[^>]+type=["']password["'][^>]*>/gi) || []).length;
  const emailInputs = (html.match(/<input[^>]+type=["']email["'][^>]*>/gi) || []).length;

  return { title, description, canonical, lang, links, images, forms, h1Count, viewport, passwordInputs, emailInputs };
}

async function fetchWithTiming(url, method = 'GET') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'WebDoctor-MVP/0.1 (+website-health-audit)' }
    });
    const durationMs = Math.round(performance.now() - started);
    return { response, durationMs };
  } finally {
    clearTimeout(timer);
  }
}

function issue(id, title, severity, detail, fix, url) {
  return { id, title, severity, detail, fix, url };
}

function scoreFromIssues(issues) {
  const weights = { critical: 20, high: 10, medium: 4, low: 1 };
  const penalty = issues.reduce((sum, item) => sum + (weights[item.severity] || 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function categoryScores(issues) {
  const groups = {
    functionality: ['broken-link', 'http-error', 'redirect'],
    performance: ['slow-response', 'large-page'],
    seo: ['missing-title', 'missing-description', 'h1', 'canonical'],
    accessibility: ['missing-alt', 'missing-lang', 'viewport'],
    security: ['https', 'security-header'],
    forms: ['form-action', 'password-form']
  };
  const out = {};
  for (const [category, ids] of Object.entries(groups)) {
    const related = issues.filter(x => ids.some(id => x.id.startsWith(id)));
    out[category] = scoreFromIssues(related);
  }
  return out;
}

async function inspectPage(url) {
  const { response, durationMs } = await fetchWithTiming(url);
  const contentType = response.headers.get('content-type') || '';
  const text = contentType.includes('text/html') ? await response.text() : '';
  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    ok: response.ok,
    durationMs,
    headers: Object.fromEntries(response.headers.entries()),
    html: text,
    bytes: Buffer.byteLength(text)
  };
}

async function checkLink(url) {
  try {
    let result = await fetchWithTiming(url, 'HEAD');
    if ([405, 501].includes(result.response.status)) result = await fetchWithTiming(url, 'GET');
    return { url, status: result.response.status, ok: result.response.ok, durationMs: result.durationMs, finalUrl: result.response.url };
  } catch (error) {
    return { url, status: 0, ok: false, durationMs: null, error: error.name === 'AbortError' ? 'Timed out' : error.message };
  }
}

export async function scanWebsite(input, options = {}) {
  const root = normalizeUrl(input);
  const limit = Math.min(Number(options.limit) || DEFAULT_LIMIT, 50);
  const rootOrigin = root.origin;
  const queue = [root.toString()];
  const visited = new Set();
  const pages = [];
  const issues = [];
  const discoveredLinks = new Set();

  while (queue.length && visited.size < limit) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const page = await inspectPage(url);
      const facts = pageFacts(page.html, page.finalUrl || url);
      pages.push({
        url,
        finalUrl: page.finalUrl,
        status: page.status,
        durationMs: page.durationMs,
        bytes: page.bytes,
        title: facts.title,
        description: facts.description,
        h1Count: facts.h1Count,
        linkCount: facts.links.length,
        imageCount: facts.images.length,
        formCount: facts.forms.length
      });

      if (!page.ok) issues.push(issue('http-error', `HTTP ${page.status}`, 'high', `${url} returned HTTP ${page.status}.`, 'Fix the route/server error or remove references to this page.', url));
      if (page.durationMs > 2500) issues.push(issue('slow-response', 'Slow server response', 'medium', `Initial HTML response took ${page.durationMs} ms.`, 'Profile server work, caching, database calls and third-party dependencies.', url));
      if (page.bytes > 1_000_000) issues.push(issue('large-page', 'Large HTML document', 'low', `HTML is ${(page.bytes / 1024 / 1024).toFixed(2)} MB.`, 'Reduce server-rendered markup and large inline payloads.', url));

      if (!facts.title) issues.push(issue('missing-title', 'Missing page title', 'medium', 'No <title> was found.', 'Add a concise unique title for this page.', url));
      if (!facts.description) issues.push(issue('missing-description', 'Missing meta description', 'low', 'No meta description was found.', 'Add a useful meta description.', url));
      if (facts.h1Count === 0) issues.push(issue('h1-none', 'Missing H1', 'low', 'No H1 heading was detected.', 'Add one primary page heading.', url));
      if (facts.h1Count > 1) issues.push(issue('h1-multiple', 'Multiple H1 headings', 'low', `${facts.h1Count} H1 headings were detected.`, 'Review heading hierarchy and keep a clear primary heading.', url));
      if (!facts.lang) issues.push(issue('missing-lang', 'HTML language not declared', 'low', '<html> has no lang attribute.', 'Add an appropriate lang attribute such as lang="en".', url));
      if (!facts.viewport) issues.push(issue('viewport', 'Viewport meta tag missing', 'medium', 'No mobile viewport declaration was detected.', 'Add a responsive viewport meta tag.', url));

      const missingAlt = facts.images.filter(img => img.src && !img.alt).length;
      if (missingAlt) issues.push(issue('missing-alt', 'Images missing alt text', 'low', `${missingAlt} image(s) have no alt text.`, 'Add meaningful alt text, or alt="" for decorative images.', url));

      if (facts.passwordInputs && root.protocol !== 'https:') issues.push(issue('password-form', 'Password field served without HTTPS', 'critical', 'A password input was found on an HTTP page.', 'Serve authentication pages over HTTPS only.', url));

      for (const form of facts.forms) {
        if (form.action && new URL(form.action).origin !== rootOrigin) {
          issues.push(issue('form-action', 'Form posts to another origin', 'medium', `A ${form.method} form submits to ${form.action}.`, 'Verify that the external form destination is intentional and trusted.', url));
        }
      }

      for (const link of facts.links) {
        discoveredLinks.add(link);
        if (sameOrigin(root, link) && !visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    } catch (error) {
      pages.push({ url, status: 0, durationMs: null, error: error.name === 'AbortError' ? 'Timed out' : error.message });
      issues.push(issue('http-error-fetch', 'Page could not be loaded', 'high', `${url}: ${error.message}`, 'Check DNS, TLS, server availability, redirects and firewall rules.', url));
    }
  }

  // Link checking is intentionally capped for an MVP so a scan cannot explode in traffic.
  const linksToCheck = [...discoveredLinks].slice(0, 80);
  const linkResults = [];
  const concurrency = 8;
  for (let i = 0; i < linksToCheck.length; i += concurrency) {
    const chunk = linksToCheck.slice(i, i + concurrency);
    linkResults.push(...await Promise.all(chunk.map(checkLink)));
  }
  for (const result of linkResults) {
    if (!result.ok) issues.push(issue('broken-link', 'Broken or unreachable link', result.status >= 500 || result.status === 0 ? 'high' : 'medium', `${result.url} returned ${result.status || result.error}.`, 'Update/remove the link or restore the destination.', result.url));
  }

  // Root-level HTTPS and security configuration checks.
  if (root.protocol !== 'https:') issues.push(issue('https', 'Website is not using HTTPS', 'critical', 'The supplied URL uses HTTP.', 'Redirect all traffic to HTTPS and enable a valid TLS certificate.', root.toString()));
  const rootPage = pages[0];
  if (rootPage?.status) {
    try {
      const { response } = await fetchWithTiming(root.toString(), 'GET');
      const headers = response.headers;
      const recommended = [
        ['strict-transport-security', 'HSTS'],
        ['content-security-policy', 'Content-Security-Policy'],
        ['x-content-type-options', 'X-Content-Type-Options'],
        ['referrer-policy', 'Referrer-Policy']
      ];
      for (const [header, label] of recommended) {
        if (!headers.get(header)) issues.push(issue(`security-header-${header}`, `Missing ${label}`, 'low', `${label} response header was not detected.`, `Review and configure ${label} appropriately for this application.`, root.toString()));
      }
    } catch {}
  }

  let dnsInfo = {};
  try {
    const hostname = root.hostname;
    const [a, mx] = await Promise.allSettled([dns.resolve4(hostname), dns.resolveMx(hostname)]);
    dnsInfo = {
      ipv4: a.status === 'fulfilled' ? a.value : [],
      mx: mx.status === 'fulfilled' ? mx.value : []
    };
  } catch {}

  const dedupedIssues = [...new Map(issues.map((x, index) => [`${x.id}|${x.url}|${x.detail}`, { ...x, key: index + 1 }])).values()];
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  dedupedIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    scannedAt: new Date().toISOString(),
    target: root.toString(),
    limits: { maxPages: limit, checkedLinks: linksToCheck.length },
    summary: {
      score: scoreFromIssues(dedupedIssues),
      pagesScanned: pages.length,
      linksDiscovered: discoveredLinks.size,
      linksChecked: linksToCheck.length,
      issues: dedupedIssues.length,
      critical: dedupedIssues.filter(x => x.severity === 'critical').length,
      high: dedupedIssues.filter(x => x.severity === 'high').length,
      medium: dedupedIssues.filter(x => x.severity === 'medium').length,
      low: dedupedIssues.filter(x => x.severity === 'low').length
    },
    categories: categoryScores(dedupedIssues),
    dns: dnsInfo,
    pages,
    links: linkResults,
    issues: dedupedIssues
  };
}
