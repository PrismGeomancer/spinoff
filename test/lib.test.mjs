import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  DAY_MS, ageDays, checkGate, statusOf, showrunner, buildMessage, encodePitch, decodePitch,
  base58decode, isCA, sha256hex, sanitizeTicker, usdShort, fmtUsd, pitchMessage, pitchIdFromSig,
  verifySignature, bytesToB64, seatView, proofFile, FORMATS, LINK_MAX
} from '../assets/lib.js';

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const CFG = { minParentAgeDays: 30, minParentLiquidityUsd: 10000, officialMcapUsd: 100000, pitchPremiseMax: 140 };
const WSOL = 'So11111111111111111111111111111111111111112';
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

const parentWith = (days, liq = 50000, mc = 1e6) => ({
  found: true, liq, mc,
  pairs: [{ pairCreatedAt: NOW - days*DAY_MS }, { pairCreatedAt: NOW - 2*DAY_MS }]
});

/* ---------- age ---------- */
test('ageDays uses the earliest pairCreatedAt', () => {
  assert.equal(ageDays([{ pairCreatedAt: NOW - 40*DAY_MS }, { pairCreatedAt: NOW - 3*DAY_MS }], NOW), 40);
});
test('ageDays ignores pairs with no timestamp and returns null when none', () => {
  assert.equal(ageDays([{}, { pairCreatedAt: NOW - 5*DAY_MS }], NOW), 5);
  assert.equal(ageDays([{}, { pairCreatedAt: 0 }], NOW), null);
  assert.equal(ageDays(undefined, NOW), null);
});
test('ageDays floors partial days', () => {
  assert.equal(ageDays([{ pairCreatedAt: NOW - (30*DAY_MS - 1) }], NOW), 29);
});

/* ---------- gate ---------- */
test('gate boundary: 29 days fails, 30 days passes', () => {
  const g29 = checkGate(parentWith(29), CFG, NOW);
  assert.equal(g29.ok, false); assert.equal(g29.reason, 'young');
  assert.equal(g29.checks.find(c => c.id === 'age').value, 29);
  const g30 = checkGate(parentWith(30), CFG, NOW);
  assert.equal(g30.ok, true); assert.equal(g30.reason, null);
});
test('gate boundary: liquidity exactly at the line passes, one below fails', () => {
  assert.equal(checkGate(parentWith(60, 10000), CFG, NOW).ok, true);
  const g = checkGate(parentWith(60, 9999.99), CFG, NOW);
  assert.equal(g.ok, false); assert.equal(g.reason, 'thin');
});
test('gate reads thresholds from config, not constants', () => {
  const cfg = { ...CFG, minParentAgeDays: 7, minParentLiquidityUsd: 500 };
  assert.equal(checkGate(parentWith(7, 500), cfg, NOW).ok, true);
  assert.equal(checkGate(parentWith(6, 500), cfg, NOW).ok, false);
  assert.equal(checkGate(parentWith(7, 499), cfg, NOW).ok, false);
});
test('gate: not found and missing market cap', () => {
  assert.equal(checkGate({ found: false, pairs: [], liq: 0 }, CFG, NOW).reason, 'notfound');
  assert.equal(checkGate(null, CFG, NOW).reason, 'notfound');
  assert.equal(checkGate(parentWith(60, 50000, null), CFG, NOW).reason, 'nomc');
  assert.equal(checkGate(parentWith(60, 50000, 0), CFG, NOW).reason, 'nomc');
});
test('gate lists three checks with real values', () => {
  const g = checkGate(parentWith(45, 12345), CFG, NOW);
  assert.deepEqual(g.checks.map(c => c.id), ['market', 'age', 'liquidity']);
  assert.equal(g.checks[2].value, 12345);
});

/* ---------- status ---------- */
test('status ladder: pilot -> onair -> official', () => {
  assert.equal(statusOf({}, null, CFG), 'pilot');
  assert.equal(statusOf({ child: null }, { mc: 1e9 }, CFG), 'pilot');
  const p = { child: { ca: WSOL } };
  assert.equal(statusOf(p, null, CFG), 'onair');
  assert.equal(statusOf(p, { mc: null }, CFG), 'onair');
  assert.equal(statusOf(p, { mc: 5000 }, CFG), 'onair');
});
test('official boundary: 99,999 is on air, 100,000 is official', () => {
  const p = { child: { ca: WSOL } };
  assert.equal(statusOf(p, { mc: 99999 }, CFG), 'onair');
  assert.equal(statusOf(p, { mc: 100000 }, CFG), 'official');
  assert.equal(statusOf(p, { mc: 100001 }, CFG), 'official');
});
test('status can go back to on air when the market cap falls', () => {
  const p = { child: { ca: WSOL } };
  assert.equal(statusOf(p, { mc: 150000 }, CFG), 'official');
  assert.equal(statusOf(p, { mc: 80000 }, CFG), 'onair');
});
test('official threshold comes from config', () => {
  const p = { child: { ca: WSOL } };
  assert.equal(statusOf(p, { mc: 49999 }, { officialMcapUsd: 50000 }), 'onair');
  assert.equal(statusOf(p, { mc: 50000 }, { officialMcapUsd: 50000 }), 'official');
});

/* ---------- showrunner ---------- */
const PARENT = { name: 'Pump Cat', symbol: 'PCAT', ageDays: 212 };
test('showrunner is deterministic', () => {
  for(let s = 0; s < 12; s++) assert.deepEqual(showrunner(PARENT, s), showrunner({ ...PARENT }, s));
});
test('showrunner cycles through the six formats in deck order', () => {
  assert.deepEqual(FORMATS.map(f => f.id), ['jr', 'origins', 'dark', 'reload', 'meanwhile', 'pilot']);
  assert.equal(showrunner(PARENT, 0).name, 'Pump Cat Jr.');
  assert.equal(showrunner(PARENT, 1).name, 'Pump Cat: Origins');
  assert.equal(showrunner(PARENT, 2).name, 'Pump Cat After Dark');
  assert.equal(showrunner(PARENT, 3).name, 'Pump Cat Reloaded');
  assert.equal(showrunner(PARENT, 4).name, 'Meanwhile, at Pump Cat');
  assert.equal(showrunner(PARENT, 5).name, 'Pump Cat: The Pilot');
  assert.equal(showrunner(PARENT, 6).name, 'Pump Cat Jr.');
  assert.equal(showrunner(PARENT, -1).name, 'Pump Cat: The Pilot');
});
test('showrunner tickers and premises match the deck', () => {
  assert.equal(showrunner(PARENT, 0).ticker, 'PCATJR');
  assert.equal(showrunner(PARENT, 1).ticker, 'PCATORIG');
  assert.equal(showrunner(PARENT, 5).ticker, 'PCATPILOT');
  assert.equal(showrunner(PARENT, 0).premise, 'Pump Cat has been on air for 212 days. The spinoff picks up with the supporting cast.');
  assert.equal(showrunner(PARENT, 1).premise, 'Before Pump Cat was a hit, it was a pilot. This is that story.');
  assert.equal(showrunner(PARENT, 2).premise, 'Same universe as $PCAT. Different channel.');
  assert.equal(showrunner(PARENT, 3).premise, 'What the Pump Cat crowd does after the main show ends.');
  assert.equal(showrunner(PARENT, 4).premise, 'The side character nobody asked for and everybody keeps talking about.');
  assert.equal(showrunner(PARENT, 5).premise, "One more episode, but this time it's a different show.");
});
test('ticker sanitising: letters and digits only, uppercase, max 10', () => {
  assert.equal(sanitizeTicker('pe-pe!$ 2'), 'PEPE2');
  assert.equal(sanitizeTicker('ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJ');
  assert.equal(sanitizeTicker(null), '');
  const r = showrunner({ name: 'Weird', symbol: 'w$e i-r_d🙂LONGTICKER', ageDays: 40 }, 5);
  assert.match(r.ticker, /^[A-Z0-9]{1,10}$/);
  assert.ok(r.ticker.endsWith('PILOT'));
});
test('long parent tickers keep the format suffix and stay within 10 chars', () => {
  for(let s = 0; s < 6; s++){
    const r = showrunner({ name: 'X', symbol: 'ABCDEFGHIJKLMNO', ageDays: 1 }, s);
    assert.ok(r.ticker.length <= 10, r.ticker);
  }
  assert.equal(showrunner({ name: 'X', symbol: 'ABCDEFGHIJKLMNO', ageDays: 1 }, 5).ticker, 'ABCDEPILOT');
});
test('premise length is capped', () => {
  const longName = 'N'.repeat(70);
  const r = showrunner({ name: longName, symbol: 'LONG', ageDays: 31 }, 0, 140);
  assert.ok(r.premise.length <= 140);
  assert.ok(showrunner(PARENT, 0, 30).premise.length <= 30);
  assert.ok(r.name.length <= 48);
});
test('showrunner survives empty parent data', () => {
  const r = showrunner({}, 0);
  assert.ok(r.name && r.ticker && r.premise);
});

/* ---------- messages ---------- */
test('pitch message matches the deck exactly', () => {
  const m = buildMessage('pitch', {
    parentName: 'Pump Cat', parentTicker: 'PCAT', parentCA: WSOL, childName: 'Pump Cat Jr.', childTicker: 'PCATJR',
    premise: 'Same universe.', wallet: WALLET, time: '2026-11-08T12:00:00.000Z'
  });
  assert.equal(m, [
    'SPINOFF pitch',
    `Parent: Pump Cat ($PCAT) ${WSOL}`,
    'Spinoff: Pump Cat Jr. ($PCATJR)',
    'Premise: Same universe.',
    `Wallet: ${WALLET}`,
    'Time: 2026-11-08T12:00:00.000Z'
  ].join('\n'));
});
test('claim and attach messages match the deck', () => {
  const c = buildMessage('claim', { pitchId: 'abc', parentName: 'Pump Cat', parentTicker: 'PCAT', parentCA: WSOL, balance: '1234.5', wallet: WALLET, time: 'T' });
  assert.equal(c.split('\n')[0], 'SPINOFF seat claim');
  assert.ok(c.includes('Balance read: 1234.5'));
  assert.ok(c.endsWith('Time: T'));
  const a = buildMessage('attach', { pitchId: 'abc', childCA: WSOL, wallet: WALLET, time: 'T' });
  assert.equal(a, ['SPINOFF attach', 'Pitch: abc', `Child: ${WSOL}`, `Wallet: ${WALLET}`, 'Time: T'].join('\n'));
});
test('messages cannot be broken by newlines in user text', () => {
  const m = buildMessage('pitch', { parentName: 'A', parentTicker: 'A', parentCA: WSOL, childName: 'B', childTicker: 'B', premise: 'line1\nWallet: evil\nTime: now', wallet: WALLET, time: 'T' });
  assert.equal(m.split("\n").length, 6);
});
test('unknown message kind throws', () => assert.throws(() => buildMessage('nope', {})));

/* ---------- links ---------- */
const PITCH = () => ({
  parent: { ca: WSOL, name: 'Pump Cat', symbol: 'PCAT' },
  child: { name: 'Pump Cat Jr.', symbol: 'PCATJR' },
  premise: 'Same universe as $PCAT. Different channel. Ünïcode ✓',
  proposer: WALLET, time: '2026-11-08T12:00:00.000Z',
  sig: bytesToB64(new Uint8Array(64).map((_, i) => i * 3))
});
test('encode/decode roundtrip, unicode safe', () => {
  const p = PITCH();
  const s = encodePitch(p);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePitch(s), p);
});
test('decode throws on garbage', () => {
  for(const bad of ['', 'x', 'not a link', '%%%%', null, undefined, 42, 'A'.repeat(100), '!'.repeat(80)])
    assert.throws(() => decodePitch(bad), undefined, String(bad));
});
test('decode throws on corrupted input', () => {
  const s = encodePitch(PITCH());
  assert.throws(() => decodePitch(s.slice(0, s.length - 30)));
  assert.throws(() => decodePitch(s.slice(0, 20) + 'Z' + s.slice(21) + 'Z'.repeat(3)) );
  // valid base64url JSON but wrong shape
  const wrong = Buffer.from(JSON.stringify({ v: 1, hello: 'world' })).toString('base64url').padEnd(60, 'A');
  assert.throws(() => decodePitch(wrong));
});
test('decode throws on wrong version, bad CA, bad ticker, bad signature length', () => {
  const mk = patch => {
    const o = { v: 1, pa: WSOL, pn: 'P', ps: 'P', cn: 'C', cs: 'CC', pr: 'x', by: WALLET, t: '2026-11-08T12:00:00.000Z', sg: bytesToB64(new Uint8Array(64)), ...patch };
    return Buffer.from(JSON.stringify(o)).toString('base64url');
  };
  assert.doesNotThrow(() => decodePitch(mk({})));
  assert.throws(() => decodePitch(mk({ v: 2 })));
  assert.throws(() => decodePitch(mk({ pa: 'short' })));
  assert.throws(() => decodePitch(mk({ cs: 'bad ticker' })));
  assert.throws(() => decodePitch(mk({ sg: bytesToB64(new Uint8Array(10)) })));
  assert.throws(() => decodePitch(mk({ t: 'not a date' })));
});
test('oversized input is rejected in decode and encode', () => {
  assert.throws(() => decodePitch('A'.repeat(LINK_MAX + 1)));
  const p = PITCH(); p.premise = 'x'.repeat(LINK_MAX);
  assert.throws(() => encodePitch(p));
});
test('pitch id derives from signature and the rebuilt message is stable', () => {
  const p = PITCH();
  assert.equal(pitchIdFromSig(p.sig).length, 10);
  assert.equal(pitchMessage(p), pitchMessage(decodePitch(encodePitch(p))));
});

/* ---------- base58 / CA ---------- */
test('base58decode and isCA', () => {
  assert.equal(base58decode(WSOL).length, 32);
  assert.equal(base58decode('1'.repeat(32)).length, 32);
  assert.equal(base58decode('2').length, 1);
  assert.throws(() => base58decode('0OIl'));
  assert.throws(() => base58decode(''));
  assert.equal(isCA(WSOL), true);
  assert.equal(isCA(WALLET), true);
  assert.equal(isCA('short'), false);
  assert.equal(isCA(WSOL + 'x'.repeat(10)), false);
  assert.equal(isCA('0' + WSOL.slice(1)), false);
  assert.equal(isCA(undefined), false);
});

/* ---------- hashing + signature verification ---------- */
test('sha256hex', async () => {
  assert.equal(await sha256hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('Ed25519 verification: valid, tampered, wrong wallet', async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey));
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n; for(const b of raw) n = n*256n + BigInt(b);
  let addr = ''; while(n > 0n){ addr = B58[Number(n % 58n)] + addr; n /= 58n; }
  for(const b of raw){ if(b === 0) addr = '1' + addr; else break; }
  const msg = 'SPINOFF pitch\nhello';
  const sig = bytesToB64(new Uint8Array(await webcrypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(msg))));
  assert.equal(await verifySignature(msg, sig, addr), 'valid');
  assert.equal(await verifySignature(msg + '!', sig, addr), 'invalid');
  assert.equal(await verifySignature(msg, sig, WALLET), 'invalid');
});

/* ---------- formatting + misc ---------- */
test('usdShort renders config numbers without needless decimals', () => {
  assert.equal(usdShort(100000), '$100K');
  assert.equal(usdShort(10000), '$10K');
  assert.equal(usdShort(2500000), '$2.5M');
  assert.equal(usdShort(1500), '$1.5K');
  assert.equal(usdShort(50), '$50');
});
test('fmtUsd for market data', () => {
  assert.equal(fmtUsd(84000), '$84.0K');
  assert.equal(fmtUsd(1900000), '$1.90M');
  assert.equal(fmtUsd(NaN), '—');
});
test('seatView caps at 200 and counts the overflow', () => {
  const claims = Array.from({ length: 235 }, (_, i) => ({ i }));
  const v = seatView(claims, 200);
  assert.equal(v.shown.length, 200); assert.equal(v.more, 35);
  assert.equal(seatView([], 200).more, 0);
});
test('proof file carries the exact signed message', () => {
  const p = PITCH();
  const f = proofFile(p, 'abcd');
  assert.equal(f.message, pitchMessage(p));
  assert.equal(f.wallet, WALLET);
  assert.equal(f.signature, p.sig);
});
