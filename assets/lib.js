/* SPINOFF — pure logic. No DOM, no network. Imported by index.html and tested with node:test. */

export const DAY_MS = 86400000;

export const DEFAULTS = Object.freeze({
  minParentAgeDays: 30,
  minParentLiquidityUsd: 10000,
  officialMcapUsd: 100000,
  pitchPremiseMax: 140
});

const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const pick = (cfg, k) => (cfg && num(cfg[k]) !== null ? cfg[k] : DEFAULTS[k]);

/* ---------- formatting ---------- */

/** Market-data style: $84.0K, $1.90M, $0.0000123 */
export function fmtUsd(n){
  if(!isFinite(n)) return '—';
  const a = Math.abs(n);
  if(a >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
  if(a >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
  if(a >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
  if(a >= 1) return '$' + n.toFixed(2);
  return '$' + n.toPrecision(3);
}

/** Config style, no needless decimals: 100000 -> $100K, 10000 -> $10K, 2500000 -> $2.5M */
export function usdShort(n){
  if(!isFinite(n)) return '—';
  const strip = s => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  const a = Math.abs(n);
  if(a >= 1e9) return '$' + strip((n/1e9).toFixed(2)) + 'B';
  if(a >= 1e6) return '$' + strip((n/1e6).toFixed(2)) + 'M';
  if(a >= 1e3) return '$' + strip((n/1e3).toFixed(2)) + 'K';
  return '$' + strip(n.toFixed(2));
}

/* ---------- base58 / addresses ---------- */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58decode(str){
  if(typeof str !== 'string' || !str.length) throw new Error('base58: empty');
  const bytes = []; // little endian
  for(const ch of str){
    const v = B58.indexOf(ch);
    if(v < 0) throw new Error('base58: bad character');
    let carry = v;
    for(let i = 0; i < bytes.length; i++){
      carry += bytes[i]*58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while(carry){ bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0;
  while(zeros < str.length && str[zeros] === '1') zeros++;
  const out = new Uint8Array(zeros + bytes.length);
  for(let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i];
  return out;
}

export function isCA(s){
  if(typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try{ return base58decode(s).length === 32; }catch(e){ return false; }
}

export const short = a => (a && a.length > 10 ? a.slice(0, 4) + '…' + a.slice(-4) : (a || ''));

/* ---------- parent gate ---------- */

/** Earliest pairCreatedAt (ms) among pairs, in whole days. null when no pair has a timestamp. */
export function ageDays(pairs, now = Date.now()){
  if(!Array.isArray(pairs)) return null;
  let min = Infinity;
  for(const p of pairs){
    const t = num(p && p.pairCreatedAt);
    if(t !== null && t > 0 && t < min) min = t;
  }
  if(min === Infinity) return null;
  return Math.max(0, Math.floor((now - min)/DAY_MS));
}

/**
 * parent: { found:boolean, pairs:[], liq:number, mc:number|null }
 * gives { ok, reason, checks:[{id, ok, value, need}] }
 * reason: null | 'notfound' | 'young' | 'thin' | 'nomc'
 */
export function checkGate(parent, cfg, now = Date.now()){
  const minAge = pick(cfg, 'minParentAgeDays');
  const minLiq = pick(cfg, 'minParentLiquidityUsd');
  const found = !!(parent && parent.found !== false && Array.isArray(parent.pairs) ? parent.pairs.length : parent && parent.found);
  const age = found ? ageDays(parent.pairs, now) : null;
  const liq = found && num(parent.liq) !== null ? parent.liq : 0;
  const checks = [
    { id: 'market', ok: found, value: found ? 'found' : 'not found', need: 'found' },
    { id: 'age', ok: age !== null && age >= minAge, value: age, need: minAge },
    { id: 'liquidity', ok: liq >= minLiq, value: liq, need: minLiq }
  ];
  const hasMc = found && num(parent.mc) !== null && parent.mc > 0;
  let reason = null;
  if(!checks[0].ok) reason = 'notfound';
  else if(!checks[1].ok) reason = 'young';
  else if(!checks[2].ok) reason = 'thin';
  else if(!hasMc) reason = 'nomc';
  return { ok: reason === null, reason, checks };
}

/* ---------- status ladder ---------- */

/** pilot -> onair -> official. Official iff the child's own market cap, read live, is >= officialMcapUsd. */
export function statusOf(pitch, childMarket, cfg){
  if(!pitch || !pitch.child || !pitch.child.ca) return 'pilot';
  const mc = childMarket && num(childMarket.mc);
  if(mc === null || mc === undefined) return 'onair';
  return mc >= pick(cfg, 'officialMcapUsd') ? 'official' : 'onair';
}

/* ---------- showrunner (deterministic script, not an AI) ---------- */

export const FORMATS = Object.freeze([
  { id: 'jr',     name: p => `${p} Jr.`,              ticker: 'JR',    premise: (P, T, A) => `${P} has been on air for ${A} days. The spinoff picks up with the supporting cast.` },
  { id: 'origins',name: p => `${p}: Origins`,         ticker: 'ORIG',  premise: (P)       => `Before ${P} was a hit, it was a pilot. This is that story.` },
  { id: 'dark',   name: p => `${p} After Dark`,       ticker: 'DARK',  premise: (P, T)    => `Same universe as $${T}. Different channel.` },
  { id: 'reload', name: p => `${p} Reloaded`,         ticker: 'RL',    premise: (P)       => `What the ${P} crowd does after the main show ends.` },
  { id: 'meanwhile', name: p => `Meanwhile, at ${p}`, ticker: 'MEAN',  premise: ()        => 'The side character nobody asked for and everybody keeps talking about.' },
  { id: 'pilot',  name: p => `${p}: The Pilot`,       ticker: 'PILOT', premise: ()        => "One more episode, but this time it's a different show." }
]);

export const NAME_MAX = 48;
export const TICKER_MAX = 10;

export function sanitizeTicker(s, max = TICKER_MAX){
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);
}
export function cleanLine(s){ return String(s ?? '').replace(/\s+/g, ' ').trim(); }
export function capText(s, max){
  s = cleanLine(s);
  if(s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * parent: { name, symbol, ageDays }.  seed: integer index (cycles through the 6 formats).
 * Same input -> same output, always.
 */
export function showrunner(parent, seed = 0, premiseMax = DEFAULTS.pitchPremiseMax){
  const n = FORMATS.length;
  const i = ((Math.trunc(Number(seed)) || 0) % n + n) % n;
  const f = FORMATS[i];
  const pname = cleanLine(parent && parent.name) || 'The Parent';
  const psym = sanitizeTicker(parent && parent.symbol) || 'COIN';
  const age = parent && num(parent.ageDays) !== null ? parent.ageDays : 0;
  const base = psym.slice(0, Math.max(1, TICKER_MAX - f.ticker.length));
  return {
    formatId: f.id,
    index: i,
    name: capText(f.name(pname), NAME_MAX),
    ticker: sanitizeTicker(base + f.ticker),
    premise: capText(f.premise(pname, psym, age), premiseMax)
  };
}

/* ---------- signed messages (exact templates from the copy deck) ---------- */

export function buildMessage(kind, d){
  const L = s => cleanLine(s);
  if(kind === 'pitch'){
    return [
      'SPINOFF pitch',
      `Parent: ${L(d.parentName)} ($${L(d.parentTicker)}) ${L(d.parentCA)}`,
      `Spinoff: ${L(d.childName)} ($${L(d.childTicker)})`,
      `Premise: ${L(d.premise)}`,
      `Wallet: ${L(d.wallet)}`,
      `Time: ${L(d.time)}`
    ].join('\n');
  }
  if(kind === 'claim'){
    return [
      'SPINOFF seat claim',
      `Pitch: ${L(d.pitchId)}`,
      `Parent: ${L(d.parentName)} ($${L(d.parentTicker)}) ${L(d.parentCA)}`,
      `Balance read: ${L(d.balance)}`,
      `Wallet: ${L(d.wallet)}`,
      `Time: ${L(d.time)}`
    ].join('\n');
  }
  if(kind === 'attach'){
    return [
      'SPINOFF attach',
      `Pitch: ${L(d.pitchId)}`,
      `Child: ${L(d.childCA)}`,
      `Wallet: ${L(d.wallet)}`,
      `Time: ${L(d.time)}`
    ].join('\n');
  }
  throw new Error('unknown message kind');
}

/* ---------- base64 helpers (browser + Node 18+) ---------- */

export function bytesToB64(bytes){
  let s = '';
  for(let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b64){
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for(let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const toUrl = b64 => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while(s.length % 4) s += '='; return s; };

/* ---------- pitch links ---------- */

export const PITCH_VERSION = 1;
export const LINK_MAX = 4000;

/** Compact, versioned. Everything needed to rebuild and verify the signed message is inside. */
export function encodePitch(p){
  const o = {
    v: PITCH_VERSION,
    pa: p.parent.ca, pn: p.parent.name, ps: p.parent.symbol,
    cn: p.child.name, cs: p.child.symbol,
    pr: p.premise,
    by: p.proposer,
    t: p.time,
    sg: p.sig
  };
  const json = JSON.stringify(o);
  const s = toUrl(bytesToB64(new TextEncoder().encode(json)));
  if(s.length > LINK_MAX) throw new Error('pitch too large');
  return s;
}

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

export function decodePitch(s){
  if(typeof s !== 'string' || s.length < 40 || s.length > LINK_MAX || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('bad link');
  let o;
  try{ o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64ToBytes(fromUrl(s)))); }
  catch(e){ throw new Error('bad link'); }
  if(!o || typeof o !== 'object' || o.v !== PITCH_VERSION) throw new Error('bad version');
  if(!isCA(o.pa) || !str(o.pn, 80) || !str(o.ps, 20) || !str(o.cn, 80) || !str(o.cs, TICKER_MAX) ||
     !str(o.pr, 400) || !isCA(o.by) || !str(o.t, 40) || !str(o.sg, 120)) throw new Error('bad fields');
  if(sanitizeTicker(o.cs) !== o.cs) throw new Error('bad ticker');
  if(isNaN(Date.parse(o.t))) throw new Error('bad time');
  let sigBytes;
  try{ sigBytes = b64ToBytes(o.sg); }catch(e){ throw new Error('bad signature'); }
  if(sigBytes.length !== 64) throw new Error('bad signature');
  return {
    parent: { ca: o.pa, name: o.pn, symbol: o.ps },
    child: { name: o.cn, symbol: o.cs },
    premise: o.pr, proposer: o.by, time: o.t, sig: o.sg
  };
}

/** Short stable id derived from the pitch signature (unique per signed pitch). */
export function pitchIdFromSig(sigB64){ return toUrl(sigB64).slice(0, 10); }

/** Rebuild the exact message a pitch was signed with. */
export function pitchMessage(p){
  return buildMessage('pitch', {
    parentName: p.parent.name, parentTicker: p.parent.symbol, parentCA: p.parent.ca,
    childName: p.child.name, childTicker: p.child.symbol, premise: p.premise,
    wallet: p.proposer, time: p.time
  });
}

/* ---------- hashing + signatures (WebCrypto) ---------- */

export async function sha256hex(bytes){
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if(!subtle) throw new Error('no-subtle');
  if(typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check an Ed25519 wallet signature locally.
 * gives 'valid' | 'invalid' | 'unsupported'
 */
export async function verifySignature(message, sigB64, addr){
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if(!subtle) return 'unsupported';
  let key;
  try{
    key = await subtle.importKey('raw', base58decode(addr), { name: 'Ed25519' }, false, ['verify']);
  }catch(e){
    return (e && /not supported|unrecognized|algorithm/i.test(String(e.message || e.name))) ? 'unsupported' : 'invalid';
  }
  try{
    const ok = await subtle.verify({ name: 'Ed25519' }, key, b64ToBytes(sigB64), new TextEncoder().encode(message));
    return ok ? 'valid' : 'invalid';
  }catch(e){ return 'invalid'; }
}

/* ---------- misc helpers used by pages ---------- */

/** Seats shown on a map: at most `max`, with the overflow count. */
export function seatView(claims, max = 200){
  const list = Array.isArray(claims) ? claims : [];
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/** Build a proof file object for a signed pitch. */
export function proofFile(p, fingerprint){
  return {
    spinoff: 'proof',
    version: PITCH_VERSION,
    message: pitchMessage(p),
    wallet: p.proposer,
    signature: p.sig,
    fingerprint,
    timestamp: p.time
  };
}
