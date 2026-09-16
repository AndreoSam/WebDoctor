import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const FILE=join(dirname(fileURLToPath(import.meta.url)),'..','data','scan-history.json');
let rows=[]; try{rows=JSON.parse(readFileSync(FILE,'utf8'));if(!Array.isArray(rows))rows=[]}catch{}
function save(){mkdirSync(dirname(FILE),{recursive:true});writeFileSync(FILE,JSON.stringify(rows,null,2))}
const originOf=u=>new URL(u).origin.toLowerCase();
export function saveScan(report){
 const origin=originOf(report.target); const item={id:crypto.randomUUID(),origin,target:report.target,createdAt:Date.now(),summary:report.summary,categories:report.categories,issues:(report.issues||[]).map(x=>({title:x.title,severity:x.severity,url:x.url||'',detail:x.detail||'',suggestion:x.suggestion||''})),pages:(report.pages||[]).map(p=>({url:p.url,status:p.status,responseMs:p.responseMs}))};
 rows.push(item); if(rows.length>300)rows=rows.slice(-300); save(); return item;
}
export function history(origin,limit=20){const o=originOf(origin);return rows.filter(x=>x.origin===o).sort((a,b)=>b.createdAt-a.createdAt).slice(0,limit)}
function key(i){return `${i.severity}|${i.title}|${i.url||''}`}
export function regression(origin){const h=history(origin,2); if(h.length<2)return {available:false,scans:h}; const [current,previous]=h;const cm=new Map(current.issues.map(i=>[key(i),i])),pm=new Map(previous.issues.map(i=>[key(i),i]));return {available:true,current,previous,fixed:[...pm].filter(([k])=>!cm.has(k)).map(([,v])=>v),newIssues:[...cm].filter(([k])=>!pm.has(k)).map(([,v])=>v),unchanged:[...cm].filter(([k])=>pm.has(k)).map(([,v])=>v),scoreDelta:(current.summary?.score||0)-(previous.summary?.score||0),issueDelta:(current.summary?.issues||0)-(previous.summary?.issues||0)} }
