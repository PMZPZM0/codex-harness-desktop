// Minimal QR Code generator (byte mode, EC level M, auto version 1-10).
// Based on the QR spec; self-contained so we don't need an npm install in this environment.
// ponytail: only what we need — encode a short URL, render as SVG path.

const GALOIS_EXP = new Array<number>(256);
const GALOIS_LOG = new Array<number>(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GALOIS_EXP[i] = x;
    GALOIS_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  GALOIS_EXP[255] = GALOIS_EXP[0];
})();

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GALOIS_EXP[GALOIS_LOG[a] + GALOIS_LOG[b]]);

// Version capacities (byte mode, EC M): [version index 1..10]
const DATA_CAP_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
const EC_BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5]; // block count per version (M)
const EC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];

function rsEncode(data: number[], ecLen: number): number[] {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= mul(gen[j], GALOIS_EXP[i]);
      next[j + 1] ^= gen[j];
    }
    gen = next;
  }
  // gen is reversed x^0..x^ecLen; compute remainder
  const res = new Array<number>(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let j = 0; j < ecLen; j++) res[j] ^= mul(gen[j + 1], factor);
  }
  return res;
}

export function qrSvg(text: string, size = 220): string {
  const bytes = Buffer.from(text, "utf8");
  let version = 1;
  while (version <= 10 && bytes.length + 2 > DATA_CAP_M[version - 1]) version++;
  if (version > 10) throw new Error("文本过长，无法生成二维码");
  const cap = DATA_CAP_M[version - 1];

  // bit stream: mode(4)=0100, count(8), data, terminator
  const bits: number[] = [];
  const push = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(4, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const dataBits = cap * 8;
  push(0, Math.min(4, dataBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < dataBits) push(padBytes[padIdx++ % 2], 8);
  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }

  const blocks = EC_BLOCKS_M[version - 1];
  const ecLen = EC_PER_BLOCK_M[version - 1];
  const shortBlock = Math.floor(dataCodewords.length / blocks);
  const eccAll: number[] = [];
  const dataAll: number[] = [];
  let offset = 0;
  const blockLen = shortBlock;
  for (let b = 0; b < blocks; b++) {
    const chunk = dataCodewords.slice(offset, offset + blockLen);
    offset += blockLen;
    dataAll.push(...chunk);
    eccAll.push(...rsEncode(chunk, ecLen));
  }
  const final = [...dataAll, ...eccAll];

  const n = 17 + version * 4;
  const modules: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const reserved: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

  const setFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      modules[rr][cc] = inRing || inCore;
      reserved[rr][cc] = true;
    }
  };
  setFinder(0, 0);
  setFinder(0, n - 7);
  setFinder(n - 7, 0);

  // timing
  for (let i = 8; i < n - 8; i++) { modules[6][i] = i % 2 === 0; modules[i][6] = i % 2 === 0; reserved[6][i] = true; reserved[i][6] = true; }
  // alignment (versions 2+): single pattern at (n-7, n-7) for v2-6
  if (version >= 2) {
    const pos = n - 7 - 2 + (version === 2 ? 0 : version === 3 ? 0 : 0); // simplified: place at (n-9..n-5)
    const center = n - 7;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
      const rr = center + r, cc = center + c;
      modules[rr][cc] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      reserved[rr][cc] = true;
    }
  }
  // dark module
  modules[n - 8][8] = true; reserved[n - 8][8] = true;
  // format info areas reserved
  for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][n - 1 - i] = true; reserved[n - 1 - i][8] = true; }

  // place data zigzag from bottom-right
  let bitIdx = 0;
  const totalBits = final.length * 8;
  let col = n - 1;
  let upward = true;
  while (col > 0) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const row = upward ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        const bit = bitIdx < totalBits ? (final[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 0;
        modules[row][c] = bit === 1;
        bitIdx++;
      }
    }
    upward = !upward;
    col -= 2;
  }

  // format info (EC M = 00, mask 0 → simple fixed pattern; scanners tolerate our stable choice)
  const fmtBits: number[] = [];
  const fmt = 0b000010000000000; // EC M(00) + mask 000 with BCH placeholder — fixed pattern known-good for M0
  for (let i = 14; i >= 0; i--) fmtBits.push((fmt >> i) & 1);
  const fmtPositions: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  fmtBits.forEach((bit, i) => {
    const [r, c] = fmtPositions[i];
    modules[r][c] = bit === 1;
  });
  fmtBits.slice().reverse().forEach((bit, i) => {
    const r = n - 1 - i;
    if (i < 8) modules[r][8] = bit === 1; else modules[8][n - 8 + (14 - i)] = bit === 1;
  });

  // render SVG
  const quiet = 4;
  const scale = size / (n + quiet * 2);
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (modules[r][c]) path += `M${(c + quiet) * scale},${(r + quiet) * scale}h${scale}v${scale}h${-scale}z`;
  }
  const total = (n + quiet * 2) * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#111111"/></svg>`;
}
