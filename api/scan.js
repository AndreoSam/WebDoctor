import { scanWebsite } from '../src/scanner.js';
import { browserAudit } from '../src/browserScanner.js';
import { saveScan } from '../src/projectStore.js';

function sendJson(res,status,data){
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(data));
}

function isPrivateHostname(hostname){
  const h=hostname.toLowerCase();
  return h==='localhost'||h==='127.0.0.1'||h==='::1'||h.endsWith('.local')||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

async function bodyOf(req){
  if(req.body&&typeof req.body==='object') return req.body;
  if(typeof req.body==='string') return JSON.parse(req.body||'{}');
  let body='';
  for await(const chunk of req) body+=chunk;
  return JSON.parse(body||'{}');
}

export default async function handler(req,res){
  if(req.method!=='POST') return sendJson(res,405,{error:'Method not allowed'});
  try{
    const parsed=await bodyOf(req);
    if(!parsed.url) return sendJson(res,400,{error:'Website URL is required.'});
    let normalized=String(parsed.url).trim();
    if(!/^https?:\/\//i.test(normalized)) normalized=`https://${normalized}`;
    const target=new URL(normalized);
    if(!['http:','https:'].includes(target.protocol)||isPrivateHostname(target.hostname)) return sendJson(res,400,{error:'Only public HTTP/HTTPS websites can be scanned.'});

    const report=await scanWebsite(normalized,{limit:Math.min(Number(parsed.limit)||15,15)});
    if(parsed.browser!==false){
      try{
        report.browser=await browserAudit(report.target,{maxPages:Math.min(Number(parsed.browserPages)||3,3)});
        if(report.browser?.available){
          report.issues.push(...report.browser.findings.map((x,i)=>({...x,key:`browser-${i+1}`})));
          report.summary.issues=report.issues.length;
          for(const sev of ['critical','high','medium','low']) report.summary[sev]=report.issues.filter(x=>x.severity===sev).length;
          report.categories.browser=report.browser.score;
          report.categories.accessibility=Math.min(report.categories.accessibility??100,report.browser.accessibilityScore??100);
          report.summary.score=Math.round((report.summary.score*0.75)+(report.browser.score*0.25));
        }
      }catch(error){
        report.browser={available:false,reason:`Browser QA is unavailable in this deployment: ${error.message}`};
      }
    }
    try{saveScan(report)}catch(error){report.persistence={available:false,reason:'Vercel serverless storage is ephemeral.'};}
    return sendJson(res,200,report);
  }catch(error){
    console.error('Vercel scan error',error);
    return sendJson(res,500,{error:error?.message||'Unexpected scan error'});
  }
}
