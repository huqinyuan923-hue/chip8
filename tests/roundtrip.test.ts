// M3 差分验收 2：汇编器 round-trip。
//   1) 随机合法指令序列 ≥5,000 条：asm→disasm→asm 逐字节相等
//   2) 全部 65536 个 16 位编码穷举 round-trip（数据字节走 db 回退）
//   3) oracle vfc ROM（含数据段）round-trip；oracle 缺失时跳过
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/assemble.js';
import { disassemble } from '../src/disassemble.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORACLE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'oracle');
const ORACLE_FILES = ['1-chip8-logo.ch8', '2-ibm-logo.ch8', '3-corax+.ch8', '4-flags.ch8', '5-quirks.ch8'];

// 可复现的伪随机（xorshift32；种子固定保证测试确定性）
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length] ?? (arr[0] as T);
const rint = (rng: () => number, max: number): number => Math.floor(rng() * max) % max;

/** 生成一条随机"合法"指令的汇编文本（覆盖全部已定义助记符形态）。 */
function randomValidInstr(rng: () => number): string {
  const x = rint(rng, 16).toString(16).toUpperCase();
  const y = rint(rng, 16).toString(16).toUpperCase();
  const nn = `0x${rint(rng, 256).toString(16).padStart(2, '0')}`;
  const nnn = `0x${rint(rng, 4096).toString(16).padStart(3, '0')}`;
  const n = rint(rng, 16);
  const forms: string[] = [
    'cls', 'ret', `sys ${nnn}`, `jump ${nnn}`, `call ${nnn}`, `jump0 ${nnn}`,
    `se v${x}, ${nn}`, `sne v${x}, ${nn}`, `se v${x}, v${y}`, `sne v${x}, v${y}`,
    `ld v${x}, ${nn}`, `ld v${x}, v${y}`,
    `add v${x}, ${nn}`, `add v${x}, v${y}`,
    `sub v${x}, v${y}`, `subr v${x}, v${y}`,
    `or v${x}, v${y}`, `and v${x}, v${y}`, `xor v${x}, v${y}`,
    `shr v${x}`, `shr v${x}, v${y}`, `shl v${x}`, `shl v${x}, v${y}`,
    `rnd v${x}, ${nn}`, `draw v${x}, v${y}, ${n}`,
    `skp v${x}`, `sknp v${x}`,
    `ld v${x}, dt`, `ld v${x}, k`, `ld dt, v${x}`, `ld st, v${x}`,
    `add i, v${x}`, `ld f, v${x}`, `ld b, v${x}`,
    `ld [i], v${x}`, `ld v${x}, [i]`,
  ];
  return pick(rng, forms);
}

function roundTrip(src: string, what: string): void {
  const rom1 = assemble(src);
  const dis = disassemble(rom1);
  const rom2 = assemble(dis.join('\n'));
  expect(rom2.length, what).toBe(rom1.length);
  for (let i = 0; i < rom1.length; i++) {
    expect(rom2[i], `${what} @${i}: ${dis[Math.floor(i / 2)]}`).toBe(rom1[i]);
  }
}

describe('M3 · round-trip（差分验收 2）', () => {
  it('随机合法指令 ≥5,000 条，asm→disasm→asm 逐字节相等', () => {
    const rng = makeRng(0xC81E5);
    // 每批 ≤2048 条（4KB ROM 上限），共 6 批 = 6,000 条
    for (let batch = 0; batch < 6; batch++) {
      const count = 1000;
      const src = Array.from({ length: count }, () => randomValidInstr(rng)).join('\n');
      roundTrip(src, `批次 ${batch}`);
    }
  });

  it('全部 65536 个 16 位编码穷举 round-trip', () => {
    // 每批 2048 字（4KB），16 批覆盖全部编码空间
    for (let batch = 0; batch < 16; batch++) {
      const rom = new Uint8Array(4096);
      for (let i = 0; i < 2048; i++) {
        const word = batch * 2048 + i;
        rom[i * 2] = word >> 8;
        rom[i * 2 + 1] = word & 0xFF;
      }
      const dis = disassemble(rom);
      expect(dis).toHaveLength(2048);
      const rom2 = assemble(dis.join('\n'));
      expect(Array.from(rom2), `批次 ${batch}`).toEqual(Array.from(rom));
    }
  });

  it('oracle vfc ROM round-trip（含数据段，db 回退覆盖）', () => {
    if (!existsSync(join(ORACLE_DIR, '1-chip8-logo.ch8'))) {
      console.warn('oracle ROM 缺失（npm run fetch:oracle），跳过');
      return; // 版权纪律：ROM 不入库，本地自备
    }
    for (const f of ORACLE_FILES) {
      const rom = new Uint8Array(readFileSync(join(ORACLE_DIR, f)));
      const dis = disassemble(rom);
      const rom2 = assemble(dis.join('\n'));
      expect(Array.from(rom2), f).toEqual(Array.from(rom));
    }
  });

  it('带 .org 空洞与标号的程序 round-trip', () => {
    const src = `
      jump start
      data: db "ABC", 0
      start: ld v0, SCREEN_W
             se v0, K1
             jump start
    `;
    roundTrip(src, '标号程序');
    // .org 空洞也走 db 补零 round-trip
    const src2 = 'ld v0, 1\n.org 0x210\nret\n';
    roundTrip(src2, 'org 空洞');
  });
});
