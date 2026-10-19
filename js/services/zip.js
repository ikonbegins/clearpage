// Minimal ZIP writer and reader for backups. Files are "stored" (not compressed):
// photos and PDFs are already compressed, so zipping them again gains almost nothing.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const enc = new TextEncoder();

/** entries: [{ name, data: Blob | Uint8Array | string }] -> Blob */
export async function makeZip(entries, onProgress) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let bytes;
    if (typeof e.data === 'string') bytes = enc.encode(e.data);
    else if (e.data instanceof Uint8Array) bytes = e.data;
    else bytes = new Uint8Array(await e.data.arrayBuffer());
    const name = enc.encode(e.name);
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // bit 11: file names are UTF-8
    local.setUint16(8, 0, true); // method 0 = stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, bytes);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, bytes.length, true);
    cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    offset += 30 + name.length + bytes.length;
    if (onProgress) onProgress((i + 1) / entries.length);
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.byteLength;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/** Reads a ZIP (stored or deflated entries). Returns Map name -> Blob. */
export async function readZip(blob) {
  const tailSize = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a ZIP backup');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const files = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged ZIP file');
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const lh = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
    const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    let data = blob.slice(start, start + compSize);
    if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack compressed ZIP files');
      data = await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    } else if (method !== 0) {
      throw new Error('Unsupported ZIP compression');
    }
    if (!name.endsWith('/')) files.set(name, data);
  }
  return files;
}
