import {assertHostedOwnership,readBody,json} from '../../src/hostedOwnership.js';
export default async function handler(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});try{const p=await readBody(req);await assertHostedOwnership(p.origin||p.url);return json(res,200,{events:[],unread:0})}catch(e){return json(res,e.statusCode||500,{error:e.message})}}
