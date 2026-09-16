import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = fileURLToPath(new URL('../public/scans/', import.meta.url));
const WEIGHTS = { critical: 20, high: 10, medium: 4, low: 1 };
function safeName(v){return v.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'page'}
function finding(id,title,severity,detail,fix,url,evidence={},meta={}){return{id,title,severity,detail,fix,url,evidence,...meta}}
function relation(resource, origin){try{return new URL(resource).origin===origin?'first-party':'third-party'}catch{return'unknown'}}

export async function browserAudit(target, options={}) {
  let chromium, AxeBuilder;
  try { ({ chromium } = await import('playwright')); ({ default: AxeBuilder } = await import('@axe-core/playwright')); }
  catch { return { available:false, reason:'Browser QA dependencies are missing. Run npm install, then npx playwright install chromium.' }; }
  await mkdir(SHOTS,{recursive:true});
  let browser;
  try { browser=await chromium.launch({headless:true}); }
  catch(error){ return {available:false,reason:`Chromium is not installed. Run npx playwright install chromium. (${error.message})`}; }

  const scanId=Date.now().toString(36), findings=[], pages=[];
  const maxPages=Math.min(Number(options.maxPages)||3,5), queue=[target], visited=new Set(), origin=new URL(target).origin;
  try {
    while(queue.length && visited.size<maxPages){
      const url=queue.shift(); if(visited.has(url))continue; visited.add(url);
      const context=await browser.newContext({viewport:{width:1440,height:900},userAgent:'WebDoctor-BrowserQA/0.3'});
      const page=await context.newPage(), consoleErrors=[], failedRequests=[], badResponses=[];
      page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
      page.on('pageerror',e=>consoleErrors.push(e.message));
      page.on('requestfailed',r=>failedRequests.push({url:r.url(),method:r.method(),error:r.failure()?.errorText||'Request failed',party:relation(r.url(),origin)}));
      page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status(),method:r.request().method(),party:relation(r.url(),origin)})});
      const started=Date.now(); let response=null,navigationError=null;
      try{response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});await page.waitForTimeout(800)}catch(e){navigationError=e.message}
      const domContentMs=Date.now()-started;
      const finalUrl=page.url();
      const facts=await page.evaluate(()=>({
        links:[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(Boolean),
        viewportWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
        nav:performance.getEntriesByType('navigation')[0] ? (()=>{const n=performance.getEntriesByType('navigation')[0];return{domContentLoaded:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd),ttfb:Math.round(n.responseStart)}})():null
      })).catch(()=>({links:[]}));
      const shotName=`${scanId}-${safeName(new URL(finalUrl||url).pathname)}-desktop.png`;
      await page.screenshot({path:join(SHOTS,shotName),fullPage:true}).catch(()=>{});

      let accessibility={violations:[],passes:0};
      try{const axe=await new AxeBuilder({page}).analyze();accessibility={violations:axe.violations,passes:axe.passes.length}}catch{}
      const serious=accessibility.violations.filter(v=>['serious','critical'].includes(v.impact));
      if(accessibility.violations.length){
        const example=accessibility.violations[0];
        findings.push(finding('a11y-axe','Accessibility violations detected',serious.length?'high':'medium',`${accessibility.violations.length} axe-core rule violation(s); ${serious.length} serious/critical. Example: ${example.help}`,'Review the affected elements and follow the WCAG guidance in the evidence.',url,{screenshot:`/scans/${shotName}`,violations:accessibility.violations.slice(0,8).map(v=>({id:v.id,impact:v.impact,help:v.help,helpUrl:v.helpUrl,nodes:v.nodes.slice(0,3).map(n=>({html:n.html,target:n.target,failureSummary:n.failureSummary}))}))},{category:'accessibility'}));
      }

      let mobileOverflow=false,mobileShotName=null;
      const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'WebDoctor-MobileQA/0.3'});
      const mp=await mobile.newPage();
      try{await mp.goto(url,{waitUntil:'domcontentloaded',timeout:20000});await mp.waitForTimeout(500);mobileOverflow=await mp.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+3);mobileShotName=`${scanId}-${safeName(new URL(mp.url()||url).pathname)}-mobile.png`;await mp.screenshot({path:join(SHOTS,mobileShotName),fullPage:true})}catch{} await mobile.close();

      const firstFailed=failedRequests.filter(x=>x.party==='first-party'), thirdFailed=failedRequests.filter(x=>x.party==='third-party');
      const firstBad=badResponses.filter(x=>x.party==='first-party'), thirdBad=badResponses.filter(x=>x.party==='third-party');
      const pageResult={url,finalUrl,status:response?.status()||0,loadMs:domContentMs,timing:facts.nav||null,consoleErrors:consoleErrors.length,failedRequests:failedRequests.length,firstPartyFailures:firstFailed.length,thirdPartyFailures:thirdFailed.length,badResponses:badResponses.length,horizontalOverflow:facts.scrollWidth>facts.viewportWidth+3,mobileOverflow,accessibilityViolations:accessibility.violations.length,screenshot:`/scans/${shotName}`,mobileScreenshot:mobileShotName?`/scans/${mobileShotName}`:null};
      pages.push(pageResult);
      const ev={...pageResult};
      if(navigationError)findings.push(finding('browser-navigation','Browser navigation failed','high',navigationError,'Check runtime errors, redirects, TLS and server availability.',url,ev,{category:'functionality'}));
      if(consoleErrors.length)findings.push(finding('browser-console','JavaScript console errors','high',`${consoleErrors.length} browser error(s). Example: ${consoleErrors[0]}`,'Fix uncaught JavaScript/runtime errors and add resilient error handling.',url,{...ev,consoleErrors:consoleErrors.slice(0,5)},{category:'functionality'}));
      if(firstFailed.length)findings.push(finding('browser-request-first','First-party requests failed','high',`${firstFailed.length} request(s) to this site failed. Example: ${firstFailed[0].url}`,'Inspect the affected API/resource and server logs.',url,{...ev,requests:firstFailed.slice(0,5)},{category:'functionality'}));
      if(thirdFailed.length)findings.push(finding('browser-request-third','Third-party requests failed','low',`${thirdFailed.length} external request(s) failed. Example: ${thirdFailed[0].url}`,'Confirm the integration is still required and available; do not treat blocked analytics/ads as a site outage.',url,{...ev,requests:thirdFailed.slice(0,5)},{category:'functionality'}));
      if(firstBad.length)findings.push(finding('browser-http-first','First-party HTTP errors','high',`${firstBad.length} site request(s) returned 4xx/5xx. Example: ${firstBad[0].status} ${firstBad[0].url}`,'Fix missing resources/API failures or obsolete requests.',url,{...ev,responses:firstBad.slice(0,5)},{category:'functionality'}));
      if(thirdBad.length)findings.push(finding('browser-http-third','Third-party HTTP errors','low',`${thirdBad.length} external request(s) returned 4xx/5xx.`,'Review external integrations and remove obsolete resources.',url,{...ev,responses:thirdBad.slice(0,5)},{category:'functionality'}));
      if(pageResult.horizontalOverflow)findings.push(finding('browser-desktop-overflow','Desktop horizontal overflow','medium','Rendered content is wider than the desktop viewport.','Inspect fixed-width elements, media and overflowing containers.',url,ev,{category:'accessibility'}));
      if(mobileOverflow)findings.push(finding('browser-mobile-overflow','Mobile horizontal overflow','high','Rendered content is wider than a 390px mobile viewport.','Use responsive widths and inspect overflowing elements/media.',url,ev,{category:'accessibility'}));
      if(domContentMs>5000)findings.push(finding('browser-slow-load','Slow browser page load','medium',`DOM content became available in about ${domContentMs} ms.`,'Profile render-blocking resources, APIs and JavaScript execution.',url,ev,{category:'performance'}));
      for(const link of facts.links||[]){try{const u=new URL(link);u.hash='';if(u.origin===origin&&!visited.has(u.toString())&&!queue.includes(u.toString()))queue.push(u.toString())}catch{}}
      await context.close();
    }
  } finally { await browser.close(); }
  const penalty=findings.reduce((n,x)=>n+(WEIGHTS[x.severity]||0),0);
  const a11yPenalty=findings.filter(x=>x.category==='accessibility').reduce((n,x)=>n+(WEIGHTS[x.severity]||0),0);
  return {available:true,score:Math.max(0,100-penalty),accessibilityScore:Math.max(0,100-a11yPenalty),pagesScanned:pages.length,findings,pages};
}
