import { investigateIssue, investigateReport } from '../src/investigator.js';
import { readBody, json } from '../src/hostedOwnership.js';
export default async function handler(req,res){
 if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});
 try{const p=await readBody(req);if(p.mode==='report'){const issues=Array.isArray(p.issues)?p.issues.slice(0,50):[];return json(res,200,{provider:'WebDoctor Local Investigator',cost:'free',analyses:investigateReport(issues,p.limit||5)})}if(!p.issue||typeof p.issue!=='object')return json(res,400,{error:'A WebDoctor finding is required.'});return json(res,200,{provider:'WebDoctor Local Investigator',cost:'free',analysis:investigateIssue(p.issue)})}catch(e){return json(res,500,{error:e.message||'Investigation failed'})}
}
