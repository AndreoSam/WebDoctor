import { runJourneyCapacityLab } from '../src/capacityLab.js';
import { assertHostedOwnership, readBody, json } from '../src/hostedOwnership.js';
export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 try{const p=await readBody(req);if(p.authorized!==true)return json(res,400,{error:'Explicit owner authorization is required for Journey Load.'});const origin=await assertHostedOwnership(p.origin||p.url||(p.pageUrls||[])[0]);const result=await runJourneyCapacityLab(origin,{pageUrls:p.pageUrls,users:p.users,durationSeconds:p.durationSeconds,save:!process.env.VERCEL});return json(res,200,result)}
 catch(e){return json(res,e.statusCode||500,{error:e.message||'Journey Load failed'})}
}
