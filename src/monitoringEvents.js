import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const FILE=join(fileURLToPath(new URL('../data/',import.meta.url)),'monitoring-events.json');
function load(){try{return existsSync(FILE)?JSON.parse(readFileSync(FILE,'utf8')):{}}catch{return {}}}
function save(db){mkdirSync(dirname(FILE),{recursive:true});writeFileSync(FILE,JSON.stringify(db,null,2))}
const db=load();
function snapshot(result){return {score:result.score,previousScore:result.previousScore,healthDrop:result.healthDrop,newIssues:result.newIssues,resolvedIssues:result.resolvedIssues||0,highPriority:result.highPriority,newHighPriority:result.newHighPriority||0,resolvedHighPriority:result.resolvedHighPriority||0,scanAt:result.scanAt}}
function resolvePrevious(origin,type,count,now,note){
 let remaining=Math.max(0,Number(count)||0);
 for(const e of db[origin]||[]){
  if(!remaining)break;
  if(e.type!==type || (e.state||'new')!=='new')continue;
  const weight=type==='high-priority'?Math.max(1,Number(e.result?.newHighPriority)||1):type==='new-issues'?Math.max(1,Number(e.result?.newIssues)||1):1;
  e.state='resolved';e.read=true;e.resolvedAt=now;e.resolutionNote=note;
  remaining-=weight;
 }
}
export function addMonitoringEvents(origin,monitor,result){
 const now=new Date().toISOString(), events=[];
 db[origin]=db[origin]||[];
 // Reconcile prior actionable alerts before adding the new run. This also cleans up legacy unread RESOLVED events.
 if(result.healthDrop>0) resolvePrevious(origin,'health-drop',1,now,'Health recovered on a later monitoring check.');
 if((result.resolvedIssues||0)>0) resolvePrevious(origin,'new-issues',result.resolvedIssues,now,'Previously detected issues are no longer present.');
 if((result.resolvedHighPriority||0)>0) resolvePrevious(origin,'high-priority',result.resolvedHighPriority,now,'Previously detected high-priority findings are no longer present.');
 for(const e of db[origin]) if((e.state||'new')==='resolved')e.read=true;
 const push=(type,severity,state,title,message,read=false)=>events.push({id:randomUUID(),origin,type,severity,state,title,message,createdAt:now,read,result:snapshot(result)});
 push('check','info','ongoing','Monitoring check completed',`Health ${result.score}/100 · ${result.newIssues} new · ${result.resolvedIssues||0} resolved · ${result.highPriority} high-priority open.`,true);
 if(monitor?.alertOnHealthDrop!==false && result.healthDrop<0) push('health-drop',Math.abs(result.healthDrop)>=10?'high':'medium','new','Website health dropped',`Health decreased by ${Math.abs(result.healthDrop)} point${Math.abs(result.healthDrop)===1?'':'s'} to ${result.score}/100.`);
 if(monitor?.alertOnNewIssues!==false && result.newIssues>0) push('new-issues',result.newIssues>=5?'high':'medium','new','New issues detected',`${result.newIssues} new issue${result.newIssues===1?' was':'s were'} detected since the previous scan.`);
 if(monitor?.alertOnHighPriority!==false && (result.newHighPriority||0)>0) push('high-priority','high','new','New high-priority findings detected',`${result.newHighPriority} new critical/high finding${result.newHighPriority===1?' requires':'s require'} attention · ${result.highPriority} currently open.`);
 if((result.resolvedIssues||0)>0) push('resolved','info','resolved','Issues resolved',`${result.resolvedIssues} previous issue${result.resolvedIssues===1?' is':'s are'} no longer detected${result.resolvedHighPriority?` · ${result.resolvedHighPriority} high-priority resolved`:''}.`,true);
 if(result.healthDrop>0 && !result.newIssues) push('recovery','info','resolved','Website health improved',`Health increased by ${result.healthDrop} point${result.healthDrop===1?'':'s'} to ${result.score}/100.`,true);
 db[origin]=[...events,...db[origin]].slice(0,200); save(db); return events;
}
export function listMonitoringEvents(origin,limit=50){return (db[origin]||[]).slice(0,Math.max(1,Math.min(200,Number(limit)||50)))}
export function unreadMonitoringEvents(origin){return (db[origin]||[]).filter(x=>!x.read && x.type!=='check' && (x.state||'new')==='new').length}
export function markMonitoringEventsRead(origin,ids=null){const wanted=Array.isArray(ids)?new Set(ids):null;for(const e of db[origin]||[])if(!wanted||wanted.has(e.id))e.read=true;save(db);return {events:listMonitoringEvents(origin),unread:unreadMonitoringEvents(origin)}}
