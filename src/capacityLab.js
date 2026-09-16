import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HISTORY_FILE=fileURLToPath(new URL('../data/capacity-history.json',import.meta.url));
function percentile(values,p){if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.ceil((p/100)*a.length)-1)]}
function privateHost(h){h=h.toLowerCase();return h==='localhost'||h==='127.0.0.1'||h==='::1'||h.endsWith('.local')||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function loadHistory(){try{return JSON.parse(await readFile(HISTORY_FILE,'utf8'))}catch{return []}}
async function saveHistory(row){const all=await loadHistory();all.push(row);await mkdir(dirname(HISTORY_FILE),{recursive:true});await writeFile(HISTORY_FILE,JSON.stringify(all.slice(-200),null,2));}
export async function getCapacityHistory(origin){const o=new URL(origin).origin;return (await loadHistory()).filter(x=>x.origin===o).slice(-12).reverse()}

export async function runCapacityLab(verifiedOrigin,{pageUrl,users=5,durationSeconds=10,save=true}={}){
 users=Number(users);durationSeconds=Number(durationSeconds);
 if(![5,10,25,50,100].includes(users))throw new Error('Choose 5, 10, 25, 50 or 100 virtual users.');
 if(![10,30,60].includes(durationSeconds))throw new Error('Choose a 10, 30 or 60 second duration.');
 const origin=new URL(verifiedOrigin).origin,target=new URL(pageUrl||origin,origin);
 if(target.origin!==origin)throw new Error('Capacity Lab can only test the verified origin.');
 if(!['http:','https:'].includes(target.protocol)||privateHost(target.hostname))throw new Error('Only the verified public HTTP/HTTPS website can be tested.');
 const baselineStart=performance.now();let baselineMs=null;try{const b=await fetch(target,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(10000),headers:{'user-agent':'WebDoctor-CapacityLab/1.5'}});await b.arrayBuffer();baselineMs=Math.round(performance.now()-baselineStart)}catch{}
 const started=Date.now(),deadline=started+durationSeconds*1000,latencies=[];let requests=0,ok=0,errors=0,aborted=false,abortReason='',active=true;const statusCounts={};const maxRequests=Math.min(2000,users*durationSeconds*2);let windowStart=Date.now(),windowCount=0;
 async function rateGate(){while(active){const now=Date.now();if(now-windowStart>=1000){windowStart=now;windowCount=0}if(windowCount<50){windowCount++;return}await sleep(Math.max(10,1000-(now-windowStart)))}}
 async function worker(){while(active&&Date.now()<deadline&&requests<maxRequests){await rateGate();if(!active||Date.now()>=deadline||requests>=maxRequests)break;const n=++requests,t0=performance.now();try{const r=await fetch(target,{method:'GET',redirect:'follow',headers:{'user-agent':'WebDoctor-CapacityLab/1.5 (owner-authorized QA)'},signal:AbortSignal.timeout(10000)});const ms=performance.now()-t0;latencies.push(ms);statusCounts[r.status]=(statusCounts[r.status]||0)+1;await r.arrayBuffer();if(r.ok)ok++;else errors++}catch{latencies.push(performance.now()-t0);errors++}if(n>=20&&errors/requests>0.30){aborted=true;abortReason='Automatically stopped because the observed error rate exceeded 30%.';active=false;break}await sleep(250)}}
 await Promise.all(Array.from({length:users},()=>worker()));active=false;
 const elapsed=(Date.now()-started)/1000,errorRate=requests?errors/requests*100:0,avg=latencies.length?latencies.reduce((a,b)=>a+b,0)/latencies.length:0,p95=Math.round(percentile(latencies,95));let verdict='PASS';if(aborted||errorRate>=10)verdict='FAIL';else if(errorRate>1||p95>2000)verdict='NEEDS ATTENTION';
 const result={target:target.href,origin,users,durationRequested:durationSeconds,durationActual:Number(elapsed.toFixed(1)),requests,successful:ok,errors,errorRate:Number(errorRate.toFixed(2)),baselineMs,avgMs:Math.round(avg),p50Ms:Math.round(percentile(latencies,50)),p95Ms:p95,p99Ms:Math.round(percentile(latencies,99)),requestsPerSecond:Number((requests/Math.max(elapsed,.1)).toFixed(1)),statusCounts,aborted,abortReason,verdict,degradationPct:baselineMs?Math.round(((avg-baselineMs)/Math.max(1,baselineMs))*100):null,scope:'GET-only capacity probe. This measures request handling, not complete logged-in user journeys.',limits:'Hard-capped at 50 requests/second and 2,000 total requests; automatically stops above 30% observed errors.',createdAt:new Date().toISOString()};
 if(save)await saveHistory(result);return result;
}

export async function runSteppedCapacityLab(verifiedOrigin,{pageUrl}={}){
 const stages=[5,10,25,50],results=[];let stopReason='';
 for(const users of stages){const r=await runCapacityLab(verifiedOrigin,{pageUrl,users,durationSeconds:10,save:false});results.push(r);if(r.verdict==='FAIL'||r.aborted||r.errorRate>=10||r.p95Ms>=3000){stopReason=`Auto-stopped after ${users} users because latency/errors crossed the safety threshold.`;break}await sleep(1000)}
 const healthy=results.filter(x=>x.verdict==='PASS');const estimatedHealthy=healthy.length?healthy.at(-1).users:0;let verdict=results.some(x=>x.verdict==='FAIL')?'FAIL':results.some(x=>x.verdict==='NEEDS ATTENTION')?'NEEDS ATTENTION':'PASS';
 const result={origin:new URL(verifiedOrigin).origin,target:results[0]?.target||pageUrl,mode:'stepped',stages:results,estimatedHealthy,stopReason,verdict,createdAt:new Date().toISOString(),scope:'Stepped GET-only probe: 5 → 10 → 25 → 50 virtual users, 10 seconds per stage. It stops early on unsafe latency/error signals.'};
 await saveHistory(result);return result;
}

export async function runJourneyCapacityLab(verifiedOrigin,{pageUrls=[],users=5,durationSeconds=10}={}){
  users=Number(users); durationSeconds=Number(durationSeconds);
  if(![5,10,25].includes(users)) throw new Error('Journey Load supports 5, 10 or 25 concurrent workers in v1.7.');
  if(![10,30].includes(durationSeconds)) throw new Error('Journey Load supports 10 or 30 seconds in v1.7.');
  const origin=new URL(verifiedOrigin).origin;
  const raw=Array.isArray(pageUrls)?pageUrls:[];
  const targets=[...new Set(raw.map(x=>String(x||'').trim()).filter(Boolean).map(x=>new URL(x,origin).href))].slice(0,5);
  if(targets.length<2) throw new Error('Add at least 2 read-only journey pages.');
  for(const href of targets){const u=new URL(href);if(u.origin!==origin)throw new Error('Every journey page must stay on the verified origin.');if(!['http:','https:'].includes(u.protocol)||privateHost(u.hostname))throw new Error('Only public HTTP/HTTPS pages on the verified website can be tested.');}

  // v1.7 pre-flight: establish route health BEFORE applying load. An unhealthy
  // route is excluded from the load test so a pre-existing 404/500 cannot be
  // misreported as a capacity failure.
  const preflight=[];
  let browser=null;
  try{ browser=await chromium.launch({headless:true}); }catch{}
  for(const href of targets){
    const t0=performance.now();
    let row={url:href,finalUrl:href,status:null,httpOk:false,ok:false,baselineMs:null,reason:'Request failed',browserState:'NOT CHECKED',browserRendered:false,interactiveCount:0};
    try{
      const r=await fetch(href,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(10000),headers:{'user-agent':'WebDoctor-JourneyLoad/1.8 Preflight'}});
      await r.arrayBuffer();
      row={...row,finalUrl:r.url,status:r.status,httpOk:r.ok,baselineMs:Math.round(performance.now()-t0),reason:r.ok?'Ready':`HTTP ${r.status}`};
    }catch(e){ row.reason=e?.name==='TimeoutError'?'Timed out':'Request failed'; }

    // Browser-aware diagnostic: an SPA route can return a direct 404 while still
    // rendering useful client-side UI after browser navigation. We identify that
    // separately instead of calling it an invalid page or a capacity failure.
    if(browser){
      const page=await browser.newPage({viewport:{width:1280,height:800}});
      try{
        await page.goto(href,{waitUntil:'domcontentloaded',timeout:12000});
        await page.waitForTimeout(900);
        const diag=await page.evaluate(()=>{
          const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
          const interactive=[...document.querySelectorAll('input,textarea,select,button,a[href],[role=button],[role=link]')].filter(visible).length;
          const body=(document.body?.innerText||'').trim();
          const errorLike=/\b(404|not found|page not found|something went wrong|application error)\b/i.test(body.slice(0,3000));
          return {interactive,bodyLength:body.length,errorLike,title:document.title||''};
        });
        row.interactiveCount=diag.interactive;
        row.browserRendered=diag.bodyLength>20 && !diag.errorLike;
        row.browserState=diag.errorLike?'ERROR UI':row.browserRendered?(diag.interactive?'INTERACTIVE':'RENDERED'):'EMPTY/LOADING';
      }catch{ row.browserState='BROWSER FAILED'; }
      finally{ await page.close(); }
    }
    const finalSameOrigin=(()=>{try{return new URL(row.finalUrl).origin===origin}catch{return false}})();
    row.ok=Boolean(row.httpOk && finalSameOrigin);
    if(!row.ok && row.browserRendered) row.reason=`SPA route: direct HTTP ${row.status??'failed'}, browser ${row.browserState.toLowerCase()}`;
    preflight.push(row);
  }
  if(browser) await browser.close();
  const valid=preflight.filter(x=>x.ok);
  const invalid=preflight.filter(x=>!x.ok);
  if(valid.length<2){
    const result={origin,mode:'journey',users,durationRequested:durationSeconds,requests:0,successful:0,errors:0,errorRate:0,avgMs:0,p95Ms:0,requestsPerSecond:0,pages:[],preflight,routeHealth:invalid.length?'NEEDS ATTENTION':'PASS',verdict:'NOT DETERMINED',loadVerdict:'NOT TESTED',aborted:false,abortReason:'',notice:'Journey load was not started because fewer than 2 selected routes passed pre-flight.',scope:'Browser-aware pre-flight distinguishes direct HTTP failures, SPA-rendered routes and invalid routes. Only successful direct GET routes are eligible for this read-only HTTP load test.',limits:'5 routes max · 25 workers max · 50 requests/sec global cap · 2,000 requests max · auto-stop above 30% load errors.',createdAt:new Date().toISOString()};
    await saveHistory(result);return result;
  }
  const loadTargets=valid.map(x=>x.url), baselines=Object.fromEntries(valid.map(x=>[x.url,x.baselineMs]));
  const started=Date.now(), deadline=started+durationSeconds*1000, latencies=[]; let requests=0,ok=0,errors=0,active=true,aborted=false,abortReason='';
  const perPage=Object.fromEntries(loadTargets.map(x=>[x,{requests:0,ok:0,errors:0,latencies:[],statusCounts:{}}]));
  let nextPermit=performance.now(); const intervalMs=1000/50; let gate=Promise.resolve();
  async function rateGate(){let release;const prev=gate;gate=new Promise(r=>release=r);await prev;const now=performance.now();const wait=Math.max(0,nextPermit-now);if(wait)await sleep(wait);nextPermit=Math.max(nextPermit,performance.now())+intervalMs;release();}
  async function worker(id){let idx=id%loadTargets.length;while(active&&Date.now()<deadline&&requests<2000){const href=loadTargets[idx%loadTargets.length];idx++;await rateGate();if(!active||Date.now()>=deadline||requests>=2000)break;requests++;const p=perPage[href];p.requests++;const t0=performance.now();try{const r=await fetch(href,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(10000),headers:{'user-agent':'WebDoctor-JourneyLoad/1.8 (owner-authorized read-only QA)'}});const ms=performance.now()-t0;latencies.push(ms);p.latencies.push(ms);p.statusCounts[r.status]=(p.statusCounts[r.status]||0)+1;await r.arrayBuffer();if(r.ok){ok++;p.ok++}else{errors++;p.errors++}}catch{const ms=performance.now()-t0;latencies.push(ms);p.latencies.push(ms);errors++;p.errors++}if(requests>=20&&errors/requests>0.30){aborted=true;abortReason='Automatically stopped because the observed load-test error rate exceeded 30%.';active=false;break}await sleep(150+((id*73)%250));}}
  await Promise.all(Array.from({length:users},(_,i)=>worker(i)));active=false;
  const elapsed=(Date.now()-started)/1000,errorRate=requests?errors/requests*100:0,avg=latencies.length?latencies.reduce((a,b)=>a+b,0)/latencies.length:0,p95=Math.round(percentile(latencies,95));
  let loadVerdict='PASS';if(aborted||errorRate>=10)loadVerdict='FAIL';else if(errorRate>1||p95>2000)loadVerdict='NEEDS ATTENTION';
  const pages=loadTargets.map(href=>{const p=perPage[href],a=p.latencies.length?p.latencies.reduce((x,y)=>x+y,0)/p.latencies.length:0;return {url:href,baselineMs:baselines[href],requests:p.requests,successful:p.ok,errors:p.errors,errorRate:p.requests?Number((p.errors/p.requests*100).toFixed(2)):0,avgMs:Math.round(a),p95Ms:Math.round(percentile(p.latencies,95)),statusCounts:p.statusCounts}});
  const result={origin,mode:'journey',users,durationRequested:durationSeconds,durationActual:Number(elapsed.toFixed(1)),requests,successful:ok,errors,errorRate:Number(errorRate.toFixed(2)),avgMs:Math.round(avg),p95Ms:p95,requestsPerSecond:Number((requests/Math.max(elapsed,.1)).toFixed(1)),pages,preflight,routeHealth:invalid.length?'NEEDS ATTENTION':'PASS',excludedRoutes:invalid.length,aborted,abortReason,loadVerdict,verdict:loadVerdict,notice:invalid.length?`${invalid.length} route(s) failed pre-flight and were excluded from load testing.`:'All selected routes passed pre-flight.',scope:'Read-only multi-page journey probe. Browser-aware pre-flight separates HTTP-ready routes, SPA-rendered routes and existing failures before load.',limits:'5 routes max · 25 workers max · 50 requests/sec global cap · 2,000 requests max · auto-stop above 30% load errors.',createdAt:new Date().toISOString()};
  await saveHistory(result);return result;
}
