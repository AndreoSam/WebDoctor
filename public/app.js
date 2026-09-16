const $=s=>document.querySelector(s); let lastReport=null, progressTimer=null;
const stages=[['Discovery','Finding crawlable pages'],['HTTP checks','Checking links and responses'],['SEO & headers','Inspecting page metadata and configuration'],['Browser QA','Rendering desktop pages in Chromium'],['Mobile QA','Rendering mobile viewports'],['Accessibility','Running axe-core WCAG checks'],['Report','Prioritizing and grouping findings']];
$('#scan-form').addEventListener('submit',async e=>{e.preventDefault();let url=$('#url').value.trim();if(!url)return;if(/^https?:\/\//i.test(url))url=url.replace(/^https?:\/\//i,'');startProgress();$('#results').classList.add('hidden');$('#scan-button').disabled=true;$('#scan-button').textContent='Scanning…';try{const r=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,limit:15,browser:true,browserPages:3})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Scan failed');lastReport=d;finishProgress();render(d)}catch(err){stopProgress();alert(err.message)}finally{$('#scan-button').disabled=false;$('#scan-button').textContent='Run website scan'}});
$('#severity').addEventListener('change',()=>lastReport&&renderIssues(lastReport.issues));
function startProgress(){let i=0;$('#progress').classList.remove('hidden');drawProgress(0);clearInterval(progressTimer);progressTimer=setInterval(()=>{i=Math.min(i+1,stages.length-2);drawProgress(i)},2200)}
function drawProgress(active){$('#progress-stages').innerHTML=stages.map((s,i)=>`<div class="pstage ${i<active?'done':i===active?'active':''}"><i>${i<active?'✓':i===active?'●':'○'}</i><span><b>${s[0]}</b><small>${s[1]}</small></span></div>`).join('');$('#progress-bar').style.width=`${Math.min(92,10+active*14)}%`;$('#progress-percent').textContent=`${Math.min(92,10+active*14)}%`}
function finishProgress(){clearInterval(progressTimer);drawProgress(stages.length-1);$('#progress-bar').style.width='100%';$('#progress-percent').textContent='100%';setTimeout(()=>$('#progress').classList.add('hidden'),450)}function stopProgress(){clearInterval(progressTimer);$('#progress').classList.add('hidden')}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}function scoreColor(s){return s>=85?'var(--good)':s>=65?'var(--warn)':'var(--bad)'}
function render(r){$('#results').classList.remove('hidden'); document.body.classList.add('project-active'); checkSavedVerification(r.target);$('#target').textContent=r.target;$('#stamp').textContent=`Scanned ${new Date(r.scannedAt).toLocaleString()} · ${r.summary.pagesScanned} pages · ${r.summary.linksChecked} links checked`;$('#score').style.borderColor=scoreColor(r.summary.score);$('#score').innerHTML=`${r.summary.score}<small>HEALTH SCORE</small>`;
const stats=[['Pages',r.summary.pagesScanned],['Links',r.summary.linksChecked],['Issues',r.summary.issues],['Critical',r.summary.critical],['High',r.summary.high],['Medium',r.summary.medium]];$('#stats').innerHTML=stats.map(([l,v])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
$('#categories').innerHTML=Object.entries(r.categories).map(([n,v])=>`<div class="category"><b>${v}/100</b><span>${n[0].toUpperCase()+n.slice(1)}</span><div class="meter"><i style="width:${v}%;background:${scoreColor(v)}"></i></div></div>`).join('');renderBreakdown(r);renderIssues(r.issues);renderBrowser(r.browser);$('#pages').innerHTML=r.pages.map(p=>`<tr><td title="${esc(p.url)}">${esc(p.url)}</td><td class="${p.status>=200&&p.status<400?'ok':'bad'}">${p.status||'ERR'}</td><td>${p.durationMs==null?'—':`${p.durationMs} ms`}</td><td>${p.linkCount??'—'}</td><td>${p.imageCount??'—'}</td><td>${p.formCount??'—'}</td></tr>`).join('');$('#results').scrollIntoView({behavior:'smooth',block:'start'})}
function renderBreakdown(r){const severityWeight={critical:20,high:10,medium:4,low:1};const rows=[...r.issues].sort((a,b)=>(severityWeight[b.severity]||0)-(severityWeight[a.severity]||0)).slice(0,5);$('#score-breakdown').innerHTML=`<div><h3>Why ${r.summary.score}/100?</h3><p class="muted">The score combines passive audit results with real-browser QA. Higher-severity findings create larger deductions.</p></div><div class="deductions">${rows.map(x=>`<span><b>-${severityWeight[x.severity]||1}</b>${esc(x.title)}</span>`).join('')||'<span>No major deductions.</span>'}</div>`}
function groupIssues(issues){const m=new Map();for(const i of issues){const k=`${i.id}|${i.title}|${i.severity}`;if(!m.has(k))m.set(k,{...i,urls:[],items:[]});const g=m.get(k);g.urls.push(i.url);g.items.push(i)}return[...m.values()].map(g=>({...g,count:g.items.length,urls:[...new Set(g.urls)]}))}
function renderIssues(issues){const f=$('#severity').value;let v=f==='all'?issues:issues.filter(i=>i.severity===f);const groups=groupIssues(v);$('#issues').innerHTML=groups.length?groups.map(g=>`<details class="issue"><summary><div class="badge ${g.severity}">${g.severity}</div><div><h3>${esc(g.title)} ${g.count>1?`<span class="count">${g.count} pages</span>`:''}</h3><p>${esc(g.detail)}</p></div><span class="openhint">Details</span></summary><div class="issue-detail"><div><h4>What happened</h4><p>${esc(g.detail)}</p><h4>Why it matters</h4><p>${impact(g)}</p></div><div><h4>Suggested fix</h4><p>${esc(g.fix)}</p><h4>Affected pages</h4>${g.urls.slice(0,8).map(u=>`<code>${esc(u)}</code>`).join('')}</div>${evidenceHtml(g.items[0])}</div></details>`).join(''):'<div class="empty">No issues in this filter.</div>'}
function impact(i){if(i.severity==='critical')return'This can directly expose users or prevent a core flow from working.';if(i.severity==='high')return'This can cause visible failures or materially degrade the user experience.';if(i.severity==='medium')return'This can affect quality, compatibility, discoverability or reliability.';return'This is a lower-risk quality/configuration improvement worth addressing.'}
function evidenceHtml(i){const e=i.evidence||{};if(!e.screenshot&&!e.requests&&!e.responses&&!e.violations)return'';return`<div class="evidence"><h4>Evidence</h4>${e.screenshot?`<a href="${e.screenshot}" target="_blank"><img src="${e.screenshot}" alt="Issue screenshot"></a>`:''}${e.requests?e.requests.slice(0,3).map(x=>`<code>${esc(x.party||'')} ${esc(x.method)} ${esc(x.url)}</code>`).join(''):''}${e.responses?e.responses.slice(0,3).map(x=>`<code>${x.status} ${esc(x.url)}</code>`).join(''):''}${e.violations?e.violations.slice(0,3).map(x=>`<p><b>${esc(x.impact||'')} · ${esc(x.help)}</b><br><code>${esc(x.id)}</code></p>`).join(''):''}</div>`}
function renderBrowser(b){const s=$('#browser-section');if(!b){s.classList.add('hidden');return}s.classList.remove('hidden');if(!b.available){$('#browser-status').textContent=b.reason||'Browser QA unavailable.';$('#browser-pages').innerHTML='';return}$('#browser-status').textContent=`${b.pagesScanned} page(s) rendered · Browser ${b.score}/100 · Accessibility ${b.accessibilityScore}/100`;$('#browser-pages').innerHTML=b.pages.map(p=>`<article class="browser-card"><div class="browser-card-head"><div><h3>${esc(p.finalUrl||p.url)}</h3><p>${p.loadMs} ms · ${p.firstPartyFailures} first-party failures · ${p.thirdPartyFailures} third-party failures · ${p.accessibilityViolations} accessibility violations</p></div><b>${p.mobileOverflow?'Mobile issue':'Rendered'}</b></div><div class="shots">${p.screenshot?`<a href="${p.screenshot}" target="_blank"><img src="${p.screenshot}" alt="Desktop"><span>Desktop</span></a>`:''}${p.mobileScreenshot?`<a href="${p.mobileScreenshot}" target="_blank"><img src="${p.mobileScreenshot}" alt="Mobile"><span>Mobile</span></a>`:''}</div></article>`).join('')}

// v0.7 persistent ownership verification + safe Form QA
let verificationSession=null;
async function checkSavedVerification(url){
  try{const r=await fetch('/api/verification/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});const d=await r.json();if(!r.ok)return;
    if(d.found){verificationSession=d;if(d.verified){showVerifiedProject(d)}else{renderVerification(d)}}
    else{$('#verified-badge').classList.add('hidden');$('#formqa').classList.add('hidden');$('#verify-start').classList.remove('hidden');$('#verify-setup').classList.add('hidden')}
  }catch{}
}
function showVerifiedProject(v){
  $('#verified-badge').classList.remove('hidden');$('#formqa').classList.remove('hidden');$('#verify-start').classList.add('hidden');
  const box=$('#verify-setup');box.classList.remove('hidden');
  box.innerHTML=`<h3>${esc(v.hostname)} is already verified</h3><div class="persist-note">✓ One-time verification saved locally. Keep the verification tag/file on the website and Deep QA stays unlocked after WebDoctor restarts.</div><div class="verified-meta"><span>Method: ${esc(v.verificationMethod||'Saved verification')}</span>${v.verifiedAt?`<span>Verified: ${new Date(v.verifiedAt).toLocaleString()}</span>`:''}</div>`;
}

$('#verify-start').addEventListener('click',async()=>{
  let url=$('#url').value.trim()||(lastReport?.target||''); if(!url)return alert('Enter or scan your website first.');
  try{const r=await fetch('/api/verification/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});const d=await r.json();if(!r.ok)throw new Error(d.error);verificationSession=d;renderVerification(d)}catch(e){alert(e.message)}
});
function renderVerification(v){const box=$('#verify-setup');box.classList.remove('hidden');box.innerHTML=`<h3>Verify ${esc(v.hostname)}</h3><p class="muted">Choose either method. Keep the token public only long enough to verify ownership.</p><div class="verify-methods"><div class="verify-method"><b>Option 1 · HTML file</b><p>Create <code>webdoctor-verification.txt</code> containing exactly:</p><code>${esc(v.token)}</code><p>Upload it so this URL opens publicly:</p><code>${esc(v.methods.htmlFile)}</code></div><div class="verify-method"><b>Option 2 · Meta tag</b><p>Add this inside your homepage &lt;head&gt;:</p><code>${esc(v.methods.meta)}</code></div></div><button id="verify-check" type="button">Check verification</button><span id="verify-message" class="muted"></span>`;$('#verify-check').onclick=checkVerification}
async function checkVerification(){const msg=$('#verify-message');msg.textContent=' Checking…';try{const r=await fetch('/api/verification/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:verificationSession.id})});const d=await r.json();if(d.verified){msg.textContent=` Verified using ${d.evidence}.`;verificationSession={...verificationSession,...d};showVerifiedProject(verificationSession)}else msg.textContent=' Token not found yet. Check the path/tag and try again.'}catch(e){msg.textContent=` ${e.message}`}}
$('#run-formqa').addEventListener('click',async()=>{if(!verificationSession)return;const b=$('#run-formqa');b.disabled=true;b.textContent='Discovering journeys…';try{const r=await fetch('/api/form-qa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id,specificUrls:$('#journey-url')?.value.trim()?[ $('#journey-url').value.trim() ]:[]})});const d=await r.json();if(!r.ok)throw new Error(d.error);renderFormQa(d)}catch(e){alert(e.message)}finally{b.disabled=false;b.textContent='Discover Smart Journeys'}});
let discoveredJourneyUrls=[];
function renderFormQa(d){
  const findings=d.findings||[], flows=d.flows||[], journeys=d.journeys||[]; const diagnostics=d.pageDiagnostics||[]; discoveredJourneyUrls=[...new Set([...(journeys||[]).map(j=>j.href),...(diagnostics||[]).map(x=>x.url),...(flows||[]).map(f=>f.page)].filter(Boolean))];
  const fieldCount=flows.reduce((n,f)=>n+(f.fields?.length||0),0);
  $('#formqa-results').innerHTML=`<div class="formqa-summary"><div><b>${d.pagesInspected}</b><span>Pages inspected</span></div><div><b>${d.flowsFound??0}</b><span>Interactive flows</span></div><div><b>${fieldCount}</b><span>Fields discovered</span></div><div><b>${findings.length}</b><span>Findings</span></div></div>${journeys.length?`<div class="journey-list"><h3>Navigation journeys discovered</h3>${journeys.map(j=>`<div><b>${esc(j.label)}</b><span>${esc(j.from)} → ${esc(j.href||'JS action')}</span></div>`).join('')}</div>`:''}${diagnostics.length?`<div class="journey-list"><h3>Page diagnostics</h3>${diagnostics.map(x=>`<div><b>${esc((x.status||'unknown').replaceAll('-',' '))}</b><span>${esc(x.url||'')} ${x.error?' · '+esc(x.error):` · ${x.fields||0} fields · ${x.actions||0} actions`}</span></div>`).join('')}</div>`:''}<p class="muted">${esc(d.notice)}</p>${findings.length?`<div class="issues">${findings.map(x=>`<div class="form-card"><b class="badge ${x.severity}">${x.severity}</b><h3>${esc(x.title)}</h3><p class="muted">${esc(x.detail)}</p><p><b>Suggested fix:</b> ${esc(x.fix)}</p><code>${esc(x.url)}</code></div>`).join('')}</div>`:''}<div class="flow-grid">${flows.map((f,i)=>`<article class="flow-card"><div class="flow-head"><div><span class="flow-type">${esc(f.type)}</span><h3>${esc(f.title||`Flow ${i+1}`)}</h3><code>${esc(f.page)}</code></div><b>${f.nativeForm?'Native form':'JS-controlled'}</b></div><h4>Fields</h4>${f.fields?.length?`<div class="flow-chips">${f.fields.map(x=>`<span>${esc(x.label||x.placeholder||x.name||x.id||x.type)} <small>${esc(x.type)}</small></span>`).join('')}</div>`:'<p class="muted">No input fields detected.</p>'}<h4>Actions</h4>${f.actions?.length?`<div class="flow-chips actions">${f.actions.map(a=>`<span>${esc(a.text||a.type||a.tag)}</span>`).join('')}</div>`:'<p class="muted">No matching action buttons detected.</p>'}<p class="flow-safe">Discovery only · no actions clicked</p><button class="active-qa-btn" data-page="${esc(f.page)}" type="button">Run validation QA</button><label class="sim-auth"><input type="checkbox" class="sim-auth-check"> I authorize WebDoctor to simulate clicking this flow's submit action. All write requests will be blocked.</label><button class="simulation-btn" data-page="${esc(f.page)}" type="button">Simulate submission safely</button><div class="active-qa-result"></div><div class="simulation-result"></div></article>`).join('')}</div>`;
}


document.addEventListener('click',async e=>{
  const btn=e.target.closest('.active-qa-btn'); if(!btn)return;
  if(!verificationSession?.verified)return alert('Verify website ownership first.');
  const card=btn.closest('.flow-card'), out=card.querySelector('.active-qa-result');
  btn.disabled=true; btn.textContent='Testing validation…'; out.innerHTML='<p class="muted">Running validation-only checks. No form will be submitted.</p>';
  try{
    const r=await fetch('/api/active-form-qa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id,pageUrl:btn.dataset.page})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||'Active QA failed'); renderActiveQa(out,d);
  }catch(err){out.innerHTML=`<p class="bad">${esc(err.message)}</p>`}finally{btn.disabled=false;btn.textContent='Run validation QA'}
});
function verdictHtml(v){
  if(!v)return '';
  const cls=v.status==='PASS'?'pass':v.status==='FAIL'?'fail':v.status==='NOT TESTED'?'not-tested':'attention';
  return `<div class="qa-verdict"><div class="qa-verdict-head"><b>QA Verdict</b><span class="qa-verdict-status ${cls}">${esc(v.status)}</span></div><div class="qa-verdict-grid"><span><b>${v.passed||0}</b>Passed</span><span><b>${v.warnings||0}</b>Warnings</span><span><b>${v.failed||0}</b>Failed</span><span><b>${v.notTested||0}</b>Not tested</span></div><div class="qa-priority"><b>Highest priority</b>${esc(v.priority||'No priority issue detected.')}</div><div class="qa-explain">${esc(v.scope||'')}</div></div>`;
}
function renderActiveQa(out,d){
  const t=d.totals||{};
  out.innerHTML=`${verdictHtml(d.verdict)}<div class="active-qa-head"><b>Validation QA</b><span>${d.testsRun||0} tests · ${d.fieldsTested||0} fields</span></div><div class="qa-totals"><span class="pass">✓ ${t.pass||0} pass</span><span class="warn">⚠ ${t.warning||0} warning</span><span class="bad">✕ ${t.fail||0} fail</span>${t.error?`<span class="bad">${t.error} errors</span>`:''}</div><p class="muted">${esc(d.notice||'')}</p>${(d.results||[]).map(r=>`<details class="qa-field"><summary><b>${esc(r.field.name||r.field.id||r.field.placeholder||r.field.type)}</b><span>${r.tests.length} tests</span></summary>${r.tests.map(x=>`<div class="qa-test ${x.result}"><b>${esc(x.label)}</b><span>${esc(x.result.toUpperCase())}</span><small>${x.message?esc(x.message):`Browser validity: ${x.valid===undefined?'—':x.valid?'valid':'invalid'}`}</small></div>`).join('')}</details>`).join('')}${d.consoleErrors?.length?`<details class="qa-field"><summary><b>Console errors observed</b><span>${d.consoleErrors.length}</span></summary>${d.consoleErrors.map(x=>`<code>${esc(x)}</code>`).join('')}</details>`:''}`;
}


document.addEventListener('click',async e=>{
  const btn=e.target.closest('.simulation-btn'); if(!btn)return;
  if(!verificationSession?.verified)return alert('Verify website ownership first.');
  const card=btn.closest('.flow-card'), check=card.querySelector('.sim-auth-check'), out=card.querySelector('.simulation-result');
  if(!check?.checked)return alert('Confirm owner authorization first.');
  btn.disabled=true; btn.textContent='Simulating…'; out.innerHTML='<p class="muted">Filling test data and clicking the action while blocking all write requests…</p>';
  try{const r=await fetch('/api/submission-simulation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id,pageUrl:btn.dataset.page,authorized:true})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Simulation failed');renderSimulation(out,d)}catch(err){out.innerHTML=`<p class="bad">${esc(err.message)}</p>`}finally{btn.disabled=false;btn.textContent='Simulate submission safely'}
});
function renderSimulation(out,d){
  if(!d.available){out.innerHTML=`<div class="simulation-box"><b>Simulation not run</b><p class="muted">${esc(d.reason||'Unavailable')}</p></div>`;return}
  out.innerHTML=`<div class="simulation-box">${verdictHtml(d.verdict)}<div class="active-qa-head"><b>Safe submission simulation</b><span>Write network blocked ✓</span></div><p>${esc(d.notice||'')}</p><div class="qa-totals"><span class="pass">Action: ${esc(d.actionText||'Submit')}</span><span>Blocked write requests: ${(d.attemptedRequests||[]).length}</span><span>Validation messages: ${(d.validation||[]).length}</span></div>${d.beforeScreenshot&&d.afterScreenshot?`<div class="shots"><a href="${d.beforeScreenshot}" target="_blank"><img src="${d.beforeScreenshot}" alt="Before simulation"><span>Before</span></a><a href="${d.afterScreenshot}" target="_blank"><img src="${d.afterScreenshot}" alt="After simulation"><span>After</span></a></div>`:''}${(d.attemptedRequests||[]).length?`<details class="qa-field"><summary><b>Intercepted write requests</b><span>${d.attemptedRequests.length}</span></summary>${d.attemptedRequests.map(x=>`<code>${esc(x.method)} ${esc(x.url)}</code>`).join('')}</details>`:''}${(d.validation||[]).length?`<details class="qa-field"><summary><b>Validation observed</b><span>${d.validation.length}</span></summary>${d.validation.map(x=>`<p><b>${esc(x.name)}</b> · ${esc(x.message||'invalid')}</p>`).join('')}</details>`:''}</div>`;
}

// v1.4 owner-verified Capacity Lab
function syncCapacityTarget(){ if(lastReport?.target && !$('#capacity-url').value) $('#capacity-url').value=lastReport.target; }
const oldShowVerifiedProject=showVerifiedProject;
showVerifiedProject=function(v){ oldShowVerifiedProject(v); $('#capacity-lab').classList.remove('hidden'); syncCapacityTarget(); };
$('#run-capacity').addEventListener('click',async()=>{
  if(!verificationSession?.verified)return alert('Verify website ownership first.');
  if(!$('#capacity-auth').checked)return alert('Confirm owner authorization first.');
  const btn=$('#run-capacity'),out=$('#capacity-results'); btn.disabled=true;btn.textContent='Running capacity test…';out.innerHTML='<p class="muted">Running a controlled GET-only probe. WebDoctor will stop automatically if the error rate becomes excessive.</p>';
  try{const r=await fetch('/api/capacity-lab',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id,pageUrl:$('#capacity-url').value.trim()||lastReport?.target,users:Number($('#capacity-users').value),durationSeconds:Number($('#capacity-duration').value),authorized:true})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Capacity test failed');renderCapacity(d)}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`}finally{btn.disabled=false;btn.textContent='Start Capacity Test'}
});
function renderCapacity(d){
 const cls=d.verdict==='PASS'?'pass':d.verdict==='FAIL'?'fail':'attention';
 $('#capacity-results').innerHTML=`<div class="capacity-result"><div class="qa-verdict-head"><b>Capacity Verdict</b><span class="qa-verdict-status ${cls}">${esc(d.verdict)}</span></div><p><code>${esc(d.target)}</code></p><div class="capacity-metrics"><span><b>${d.users}</b>Virtual users</span><span><b>${d.requests}</b>Requests</span><span><b>${d.requestsPerSecond}</b>Req/sec</span><span><b>${d.avgMs} ms</b>Average</span><span><b>${d.p95Ms} ms</b>p95</span><span><b>${d.errorRate}%</b>Errors</span></div><p><b>Duration:</b> ${d.durationActual}s · <b>Successful:</b> ${d.successful} · <b>Errors:</b> ${d.errors}</p>${d.aborted?`<p class="bad"><b>Automatically stopped:</b> ${esc(d.abortReason)}</p>`:''}<p class="muted">${esc(d.scope)} ${esc(d.limits)}</p><details class="qa-field"><summary><b>HTTP status counts</b></summary>${Object.entries(d.statusCounts||{}).map(([k,v])=>`<code>${esc(k)} → ${v}</code>`).join('')||'<p>No HTTP responses recorded.</p>'}</details></div>`;
}


// v1.5 automatic stepped capacity test + persistent history
$('#run-stepped-capacity').addEventListener('click',async()=>{
 if(!verificationSession?.verified)return alert('Verify website ownership first.');
 if(!$('#capacity-auth').checked)return alert('Confirm owner authorization first.');
 const btn=$('#run-stepped-capacity'),out=$('#capacity-results');btn.disabled=true;btn.textContent='Running stepped test…';out.innerHTML='<p class="muted">Testing 5 → 10 → 25 → 50 virtual users. Each stage lasts 10 seconds and may stop early for safety.</p>';
 try{const r=await fetch('/api/capacity-lab',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id,pageUrl:$('#capacity-url').value.trim()||lastReport?.target,mode:'stepped',authorized:true})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Stepped test failed');renderSteppedCapacity(d)}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`}finally{btn.disabled=false;btn.textContent='Run Auto Stepped Test'}
});
function renderSteppedCapacity(d){const cls=d.verdict==='PASS'?'pass':d.verdict==='FAIL'?'fail':'attention';$('#capacity-results').innerHTML=`<div class="capacity-result"><div class="qa-verdict-head"><b>Stepped Capacity Verdict</b><span class="qa-verdict-status ${cls}">${esc(d.verdict)}</span></div><p><b>Estimated healthy tested level:</b> ${d.estimatedHealthy||0} virtual users</p>${d.stopReason?`<p class="bad">${esc(d.stopReason)}</p>`:''}<div class="tablewrap"><table class="capacity-stage-table"><thead><tr><th>Users</th><th>Baseline</th><th>Average</th><th>p95</th><th>Errors</th><th>Req/sec</th><th>Verdict</th></tr></thead><tbody>${(d.stages||[]).map(x=>`<tr><td>${x.users}</td><td>${x.baselineMs??'—'} ms</td><td>${x.avgMs} ms</td><td>${x.p95Ms} ms</td><td>${x.errorRate}%</td><td>${x.requestsPerSecond}</td><td>${esc(x.verdict)}</td></tr>`).join('')}</tbody></table></div><p class="muted">${esc(d.scope||'')}</p></div>`}
$('#load-capacity-history').addEventListener('click',async()=>{if(!verificationSession?.verified)return alert('Verify website ownership first.');const out=$('#capacity-results');try{const r=await fetch('/api/capacity-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load history');renderCapacityHistory(d.history||[])}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`}});
function renderCapacityHistory(rows){$('#capacity-results').innerHTML=`<div class="capacity-result capacity-history"><div class="qa-verdict-head"><b>Capacity History</b><span>${rows.length} saved runs</span></div>${rows.length?rows.map(x=>{const stepped=x.mode==='stepped';const last=stepped?(x.stages||[]).at(-1):x;return `<div class="capacity-history-row"><b>${new Date(x.createdAt).toLocaleString()}</b><span>${stepped?'AUTO':(x.users+' users')}</span><span>${last?.avgMs??'—'} ms avg</span><span>${last?.p95Ms??'—'} ms p95</span><span>${last?.errorRate??'—'}% errors</span><span>${esc(x.verdict||'')}</span></div>`}).join(''):'<p class="muted">No capacity runs saved yet.</p>'}</div>`}

// v1.6 read-only multi-page Journey Load
function seedJourneyUrls(){const el=$('#journey-capacity-urls');if(!el||el.value.trim()||!lastReport)return;const urls=[lastReport.target,...(lastReport.pages||[]).map(p=>p.url)].filter(Boolean);el.value=[...new Set(urls)].slice(0,5).join('\n');}
const v16OldSync=syncCapacityTarget;syncCapacityTarget=function(){v16OldSync();seedJourneyUrls();};

$('#use-discovered-journeys').addEventListener('click',()=>{const el=$('#journey-capacity-urls');const origin=verificationSession?.origin;if(!origin)return alert('Scan and verify the website first.');const urls=[lastReport?.target,...discoveredJourneyUrls].filter(Boolean).filter(u=>{try{return new URL(u,origin).origin===new URL(origin).origin}catch{return false}});const unique=[...new Set(urls.map(u=>new URL(u,origin).href))].slice(0,5);if(unique.length<2)return alert('WebDoctor has not discovered at least 2 same-origin pages yet. Run Discover Smart Journeys first.');el.value=unique.join('\n');});

$('#run-journey-capacity').addEventListener('click',async()=>{
 if(!verificationSession?.verified)return alert('Verify website ownership first.');
 if(!$('#capacity-auth').checked)return alert('Confirm owner authorization first.');
 const pageUrls=$('#journey-capacity-urls').value.split(/\n+/).map(x=>x.trim()).filter(Boolean);if(pageUrls.length<2)return alert('Add at least 2 read-only journey pages.');
 const btn=$('#run-journey-capacity'),out=$('#journey-capacity-results');btn.disabled=true;btn.textContent='Running journey load…';out.innerHTML='<p class="muted">Rotating workers through the selected read-only pages under the global safety cap…</p>';
 try{const r=await fetch('/api/journey-capacity-lab',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id,pageUrls,users:Number($('#journey-capacity-users').value),durationSeconds:Number($('#journey-capacity-duration').value),authorized:true})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Journey Load failed');renderJourneyCapacity(d)}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`}finally{btn.disabled=false;btn.textContent='Run Journey Load Test'}
});
function renderJourneyCapacity(d){const cls=d.verdict==='PASS'?'pass':d.verdict==='FAIL'?'fail':'attention';const routeCls=d.routeHealth==='PASS'?'pass':'attention';$('#journey-capacity-results').innerHTML=`<div class="capacity-result"><div class="qa-verdict-head"><b>Route pre-flight</b><span class="qa-verdict-status ${routeCls}">${esc(d.routeHealth||'UNKNOWN')}</span></div><p class="muted">${esc(d.notice||'')}</p><div class="tablewrap"><table class="capacity-stage-table"><thead><tr><th>Page</th><th>HTTP</th><th>Browser</th><th>Baseline</th><th>Pre-flight</th></tr></thead><tbody>${(d.preflight||[]).map(x=>`<tr><td title="${esc(x.url)}">${esc(new URL(x.url).pathname||'/')}</td><td>${x.status??'—'}</td><td>${esc(x.browserState||'NOT CHECKED')}</td><td>${x.baselineMs==null?'—':x.baselineMs+' ms'}</td><td>${x.ok?'READY':(x.browserRendered?'SPA · NOT HTTP-LOADABLE':'EXCLUDED')+' · '+esc(x.reason||'unhealthy')}</td></tr>`).join('')}</tbody></table></div><div class="qa-verdict-head"><b>Journey Load Verdict</b><span class="qa-verdict-status ${cls}">${esc(d.verdict)}</span></div>${d.verdict==='NOT DETERMINED'?`<p class="bad">Load test not started. Fix or replace the unhealthy routes, then run again.</p>`:`<div class="capacity-metrics"><span><b>${d.users}</b>Workers</span><span><b>${d.requests}</b>Requests</span><span><b>${d.requestsPerSecond}</b>Req/sec</span><span><b>${d.avgMs} ms</b>Average</span><span><b>${d.p95Ms} ms</b>p95</span><span><b>${d.errorRate}%</b>Load errors</span></div>${d.aborted?`<p class="bad"><b>Automatically stopped:</b> ${esc(d.abortReason)}</p>`:''}<div class="tablewrap"><table class="capacity-stage-table"><thead><tr><th>Loaded page</th><th>Baseline</th><th>Average</th><th>p95</th><th>Errors</th><th>Requests</th></tr></thead><tbody>${(d.pages||[]).map(x=>`<tr><td title="${esc(x.url)}">${esc(new URL(x.url).pathname||'/')}</td><td>${x.baselineMs??'—'} ms</td><td>${x.avgMs} ms</td><td>${x.p95Ms} ms</td><td>${x.errorRate}%</td><td>${x.requests}</td></tr>`).join('')}</tbody></table></div>`}<p class="muted">${esc(d.scope)} ${esc(d.limits)}</p></div>`;}

// v2.0 project history + regression intelligence
const v20OldShowVerifiedProject=showVerifiedProject;
showVerifiedProject=function(v){v20OldShowVerifiedProject(v);$('#project-intelligence').classList.remove('hidden');};
$('#load-scan-history').addEventListener('click',async()=>{const out=$('#project-intelligence-results');if(!verificationSession?.verified)return alert('Verify website ownership first.');out.innerHTML='<p class="muted">Loading saved scans…</p>';try{const r=await fetch('/api/project-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load scan history');const h=d.history||[];out.innerHTML=`<div class="capacity-result"><div class="qa-verdict-head"><b>Scan History</b><span>${h.length} saved scans</span></div>${h.length?`<div class="tablewrap"><table class="capacity-stage-table"><thead><tr><th>Scanned</th><th>Health</th><th>Issues</th><th>High</th><th>Medium</th><th>Pages</th></tr></thead><tbody>${h.map(x=>`<tr><td>${new Date(x.createdAt).toLocaleString()}</td><td>${x.summary?.score??'—'}/100</td><td>${x.summary?.issues??'—'}</td><td>${x.summary?.high??0}</td><td>${x.summary?.medium??0}</td><td>${x.summary?.pages??x.pages?.length??'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No saved scans yet. Run this website scan twice to unlock regression comparison.</p>'}</div>`}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`}});
$('#run-regression').addEventListener('click',async()=>{const out=$('#project-intelligence-results');if(!verificationSession?.verified)return alert('Verify website ownership first.');out.innerHTML='<p class="muted">Comparing latest scans…</p>';try{const r=await fetch('/api/regression',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Regression comparison failed');if(!d.available){out.innerHTML='<div class="capacity-result"><b>Regression not ready</b><p class="muted">Run at least two scans of this verified website. WebDoctor will then compare them automatically.</p></div>';return}const delta=d.scoreDelta||0;const verdict=delta>0?'IMPROVED':delta<0?'REGRESSED':'UNCHANGED';const cls=delta>0?'pass':delta<0?'fail':'attention';const issueList=(arr,empty)=>arr?.length?arr.slice(0,10).map(i=>`<li><b>${esc(i.title)}</b> <span class="muted">${esc(i.severity||'')}</span></li>`).join(''):`<li class="muted">${empty}</li>`;out.innerHTML=`<div class="capacity-result"><div class="qa-verdict-head"><b>Regression Verdict</b><span class="qa-verdict-status ${cls}">${verdict}</span></div><div class="capacity-metrics"><span><b>${d.previous.summary?.score??'—'} → ${d.current.summary?.score??'—'}</b>Health score</span><span><b>${delta>0?'+':''}${delta}</b>Score change</span><span><b>${d.previous.summary?.issues??0} → ${d.current.summary?.issues??0}</b>Issues</span><span><b>${d.fixed.length}</b>Fixed</span><span><b>${d.newIssues.length}</b>New</span><span><b>${d.unchanged.length}</b>Unchanged</span></div><div class="regression-grid"><div><h4>✓ Fixed</h4><ul>${issueList(d.fixed,'No fixed findings detected.')}</ul></div><div><h4>⚠ New problems</h4><ul>${issueList(d.newIssues,'No new findings detected.')}</ul></div><div><h4>• Unchanged</h4><ul>${issueList(d.unchanged,'No unchanged findings.')}</ul></div></div><p class="muted">Compared ${new Date(d.previous.createdAt).toLocaleString()} with ${new Date(d.current.createdAt).toLocaleString()}.</p></div>`}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`}});

// v2.1 productized project navigation
let activeProjectTab='overview';
function projectTabNodes(){
 const results=$('#results'); if(!results)return {};
 const titles=[...results.querySelectorAll('.section-title')];
 return {
  overview:[$('#launch-dashboard'),results.querySelector('.results-head'),$('#stats'),$('#categories'),$('#score-breakdown'),titles.find(x=>x.textContent.includes('Pages scanned')),results.querySelector('.tablewrap:last-child')].filter(Boolean),
  issues:[titles.find(x=>x.textContent.includes('Issues to investigate')),$('#issues')].filter(Boolean),
  browser:[$('#browser-section')].filter(Boolean),
  deepqa:[$('#formqa')].filter(Boolean),
  capacity:[$('#capacity-lab')].filter(Boolean),
  regression:[$('#project-intelligence')].filter(Boolean)
 };
}
function setProjectTab(tab){
 activeProjectTab=tab; const map=projectTabNodes();
 Object.values(map).flat().forEach(n=>n&&n.classList.add('product-panel-hidden'));
 (map[tab]||[]).forEach(n=>{
   if(!n)return;
   n.classList.remove('product-panel-hidden');
   // Standalone workspaces start life with .hidden. Selecting their tab must
   // reveal them as well as removing the product-level visibility class.
   if(['investigator','report','deepqa','capacity','regression'].includes(tab)) n.classList.remove('hidden');
 });
 // Ownership verification belongs with Deep QA, not the client-facing report.
 $('#verification')?.classList.toggle('product-panel-hidden',tab!=='deepqa');
 // Product shortcuts are useful on Overview only; other tabs stay focused.
 $('#module-shortcuts')?.classList.toggle('product-panel-hidden',tab!=='overview');
 $('#project-nav')?.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='report') v33RenderReport?.();
 window.scrollTo({top:$('#project-nav')?.offsetTop-10||0,behavior:'smooth'});
}
$('#project-nav')?.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)setProjectTab(b.dataset.tab)});
function updateProjectOverview(){
 if(!lastReport)return; const card=$('#project-overview-card'),nav=$('#project-nav'); nav?.classList.remove('hidden');card?.classList.remove('hidden');
 const issues=lastReport.issues||[], high=issues.filter(x=>x.severity==='high'||x.severity==='critical').length;
 card.innerHTML=`<div class="project-main"><p class="eyebrow">CURRENT PROJECT</p><div class="project-domain">${esc(lastReport.target||'')}</div><p class="muted">${verificationSession?.verified?'✓ Verified website':'Public audit'} · Latest scan ${new Date(lastReport.scannedAt||Date.now()).toLocaleString()}</p></div><div class="mini"><b>${lastReport.summary?.score??lastReport.score??'—'}</b><span>Health / 100</span></div><div class="mini"><b>${issues.length}</b><span>Open findings</span></div><div class="mini"><b>${high}</b><span>High priority</span></div>`;
 setProjectTab(activeProjectTab);
}
const v21OldRender=render; render=function(d){v21OldRender(d);setTimeout(updateProjectOverview,0);};
const v21OldShowVerifiedProject=showVerifiedProject;showVerifiedProject=function(v){v21OldShowVerifiedProject(v);setTimeout(updateProjectOverview,0)};

// v2.3 AI Investigator — free local evidence-based diagnosis
function investigatorIssueOptions(){
 const select=$('#investigator-issue');if(!select||!lastReport)return;
 const previous=select.value;select.innerHTML='<option value="">Select a finding…</option>'+(lastReport.issues||[]).map((x,i)=>`<option value="${i}">${esc((x.severity||'low').toUpperCase())} · ${esc(x.title||'Finding')}</option>`).join('');
 if(previous&&select.querySelector(`option[value="${previous}"]`))select.value=previous;
}
function renderInvestigation(a){
 const snippets=(a.snippets||[]).map(s=>`<div class="investigator-code"><div>${esc((s.language||'code').toUpperCase())}</div><pre><code>${esc(s.value||'')}</code></pre></div>`).join('');
 const list=(items)=>`<ol>${(items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;
 return `<article class="investigation-card"><div class="investigation-head"><div><span class="severity ${esc(a.issue?.severity||'low')}">${esc(a.issue?.severity||'low')}</span><h3>${esc(a.issue?.title||'Finding')}</h3><p class="muted">${esc(a.issue?.url||'')}</p></div><div class="investigator-priority"><b>${esc(a.priority||'')}</b><span>${esc((a.confidence||'low').toUpperCase())} confidence</span></div></div><div class="investigation-grid"><section><h4>What likely happened</h4><p>${esc(a.cause||'')}</p></section><section><h4>Why it matters</h4><p>${esc(a.impact||'')}</p></section><section><h4>Recommended fix</h4>${list(a.fixes)}</section><section><h4>How to verify</h4>${list(a.verify)}</section></div>${snippets?`<div class="investigator-snippets"><h4>Implementation example</h4>${snippets}</div>`:''}<details><summary>Evidence boundary</summary><p class="muted">${esc(a.disclaimer||'')}</p>${a.issue?.detail?`<p><b>Observed evidence:</b> ${esc(a.issue.detail)}</p>`:''}</details></article>`;
}
async function callInvestigator(payload){
 const r=await fetch('/api/investigator',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Investigation failed');return d;
}
$('#investigate-one')?.addEventListener('click',async()=>{if(!lastReport)return alert('Run a website scan first.');const idx=Number($('#investigator-issue').value);if(!Number.isInteger(idx)||!lastReport.issues?.[idx])return alert('Select a finding first.');const out=$('#investigator-results');out.innerHTML='<p class="muted">Investigating WebDoctor evidence locally…</p>';try{const d=await callInvestigator({issue:lastReport.issues[idx]});out.innerHTML=`<div class="investigator-provider">${esc(d.provider)} · ${esc(d.cost)} · no external API used</div>${renderInvestigation(d.analysis)}`}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`}});
$('#investigate-top')?.addEventListener('click',async()=>{if(!lastReport?.issues?.length)return alert('Run a website scan with findings first.');const out=$('#investigator-results');out.innerHTML='<p class="muted">Prioritizing and investigating the highest-severity findings…</p>';try{const d=await callInvestigator({mode:'report',issues:lastReport.issues,limit:5});out.innerHTML=`<div class="investigator-provider">${esc(d.provider)} · ${esc(d.cost)} · top ${d.analyses.length} findings</div>${d.analyses.map(renderInvestigation).join('')}`}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`}});
const v23OldUpdateProjectOverview=updateProjectOverview;updateProjectOverview=function(){v23OldUpdateProjectOverview();investigatorIssueOptions();};
const v23OldProjectTabNodes=projectTabNodes;projectTabNodes=function(){const map=v23OldProjectTabNodes();map.investigator=[$('#ai-investigator')].filter(Boolean);return map;};

// v3.0 launch dashboard — trends, next action and report export
function v30NextAction(){
 if(!lastReport)return;
 const issues=[...(lastReport.issues||[])];
 const weight={critical:4,high:3,medium:2,low:1};issues.sort((a,b)=>(weight[b.severity]||0)-(weight[a.severity]||0));
 const top=issues[0], box=$('#next-action'); if(!box)return;
 box.innerHTML=top?`<strong>${esc(top.title)}</strong><span>${esc(top.fix||'Investigate this finding, deploy the fix, then rerun Regression.')}</span>`:'<strong>No open findings</strong><span>Run Regression after your next deployment to make sure the site stays healthy.</span>';
}
async function v30Trend(){
 const panel=$('#launch-dashboard'),out=$('#health-trend'),cap=$('#trend-caption'); if(!panel||!lastReport)return;panel.classList.remove('hidden');v30NextAction();
 if(!verificationSession?.verified){out.innerHTML='<p class="muted">Verify this website to save scans and unlock health trends.</p>';return}
 try{const r=await fetch('/api/project-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error();const h=(d.history||[]).slice(-8);cap.textContent=`${h.length} saved scan${h.length===1?'':'s'}`;if(h.length<2){out.innerHTML='<p class="muted">Run one more scan to unlock a health trend.</p>';return}const W=620,H=150,pad=24;const vals=h.map(x=>Number(x.summary?.score??0));const min=Math.max(0,Math.min(...vals)-8),max=Math.min(100,Math.max(...vals)+8);const den=Math.max(1,max-min);const pts=vals.map((v,i)=>[pad+i*(W-pad*2)/Math.max(1,vals.length-1),H-pad-(v-min)*(H-pad*2)/den]);out.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Health score trend"><line class="grid" x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}"/><line class="grid" x1="${pad}" y1="${pad}" x2="${W-pad}" y2="${pad}"/><polyline class="line" points="${pts.map(p=>p.join(',')).join(' ')}"/>${pts.map((p,i)=>`<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4"/><text x="${p[0]-7}" y="${p[1]-9}">${vals[i]}</text>`).join('')}</svg>`}catch{out.innerHTML='<p class="muted">Health history could not be loaded right now.</p>'}
}
$('#quick-rescan')?.addEventListener('click',()=>$('#scan-form')?.requestSubmit());
$('#print-report')?.addEventListener('click',()=>window.print());
const v30OldUpdate=updateProjectOverview;updateProjectOverview=function(){v30OldUpdate();setTimeout(v30Trend,0)};
// Clarify priority vs diagnostic confidence in Investigator cards.
const v30OldInvestigation=renderInvestigation;renderInvestigation=function(a){return v30OldInvestigation(a).replace(`<div class="investigator-priority"><b>${esc(a.priority||'')}</b><span>${esc((a.confidence||'low').toUpperCase())} confidence</span></div>`,`<div class="investigator-priority priority-confidence"><span>Priority: <b>${esc(a.priority||'')}</b></span><span class="confidence">Diagnosis confidence: <b>${esc((a.confidence||'low').toUpperCase())}</b></span></div>`)};


// v3.1 multi-project workspace foundation
async function loadProjectsWorkspace(){
 const list=$('#project-list'); if(!list)return;
 try{
  const r=await fetch('/api/projects'); const d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not load projects');
  const projects=(d.projects||[]).filter(p=>p.verified);
  if(!projects.length){list.innerHTML='<div class="workspace-empty"><b>No verified projects yet</b><span>Scan a website and verify ownership once. It will then appear here automatically.</span></div>';return;}
  list.innerHTML=projects.map(p=>{const s=p.latest?.summary||{};return `<article class="workspace-project" data-origin="${esc(p.origin)}"><div class="workspace-project-main"><span class="workspace-status">✓ VERIFIED</span><h3>${esc(p.hostname)}</h3><p>${esc(p.origin)}</p><small>${p.latest?`Last scan ${new Date(p.latest.createdAt).toLocaleString()}`:'Verified · no saved scan yet'}</small></div><div class="workspace-metric"><b>${s.score??'—'}</b><span>Health</span></div><div class="workspace-metric"><b>${s.issues??'—'}</b><span>Issues</span></div><div class="workspace-project-actions"><button type="button" data-open-project="${esc(p.origin)}">Open / scan</button></div></article>`}).join('');
 }catch(e){list.innerHTML=`<p class="bad">${esc(e.message)}</p>`}
}
$('#refresh-projects')?.addEventListener('click',loadProjectsWorkspace);
$('#project-list')?.addEventListener('click',e=>{const b=e.target.closest('[data-open-project]');if(!b)return;const origin=b.dataset.openProject;const input=$('#url');input.value=origin.replace(/^https?:\/\//i,'');window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>$('#scan-form')?.requestSubmit(),250)});
const v31OldRender=render;render=function(d){v31OldRender(d);setTimeout(loadProjectsWorkspace,0)};
const v31OldShowVerified=showVerifiedProject;showVerifiedProject=function(v){v31OldShowVerified(v);setTimeout(loadProjectsWorkspace,0)};
loadProjectsWorkspace();

// v3.2 focused dashboard + workspace navigation
(function(){
 const oldProjectTabNodes=projectTabNodes;
 projectTabNodes=function(){
   const map=oldProjectTabNodes();
   const results=$('#results');
   if(!results)return map;
   const titles=[...results.querySelectorAll('.section-title')];
   const scanHead=results.querySelector('.results-head');
   const pagesTitle=titles.find(x=>x.textContent.includes('Pages scanned'));
   const pagesTable=results.querySelector('.tablewrap:last-child');
   // Overview is intentionally concise: project identity + pulse are global/overview UI.
   map.overview=[$('#launch-dashboard')].filter(Boolean);
   // The complete audit score and findings live together in Issues.
   map.issues=[scanHead,$('#stats'),$('#categories'),$('#score-breakdown'),titles.find(x=>x.textContent.includes('Issues to investigate')),$('#issues')].filter(Boolean);
   // Discovery belongs with rendered browser evidence.
   map.browser=[$('#browser-section'),pagesTitle,pagesTable].filter(Boolean);
   // Ownership + safe active QA belong together.
   map.deepqa=[$('#verification'),$('#formqa')].filter(Boolean);
   return map;
 };
 const oldSetProjectTab=setProjectTab;
 setProjectTab=function(tab){
   oldSetProjectTab(tab);
   // v2.x treated verification as Overview; v3.2 makes it part of Deep QA.
   $('#verification')?.classList.toggle('product-panel-hidden',tab!=='deepqa');
 };

 const workspace=$('#projects-workspace'), toggle=$('#toggle-projects');
 function setWorkspaceCompact(compact){
   if(!workspace||!toggle)return;
   workspace.classList.toggle('compact',compact);
   toggle.textContent=compact?'Show websites':'Collapse';
   toggle.setAttribute('aria-expanded',String(!compact));
 }
 toggle?.addEventListener('click',()=>setWorkspaceCompact(!workspace.classList.contains('compact')));

 // Once a project is active, keep the website switcher available without consuming the page.
 const oldUpdate=updateProjectOverview;
 updateProjectOverview=function(){
   oldUpdate();
   if(lastReport)setWorkspaceCompact(true);
 };

 function openModule(tab){
   if(!lastReport){document.querySelector('#url')?.focus();return;}
   setProjectTab(tab);
 }
 $('#module-shortcuts')?.addEventListener('click',e=>{const card=e.target.closest('[data-module-tab]');if(card)openModule(card.dataset.moduleTab)});
 $('#module-shortcuts')?.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const card=e.target.closest('[data-module-tab]');if(card){e.preventDefault();openModule(card.dataset.moduleTab)}});
})();

// v3.3 shareable Website Health Report
function v33SeverityCounts(){
 const counts={critical:0,high:0,medium:0,low:0};
 for(const x of lastReport?.issues||[]) if(counts[x.severity]!==undefined) counts[x.severity]++;
 return counts;
}
function v33ReportHtml(){
 if(!lastReport)return '<p class="muted">Run a scan to generate the report.</p>';
 const issues=[...(lastReport.issues||[])];
 const rank={critical:4,high:3,medium:2,low:1};issues.sort((a,b)=>(rank[b.severity]||0)-(rank[a.severity]||0));
 const c=v33SeverityCounts(), score=lastReport.summary?.score??lastReport.score??'—';
 const cats=lastReport.categories||lastReport.summary?.categories||{};
 const categoryRows=Object.entries(cats).filter(([,v])=>typeof v==='number').map(([k,v])=>`<div class="report-category"><span>${esc(k.replace(/(^.|_.)/g,m=>m.replace('_',' ').toUpperCase()))}</span><b>${v}/100</b></div>`).join('');
 const top=issues.slice(0,6).map((x,i)=>`<article class="report-finding"><div class="report-finding-num">${i+1}</div><div><div class="report-finding-head"><b>${esc(x.title||'Finding')}</b><span class="severity ${esc(x.severity||'low')}">${esc(x.severity||'low')}</span></div><p>${esc(x.detail||x.why||'WebDoctor detected an issue that should be reviewed.')}</p><p class="report-fix"><b>Recommended action:</b> ${esc(x.fix||'Investigate, deploy a fix, then rerun WebDoctor to verify the change.')}</p>${x.url?`<small>${esc(x.url)}</small>`:''}</div></article>`).join('');
 const positives=[]; if(c.critical===0)positives.push('No critical findings detected.'); if((lastReport.browser?.pages||[]).length)positives.push('Real-browser QA completed with rendered-page evidence.'); if(verificationSession?.verified)positives.push('Website ownership is verified, enabling deeper QA and regression tracking.');
 const status=Number(score)>=90?'Strong':Number(score)>=75?'Needs attention':'At risk';
 return `<div class="client-report"><header class="client-report-hero"><div><p class="eyebrow">WEBSITE HEALTH REPORT</p><h1>${esc(lastReport.target||'Website')}</h1><p>Generated ${new Date(lastReport.scannedAt||Date.now()).toLocaleString()} · WebDoctor v3.4</p></div><div class="report-score"><b>${score}</b><span>/100</span><small>${status}</small></div></header><section class="report-summary"><div><b>${issues.length}</b><span>Open findings</span></div><div><b>${c.critical+c.high}</b><span>High priority</span></div><div><b>${lastReport.pages?.length||lastReport.summary?.pages||0}</b><span>Pages scanned</span></div><div><b>${verificationSession?.verified?'Verified':'Public'}</b><span>Audit scope</span></div></section><section class="report-block"><h2>Executive summary</h2><p>WebDoctor scored this website <b>${score}/100</b>. The audit found <b>${issues.length}</b> item${issues.length===1?'':'s'} to review, including <b>${c.critical+c.high}</b> high-priority finding${c.critical+c.high===1?'':'s'}. Address the highest-priority items first, then rerun the scan and use Regression to confirm the improvement.</p>${positives.length?`<div class="report-positive">${positives.map(x=>`<span>✓ ${esc(x)}</span>`).join('')}</div>`:''}</section>${categoryRows?`<section class="report-block"><h2>Health by category</h2><div class="report-categories">${categoryRows}</div></section>`:''}<section class="report-block"><h2>Priority findings</h2>${top||'<p>No open findings were detected in this scan.</p>'}</section><section class="report-block report-scope"><h2>What this report means</h2><p>This report summarizes evidence WebDoctor observed from public HTTP checks, browser QA and enabled verified-owner modules. A PASS only covers the behavior actually tested; untested server-side or authenticated behavior is not implied to be healthy.</p></section><footer class="report-footer">Generated by WebDoctor · Retest after fixes to prove improvement with Regression.</footer></div>`;
}
function v33RenderReport(){const el=$('#health-report-content');if(el)el.innerHTML=v33ReportHtml()}
$('#refresh-health-report')?.addEventListener('click',v33RenderReport);
$('#print-health-report')?.addEventListener('click',()=>{v33RenderReport();document.body.classList.add('printing-health-report');window.print();setTimeout(()=>document.body.classList.remove('printing-health-report'),500)});
$('#download-health-html')?.addEventListener('click',()=>{if(!lastReport)return alert('Run a scan first.');const css=`body{font-family:Arial,sans-serif;max-width:980px;margin:40px auto;color:#172033;padding:0 20px}h1{word-break:break-all}.score{font-size:52px;font-weight:800}.finding{border-top:1px solid #ddd;padding:16px 0}.sev{text-transform:uppercase;font-size:11px;font-weight:bold}.meta{color:#667085}.summary{display:flex;gap:30px;flex-wrap:wrap}.summary b{font-size:24px;display:block}`;const issues=[...(lastReport.issues||[])];const c=v33SeverityCounts(),score=lastReport.summary?.score??lastReport.score??'—';const body=`<h1>Website Health Report</h1><p class="meta">${esc(lastReport.target||'')} · ${new Date(lastReport.scannedAt||Date.now()).toLocaleString()}</p><div class="score">${score}/100</div><div class="summary"><span><b>${issues.length}</b>Open findings</span><span><b>${c.critical+c.high}</b>High priority</span><span><b>${lastReport.pages?.length||0}</b>Pages scanned</span></div><h2>Priority findings</h2>${issues.slice(0,10).map(x=>`<div class="finding"><span class="sev">${esc(x.severity||'low')}</span><h3>${esc(x.title||'Finding')}</h3><p>${esc(x.detail||'')}</p><p><b>Recommended action:</b> ${esc(x.fix||'Review and retest.')}</p></div>`).join('')}<p class="meta">Generated by WebDoctor v3.4. Retest after fixes to verify improvement.</p>`;const blob=new Blob([`<!doctype html><meta charset="utf-8"><title>WebDoctor Health Report</title><style>${css}</style>${body}`],{type:'text/html'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`webdoctor-health-report-${new URL(lastReport.target).hostname}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
const v33OldNodes=projectTabNodes;projectTabNodes=function(){const map=v33OldNodes();map.report=[$('#health-report')].filter(Boolean);return map};
const v33OldUpdate=updateProjectOverview;updateProjectOverview=function(){v33OldUpdate();v33RenderReport()};

// v3.4.1 interaction feedback: operation-bound loading + animated accordions
(function(){
 const asyncIds=new Set(['verify-start','verify-check','run-formqa','run-capacity','run-stepped-capacity','load-capacity-history','run-journey-capacity','load-scan-history','run-regression','investigate-one','investigate-top','refresh-projects']);
 let clickAction=null;
 const markBusy=b=>{if(!b)return;b.classList.add('is-loading');b.setAttribute('aria-busy','true')};
 const clearBusy=b=>{if(!b)return;b.classList.remove('is-loading');b.removeAttribute('aria-busy')};
 // Associate loading with a real network operation. A click that exits early (validation,
 // missing verification, etc.) is cleared immediately instead of getting stuck.
 document.addEventListener('click',e=>{
   const b=e.target.closest('button');
   if(!b||!(asyncIds.has(b.id)||b.matches('.active-qa-btn,.simulation-btn')))return;
   clickAction={button:b,fetchStarted:false};
   markBusy(b);
   setTimeout(()=>{if(clickAction?.button===b&&!clickAction.fetchStarted){clearBusy(b);clickAction=null}},0);
 },true);
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async function(...args){
   const action=clickAction;
   const b=action?.button||null;
   if(action)action.fetchStarted=true;
   if(b)markBusy(b);
   try{return await nativeFetch(...args)}
   finally{
     if(b)clearBusy(b);
     if(clickAction===action)clickAction=null;
   }
 };
 // Safety net: no loading indicator can survive a completed/abandoned operation forever.
 document.addEventListener('click',e=>{
   const b=e.target.closest('button.is-loading');
   if(!b)return;
   setTimeout(()=>{if(b.classList.contains('is-loading')&&!b.disabled)clearBusy(b)},30000);
 },false);

 // Animate native <details> without changing its accessible semantics.
 document.addEventListener('click',e=>{const s=e.target.closest('details > summary');if(!s)return;const d=s.parentElement;if(d.dataset.wdAnimating==='1')return;e.preventDefault();const opening=!d.open;const start=d.getBoundingClientRect().height;if(opening)d.open=true;const end=opening?d.scrollHeight:s.getBoundingClientRect().height;d.dataset.wdAnimating='1';d.classList.add('wd-accordion-animating');d.style.height=start+'px';const anim=d.animate([{height:start+'px',opacity:opening?.82:1},{height:end+'px',opacity:opening?1:.88}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});anim.onfinish=()=>{if(!opening)d.open=false;d.style.height='';d.classList.remove('wd-accordion-animating');delete d.dataset.wdAnimating};anim.oncancel=anim.onfinish},true);
})();

// v3.5 Monitoring & Action Center
(function(){
 const toast=(title,message='',type='success')=>{const region=$('#toast-region');if(!region)return;const el=document.createElement('div');el.className=`wd-toast ${type}`;el.innerHTML=`<b>${esc(title)}</b>${message?`<span>${esc(message)}</span>`:''}`;region.appendChild(el);setTimeout(()=>{el.classList.add('leaving');setTimeout(()=>el.remove(),220)},3200)};
 window.wdToast=toast;
 function localPriority(){return [...(lastReport?.issues||[])].sort((a,b)=>({critical:4,high:3,medium:2,low:1}[b.severity]||0)-({critical:4,high:3,medium:2,low:1}[a.severity]||0));}
 async function refreshActionCenter(silent=false){
  const panel=$('#action-center'),out=$('#action-center-content');if(!panel||!out||!lastReport)return;
  panel.classList.remove('hidden');
  const issues=localPriority(), high=issues.filter(x=>['critical','high'].includes(x.severity)).length;
  let history=[],reg=null;
  if(verificationSession?.verified){
   try{const [hr,rr]=await Promise.all([fetch('/api/project-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})}),fetch('/api/regression',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})})]);if(hr.ok)history=(await hr.json()).history||[];if(rr.ok)reg=await rr.json()}catch{}
  }
  const score=lastReport.summary?.score??lastReport.score??'—';
  const delta=reg?.available?reg.scoreDelta:null, fixed=reg?.available?reg.fixed.length:0, fresh=reg?.available?reg.newIssues.length:0;
  const change=delta===null?'Run one more scan':delta>0?`+${delta} health points`:delta<0?`${delta} health points`:'No score change';
  const changeClass=delta===null||delta===0?'neutral':delta>0?'good':'bad';
  const top=issues.slice(0,4).map((x,i)=>`<div class="action-item"><i class="action-dot ${['critical','high'].includes(x.severity)?'high':''}"></i><div><b>${esc(x.title||'Finding')}</b><small>${esc((x.severity||'low').toUpperCase())}${x.url?' · '+esc(x.url):''}</small></div><button type="button" data-action="investigate" data-issue-index="${(lastReport.issues||[]).indexOf(x)}">Investigate</button></div>`).join('')||'<div class="action-item"><i class="action-dot good"></i><div><b>No open findings</b><small>This scan did not detect an issue requiring action.</small></div></div>';
  out.innerHTML=`<div class="action-center-grid"><div class="action-stat"><b>${score}/100</b><span>Current health</span></div><div class="action-stat"><b>${high}</b><span>High priority</span></div><div class="action-stat"><b>${fixed}</b><span>Fixed since prior scan</span></div><div class="action-stat"><b>${fresh}</b><span>New since prior scan</span></div></div><div class="action-main"><article class="action-card"><h3>Priority queue</h3>${top}</article><article class="action-card"><h3>Project status</h3><p class="action-change ${changeClass}">${esc(change)}</p><p class="muted">${history.length?`${history.length} recent saved scan${history.length===1?'':'s'} available.`:'Verify ownership to unlock saved monitoring history.'}</p><div class="action-quick"><button type="button" data-action="rescan">↻ Retest website now</button><button type="button" data-action="issues">Review all findings →</button><button type="button" data-action="regression">Compare latest scans →</button><button type="button" data-action="report">Open client health report →</button></div></article></div>`;
  if(!silent)toast('Status refreshed',reg?.available?'Latest scan changes are up to date.':'Current project status is up to date.');
 }
 $('#refresh-action-center')?.addEventListener('click',()=>refreshActionCenter());
 $('#action-center')?.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(a==='rescan'){$('#quick-rescan')?.click();return}if(a==='issues'){setProjectTab('issues');return}if(a==='regression'){setProjectTab('regression');setTimeout(()=>$('#run-regression')?.click(),100);return}if(a==='report'){setProjectTab('report');return}if(a==='investigate'){setProjectTab('investigator');const sel=$('#investigator-issue');if(sel){sel.value=b.dataset.issueIndex;setTimeout(()=>$('#investigate-one')?.click(),80)}}});
 const oldNodes=projectTabNodes;projectTabNodes=function(){const map=oldNodes();map.overview=[...(map.overview||[]),$('#action-center')].filter(Boolean);return map};
 const oldUpdate=updateProjectOverview;updateProjectOverview=function(){oldUpdate();setTimeout(()=>refreshActionCenter(true),120)};
 const oldRender=render;render=function(d){oldRender(d);toast('Scan complete',`${d.summary?.score??'—'}/100 health · ${d.summary?.issues??d.issues?.length??0} findings`,'success')};
 window.addEventListener('unhandledrejection',e=>{if(e.reason?.message)toast('Action failed',e.reason.message,'error')});
})();

// v3.6 Continuous Monitoring / Website Watch
(function(){
 const fmt=d=>d?new Date(d).toLocaleString():'—';
 function renderMonitor(m){const out=$('#monitoring-status');if(!out)return;if(!m){out.innerHTML='<div><b>Not configured</b><span>Save monitoring to start Website Watch.</span></div>';return}$('#monitor-cadence').value=m.cadence||'daily';$('#monitor-enabled').checked=!!m.enabled;$('#monitor-health-drop').checked=m.alertOnHealthDrop!==false;$('#monitor-new-issues').checked=m.alertOnNewIssues!==false;$('#monitor-high-priority').checked=m.alertOnHighPriority!==false;const r=m.lastResult||{};out.innerHTML=`<div><b>${m.enabled?'ACTIVE':'PAUSED'}</b><span>Website Watch</span></div><div><b>${esc((m.cadence||'daily').toUpperCase())}</b><span>Check cadence</span></div><div><b>${esc(fmt(m.lastRunAt))}</b><span>Last automatic/manual check</span></div><div><b>${esc(fmt(m.nextRunAt))}</b><span>Next due check</span></div>${m.lastResult?`<div><b>${r.score??'—'}/100</b><span>Last health</span></div><div><b>${r.healthDrop>0?'+':''}${r.healthDrop??0}</b><span>Health change</span></div><div><b>${r.newIssues??0}</b><span>New issues</span></div><div><b>${r.highPriority??0}</b><span>High priority</span></div>`:''}`}
 async function loadMonitor(silent=false){if(!verificationSession?.verified){renderMonitor(null);return}try{const r=await fetch('/api/monitoring/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load monitoring');renderMonitor(d.monitor);if(!silent)wdToast?.('Monitoring refreshed','Website Watch status is up to date.')}catch(e){if(!silent)wdToast?.('Monitoring failed',e.message,'error')}}
 $('#refresh-monitoring')?.addEventListener('click',()=>loadMonitor());
 $('#save-monitoring')?.addEventListener('click',async()=>{if(!verificationSession?.verified)return alert('Verify website ownership first.');try{const r=await fetch('/api/monitoring/configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id,enabled:$('#monitor-enabled').checked,cadence:$('#monitor-cadence').value,alertOnHealthDrop:$('#monitor-health-drop').checked,alertOnNewIssues:$('#monitor-new-issues').checked,alertOnHighPriority:$('#monitor-high-priority').checked})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not save monitoring');renderMonitor(d.monitor);wdToast?.('Monitoring saved',d.monitor.enabled?`Next ${d.monitor.cadence} check is scheduled.`:'Automatic checks are paused.')}catch(e){wdToast?.('Monitoring failed',e.message,'error')}});
 $('#run-monitor-now')?.addEventListener('click',async()=>{if(!verificationSession?.verified)return alert('Verify website ownership first.');const out=$('#monitoring-result');out.innerHTML='<p class="muted">Running a full monitored health check…</p>';try{const r=await fetch('/api/monitoring/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Monitoring check failed');lastReport=d.report;render(d.report);setProjectTab('monitoring');const x=d.result;out.innerHTML=`<div class="monitor-result-card ${x.healthDrop<0||x.newIssues||x.highPriority?'warn':'good'}"><b>Monitoring check complete · ${x.score}/100</b><p>${x.healthDrop>0?'+':''}${x.healthDrop} health points · ${x.newIssues} new issues · ${x.highPriority} high-priority findings</p></div>`;await loadMonitor(true);wdToast?.('Monitoring check complete',`${x.score}/100 health · ${x.newIssues} new issues`)}catch(e){out.innerHTML=`<p class="bad">${esc(e.message)}</p>`;wdToast?.('Monitoring check failed',e.message,'error')}});
 const oldNodes=projectTabNodes;projectTabNodes=function(){const map=oldNodes();map.monitoring=[$('#monitoring-center')].filter(Boolean);return map};
 const oldSet=setProjectTab;setProjectTab=function(tab){oldSet(tab);if(tab==='monitoring'){$('#monitoring-center')?.classList.remove('hidden');setTimeout(()=>loadMonitor(true),50)}};
 const oldVerified=showVerifiedProject;showVerifiedProject=function(v){oldVerified(v);if(activeProjectTab==='monitoring')loadMonitor(true)};
})();


// v3.7 Monitoring Alerts & Events
(function(){
 const fmt=d=>d?new Date(d).toLocaleString():'—';
 const badge=$('#alert-nav-badge');
 function setBadge(n){if(!badge)return;badge.textContent=n>99?'99+':String(n||0);badge.classList.toggle('hidden',!n)}
 let monitorEventFilter='all';
 function renderEvents(events=[],unread=0){
  setBadge(unread);const out=$('#monitor-events'),summary=$('#monitor-event-summary');if(!out||!summary)return;
  const alerts=events.filter(x=>x.type!=='check'), active=alerts.filter(x=>(x.state||'new')==='new'), high=active.filter(x=>x.severity==='high').length;
  summary.innerHTML=`<div><b>${unread}</b><span>Unread actionable alerts</span></div><div><b>${active.length}</b><span>Active alerts</span></div><div><b>${high}</b><span>Active high alerts</span></div>`;
  document.querySelectorAll('[data-monitor-filter]').forEach(b=>b.classList.toggle('active',b.dataset.monitorFilter===monitorEventFilter));
  const filtered=events.filter(e=>monitorEventFilter==='all'||(monitorEventFilter==='active'&&e.type!=='check'&&(e.state||'new')==='new')||(monitorEventFilter==='resolved'&&(e.state||'new')==='resolved')||(monitorEventFilter==='checks'&&e.type==='check'));
  if(!filtered.length){out.innerHTML=`<p class="muted">No ${monitorEventFilter==='all'?'monitoring':monitorEventFilter} events to show.</p>`;return}
  out.innerHTML=filtered.map(e=>{const state=e.state||(e.type==='check'?'ongoing':'new');const resolvedNote=e.resolutionNote?`<small class="event-resolution">Resolved: ${esc(e.resolutionNote)}</small>`:'';return `<article class="monitor-event ${esc(e.severity||'info')} state-${esc(state)} ${e.read?'':'unread'}"><i class="monitor-event-dot"></i><div class="monitor-event-body"><div class="event-title-row"><b>${esc(e.title||'Monitoring event')}</b><span class="event-state">${esc(state.toUpperCase())}</span></div><p>${esc(e.message||'')}</p><small>${esc(fmt(e.createdAt))}${e.result?.score!=null?' · Health '+esc(e.result.score)+'/100':''}</small>${resolvedNote}</div><div class="monitor-event-side"><span class="event-severity">${esc((e.severity||'info').toUpperCase())}</span><div class="monitor-event-links"><button type="button" data-event-action="investigate">Investigate</button><button type="button" data-event-action="compare">Compare</button><button type="button" data-event-action="report">Report</button></div></div></article>`}).join('');
 }
 let latestMonitorEvents=[];let latestMonitorUnread=0;
 async function loadEvents(silent=false){if(!verificationSession?.verified){latestMonitorEvents=[];latestMonitorUnread=0;renderEvents([],0);return}try{const r=await fetch('/api/monitoring/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id,limit:50})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load monitoring events');latestMonitorEvents=d.events||[];latestMonitorUnread=d.unread||0;renderEvents(latestMonitorEvents,latestMonitorUnread);if(!silent)wdToast?.('Events refreshed',`${d.unread||0} unread monitoring event${d.unread===1?'':'s'}.`)}catch(e){if(!silent)wdToast?.('Events unavailable',e.message,'error')}}
 $('#refresh-monitor-events')?.addEventListener('click',()=>loadEvents());
 $('#mark-monitor-read')?.addEventListener('click',async()=>{if(!verificationSession?.verified)return;try{const r=await fetch('/api/monitoring/events/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not update alerts');latestMonitorEvents=d.events||[];latestMonitorUnread=d.unread||0;renderEvents(latestMonitorEvents,latestMonitorUnread);wdToast?.('Alerts acknowledged','Monitoring timeline marked as read.')}catch(e){wdToast?.('Could not mark alerts read',e.message,'error')}});
 document.querySelector('.monitor-event-filters')?.addEventListener('click',e=>{const b=e.target.closest('[data-monitor-filter]');if(!b)return;monitorEventFilter=b.dataset.monitorFilter;renderEvents(latestMonitorEvents,latestMonitorUnread)});
 $('#monitor-events')?.addEventListener('click',e=>{const b=e.target.closest('[data-event-action]');if(!b)return;const a=b.dataset.eventAction;if(a==='investigate'){setProjectTab('investigator');setTimeout(()=>$('#investigate-top')?.click(),80)}else if(a==='compare'){setProjectTab('regression');setTimeout(()=>$('#run-regression')?.click(),80)}else if(a==='report'){setProjectTab('report')}});
 const oldSet=setProjectTab;setProjectTab=function(tab){oldSet(tab);if(tab==='monitoring')setTimeout(()=>loadEvents(true),90)};
 const oldVerified=showVerifiedProject;showVerifiedProject=function(v){oldVerified(v);setTimeout(()=>loadEvents(true),120)};
 const run=$('#run-monitor-now');run?.addEventListener('click',()=>setTimeout(()=>loadEvents(true),1200));
 window.addEventListener('focus',()=>{if(verificationSession?.verified)loadEvents(true)});
})();


// v3.8 External Notifications
(function(){
 const badge=()=>$('#notification-delivery-badge');
 function renderNotify(x){const b=badge();const text=$('#notification-status-text');if(!x){$('#notify-enabled').checked=false;$('#notify-webhook-url').value='';if(b){b.textContent='NOT CONFIGURED';b.className='delivery-badge'};if(text)text.textContent='Configure an HTTPS webhook to receive monitoring alerts outside WebDoctor.';return}$('#notify-enabled').checked=!!x.enabled;$('#notify-resolved').checked=x.notifyResolved!==false;$('#notify-webhook-url').value=x.webhookUrl||'';if(b){b.textContent=x.lastDeliveryStatus==='delivered'?'DELIVERED':x.lastDeliveryStatus==='failed'?'DELIVERY FAILED':x.enabled?'READY':'PAUSED';b.className='delivery-badge '+(x.lastDeliveryStatus==='failed'?'bad':x.enabled?'good':'')}if(text)text.textContent=x.lastDeliveryAt?`Last delivery: ${fmt(x.lastDeliveryAt)}${x.lastDeliveryError?' · '+x.lastDeliveryError:''}`:'No notification has been delivered yet.'}
 async function loadNotify(silent=true){if(!verificationSession?.verified){renderNotify(null);return}try{const r=await fetch('/api/notifications/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load notifications');renderNotify(d.settings);if(!silent)wdToast?.('Notifications refreshed','External delivery settings are up to date.')}catch(e){if(!silent)wdToast?.('Notifications unavailable',e.message,'error')}}
 $('#save-notifications')?.addEventListener('click',async()=>{if(!verificationSession?.verified)return alert('Verify website ownership first.');try{const body={verificationId:verificationSession.id,enabled:$('#notify-enabled').checked,notifyResolved:$('#notify-resolved').checked,webhookUrl:$('#notify-webhook-url').value.trim()};const secret=$('#notify-secret').value;if(secret)body.secret=secret;const r=await fetch('/api/notifications/configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not save notifications');$('#notify-secret').value='';renderNotify(d.settings);wdToast?.('Notifications saved',d.settings?.enabled?'Webhook delivery is active.':'Webhook delivery is paused.')}catch(e){wdToast?.('Could not save notifications',e.message,'error')}});
 $('#test-notifications')?.addEventListener('click',async()=>{if(!verificationSession?.verified)return alert('Verify website ownership first.');const text=$('#notification-status-text');if(text)text.textContent='Sending a test notification…';try{const r=await fetch('/api/notifications/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verificationId:verificationSession.id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Test delivery failed');await loadNotify(true);wdToast?.('Test delivered','The webhook accepted WebDoctor’s test notification.')}catch(e){if(text)text.textContent=e.message;wdToast?.('Test delivery failed',e.message,'error')}});
 const previousSet=setProjectTab;setProjectTab=function(tab){previousSet(tab);if(tab==='monitoring')setTimeout(()=>loadNotify(true),120)};
 const previousVerified=showVerifiedProject;showVerifiedProject=function(v){previousVerified(v);if(activeProjectTab==='monitoring')loadNotify(true)};
})();
