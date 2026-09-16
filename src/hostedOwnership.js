function normalizeOrigin(value){
  if(!value) throw new Error('Website origin is required.');
  let v=String(value).trim(); if(!/^https?:\/\//i.test(v)) v=`https://${v}`;
  const u=new URL(v); if(!['http:','https:'].includes(u.protocol)) throw new Error('Only public HTTP/HTTPS websites are supported.');
  return u.origin;
}
const TOKEN_RE=/webdoctor-[a-f0-9]{16,128}/i;
const headers={'user-agent':'WebDoctor/4.0 Ownership Verification','cache-control':'no-cache','accept':'text/html,text/plain,*/*'};
async function fetchProof(url){let last;for(let i=0;i<2;i++){try{return await fetch(url,{redirect:'follow',headers,signal:AbortSignal.timeout(12000)})}catch(e){last=e}}throw last}
export async function assertHostedOwnership(value){
  const origin=normalizeOrigin(value);
  try{const r=await fetchProof(`${origin}/.well-known/webdoctor-verification.txt`);if(r.ok&&TOKEN_RE.test(await r.text()))return origin}catch{}
  try{const r=await fetchProof(origin);if(r.ok){const html=await r.text();const head=(html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)||[])[0]||'';const meta=/<meta\b[^>]*name\s*=\s*["']webdoctor-verification["'][^>]*>/i.exec(head)?.[0]||/<meta\b[^>]*content\s*=\s*["']webdoctor-[a-f0-9]{16,128}["'][^>]*name\s*=\s*["']webdoctor-verification["'][^>]*>/i.exec(head)?.[0];if(meta&&TOKEN_RE.test(meta))return origin}}catch{}
  const e=new Error('Verified website ownership is required. WebDoctor could not read a valid verification token from the website right now. Keep the verification meta tag/file public and retry.');e.statusCode=403;throw e;
}
export async function readBody(req){if(req.body&&typeof req.body==='object')return req.body;if(typeof req.body==='string')return JSON.parse(req.body||'{}');let s='';for await(const c of req)s+=c;return JSON.parse(s||'{}')}
export function json(res,status,data){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(data))}
