const db=globalThis.__webdoctorNotifications||(globalThis.__webdoctorNotifications=new Map());
export function getHostedNotifications(origin){const x=db.get(origin);if(!x)return null;const y={...x};if(y.smtpPass)y.smtpPass='••••••••';if(y.secret)y.secret='••••••••';return y}
export function setHostedNotifications(origin,p){const prev=db.get(origin)||{};const x={...prev,...p,origin,updatedAt:new Date().toISOString()};if(!p.smtpPass&&prev.smtpPass)x.smtpPass=prev.smtpPass;if(!p.secret&&prev.secret)x.secret=prev.secret;db.set(origin,x);return getHostedNotifications(origin)}
export function rawHostedNotifications(origin){return db.get(origin)||null}
