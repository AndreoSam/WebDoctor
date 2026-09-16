import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanWebsite } from './src/scanner.js';
import { browserAudit } from './src/browserScanner.js';
import { createVerification, getVerification, getProjectByOrigin, markVerified, adoptVerification, listProjects } from './src/verification.js';
import { runFormQa } from './src/formQa.js';
import { runActiveValidationQa, runSubmissionSimulation } from './src/activeQa.js';
import { runCapacityLab, runSteppedCapacityLab, runJourneyCapacityLab, getCapacityHistory } from './src/capacityLab.js';
import { saveScan, history as getScanHistory, regression as getRegression } from './src/projectStore.js';
import { investigateIssue, investigateReport } from './src/investigator.js';
import { getMonitor, setMonitor, recordMonitorRun, dueMonitors } from './src/monitoringStore.js';
import { addMonitoringEvents, listMonitoringEvents, unreadMonitoringEvents, markMonitoringEventsRead } from './src/monitoringEvents.js';
import { getNotificationSettings, setNotificationSettings, deliverWebhook, deliverMonitoringEvents } from './src/notificationStore.js';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 3000);

async function readJson(req){ let body=''; for await (const chunk of req){ body+=chunk; if(body.length>100_000) throw new Error('Request body too large'); } return JSON.parse(body||'{}'); }

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function isPrivateHostname(hostname) {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local') ||
    /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

async function runFullScan(normalized,{limit=15,browser=true,browserPages=3}={}){
  const report=await scanWebsite(normalized,{limit});
  if(browser){
    report.browser=await browserAudit(report.target,{maxPages:browserPages});
    if(report.browser?.available){
      report.issues.push(...report.browser.findings.map((x,i)=>({...x,key:`browser-${i+1}`})));
      report.summary.issues=report.issues.length;
      for(const sev of ['critical','high','medium','low']) report.summary[sev]=report.issues.filter(x=>x.severity===sev).length;
      report.categories.browser=report.browser.score;
      report.categories.accessibility=Math.min(report.categories.accessibility??100,report.browser.accessibilityScore??100);
      report.summary.score=Math.round((report.summary.score*0.75)+(report.browser.score*0.25));
    }
  }
  saveScan(report); return report;
}

async function runMonitor(origin){
  const before=getScanHistory(origin,1)[0]||null; const report=await runFullScan(origin,{limit:15,browser:true,browserPages:3});
  const issueKey=x=>`${x.title}|${x.url||''}`;
  const currentIssues=report.issues||[], oldIssues=before?.issues||[];
  const currentKeys=new Set(currentIssues.map(issueKey)), oldKeys=new Set(oldIssues.map(issueKey));
  const newIssues=[...currentKeys].filter(k=>!oldKeys.has(k)).length;
  const resolvedIssues=[...oldKeys].filter(k=>!currentKeys.has(k)).length;
  const currentHigh=new Set(currentIssues.filter(x=>['critical','high'].includes(x.severity)).map(issueKey));
  const oldHigh=new Set(oldIssues.filter(x=>['critical','high'].includes(x.severity)).map(issueKey));
  const newHighPriority=[...currentHigh].filter(k=>!oldHigh.has(k)).length;
  const resolvedHighPriority=[...oldHigh].filter(k=>!currentHigh.has(k)).length;
  const score=report.summary?.score??null; const previousScore=before?.summary?.score??null;
  const result={score,previousScore,healthDrop:previousScore==null?0:score-previousScore,newIssues,resolvedIssues,highPriority:currentHigh.size,newHighPriority,resolvedHighPriority,scanAt:report.scannedAt};
  const monitor=recordMonitorRun(origin,result); const events=addMonitoringEvents(origin,monitor,result); const deliveries=await deliverMonitoringEvents(origin,events); return {report,result,events,deliveries};
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/investigator') {
      const parsed=await readJson(req);
      if(parsed.mode==='report'){
        const issues=Array.isArray(parsed.issues)?parsed.issues.slice(0,50):[];
        return sendJson(res,200,{provider:'WebDoctor Local Investigator',cost:'free',analyses:investigateReport(issues,parsed.limit||5)});
      }
      if(!parsed.issue||typeof parsed.issue!=='object') return sendJson(res,400,{error:'A WebDoctor finding is required.'});
      return sendJson(res,200,{provider:'WebDoctor Local Investigator',cost:'free',analysis:investigateIssue(parsed.issue)});
    }
    if (req.method === 'POST' && req.url === '/api/notifications/status') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for notifications.'});
      return sendJson(res,200,{settings:getNotificationSettings(record.origin)});
    }
    if (req.method === 'POST' && req.url === '/api/notifications/configure') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for notifications.'});
      const settings=await setNotificationSettings(record.origin,parsed); return sendJson(res,200,{settings});
    }
    if (req.method === 'POST' && req.url === '/api/notifications/test') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for notifications.'});
      const result=await deliverWebhook(record.origin,{type:'test',severity:'info',state:'new',title:'WebDoctor test notification',message:'Your external notification webhook is connected.',createdAt:new Date().toISOString()},{test:true});
      if(result.skipped) return sendJson(res,400,{error:'Enable and save a webhook first.'});
      return sendJson(res,result.delivered?200:502,result);
    }
    if (req.method === 'POST' && req.url === '/api/monitoring/status') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for monitoring.'});
      return sendJson(res,200,{monitor:getMonitor(record.origin)});
    }
    if (req.method === 'POST' && req.url === '/api/monitoring/events') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for monitoring events.'});
      return sendJson(res,200,{events:listMonitoringEvents(record.origin,parsed.limit||50),unread:unreadMonitoringEvents(record.origin)});
    }
    if (req.method === 'POST' && req.url === '/api/monitoring/events/read') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for monitoring events.'});
      return sendJson(res,200,markMonitoringEventsRead(record.origin,parsed.ids));
    }
    if (req.method === 'POST' && req.url === '/api/monitoring/configure') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for monitoring.'});
      return sendJson(res,200,{monitor:setMonitor(record.origin,parsed)});
    }
    if (req.method === 'POST' && req.url === '/api/monitoring/run') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for monitoring.'});
      if(!getMonitor(record.origin)) setMonitor(record.origin,{enabled:true,cadence:'daily'});
      const data=await runMonitor(record.origin); return sendJson(res,200,data);
    }
    if (req.method === 'GET' && req.url === '/api/projects') {
      const projects=listProjects().map(p=>{const h=getScanHistory(p.origin,1);const latest=h[0]||null;return {...p,latest:latest?{createdAt:latest.createdAt,summary:latest.summary,categories:latest.categories}:null};});
      return sendJson(res,200,{projects});
    }

    if (req.method === 'POST' && req.url === '/api/project-history') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required.'});
      return sendJson(res,200,{history:getScanHistory(record.origin,20)});
    }
    if (req.method === 'POST' && req.url === '/api/regression') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required.'});
      return sendJson(res,200,getRegression(record.origin));
    }
    if (req.method === 'POST' && req.url === '/api/verification/start') {
      const parsed=await readJson(req); if(!parsed.url) return sendJson(res,400,{error:'Website URL is required.'});
      let normalized=String(parsed.url).trim(); if(!/^https?:\/\//i.test(normalized)) normalized=`https://${normalized}`;
      const target=new URL(normalized); if(!['http:','https:'].includes(target.protocol)||isPrivateHostname(target.hostname)) return sendJson(res,400,{error:'Only public HTTP/HTTPS websites can be verified.'});
      return sendJson(res,200,createVerification(target.origin));
    }


    if (req.method === 'POST' && req.url === '/api/verification/status') {
      const parsed=await readJson(req); if(!parsed.url) return sendJson(res,400,{error:'Website URL is required.'});
      let normalized=String(parsed.url).trim(); if(!/^https?:\/\//i.test(normalized)) normalized=`https://${normalized}`;
      const target=new URL(normalized);
      let record=getProjectByOrigin(target.origin);
      if(record) return sendJson(res,200,{ found:true, ...createVerification(record.origin) });

      // Recovery path: a new WebDoctor version/local install may not have the old
      // projects.json. If the site still carries a WebDoctor meta token, adopt it
      // automatically and keep ownership verified without asking for a new tag.
      try {
        const r=await fetch(target.origin,{redirect:'follow',signal:AbortSignal.timeout(10000)});
        const html=await r.text();
        const head=(html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)||[])[0]||'';
        const m=head.match(/<meta[^>]+name=["']webdoctor-verification["'][^>]+content=["'](webdoctor-[a-f0-9]{16,128})["']/i)
          || head.match(/<meta[^>]+content=["'](webdoctor-[a-f0-9]{16,128})["'][^>]+name=["']webdoctor-verification["']/i);
        if(m?.[1]) {
          const adopted=adoptVerification(target.origin,m[1],'Existing meta tag');
          return sendJson(res,200,{found:true,recovered:true,...adopted});
        }
      } catch {}
      return sendJson(res,200,{ found:false, verified:false });
    }

    if (req.method === 'POST' && req.url === '/api/verification/check') {
      const parsed=await readJson(req); const record=getVerification(parsed.id); if(!record) return sendJson(res,404,{error:'Verification session not found. Start verification again.'});
      // One-time verification means exactly that: once this local project is
      // verified, pressing Check again never rotates the token or requires the
      // owner to edit the website again.
      if(record.verified) return sendJson(res,200,{...createVerification(record.origin),verified:true,evidence:record.verificationMethod||'Saved verification',alreadyVerified:true});
      let verified=false, evidence='';
      try{ const r=await fetch(`${record.origin}/.well-known/webdoctor-verification.txt`,{redirect:'follow',signal:AbortSignal.timeout(10000)}); const text=await r.text(); if(r.ok&&text.includes(record.token)){verified=true;evidence='HTML verification file';} }catch{}
      if(!verified){ try{ const r=await fetch(record.origin,{redirect:'follow',signal:AbortSignal.timeout(10000)}); const html=await r.text(); const head=(html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)||[])[0]||''; const escaped=record.token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); if(new RegExp(`<meta[^>]+name=[\"']webdoctor-verification[\"'][^>]+content=[\"']${escaped}[\"']`,'i').test(head)||new RegExp(`<meta[^>]+content=[\"']${escaped}[\"'][^>]+name=[\"']webdoctor-verification[\"']`,'i').test(head)){verified=true;evidence='Meta tag';} }catch{} }
      if(!verified) return sendJson(res,200,{verified:false,error:'Verification token was not found yet.'}); const saved=markVerified(record.id,evidence); return sendJson(res,200,{...saved,verified:true,evidence,origin:record.origin});
    }

    if (req.method === 'POST' && req.url === '/api/journey-capacity-lab') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for Journey Load.'});
      if(parsed.authorized!==true) return sendJson(res,400,{error:'Explicit owner authorization is required for Journey Load.'});
      const result=await runJourneyCapacityLab(record.origin,{pageUrls:parsed.pageUrls,users:parsed.users,durationSeconds:parsed.durationSeconds});
      return sendJson(res,200,result);
    }

    if (req.method === 'POST' && req.url === '/api/capacity-lab') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for Capacity Lab.'});
      if(parsed.authorized!==true) return sendJson(res,400,{error:'Explicit owner authorization is required for Capacity Lab.'});
      const result=parsed.mode==='stepped' ? await runSteppedCapacityLab(record.origin,{pageUrl:parsed.pageUrl||record.origin}) : await runCapacityLab(record.origin,{pageUrl:parsed.pageUrl||record.origin,users:parsed.users,durationSeconds:parsed.durationSeconds});
      return sendJson(res,200,result);
    }

    if (req.method === 'POST' && req.url === '/api/submission-simulation') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required.'});
      if(parsed.authorized!==true) return sendJson(res,400,{error:'Explicit owner authorization is required for submission simulation.'});
      if(!parsed.pageUrl) return sendJson(res,400,{error:'A discovered page URL is required.'});
      const result=await runSubmissionSimulation(record.origin,parsed.pageUrl); return sendJson(res,200,result);
    }

    if (req.method === 'POST' && req.url === '/api/active-form-qa') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId);
      if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for Active Form QA.'});
      if(!parsed.pageUrl) return sendJson(res,400,{error:'A discovered page URL is required.'});
      const result=await runActiveValidationQa(record.origin,parsed.pageUrl); return sendJson(res,200,result);
    }

    if (req.method === 'POST' && req.url === '/api/form-qa') {
      const parsed=await readJson(req); const record=getVerification(parsed.verificationId); if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required for Form QA.'});
      const specificUrls=Array.isArray(parsed.specificUrls)?parsed.specificUrls.slice(0,5):[]; const result=await runFormQa(record.origin,{maxPages:8,specificUrls}); return sendJson(res,200,result);
    }

    if (req.method === 'POST' && req.url === '/api/scan') {
      const parsed = await readJson(req);
      if (!parsed.url) return sendJson(res, 400, { error: 'A website URL is required.' });

      let normalized = String(parsed.url).trim();
      if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
      const target = new URL(normalized);
      if (!['http:', 'https:'].includes(target.protocol) || isPrivateHostname(target.hostname)) {
        return sendJson(res, 400, { error: 'Only public HTTP/HTTPS websites can be scanned.' });
      }

      const report = await runFullScan(normalized,{limit:parsed.limit||15,browser:parsed.browser!==false,browserPages:parsed.browserPages||3});
      return sendJson(res, 200, report);
    }

    if (req.method === 'POST' && req.url === '/api/capacity-history') { const parsed=await readJson(req); const record=getVerification(parsed.verificationId); if(!record?.verified) return sendJson(res,403,{error:'Verified website ownership is required.'}); return sendJson(res,200,{history:await getCapacityHistory(record.origin)}); }

    if (req.method === 'GET' && req.url === '/api/health') return sendJson(res, 200, { ok: true, version: '3.8.0' });

    const pathname = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const safePath = pathname.replace(/\.\./g, '');
    const file = await readFile(join(ROOT, safePath));
    res.writeHead(200, { 'content-type': mime[extname(safePath)] || 'application/octet-stream' });
    res.end(file);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    console.error(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error' });
  }
});

let monitorRunnerBusy=false;
setInterval(async()=>{if(monitorRunnerBusy)return;monitorRunnerBusy=true;try{for(const m of dueMonitors()){try{await runMonitor(m.origin)}catch(e){console.error('Monitoring run failed:',m.origin,e.message)}}}finally{monitorRunnerBusy=false}},60_000).unref();

server.listen(PORT, () => console.log(`WebDoctor MVP running at http://localhost:${PORT}`));
