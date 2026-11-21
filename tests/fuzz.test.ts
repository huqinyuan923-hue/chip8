// 差分验收 4：坏 ROM 模糊——随机字节流不崩，口径固定（未定义 opcode 当 NOP 并计数）。
// 结构化模糊：全随机 + 半随机（opcode 合法/操作数随机）+ 极端构造（栈溢出、I 越界、跳转乱飞）。
import { describe, expect, it } from 'vitest';
import { Chip8 } from '../src/vm.js';
import { disassemble } from '../src/disassemble.js';
import { assemble } from '../src/assemble.js';

// 可复现伪随机（xorshift32）
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}

function assertSane(vm: Chip8, what: string): void {
  expect(Number.isInteger(vm.pc), `${what}: pc 应为整数`).toBe(true);
  expect(vm.pc >= 0 && vm.pc <= 0xFFF, `${what}: pc 在 12 位范围内`).toBe(true);
  expect(vm.i >= 0 && vm.i <= 0xFFF, `${what}: i 在 12 位范围内`).toBe(true);
  expect(vm.stack.length <= 16, `${what}: 栈深不超上限`).toBe(true);
  for (const r of vm.v) expect(Number.isInteger(r) && r >= 0 && r <= 0xFF, `${what}: 寄存器 8 位`).toBe(true);
}

describe('差分验收 4 · 坏 ROM 模糊（口径：未定义 opcode 当 NOP）', () => {
  it('全随机字节流 500 条 × 最多 5000 周期：不崩、状态守恒', () => {
    const rng = makeRng(0xBADC0DE);
    for (let t = 0; t < 500; t++) {
      const len = 1 + Math.floor(rng() % 512);
      const rom = new Uint8Array(len);
      for (let k = 0; k < len; k++) rom[k] = rng() % 256;
      const vm = new Chip8();
      vm.loadRom(rom);
      let crashed = false;
      try {
        const cycles = 1 + Math.floor(rng() % 5000);
        for (let c = 0; c < cycles; c++) {
          vm.tick();
          if (c % 97 === 0) vm.tickTimers();
        }
      } catch (e) {
        crashed = true;
        console.error(`种子流 #${t} 崩溃：`, e);
      }
      expect(crashed, `随机流 #${t} 不应抛异常`).toBe(false);
      assertSane(vm, `随机流 #${t}`);
    }
  });

  it('结构化模糊：合法 opcode 空间 × 随机操作数 + 定时器/按键乱序', () => {
    const rng = makeRng(0xFEED42);
    for (let t = 0; t < 300; t++) {
      const rom = new Uint8Array(1024);
      const pick = <T>(arr: readonly T[]): T => arr[rng() % arr.length] as T;
      for (let k = 0; k < 512; k++) {
        const x = rng() % 16, y = rng() % 16, nn = rng() % 256, nnn = rng() % 4096;
        const hi = pick([
          0x10 | (nnn >> 8), 0x20 | (nnn >> 8), 0x30 | x, 0x40 | x, 0x50 | x, 0x60 | x, 0x70 | x,
          0x80 | x, 0x90 | x, 0xA0 | (nnn >> 8), 0xB0 | (nnn >> 8), 0xC0 | x, 0xD0 | x, 0xE0 | x,
          0xF0 | x,
        ]);
        let lo: number = nn;
        if (hi >> 4 === 0x8) lo = (y << 4) | pick([0, 1, 2, 3, 4, 5, 6, 7, 0xE]);
        if (hi >> 4 === 0x5 || hi >> 4 === 0x9) lo = y << 4;
        if (hi >> 4 === 0xD) lo = (y << 4) | (rng() % 16);
        if (hi >> 4 === 0xF) lo = pick([0x07, 0x0A, 0x15, 0x18, 0x1E, 0x29, 0x33, 0x55, 0x65]);
        if (hi >> 4 === 0xE) lo = pick([0x9E, 0xA1]);
        if (hi >> 4 === 0x1 || hi >> 4 === 0x2 || hi >> 4 === 0xA || hi >> 4 === 0xB) lo = nnn & 0xFF;
        rom[k * 2] = hi;
        rom[k * 2 + 1] = lo;
      }
      const vm = new Chip8();
      vm.loadRom(rom);
      let crashed = false;
      try {
        for (let c = 0; c < 8000; c++) {
          vm.tick();
          if (c % 13 === 0) vm.tickTimers();
          if (c % 31 === 0) vm.setKey(rng() % 16, rng() % 2 === 0); // 按键乱按
        }
      } catch (e) {
        crashed = true;
        console.error(`结构流 #${t} 崩溃：`, e);
      }
      expect(crashed, `结构流 #${t} 不应抛异常`).toBe(false);
      assertSane(vm, `结构流 #${t}`);
    }
  });

  it('极端构造：自跳转环、栈爆、I 越界、超长精灵，均不崩', () => {
    const cases: { name: string; rom: number[] }[] = [
      { name: 'jump 自身', rom: [0x12, 0x00] },
      { name: 'call 自身至栈爆', rom: Array(64).fill(0x22).concat([0x00]) },
      { name: 'FX65 从 I=0xFFF 越界读', rom: [0xA0, 0x00, 0x61, 0xFF, 0xF1, 0x1E, 0xF2, 0x65] },
      { name: 'DXYN n=0 / n=15', rom: [0xD0, 0x00, 0xD0, 0x0F, 0xD0, 0x01] },
      { name: '全 0xFF 流', rom: Array(128).fill(0xFF) },
      { name: 'BNNN 跳到 ROM 头', rom: [0xB0, 0x00, 0x00, 0x00] },
    ];
    for (const c of cases) {
      const vm = new Chip8();
      let crashed = false;
      try {
        vm.loadRom(new Uint8Array(c.rom));
        for (let k = 0; k < 3000; k++) {
          vm.tick();
          if (k % 50 === 0) vm.tickTimers();
        }
      } catch (e) {
        crashed = true;
        console.error(`${c.name} 崩溃：`, e);
      }
      expect(crashed, `${c.name} 不应抛异常`).toBe(false);
      assertSane(vm, c.name);
    }
  });

  it('坏 ROM 反汇编也不崩，且 round-trip 成立（db 回退覆盖）', () => {
    const rng = makeRng(0xDEAD11);
    for (let t = 0; t < 100; t++) {
      const rom = new Uint8Array(256);
      for (let k = 0; k < 256; k++) rom[k] = rng() % 256;
      const lines = disassemble(rom); // 不抛异常
      expect(lines.length).toBe(128);
      const back = assemble(lines.join('\n'));
      expect(Array.from(back)).toEqual(Array.from(rom));
    }
  });
});
