import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'projects.json');
const sessions = new Map();
let projects = new Map();

function canonicalOrigin(target) {
  const u = target instanceof URL ? target : new URL(target);
  u.hash = '';
  u.search = '';
  return u.origin.toLowerCase();
}

function load() {
  try {
    const rows = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    projects = new Map(rows.map(r => [canonicalOrigin(r.origin), { ...r, origin: canonicalOrigin(r.origin) }]));
  } catch {
    projects = new Map();
  }
}

function save() {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify([...projects.values()], null, 2));
}
load();

function newRecord(origin, token = null) {
  const url = new URL(origin);
  return {
    id: crypto.randomUUID(),
    origin,
    hostname: url.hostname,
    token: token || `webdoctor-${crypto.randomBytes(18).toString('hex')}`,
    verified: false,
    createdAt: Date.now(),
    verifiedAt: null,
    lastVerifiedAt: null,
    verificationMethod: null
  };
}

export function createVerification(target) {
  const origin = canonicalOrigin(target);
  let record = projects.get(origin);
  if (!record) {
    record = newRecord(origin);
    projects.set(origin, record);
    save();
  }
  sessions.set(record.id, record);
  return publicRecord(record);
}

// Used when WebDoctor is moved/upgraded and its local DB is missing, but the
// website still contains the one-time WebDoctor proof. We adopt that exact
// token instead of forcing the owner to replace their meta tag/file.
export function adoptVerification(target, token, method = 'Existing meta tag') {
  const origin = canonicalOrigin(target);
  let record = projects.get(origin);
  if (!record) record = newRecord(origin, token);
  record.token = token;
  record.verified = true;
  record.verificationMethod = method;
  record.verifiedAt ||= Date.now();
  record.lastVerifiedAt = Date.now();
  projects.set(origin, record);
  sessions.set(record.id, record);
  save();
  return publicRecord(record);
}

export function getVerification(id) {
  if (sessions.has(id)) return sessions.get(id);
  for (const r of projects.values()) {
    if (r.id === id) {
      sessions.set(id, r);
      return r;
    }
  }
  return null;
}

export function getProjectByOrigin(target) {
  try {
    return projects.get(canonicalOrigin(target)) || null;
  } catch {
    return null;
  }
}

export function markVerified(id, method = 'Unknown') {
  const r = getVerification(id);
  if (!r) return null;
  r.verified = true;
  r.verificationMethod = method;
  r.verifiedAt ||= Date.now();
  r.lastVerifiedAt = Date.now();
  projects.set(r.origin, r);
  sessions.set(r.id, r);
  save();
  return publicRecord(r);
}

export function touchVerified(id) {
  const r = getVerification(id);
  if (r) {
    r.lastVerifiedAt = Date.now();
    projects.set(r.origin, r);
    save();
  }
  return r ? publicRecord(r) : null;
}

export function publicRecord(r) {
  return {
    id: r.id,
    origin: r.origin,
    hostname: r.hostname,
    token: r.token,
    verified: r.verified,
    verifiedAt: r.verifiedAt,
    lastVerifiedAt: r.lastVerifiedAt,
    verificationMethod: r.verificationMethod || null,
    methods: {
      htmlFile: `${r.origin}/.well-known/webdoctor-verification.txt`,
      meta: `<meta name="webdoctor-verification" content="${r.token}">`
    }
  };
}

export function listProjects() {
  return [...projects.values()].map(publicRecord).sort((a,b)=>(b.lastVerifiedAt||b.verifiedAt||0)-(a.lastVerifiedAt||a.verifiedAt||0));
}
