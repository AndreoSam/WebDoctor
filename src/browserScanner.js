import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = process.env.VERCEL ? join('/tmp','webdoctor','scans') : fileURLToPath(new URL('../public/scans/', import.meta.url));
const WEIGHTS = { critical: 20, high: 10, medium: 4, low: 1 };
function safeName(v){return v.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'page'}
function finding(id,title,severity,detail,fix,url,evidence={},meta={}){return{id,title,severity,detail,fix,url,evidence,...meta}}
function relation(resource, origin){try{return new URL(resource).origin===origin?'first-party':'third-party'}catch{return'unknown'}}

export async function browserAudit(target, options={}) {
  let playwrightChromium, AxeBuilder;
  try { ({ chromium: playwrightChromium } = await import('playwright')); ({ default: AxeBuilder } = await import('@axe-core/playwright')); }
  catch { return { available:false, reason:'Browser QA dependencies are missing.' }; }
  await mkdir(SHOTS,{recursive:true});
  let browser;
  try {
    if(process.env.VERCEL){
      const { default: serverlessChromium } = await import('@sparticuz/chromium');
      browser=await playwrightChromium.launch({args:serverlessChromium.args,executablePath:await serverlessChromium.executablePath(),headless:true});
    }else browser=await playwrightChromium.launch({headless:true});
  } catch(error){
    return {available:false,reason:`${process.env.VERCEL?'Vercel serverless Chromium failed to launch.':'Chromium failed to launch.'} (${error.message})`};
  }

  const scanId=Date.now().toString(36), findings=[], pages=[];
  const requestedMax=Math.min(Number(options.maxPages)||3,5);
  const maxPages=process.env.VERCEL?Math.min(requestedMax,1):requestedMax;
  const queue=[target], visited=new Set(), origin=new URL(target).origin;
  try {
    while(queue.length && visited.size<maxPages){
      const url=queue.shift(); if(visited.has(url))continue; visited.add(url);
      let context=null, mobile=null;
      try {
        context=await browser.newContext({viewport:{width:1440,height:900},userAgent:'WebDoctor-BrowserQA/0.3'});
        const page=await context.newPage(); const consoleErrors=[], failedRequests=[], httpErrors=[];
        page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),location:m.location()})});
        page.on('pageerror',e=>consoleErrors.push({text:e.message,location:{}}));
        page.on('requestfailed',r=>failedRequests.push({url:r.url(),method:r.method(),failure:r.failure()?.errorText||'failed',relation:relation(r.url(),origin)}));
        page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status(),relation:relation(r.url(),origin)})});
        const started=Date.now(); let response=null,navigationError=null;
        try{response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});await page.waitForTimeout(300)}catch(e){navigationError=e.message}
        const loadMs=Date.now()-started;
        const facts=await page.evaluate(()=>({url:location.href,title:document.title,viewport:{w:innerWidth,h:innerHeight},doc:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},links:[...document.querySelectorAll('a[href]')].map(a=>a.href),forms:document.forms.length,text:(document.body?.innerText||'').slice(0,300)})).catch(()=>({links:[]}));
        const overflow=(facts.doc?.scrollWidth||0)>(facts.doc?.clientWidth||0)+3;
        const shotName=`${scanId}-${safeName(new URL(facts.url||url).pathname)}-desktop.png`;
        if(!process.env.VERCEL) await page.screenshot({path:join(SHOTS,shotName),fullPage:true}).catch(()=>{});
        let accessibility={violations:[],passes:0};
        try{const axe=await new AxeBuilder({page}).analyze();accessibility={violations:axe.violations,passes:axe.passes.length}}catch{}
        let mobileOverflow=false,mobileShotName='';
        try{
          mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,userAgent:'WebDoctor-MobileQA/0.3'});
          const mp=await mobile.newPage(); await mp.goto(url,{waitUntil:'domcontentloaded',timeout:12000}); await mp.waitForTimeout(200);
          mobileOverflow=await mp.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+3);
          if(!process.env.VERCEL){mobileShotName=`${scanId}-${safeName(new URL(mp.url()||url).pathname)}-mobile.png`;await mp.screenshot({path:join(SHOTS,mobileShotName),fullPage:true}).catch(()=>{});}
        }catch{} finally { if(mobile) await mobile.close().catch(()=>{}); mobile=null; }
        const p={url:facts.url||url,status:response?.status()||0,loadMs,navigationError,consoleErrors,failedRequests,httpErrors,overflow,mobileOverflow,screenshot:process.env.VERCEL?null:`/scans/${shotName}`,mobileScreenshot:process.env.VERCEL?null:(mobileShotName?`/scans/${mobileShotName}`:null),accessibility}; pages.push(p);
        if(navigationError)findings.push(finding('browser-navigation','Browser navigation failed','high',navigationError,'Fix the page/server error so the page can load in a real browser.',url,{navigationError}));
        if(consoleErrors.length)findings.push(finding('console-errors','JavaScript console errors','medium',`${consoleErrors.length} browser console/runtime error(s) detected.`,'Inspect the console evidence and fix first-party runtime errors.',url,{consoleErrors:consoleErrors.slice(0,10)}));
        const firstPartyFailures=[...failedRequests,...httpErrors].filter(x=>x.relation==='first-party'); if(firstPartyFailures.length)findings.push(finding('first-party-request-failures','First-party browser requests failed','high',`${firstPartyFailures.length} first-party request(s) failed while rendering.`,'Fix the failing application/API/static resource requests.',url,{requests:firstPartyFailures.slice(0,12)}));
        if(overflow||mobileOverflow)findings.push(finding('horizontal-overflow','Horizontal overflow detected','medium','The page is wider than the viewport on desktop or mobile.','Inspect fixed-width elements, long content and responsive CSS.',url,{desktop:overflow,mobile:mobileOverflow}));
        for(const v of accessibility.violations||[])findings.push(finding(`axe-${v.id}`,v.help,v.impact==='critical'?'critical':v.impact==='serious'?'high':v.impact==='moderate'?'medium':'low',v.description,v.helpUrl,url,{impact:v.impact,nodes:v.nodes.slice(0,5).map(n=>({target:n.target,html:n.html,failureSummary:n.failureSummary}))},{standard:'axe-core'}));
        for(const link of facts.links||[]){try{const u=new URL(link);u.hash='';if(u.origin===origin&&!visited.has(u.toString())&&!queue.includes(u.toString()))queue.push(u.toString())}catch{}}
      } catch(error){
        findings.push(finding('browser-page-error','Browser QA page interrupted','medium',error.message,'Retry the scan. If this persists, inspect the serverless function logs.',url,{error:error.message}));
      } finally {
        if(mobile) await mobile.close().catch(()=>{});
        if(context) await context.close().catch(()=>{});
      }
    }
  } catch(error){
    return {available:false,reason:`Browser QA was interrupted: ${error.message}`,pages,findings};
  } finally { await browser.close().catch(()=>{}); }
  const deduction=findings.reduce((s,f)=>s+(WEIGHTS[f.severity]||1),0),score=Math.max(0,100-Math.min(100,deduction));
  const accessibilityFindings=findings.filter(x=>x.id.startsWith('axe-')),accessibilityScore=Math.max(0,100-Math.min(100,accessibilityFindings.reduce((s,f)=>s+(WEIGHTS[f.severity]||1),0)));
  return {available:true,score,accessibilityScore,pages,findings,summary:{pages:pages.length,findings:findings.length,consoleErrors:pages.reduce((s,p)=>s+p.consoleErrors.length,0),failedRequests:pages.reduce((s,p)=>s+p.failedRequests.length,0),httpErrors:pages.reduce((s,p)=>s+p.httpErrors.length,0),accessibilityViolations:accessibilityFindings.length}};
}
