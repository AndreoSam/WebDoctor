import {assertHostedOwnership,readBody,json} from '../../src/hostedOwnership.js';
import {monitoringEvents,durableStoreEnabled} from '../../src/supabaseStore.js';
export default async function handler(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});try{const p=await readBody(req),origin=await assertHostedOwnership(p.origin||p.url);const events=durableStoreEnabled()?await monitoringEvents(origin):[];return json(res,200,{events,unread:events.filter(x=>!x.isRead).length})}catch(e){return json(res,e.statusCode||500,{error:e.message})}}
