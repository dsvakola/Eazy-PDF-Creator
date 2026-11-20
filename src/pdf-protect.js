'use strict';
// Eazy PDF Creator — PDF protection module (RC4-128 encryption, PDF 1.4 Rev 3)
// Pure-JS RC4 so it works even when OpenSSL has RC4 disabled (Electron 33+).
// Copyright (C) 2026 Vidyasagar Academy — GPL-3.0-or-later

const crypto = require('crypto');

// ── Password padding constant (PDF spec §3.5.2) ───────────────────────────────
const PASS_PAD = Buffer.from(
  '28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex'
);

function padPassword(pass) {
  const b = Buffer.from(pass || '', 'latin1').slice(0, 32);
  const r = Buffer.alloc(32);
  b.copy(r);
  if (b.length < 32) PASS_PAD.copy(r, b.length, 0, 32 - b.length);
  return r;
}

// ── Pure-JS RC4 ───────────────────────────────────────────────────────────────
function rc4(data, key) {
  const K = Buffer.isBuffer(key) ? key : Buffer.from(key);
  const D = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary');
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + K[i % K.length]) & 0xFF;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = Buffer.allocUnsafe(D.length);
  for (let k = 0, i = 0, j = 0; k < D.length; k++) {
    i = (i + 1) & 0xFF;
    j = (j + S[i]) & 0xFF;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[k] = D[k] ^ S[(S[i] + S[j]) & 0xFF];
  }
  return out;
}

// ── MD5 helper ────────────────────────────────────────────────────────────────
function md5(...parts) {
  const h = crypto.createHash('md5');
  for (const p of parts) h.update(p);
  return h.digest();
}

// ── Security key computation ──────────────────────────────────────────────────

/** O entry — owner verification value (32 bytes) */
function computeO(ownerPass, userPass) {
  const po = padPassword(ownerPass || userPass);
  const pu = padPassword(userPass);
  let h = md5(po);
  for (let i = 0; i < 50; i++) h = md5(h);
  const key16 = h.slice(0, 16);
  let r = Buffer.from(pu);
  for (let i = 0; i <= 19; i++) {
    const k = Buffer.from(key16).map((b, _) => b ^ i);
    r = rc4(r, k);
  }
  return r;
}

/** EK — 128-bit encryption key */
function computeEK(userPass, O, perm, fid) {
  const pu = padPassword(userPass);
  const pb = Buffer.allocUnsafe(4);
  pb.writeInt32LE(perm, 0);
  let h = md5(pu, O, pb, fid);
  for (let i = 0; i < 50; i++) h = md5(h.slice(0, 16));
  return h.slice(0, 16);
}

/** U entry — user verification value (32 bytes) */
function computeU(EK, fid) {
  let u = md5(PASS_PAD, fid);
  for (let i = 0; i <= 19; i++) u = rc4(u, Buffer.from(EK).map((b, _) => b ^ i));
  const r = Buffer.alloc(32, 0);
  u.copy(r);
  return r;
}

/** Per-object encryption key */
function objKey(EK, objN, genN) {
  const e = Buffer.from([
    objN & 0xFF, (objN >> 8) & 0xFF, (objN >> 16) & 0xFF,
    genN & 0xFF, (genN >> 8) & 0xFF,
  ]);
  return md5(EK, e).slice(0, Math.min(16, EK.length + 5));
}

// ── Literal string decoder ────────────────────────────────────────────────────
function decodeLiteralStr(raw) {
  const bytes = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const c = raw[i + 1];
      if      (c === 'n')  { bytes.push(10); i += 2; }
      else if (c === 'r')  { bytes.push(13); i += 2; }
      else if (c === 't')  { bytes.push(9);  i += 2; }
      else if (c === 'b')  { bytes.push(8);  i += 2; }
      else if (c === 'f')  { bytes.push(12); i += 2; }
      else if (c === '(' || c === ')' || c === '\\') {
        bytes.push(c.charCodeAt(0)); i += 2;
      } else if (c >= '0' && c <= '7') {
        let oct = c; i += 2;
        if (i < raw.length && raw[i] >= '0' && raw[i] <= '7') oct += raw[i++];
        if (i < raw.length && raw[i] >= '0' && raw[i] <= '7') oct += raw[i++];
        bytes.push(parseInt(oct, 8));
      } else {
        bytes.push(raw.charCodeAt(i + 1)); i += 2;
      }
    } else {
      bytes.push(raw.charCodeAt(i++));
    }
  }
  return Buffer.from(bytes);
}

// ── Object body encryptor ─────────────────────────────────────────────────────
/**
 * Walks through the latin-1 string `body` (content between "N M obj" and "endobj"),
 * encrypts every PDF string and stream found, and returns the encrypted body string.
 */
function encryptBody(body, EK, objN, genN) {
  const key = objKey(EK, objN, genN);
  const out = [];
  let i = 0;

  while (i < body.length) {
    // ── Stream ──────────────────────────────────────────────────────────────
    if (body.startsWith('stream', i)) {
      let si = i + 6;
      if (body[si] === '\r') si++;
      if (body[si] === '\n') si++;
      const ei = body.indexOf('endstream', si);
      if (ei === -1) { out.push(body.slice(i)); break; }
      let se = ei;
      if (se > 0 && body[se - 1] === '\n') se--;
      if (se > 0 && body[se - 1] === '\r') se--;
      const streamData = Buffer.from(body.slice(si, se), 'binary');
      const encStream  = rc4(streamData, key);
      out.push('stream\n', encStream.toString('binary'), '\nendstream');
      i = ei + 9;  // skip 'endstream'
      continue;
    }

    // ── Hex string <HEXHEX> ─────────────────────────────────────────────────
    if (body[i] === '<' && body[i + 1] !== '<') {
      let j = i + 1;
      while (j < body.length && body[j] !== '>') j++;
      const hex = body.slice(i + 1, j).replace(/\s/g, '');
      if (/^[0-9a-fA-F]*$/.test(hex)) {
        const h = hex.length % 2 ? hex + '0' : hex;
        if (h.length) {
          const enc = rc4(Buffer.from(h, 'hex'), key);
          out.push('<', enc.toString('hex').toUpperCase(), '>');
        } else {
          out.push('<>');
        }
        i = j + 1;
        continue;
      }
      // Not a valid hex string — copy verbatim
      out.push(body[i++]);
      continue;
    }

    // ── Literal string (...) ────────────────────────────────────────────────
    if (body[i] === '(') {
      let depth = 1, j = i + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === '\\') { j += 2; continue; }
        if (body[j] === '(') depth++;
        else if (body[j] === ')') depth--;
        j++;
      }
      const raw = body.slice(i + 1, j - 1);
      const bytes = decodeLiteralStr(raw);
      const enc   = rc4(bytes, key);
      // Re-encode as hex string — always safe regardless of byte values
      out.push('<', enc.toString('hex').toUpperCase(), '>');
      i = j;
      continue;
    }

    // ── String comment % — skip to EOL ──────────────────────────────────────
    if (body[i] === '%') {
      let j = i + 1;
      while (j < body.length && body[j] !== '\n' && body[j] !== '\r') j++;
      out.push(body.slice(i, j));
      i = j;
      continue;
    }

    out.push(body[i++]);
  }

  return out.join('');
}

// ── Dict-end finder ───────────────────────────────────────────────────────────
function findDictEnd(str, start) {
  let depth = 1, i = start + 2;
  while (i < str.length && depth > 0) {
    if (str[i] === '<' && str[i + 1] === '<') { depth++; i += 2; continue; }
    if (str[i] === '>' && str[i + 1] === '>') { depth--; if (depth === 0) return i; i += 2; continue; }
    i++;
  }
  return i;
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * @param {Uint8Array} pdfBytes   Raw PDF bytes (from pdf-lib or original file)
 * @param {object}     options
 * @param {string}     options.userPassword   Password to open the file (empty = no open password)
 * @param {string}     options.ownerPassword  Master password (auto-generated if empty)
 * @param {boolean}    options.lockPrinting
 * @param {boolean}    options.lockCopying
 * @param {boolean}    options.lockModifying
 * @returns {Buffer}  Encrypted PDF bytes
 */
function protectPdf(pdfBytes, options = {}) {
  const {
    userPassword  = '',
    ownerPassword = '',
    lockPrinting  = false,
    lockCopying   = false,
    lockModifying = false,
  } = options;

  const hasPassword = userPassword.length > 0;
  const hasLocks    = lockPrinting || lockCopying || lockModifying;

  // Nothing to do — return original bytes untouched
  if (!hasPassword && !hasLocks) return Buffer.from(pdfBytes);

  // ── Permissions bitmask (PDF 1.4 §3.5.2, signed 32-bit int) ───────────────
  // Bits 1-2 = 0 (reserved), bits 7-8 = 0 (reserved), bits 13-32 = 1 (reserved)
  // All other bits = 1 means "allowed".
  let perm = -4 & ~0xC0;    // 0xFFFFFF3C → bits 1-2 and 7-8 cleared
  if (lockPrinting)  { perm &= ~0x004; perm &= ~0x800; }  // bits 3 and 12
  if (lockModifying) { perm &= ~0x008; }                   // bit 4
  if (lockCopying)   { perm &= ~0x010; }                   // bit 5
  perm = perm | 0;  // ensure signed 32-bit

  // ── Generate security values ───────────────────────────────────────────────
  const fid = crypto.randomBytes(16);
  const ownerPass = ownerPassword || (crypto.randomBytes(12).toString('hex'));
  const O  = computeO(ownerPass, userPassword);
  const EK = computeEK(userPassword, O, perm, fid);
  const U  = computeU(EK, fid);

  // ── Parse PDF as a latin-1 string ─────────────────────────────────────────
  const src = Buffer.from(pdfBytes).toString('binary');

  // Find all objects
  const objRe = /\b(\d+)\s+(\d+)\s+obj\b/g;
  const starts = [];
  let m;
  while ((m = objRe.exec(src)) !== null) {
    starts.push({ objN: +m[1], genN: +m[2], pos: m.index, bodyStart: m.index + m[0].length });
  }
  if (!starts.length) throw new Error('No PDF objects found');

  // Find endobj for each
  const objects = [];
  for (let k = 0; k < starts.length; k++) {
    const { objN, genN, pos, bodyStart } = starts[k];
    const limit = k + 1 < starts.length ? starts[k + 1].pos : src.length;
    // Find the last 'endobj' before the next object starts
    let eidx = -1;
    let searchFrom = bodyStart;
    while (true) {
      const found = src.indexOf('endobj', searchFrom);
      if (found === -1 || found > limit) break;
      eidx = found;
      searchFrom = found + 6;
    }
    if (eidx < bodyStart) continue;
    objects.push({ objN, genN, pos, bodyStart, bodyEnd: eidx });
  }

  const maxObjN   = Math.max(...objects.map(o => o.objN));
  const encObjN   = maxObjN + 1;
  const fidHex    = fid.toString('hex').toUpperCase();
  const oHex      = O.toString('hex').toUpperCase();
  const uHex      = U.toString('hex').toUpperCase();

  // ── Build encrypted output ─────────────────────────────────────────────────
  const parts = [];
  const newOffsets = new Map();  // objN → byte offset in output
  let outputLen = 0;

  function push(str) {
    const buf = Buffer.from(str, 'binary');
    parts.push(buf);
    outputLen += buf.length;
  }

  // Header (everything before the first object)
  push(src.slice(0, objects[0].pos));

  for (const obj of objects) {
    newOffsets.set(obj.objN, outputLen);
    const header = `${obj.objN} ${obj.genN} obj`;
    push(header);

    const rawBody = src.slice(obj.bodyStart, obj.bodyEnd);
    let encBody;
    try { encBody = encryptBody(rawBody, EK, obj.objN, obj.genN); }
    catch (_) { encBody = rawBody; }  // fallback: copy unmodified

    push(encBody);
    push('\nendobj\n');
  }

  // ── Encrypt object (not encrypted itself per spec) ─────────────────────────
  newOffsets.set(encObjN, outputLen);
  push(
    `${encObjN} 0 obj\n` +
    `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${perm} ` +
    `/O <${oHex}> /U <${uHex}> >>\n` +
    `endobj\n`
  );

  // ── Updated trailer ────────────────────────────────────────────────────────
  const trailerIdx = src.lastIndexOf('trailer');
  if (trailerIdx < 0) throw new Error('No trailer in PDF');
  const dictStart   = src.indexOf('<<', trailerIdx);
  const dictEnd     = findDictEnd(src, dictStart);
  let   trailerDict = src.slice(dictStart + 2, dictEnd);

  // Update /Size, strip old /Encrypt and /ID
  trailerDict = trailerDict.replace(/\/Size\s+\d+/, `/Size ${encObjN + 1}`);
  trailerDict = trailerDict.replace(/\/Encrypt\s+\d+\s+\d+\s+R/, '');
  trailerDict = trailerDict.replace(/\/ID\s*\[[\s\S]*?\]/, '');
  trailerDict = trailerDict.trim();
  trailerDict += ` /Encrypt ${encObjN} 0 R /ID [<${fidHex}><${fidHex}>]`;

  // ── New cross-reference table ─────────────────────────────────────────────
  const xrefOffset = outputLen;
  const sortedNums = [...newOffsets.keys()].sort((a, b) => a - b);
  const maxN = sortedNums[sortedNums.length - 1];

  let xref = `xref\n0 ${maxN + 1}\n`;
  xref += '0000000000 65535 f \n';  // object 0 — always free
  for (let n = 1; n <= maxN; n++) {
    if (newOffsets.has(n)) {
      xref += String(newOffsets.get(n)).padStart(10, '0') + ' 00000 n \n';
    } else {
      xref += '0000000000 65535 f \n';
    }
  }
  xref += `trailer\n<<${trailerDict}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  push(xref);

  return Buffer.concat(parts);
}

module.exports = { protectPdf };
