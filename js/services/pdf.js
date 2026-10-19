// A small PDF writer, written from scratch so there is no library watermark and no licence issue.
//
// What it supports:
//  - one JPEG image per page (embedded as-is, so no quality is lost)
//  - an invisible text layer from OCR, so the PDF is searchable and copyable
//  - AES-256 password protection (PDF standard security handler revision 6)
//
// PDF basics, for reading this file: a PDF is a list of numbered "objects" (dictionaries
// written like << /Key value >>, optionally followed by a binary "stream"), then a table
// of byte offsets ("xref") so a reader can jump to any object, then a "trailer".

const enc = new TextEncoder();

function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const num = (v) => (Math.round(v * 1000) / 1000).toString();

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// UTF-16BE with a byte order mark: how PDF stores non-ASCII text strings like titles.
function utf16be(str) {
  const out = [0xfe, 0xff];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out.push(c >> 8, c & 0xff);
  }
  return new Uint8Array(out);
}

function pdfDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// ---------------- AES-256 encryption (revision 6) ----------------

const subtle = () => globalThis.crypto.subtle;

async function digest(alg, data) {
  return new Uint8Array(await subtle().digest(alg, data));
}

// AES-CBC without padding. WebCrypto always adds one padding block; for input that is a
// multiple of 16 bytes, the first n bytes of the output are exactly the unpadded result.
async function aesCbcRaw(keyBytes, iv, data) {
  const key = await subtle().importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, data));
  return out.subarray(0, data.length);
}

// Algorithm 2.B from ISO 32000-2: a deliberately slow, hard-to-shortcut password hash.
async function hash2B(password, salt, udata) {
  let k = await digest('SHA-256', concatBytes([password, salt, udata]));
  let e = new Uint8Array([0]);
  let i = 0;
  while (i < 64 || e[e.length - 1] > i - 32) {
    const block = concatBytes([password, k, udata]);
    const k1 = new Uint8Array(block.length * 64);
    for (let j = 0; j < 64; j++) k1.set(block, j * block.length);
    e = await aesCbcRaw(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j];
    const alg = ['SHA-256', 'SHA-384', 'SHA-512'][sum % 3];
    k = await digest(alg, e);
    i++;
  }
  return k.subarray(0, 32);
}

async function makeSecurity(passwordText) {
  const pw = enc.encode(passwordText.normalize('NFKC')).subarray(0, 127);
  const fileKey = randomBytes(32);
  const zeroIv = new Uint8Array(16);
  const uSalts = randomBytes(16);
  const U = concatBytes([await hash2B(pw, uSalts.subarray(0, 8), new Uint8Array(0)), uSalts]);
  const UE = await aesCbcRaw(await hash2B(pw, uSalts.subarray(8, 16), new Uint8Array(0)), zeroIv, fileKey);
  const oSalts = randomBytes(16);
  const O = concatBytes([await hash2B(pw, oSalts.subarray(0, 8), U), oSalts]);
  const OE = await aesCbcRaw(await hash2B(pw, oSalts.subarray(8, 16), U), zeroIv, fileKey);
  // Permissions: -4 means "everything allowed" (printing, copying...). Only opening needs the password.
  const P = -4;
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, P, true);
  perms.set([0xff, 0xff, 0xff, 0xff, 0x54, 0x61, 0x64, 0x62], 4); // ffff ffff 'T' 'a' 'd' 'b'
  perms.set(randomBytes(4), 12);
  const Perms = await aesCbcRaw(fileKey, zeroIv, perms);
  const key = await subtle().importKey('raw', fileKey, 'AES-CBC', false, ['encrypt']);
  return {
    dict:
      `<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /Type /CryptFilter /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> ` +
      `/StmF /StdCF /StrF /StdCF /O <${hex(O)}> /U <${hex(U)}> /OE <${hex(OE)}> /UE <${hex(UE)}> /P ${P} /Perms <${hex(Perms)}> /EncryptMetadata true >>`,
    // Every stream and string is encrypted with the file key and its own random IV.
    async encrypt(data) {
      const iv = randomBytes(16);
      const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, data));
      return concatBytes([iv, ct]);
    },
  };
}

// ---------------- invisible text font ----------------

// The OCR text uses a Type 3 font whose glyphs draw nothing. Viewers only need its
// ToUnicode map to know which character each code means, for search and copy.
// Type 3 fonts allow 255 codes, so documents with many different characters get several fonts.
function buildFontPlan(allTexts) {
  const chars = [];
  const seen = new Set();
  for (const t of allTexts) {
    for (const ch of t) {
      if (!seen.has(ch)) {
        seen.add(ch);
        chars.push(ch);
      }
    }
  }
  const fonts = [];
  const where = new Map(); // char -> [fontIndex, code]
  for (let i = 0; i < chars.length; i += 255) {
    const slice = chars.slice(i, i + 255);
    slice.forEach((ch, k) => where.set(ch, [fonts.length, k + 1]));
    fonts.push(slice);
  }
  return { fonts, where };
}

function toUnicodeCMap(chars) {
  const lines = [];
  for (let i = 0; i < chars.length; i += 100) {
    const part = chars.slice(i, i + 100);
    lines.push(`${part.length} beginbfchar`);
    part.forEach((ch, k) => {
      const code = (i + k + 1).toString(16).padStart(2, '0').toUpperCase();
      lines.push(`<${code}> <${hex(utf16be(ch).subarray(2))}>`);
    });
    lines.push('endbfchar');
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<01> <FF>\nendcodespacerange\n' +
    lines.join('\n') +
    '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
  );
}

// Splits a word into runs that use the same font, as [fontIndex, hexCodes, charCount].
function encodeRuns(text, where) {
  const runs = [];
  for (const ch of text) {
    const [f, code] = where.get(ch);
    const h = code.toString(16).padStart(2, '0').toUpperCase();
    const last = runs[runs.length - 1];
    if (last && last[0] === f) {
      last[1] += h;
      last[2]++;
    } else runs.push([f, h, 1]);
  }
  return runs;
}

// ---------------- the writer ----------------

/**
 * pages: [{ jpeg: Uint8Array, imgW, imgH,
 *           pageW, pageH,               // page size in points (1/72 inch)
 *           place: { x, y, w, h },      // where the image goes, points from the top-left
 *           words: [{ text, box: [x, y, w, h] }]  // optional, box as fractions of the image
 *        }]
 * options: { title, password }
 * Returns a Uint8Array with the finished PDF file.
 */
export async function buildPdf(pages, { title = 'Scan', password = '' } = {}) {
  const sec = password ? await makeSecurity(password) : null;
  const objects = []; // index = object number - 1; each { dict, stream }
  const alloc = () => objects.push(null);

  const catalogNum = alloc();
  const pagesNum = alloc();
  const infoNum = alloc();

  const allWords = [];
  for (const p of pages) for (const w of p.words || []) allWords.push(w.text);
  const plan = buildFontPlan(allWords.length ? [...allWords, ' '] : []);
  const glyphNum = plan.fonts.length ? alloc() : 0;
  const fontNums = plan.fonts.map(() => [alloc(), alloc()]); // [font, toUnicode]

  const kids = [];
  const pageObjs = [];
  for (let i = 0; i < pages.length; i++) {
    const pageNum = alloc(), contentNum = alloc(), imageNum = alloc();
    kids.push(pageNum);
    pageObjs.push({ pageNum, contentNum, imageNum });
  }

  const set = (n, dict, stream = null) => {
    objects[n - 1] = { dict, stream };
  };

  set(catalogNum, `<< /Type /Catalog /Pages ${pagesNum} 0 R${sec ? ' /Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel 8 >> >>' : ''} >>`);
  set(pagesNum, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  // Strings in an encrypted file must be encrypted too, so the title is written last (async).
  const titleBytes = utf16be(title);
  const producerBytes = utf16be('ClearPage');
  set(infoNum, null);

  if (plan.fonts.length) {
    set(glyphNum, '<< >>', enc.encode('500 0 d0'));
    plan.fonts.forEach((chars, fi) => {
      const [fontNum, cmapNum] = fontNums[fi];
      const diffs = chars.map(() => '/g').join(' ');
      set(
        fontNum,
        `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 500 1000] /FontMatrix [0.001 0 0 0.001 0 0] ` +
          `/CharProcs << /g ${glyphNum} 0 R >> /Encoding << /Type /Encoding /Differences [1 ${diffs}] >> ` +
          `/FirstChar 1 /LastChar ${chars.length} /Widths [${chars.map(() => '500').join(' ')}] ` +
          `/ToUnicode ${cmapNum} 0 R /Resources << >> >>`,
      );
      set(cmapNum, '<< >>', enc.encode(toUnicodeCMap(chars)));
    });
  }
  const fontRes = plan.fonts.length ? ` /Font << ${fontNums.map(([n], i) => `/F${i} ${n} 0 R`).join(' ')} >>` : '';

  pages.forEach((p, i) => {
    const { pageNum, contentNum, imageNum } = pageObjs[i];
    const { x, y, w, h } = p.place;
    // PDF measures y from the bottom of the page, so flip.
    const by = p.pageH - y - h;
    let content = `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(by)} cm /Im0 Do Q\n`;
    if (p.words && p.words.length && plan.fonts.length) {
      content += 'BT 3 Tr\n';
      for (const word of p.words) {
        const [wx, wy, ww, wh] = word.box;
        const bx = x + wx * w, bw = ww * w, bh = wh * h;
        const top = y + wy * h;
        const fs = Math.max(1, bh);
        const baseline = p.pageH - (top + bh) + bh * 0.2;
        const n = [...word.text].length;
        if (!n || bw <= 0) continue;
        // Stretch the invisible glyphs so the selectable text covers the word exactly.
        const scale = (100 * bw) / (n * 0.5 * fs);
        let line = `${num(scale)} Tz 1 0 0 1 ${num(bx)} ${num(baseline)} Tm`;
        const runs = encodeRuns(word.text + (word.space ? ' ' : ''), plan.where);
        for (const [f, codes] of runs) line += ` /F${f} ${num(fs)} Tf <${codes}> Tj`;
        content += line + '\n';
      }
      content += 'ET\n';
    }
    set(contentNum, '<< >>', enc.encode(content));
    set(
      imageNum,
      `<< /Type /XObject /Subtype /Image /Width ${p.imgW} /Height ${p.imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`,
      p.jpeg,
    );
    set(
      pageNum,
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${num(p.pageW)} ${num(p.pageH)}] ` +
        `/Resources << /XObject << /Im0 ${imageNum} 0 R >>${fontRes} >> /Contents ${contentNum} 0 R >>`,
    );
  });

  const strEnc = async (bytes) => `<${hex(sec ? await sec.encrypt(bytes) : bytes)}>`;
  set(infoNum, `<< /Title ${await strEnc(titleBytes)} /Producer ${await strEnc(producerBytes)} /CreationDate ${await strEnc(enc.encode(pdfDate()))} >>`);

  // ---- serialise ----
  const chunks = [];
  let offset = 0;
  const push = (bytes) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  push(enc.encode('%PDF-1.7\n%âãÏÓ\n'));
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    offsets.push(offset);
    if (o.stream) {
      const data = sec ? await sec.encrypt(o.stream) : o.stream;
      const dict = o.dict.replace(/>>\s*$/, ` /Length ${data.length} >>`);
      push(enc.encode(`${i + 1} 0 obj\n${dict}\nstream\n`));
      push(data);
      push(enc.encode('\nendstream\nendobj\n'));
    } else {
      push(enc.encode(`${i + 1} 0 obj\n${o.dict}\nendobj\n`));
    }
  }
  let encryptRef = '';
  if (sec) {
    offsets.push(offset);
    const n = objects.length + 1;
    push(enc.encode(`${n} 0 obj\n${sec.dict}\nendobj\n`));
    encryptRef = ` /Encrypt ${n} 0 R`;
  }
  const xrefStart = offset;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const id = hex(randomBytes(16));
  xref += `trailer\n<< /Size ${offsets.length + 1} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R${encryptRef} /ID [<${id}> <${id}>] >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  push(enc.encode(xref));
  return concatBytes(chunks);
}

// Reads width and height from a JPEG's header (the SOF marker), without decoding it.
export function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  throw new Error('Not a JPEG');
}

// Page sizes in points.
export const PAGE_SIZES = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

// Works out page size and image placement.
// "auto" makes the page the same shape as the scan, with an 11 inch long side.
export function layoutPage(imgW, imgH, size = 'auto') {
  const landscape = imgW > imgH;
  if (size === 'auto') {
    const long = 792;
    const pageW = landscape ? long : (long * imgW) / imgH;
    const pageH = landscape ? (long * imgH) / imgW : long;
    return { pageW, pageH, place: { x: 0, y: 0, w: pageW, h: pageH } };
  }
  let [pw, ph] = PAGE_SIZES[size] || PAGE_SIZES.letter;
  if (landscape) [pw, ph] = [ph, pw];
  // Fit inside the page, centred, keeping the scan's shape.
  const s = Math.min(pw / imgW, ph / imgH);
  const w = imgW * s, h = imgH * s;
  return { pageW: pw, pageH: ph, place: { x: (pw - w) / 2, y: (ph - h) / 2, w, h } };
}
