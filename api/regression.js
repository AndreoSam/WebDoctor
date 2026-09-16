import {assertHostedOwnership,readBody,json} from '../src/hostedOwnership.js';
import {hostedRegression} from '../src/hostedHistory.js';
import {regression,durableStoreEnabled} from '../src/supabaseStore.js';
export default async function handler(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});try{const p=await readBody(req),origin=await assertHostedOwnership(p.origin||p.url);return json(res,200,durableStoreEnabled()?await regression(origin):hostedRegression(origin))}catch(e){return json(res,e.statusCode||500,{error:e.message})}}
