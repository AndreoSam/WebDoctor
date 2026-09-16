import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC=fileURLToPath(new URL('./public/',import.meta.url));
const PORT=Number(process.env.PORT||3000);

// One authoritative router for the Vercel Node preset. Each API implementation
// remains isolated in /api, but production no longer depends on Vercel inferring
// nested filesystem routes alongside a root Node application.
const routes={
 '/api/scan':()=>import('./api/scan.js'),
 '/api/investigator':()=>import('./api/investigator.js'),
 '/api/health':()=>import('./api/health.js'),
 '/api/projects':()=>import('./api/projects.js'),
 '/api/project-history':()=>import('./api/project-history.js'),
 '/api/regression':()=>import('./api/regression.js'),
 '/api/capacity-history':()=>import('./api/capacity-history.js'),
 '/api/capacity-lab':()=>import('./api/capacity-lab.js'),
 '/api/journey-capacity-lab':()=>import('./api/journey-capacity-lab.js'),
 '/api/form-qa':()=>import('./api/form-qa.js'),
 '/api/active-form-qa':()=>import('./api/active-form-qa.js'),
 '/api/submission-simulation':()=>import('./api/submission-simulation.js'),
 '/api/verification/start':()=>import('./api/verification/start.js'),
 '/api/verification/status':()=>import('./api/verification/status.js'),
 '/api/verification/check':()=>import('./api/verification/check.js'),
 '/api/verification-start':()=>import('./api/verification-start.js'),
 '/api/verification-status':()=>import('./api/verification-status.js'),
 '/api/verification-check':()=>import('./api/verification-check.js'),
 '/api/monitoring/status':()=>import('./api/monitoring/status.js'),
 '/api/monitoring/configure':()=>import('./api/monitoring/configure.js'),
 '/api/monitoring/run':()=>import('./api/monitoring/run.js'),
 '/api/monitoring/events':()=>import('./api/monitoring/events.js'),
 '/api/monitoring/events/read':()=>import('./api/monitoring/events/read.js'),
 '/api/notifications/status':()=>import('./api/notifications/status.js'),
 '/api/notifications/configure':()=>import('./api/notifications/configure.js'),
 '/api/notifications/test':()=>import('./api/notifications/test.js')
};

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon'};
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}

async function serveStatic(pathname,res){
 let rel=pathname==='/'?'index.html':decodeURIComponent(pathname).replace(/^\/+/, '');
 rel=normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
 let file=join(PUBLIC,rel);
 if(!file.startsWith(PUBLIC)) return false;
 try{
   const s=await stat(file);
   if(s.isDirectory()) file=join(file,'index.html');
   const body=await readFile(file);
   res.writeHead(200,{'content-type':mime[extname(file).toLowerCase()]||'application/octet-stream'});res.end(body);return true;
 }catch{return false;}
}

const server=http.createServer(async(req,res)=>{
 try{
   const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
   const load=routes[url.pathname];
   if(load){const mod=await load();return await mod.default(req,res);}
   if(url.pathname.startsWith('/api/')) return json(res,404,{error:'Unknown WebDoctor API route.',path:url.pathname});
   if(await serveStatic(url.pathname,res)) return;
   // SPA/static fallback.
   if(await serveStatic('/',res)) return;
   res.writeHead(404);res.end('Not found');
 }catch(error){console.error('WebDoctor request failed',error);if(!res.headersSent)json(res,500,{error:error?.message||'Internal server error'});else res.end();}
});
server.listen(PORT,()=>console.log(`WebDoctor listening on ${PORT}`));
