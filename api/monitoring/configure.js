import {assertHostedOwnership,readBody,json} from '../../src/hostedOwnership.js';
import {setHostedMonitor} from '../../src/hostedMonitoring.js';
import {saveMonitor,durableStoreEnabled} from '../../src/supabaseStore.js';
export default async function handler(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});try{const p=await readBody(req),origin=await assertHostedOwnership(p.origin||p.url);const monitor=setHostedMonitor(origin,p);if(durableStoreEnabled())await saveMonitor(origin,monitor);return json(res,200,{monitor,persistence:durableStoreEnabled()?'supabase':'runtime'})}catch(e){return json(res,e.statusCode||500,{error:e.message})}}
