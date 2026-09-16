import {readBody,json} from '../src/hostedOwnership.js';
function decode(id){try{return JSON.parse(Buffer.from(String(id),'base64url').toString('utf8'))}catch{return null}}
async function get(url){for(let i=0;i<2;i++){try{return await fetch(url,{redirect:'follow',headers:{'user-agent':'WebDoctor/4.0 Ownership Verification','cache-control':'no-cache'},signal:AbortSignal.timeout(12000)})}catch(e){if(i===1)throw e}}}
export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 try{
  const p=await readBody(req),x=decode(p.id);
  if(!x?.origin||!x?.token)return json(res,400,{error:'Verification session is invalid. Start verification again.'});
  let evidence=null;
  try{const r=await get(x.origin+'/.well-known/webdoctor-verification.txt');if(r.ok&&(await r.text()).includes(x.token))evidence='HTML verification file'}catch{}
  if(!evidence)try{const r=await get(x.origin);if(r.ok){const h=await r.text();const head=(h.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)||[])[0]||'';if(head.includes(x.token))evidence='Meta tag'}}catch{}
  if(!evidence)return json(res,200,{verified:false,error:'Verification token was not found yet. Confirm the current token is publicly visible and try again.'});
  return json(res,200,{id:p.id,origin:x.origin,hostname:new URL(x.origin).hostname,token:x.token,verified:true,evidence,verificationMethod:evidence,methods:{htmlFile:x.origin+'/.well-known/webdoctor-verification.txt',meta:`<meta name="webdoctor-verification" content="${x.token}">`}});
 }catch(e){return json(res,500,{error:e.message})}
}
