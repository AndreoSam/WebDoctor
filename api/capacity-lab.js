import { runCapacityLab, runSteppedCapacityLab } from '../src/capacityLab.js';
import { assertHostedOwnership, readBody, json } from '../src/hostedOwnership.js';\nimport {saveCapacity,durableStoreEnabled} from '../src/supabaseStore.js';
export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 try{const p=await readBody(req);if(p.authorized!==true)return json(res,400,{error:'Explicit owner authorization is required for Capacity Lab.'});const origin=await assertHostedOwnership(p.origin||p.url||p.pageUrl);const result=p.mode==='stepped'?await runSteppedCapacityLab(origin,{pageUrl:p.pageUrl||origin,save:false}):await runCapacityLab(origin,{pageUrl:p.pageUrl||origin,users:p.users,durationSeconds:p.durationSeconds,save:false});if(durableStoreEnabled())await saveCapacity(origin,result);return json(res,200,result)}
 catch(e){return json(res,e.statusCode||500,{error:e.message||'Capacity Lab failed'})}
}
