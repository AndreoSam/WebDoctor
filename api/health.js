import { json } from '../src/hostedOwnership.js';
export default function handler(req,res){return json(res,200,{ok:true,version:'4.0.0',runtime:process.env.VERCEL?'vercel':'node'})}
