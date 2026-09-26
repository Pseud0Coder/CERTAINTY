/* Minimal ZIP writer: uncompressed ("stored") entries only. A .docx file
   is itself a zip of XML parts, and a stored-only archive is a valid zip
   without needing a deflate implementation or any external library. */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();
function crc32(data) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++)
        c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
function u32(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF]; }
/* Fixed 1980-01-01 timestamp: the DOS-era default many zip writers fall
   back to when no meaningful modification time applies. */
const DOS_TIME = 0;
const DOS_DATE = 0x21;
export function buildZip(entries) {
    const enc = new TextEncoder();
    const prepared = entries.map(e => ({ nameBytes: enc.encode(e.name), data: e.data, crc: crc32(e.data) }));
    const localParts = [];
    const offsets = [];
    let offset = 0;
    for (const p of prepared) {
        offsets.push(offset);
        const header = [
            ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE),
            ...u32(p.crc), ...u32(p.data.length), ...u32(p.data.length),
            ...u16(p.nameBytes.length), ...u16(0),
        ];
        localParts.push(...header, ...p.nameBytes, ...p.data);
        offset += header.length + p.nameBytes.length + p.data.length;
    }
    const centralParts = [];
    prepared.forEach((p, i) => {
        const rec = [
            ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE),
            ...u32(p.crc), ...u32(p.data.length), ...u32(p.data.length),
            ...u16(p.nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
            ...u32(offsets[i]),
        ];
        centralParts.push(...rec, ...p.nameBytes);
    });
    const end = [
        ...u32(0x06054b50), ...u16(0), ...u16(0),
        ...u16(prepared.length), ...u16(prepared.length),
        ...u32(centralParts.length), ...u32(localParts.length), ...u16(0),
    ];
    return Uint8Array.from([...localParts, ...centralParts, ...end]);
}
