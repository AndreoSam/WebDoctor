import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const FILE=join(fileURLToPath(new URL('../data/',import.meta.url)),'monitoring.json');
function load(){try{return existsSync(FILE)?JSON.parse(readFileSync(FILE,'utf8')):{}}catch{return {}}}
function save(db){mkdirSync(dirname(FILE),{recursive:true});writeFileSync(FILE,JSON.stringify(db,null,2))}
const db=load();
const intervals={hourly:60*60e3,daily:24*60*60e3,weekly:7*24*60*60e3};
export function getMonitor(origin){return db[origin]||null}
export function setMonitor(origin,opts={}){const prev=db[origin]||{};const cadence=['hourly','daily','weekly'].includes(opts.cadence)?opts.cadence:'daily';const now=new Date().toISOString();db[origin]={origin,enabled:opts.enabled!==false,cadence,alertOnNewIssues:opts.alertOnNewIssues!==false,alertOnHealthDrop:opts.alertOnHealthDrop!==false,alertOnHighPriority:opts.alertOnHighPriority!==false,createdAt:prev.createdAt||now,updatedAt:now,lastRunAt:prev.lastRunAt||null,lastResult:prev.lastResult||null,nextRunAt:opts.enabled===false?null:new Date(Date.now()+intervals[cadence]).toISOString()};save(db);return db[origin]}
export function recordMonitorRun(origin,result){const m=db[origin];if(!m)return null;const ms=intervals[m.cadence]||intervals.daily;m.lastRunAt=new Date().toISOString();m.nextRunAt=m.enabled?new Date(Date.now()+ms).toISOString():null;m.lastResult=result;m.updatedAt=m.lastRunAt;save(db);return m}
export function dueMonitors(){const now=Date.now();return Object.values(db).filter(m=>m.enabled&&m.nextRunAt&&Date.parse(m.nextRunAt)<=now)}
