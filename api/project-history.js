import {assertHostedOwnership,readBody,json} from '../src/hostedOwnership.js';
import {hostedHistory} from '../src/hostedHistory.js';
import {scanHistory,durableStoreEnabled} from '../src/supabaseStore.js';
export default async function handler(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});try{const p=await readBody(req),origin=await assertHostedOwnership(p.origin||p.url);const history=durableStoreEnabled()?await scanHistory(origin):hostedHistory(origin);return json(res,200,{history})}catch(e){return json(res,e.statusCode||500,{error:e.message})}}
