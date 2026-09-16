function normalizeOrigin(value){
  if(!value) throw new Error('Website origin is required.');
  let v=String(value).trim(); if(!/^https?:\/\//i.test(v)) v=`https://${v}`;
  const u=new URL(v); if(!['http:','https:'].includes(u.protocol)) throw new Error('Only public HTTP/HTTPS websites are supported.');
  return u.origin;
}
const TOKEN_RE=/webdoctor-[a-f0-9]{16,128}/i;
export async function assertHostedOwnership(value){
  const origin=normalizeOrigin(value);
  try{
    const r=await fetch(`${origin}/.well-known/webdoctor-verification.txt`,{redirect:'follow',signal:AbortSignal.timeout(8000)});
    if(r.ok&&TOKEN_RE.test(await r.text())) return origin;
  }catch{}
  try{
    const r=await fetch(origin,{redirect:'follow',signal:AbortSignal.timeout(8000)}); const html=await r.text();
    const head=(html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)||[])[0]||'';
    if(/<meta[^>]+name=["']webdoctor-verification["'][^>]+content=["']webdoctor-[a-f0-9]{16,128}["']/i.test(head)||/<meta[^>]+content=["']webdoctor-[a-f0-9]{16,128}["'][^>]+name=["']webdoctor-verification["']/i.test(head)) return origin;
  }catch{}
  const e=new Error('Verified website ownership is required. Keep the WebDoctor verification meta tag or verification file on the website.'); e.statusCode=403; throw e;
}
export async function readBody(req){if(req.body&&typeof req.body==='object')return req.body;if(typeof req.body==='string')return JSON.parse(req.body||'{}');let s='';for await(const c of req)s+=c;return JSON.parse(s||'{}')}
export function json(res,status,data){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(data))}
