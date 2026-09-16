import { chromium } from 'playwright';

const FIELD_SELECTOR='input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select';

function safeSameOrigin(origin, candidate){
  try { const u=new URL(candidate,origin); u.hash=''; return u.origin===origin?u.href:null; } catch { return null; }
}

function casesFor(field){
  if(field.tag==='select') return [];
  const out=[];
  if(field.required) out.push({id:'empty-required',label:'Empty required value',value:'',expect:'invalid'});
  if(['text','email','tel','url','password','search','textarea'].includes(field.type)) out.push({id:'whitespace',label:'Whitespace-only value',value:'   ',expect:field.required?'invalid-or-app-rule':'observe'});
  if(field.type==='email') out.push({id:'malformed-email',label:'Malformed email',value:'not-an-email',expect:'invalid'});
  if(field.type==='url') out.push({id:'malformed-url',label:'Malformed URL',value:'not a url',expect:'invalid'});
  if(['text','email','tel','url','password','search','textarea'].includes(field.type)){
    const n=field.maxLength>0?Math.min(field.maxLength+1,600):300;
    out.push({id:'long-value',label:`Long value (${n} chars)`,value:'A'.repeat(n),expect:field.maxLength>0?'invalid-or-truncated':'observe'});
  }
  if(['text','search','textarea'].includes(field.type)) out.push({id:'unicode',label:'Unicode text',value:"André O’Connor 東京 ✓",expect:'valid-or-app-rule'});
  return out.slice(0,5);
}

export async function runActiveValidationQa(origin,pageUrl){
  const target=safeSameOrigin(origin,pageUrl); if(!target) throw new Error('Active QA page must be on the verified website.');
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  const page=await context.newPage(); const consoleErrors=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,500))});
  try{
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForLoadState('networkidle',{timeout:3500}).catch(()=>{}); await page.waitForTimeout(600);
    const fields=await page.$$eval(FIELD_SELECTOR,els=>els.map((e,index)=>({index,tag:e.tagName.toLowerCase(),type:e.tagName.toLowerCase()==='textarea'?'textarea':(e.type||e.tagName).toLowerCase(),name:e.name||'',id:e.id||'',placeholder:e.placeholder||'',required:!!e.required,minLength:e.minLength,maxLength:e.maxLength,pattern:e.pattern||'',disabled:!!e.disabled,readOnly:!!e.readOnly})));
    const results=[];
    for(const field of fields.slice(0,12)){
      if(field.disabled||field.readOnly) continue;
      const tests=[];
      for(const tc of casesFor(field)){
        await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{}); await page.waitForTimeout(350);
        const loc=page.locator(FIELD_SELECTOR).nth(field.index); if(!(await loc.count())) continue;
        try{
          await loc.fill(tc.value,{timeout:2500}); await loc.dispatchEvent('input'); await loc.dispatchEvent('change'); await loc.blur(); await page.waitForTimeout(120);
          const state=await loc.evaluate(e=>({value:e.value,valid:e.checkValidity(),message:e.validationMessage||'',tooLong:e.validity?.tooLong||false,typeMismatch:e.validity?.typeMismatch||false,valueMissing:e.validity?.valueMissing||false,patternMismatch:e.validity?.patternMismatch||false}));
          let result='observe';
          if(tc.expect==='invalid') result=state.valid?'fail':'pass';
          else if(tc.expect==='invalid-or-truncated') result=(!state.valid||state.value.length<tc.value.length)?'pass':'warning';
          else if(tc.expect==='invalid-or-app-rule') result=state.valid?'warning':'pass';
          else if(tc.expect==='valid-or-app-rule') result=state.valid?'pass':'warning';
          tests.push({case:tc.id,label:tc.label,result,...state,inputLength:tc.value.length});
        }catch(error){tests.push({case:tc.id,label:tc.label,result:'error',error:error.message})}
      }
      results.push({field,tests});
    }
    const totals={pass:0,warning:0,fail:0,error:0,observe:0}; for(const r of results)for(const t of r.tests)totals[t.result]=(totals[t.result]||0)+1;
    const testsRun=Object.values(totals).reduce((a,b)=>a+b,0);
    const verdictStatus=totals.fail>0||totals.error>0?'FAIL':totals.warning>0?'NEEDS ATTENTION':testsRun>0?'PASS':'NOT TESTED';
    const priority=totals.fail>0?'One or more validation checks behaved contrary to the expected browser constraint.':totals.error>0?'One or more validation checks could not complete.':totals.warning>0?'Review warning cases, especially fields accepting boundary or whitespace values without an explicit constraint.':testsRun>0?'The validation cases executed by WebDoctor behaved as expected.':'No validation cases were executed.';
    return {available:true,mode:'validation-only',page:page.url(),fieldsTested:results.length,testsRun,totals,results,consoleErrors:[...new Set(consoleErrors)].slice(0,10),verdict:{status:verdictStatus,passed:totals.pass||0,warnings:totals.warning||0,failed:(totals.fail||0)+(totals.error||0),notTested:0,priority,scope:'Client-side validation only. Server-side validation and persistence were not tested.'},notice:'Validation-only Active QA changed field values and triggered input/change/blur events. It did not click submit buttons, submit forms, create accounts, send messages, make purchases, or intentionally trigger server-side actions.'};
  } finally { await browser.close(); }
}

export async function runSubmissionSimulation(origin,pageUrl){
  const target=safeSameOrigin(origin,pageUrl); if(!target) throw new Error('Submission simulation page must be on the verified website.');
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
  const page=await context.newPage(); const attempted=[]; const consoleErrors=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,500))});
  await page.route('**/*',async route=>{const req=route.request(), method=req.method().toUpperCase(); if(['POST','PUT','PATCH','DELETE'].includes(method)){attempted.push({method,url:req.url(),resourceType:req.resourceType()}); return route.abort('blockedbyclient');} return route.continue();});
  try{
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000}); await page.waitForLoadState('networkidle',{timeout:3500}).catch(()=>{}); await page.waitForTimeout(500);
    const info=await page.evaluate((sel)=>{const fields=[...document.querySelectorAll(sel)]; const actions=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(e=>/submit|send|continue|sign\s?up|register|create|contact|subscribe|save/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').trim())||e.type==='submit'); return {fieldCount:fields.length,hasPassword:fields.some(e=>e.type==='password'),text:(document.body?.innerText||'').slice(0,5000),actionCount:actions.length};},FIELD_SELECTOR);
    // Classify the target flow itself, not unrelated words elsewhere on the page.
    // Safe simulation blocks every write request at the browser network layer, but we
    // still avoid typing into password/card fields by default.
    const flowMeta=await page.evaluate((sel)=>{
      const fields=[...document.querySelectorAll(sel)];
      const actions=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')]
        .map(e=>(e.innerText||e.value||e.getAttribute('aria-label')||'').trim())
        .filter(Boolean);
      const fieldHints=fields.map(e=>[e.type,e.name,e.id,e.placeholder,e.autocomplete].filter(Boolean).join(' ')).join(' ');
      return {actions:actions.slice(0,30),fieldHints};
    },FIELD_SELECTOR);
    const actionHints=flowMeta.actions.join(' ');
    const paymentSensitive=/card|cvv|cvc|expiry|credit\s*card|debit\s*card|payment|checkout|billing/i.test(flowMeta.fieldHints+' '+actionHints);
    const authenticationSensitive=info.hasPassword || /password|passcode|otp|one[- ]time|sign\s?in|log\s?in/i.test(flowMeta.fieldHints+' '+actionHints);
    if(paymentSensitive || authenticationSensitive) return {available:false,blocked:true,sensitiveType:paymentSensitive?'payment':'authentication',reason:`Safety block: this specific flow contains ${paymentSensitive?'payment/card':'authentication/password'} controls. WebDoctor did not fill or submit them. This message is not asking you to pay for WebDoctor.`};
    const fields=page.locator(FIELD_SELECTOR); const count=await fields.count();
    for(let i=0;i<Math.min(count,12);i++){
      const loc=fields.nth(i); if(await loc.isDisabled().catch(()=>true))continue;
      const tag=await loc.evaluate(e=>e.tagName.toLowerCase()); const type=await loc.getAttribute('type')||tag;
      if(type==='checkbox'||type==='radio'){if(!(await loc.isChecked().catch(()=>false))) await loc.check().catch(()=>{});continue;}
      if(tag==='select'){const opts=await loc.locator('option').all(); if(opts.length>1)await loc.selectOption({index:1}).catch(()=>{});continue;}
      const value=type==='email'?'webdoctor-test@example.com':type==='url'?'https://example.com':type==='tel'?'+15555550123':'WebDoctor automated QA test';
      await loc.fill(value).catch(()=>{});
    }
    const before=await page.screenshot({type:'png'}); const before64=`data:image/png;base64,${before.toString('base64')}`;
    const submit=page.locator('button,input[type="submit"],[role="button"]').filter({hasText:/submit|send|continue|create|contact|subscribe|save/i}).first();
    const fallback=page.locator('button[type="submit"],input[type="submit"]').first(); const action=await submit.count()?submit:fallback;
    if(!(await action.count())) return {available:false,reason:'No submit-like action was found on this page.'};
    const actionText=(await action.innerText().catch(()=>''))||(await action.getAttribute('value'))||'Submit';
    await action.click({timeout:3000}).catch(()=>{}); await page.waitForTimeout(800);
    const after=await page.screenshot({type:'png'}); const after64=`data:image/png;base64,${after.toString('base64')}`;
    const validation=await page.locator(FIELD_SELECTOR).evaluateAll(els=>els.map(e=>({name:e.name||e.id||e.placeholder||e.type,valid:e.checkValidity(),message:e.validationMessage||''})).filter(x=>!x.valid||x.message));
    const uniqueConsole=[...new Set(consoleErrors)].slice(0,10);
    const clientFailed=uniqueConsole.length>0;
    const clientWarning=validation.length>0;
    const verdictStatus=clientFailed?'FAIL':clientWarning?'NEEDS ATTENTION':'PASS';
    return {available:true,mode:'intercepted-submission-simulation',page:page.url(),actionText,attemptedRequests:attempted.slice(0,20),validation,consoleErrors:uniqueConsole,beforeScreenshot:before64,afterScreenshot:after64,networkBlocked:true,verdict:{status:verdictStatus,passed:clientFailed?0:1,warnings:clientWarning?validation.length:0,failed:clientFailed?uniqueConsole.length:0,notTested:1,priority:clientFailed?'JavaScript console errors appeared during the simulated interaction.':clientWarning?'The action ran, but browser validation messages remained after the click.':'The client-side action responded without a newly observed console error.',scope:'Server submission is NOT TESTED because all write requests were intentionally blocked.'},notice:'WebDoctor filled test values and clicked the submit-like action, but blocked all POST/PUT/PATCH/DELETE requests before they left the browser. No server-side submission was intentionally allowed.'};
  } finally {await browser.close();}
}
