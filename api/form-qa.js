import { runFormQa } from '../src/formQa.js';
import { assertHostedOwnership, readBody, json } from '../src/hostedOwnership.js';
export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 try{const p=await readBody(req);const origin=await assertHostedOwnership(p.origin||p.url);const result=await runFormQa(origin,{maxPages:process.env.VERCEL?3:8,specificUrls:Array.isArray(p.specificUrls)?p.specificUrls:[]});return json(res,200,result)}
 catch(e){return json(res,e.statusCode||500,{error:e.message||'Smart Journey QA failed'})}
}
