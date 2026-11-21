// 差分验收 3：同一 ROM 在两代行为开关下的寄存器轨迹差分，与已记录的变体语义逐条一致。
// 另附 quirks 翻转差分：把某一 quirk 单独翻转后跑 oracle quirks ROM，
// 画面必须只在该 quirk 对应的行发生变化（证明开关与 oracle 判定逐条对得上）。
import { describe, expect, it } from 'vitest';
import { Chip8, VIP_PRESET, MODERN_PRESET } from '../src/vm.js';
import { assemble } from '../src/assemble.js';
import { expectedBitmap, loadOracle, runFrames, oracleAvailable } from './vfc.test.js';

interface Snapshot {
  pc: number;
  i: number;
  v: number[];
  dt: number;
  st: number;
}

/** 快照取寄存器（索引越界按 0 处理，仅为满足 noUncheckedIndexedAccess） */
const rv = (s: Snapshot | undefined, r: number): number => s?.v[r] ?? 0;

function trace(vm: Chip8, cycles: number): Snapshot[] {
  const out: Snapshot[] = [];
  for (let k = 0; k < cycles; k++) {
    vm.tick();
    out.push({ pc: vm.pc, i: vm.i, v: Array.from(vm.v), dt: vm.dt, st: vm.st });
  }
  return out;
}

function runAsm(src: string, preset: typeof VIP_PRESET, cycles: number): { vm: Chip8; tr: Snapshot[] } {
  const vm = new Chip8(preset);
  vm.loadRom(assemble(src));
  return { vm, tr: trace(vm, cycles) };
}

describe('差分验收 3 · 两代行为开关寄存器轨迹差分', () => {
  it('shift：vip 移 vY / modern 移 vX——分歧点与语义逐条一致', () => {
    const src = `
      ld v1, 0xF0
      ld v2, 0x31
      shr v1, v2     ; 分歧点 1
      shr v3, v2     ; 分歧点 2
      shl v4, v1     ; 分歧点 3（用上一条的结果放大差异）
      ret
    `;
    const vip = runAsm(src, VIP_PRESET, 6);
    const mod = runAsm(src, MODERN_PRESET, 6);
    // 前 2 条（ld）完全一致
    for (let k = 0; k < 2; k++) {
      expect(vip.tr[k]?.v, `第 ${k} 周期应一致`).toEqual(mod.tr[k]?.v);
      expect(vip.tr[k]?.pc).toBe(mod.tr[k]?.pc);
      expect(vip.tr[k]?.i).toBe(mod.tr[k]?.i);
    }
    // 第 3 周期（shr v1, v2）起分歧：vip v1 = v2>>1 = 0x18；modern v1 = v1>>1 = 0x78
    expect(rv(vip.tr[2], 1)).toBe(0x18);
    expect(rv(mod.tr[2], 1)).toBe(0x78);
    // 移出位语义：vip 取 vY 的 LSB（0x31 → 1），modern 取 vX 的 LSB（0xF0 → 0）
    expect(rv(vip.tr[2], 0xF)).toBe(1);
    expect(rv(mod.tr[2], 0xF)).toBe(0);
    // shr v3, v2：vip v3 = 0x31>>1 = 0x18；modern v3 = 0（v3 未初始化）
    expect(rv(vip.tr[3], 3)).toBe(0x18);
    expect(rv(mod.tr[3], 3)).toBe(0x00);
    // shl v4, v1：vip v4 = v1<<1（分歧后的 v1）；modern v4 = v4<<1 = 0
    expect(rv(vip.tr[4], 4)).toBe((0x18 << 1) & 0xFF);
    expect(rv(mod.tr[4], 4)).toBe(0x00);
    // PC 轨迹全程一致（语义分歧只影响寄存器）
    for (let k = 0; k < 6; k++) expect(vip.tr[k]?.pc).toBe(mod.tr[k]?.pc);
  });

  it('jump：vip BNNN 用 v0 / modern 用 vX——落点与语义一致', () => {
    const src = `
      ld v0, 0x03
      ld v2, 0x07
      jump0 0x230    ; vip → 0x233；modern → 0x237
      ret
    `;
    const prog = assemble(src);
    const vip = runAsm(src, VIP_PRESET, 3);
    const mod = runAsm(src, MODERN_PRESET, 3);
    expect(vip.tr[2]?.pc).toBe((0x230 + 0x03) & 0xFFF);
    expect(mod.tr[2]?.pc).toBe((0x230 + 0x07) & 0xFFF);
    void prog;
    const vmA = new Chip8(VIP_PRESET);
    vmA.loadRom(assemble(`
      ld v0, 0x03
      ld v2, 0x07
      jump0 0x230
    `));
    // 0x233/0x237 超出小程序长度——直接在内存布置标记；4 个周期：t3 执行落点指令
    vmA.memory[0x233] = 0x6F; vmA.memory[0x234] = 0xAA; // ld vF, 0xAA
    vmA.memory[0x237] = 0x6F; vmA.memory[0x238] = 0xBB; // ld vF, 0xBB
    trace(vmA, 4);
    expect(vmA.v[0xF]).toBe(0xAA);
    const vmB = new Chip8(MODERN_PRESET);
    vmB.loadRom(assemble(`
      ld v0, 0x03
      ld v2, 0x07
      jump0 0x230
    `));
    vmB.memory[0x233] = 0x6F; vmB.memory[0x234] = 0xAA;
    vmB.memory[0x237] = 0x6F; vmB.memory[0x238] = 0xBB;
    trace(vmB, 4);
    expect(vmB.v[0xF]).toBe(0xBB);
  });

  it('memory：vip FX55/FX65 递增 I / modern 不变——I 与内存逐条一致', () => {
    const src = `
      ld i, 0x400
      ld v4, 0xAA
      ld [i], v4      ; 存 v0..v4
      ld v5, 0xBB
      ld [i], v5      ; 第二次存：vip 写 0x405，modern 重写 0x400
      ret
    `;
    const vip = runAsm(src, VIP_PRESET, 5);
    const mod = runAsm(src, MODERN_PRESET, 5);
    // FX55 x 写 v0..vX 整组：第一次 v4=0xAA → mem[0x404]；第二次 v5=0xBB
    // vip：第一次写 0x400..0x404，I→0x405；第二次写 0x405..0x40A（v5=0xBB 落 0x40A）
    expect(vip.vm.memory[0x404]).toBe(0xAA);
    expect(vip.vm.memory[0x405]).toBe(0x00);  // 第二次从 0x405 起，v0=0
    expect(vip.vm.memory[0x409]).toBe(0xAA);  // v4 仍在寄存器组里
    expect(vip.vm.memory[0x40A]).toBe(0xBB);  // v5 落在 I+5
    expect(vip.vm.i).toBe(0x40B);
    // modern：两次都写 0x400..，I 恒为 0x400（第二次 v5=0xBB 落 0x405）
    expect(mod.vm.memory[0x404]).toBe(0xAA);
    expect(mod.vm.memory[0x405]).toBe(0xBB);
    expect(mod.vm.memory[0x409]).toBe(0x00);
    expect(mod.vm.i).toBe(0x400);
    // 前 2 条（ld i / ld v4）轨迹一致
    expect(vip.tr[0]?.v).toEqual(mod.tr[0]?.v);
    expect(vip.tr[1]?.v).toEqual(mod.tr[1]?.v);
    // 第 5 周期后 I 分歧
    expect(vip.tr[3]?.i).toBe(0x405);
    expect(mod.tr[3]?.i).toBe(0x400);
  });

  it('displayWait：vip 绘制后等 vblank / modern 不等——轨迹空转段一致于语义', () => {
    const src = `
      ld i, 0x210
      draw v0, v0, 1
      ld v1, 0x11     ; vip 下被 vblank 阻塞
      ret
      db 0x80
    `;
    const vip = runAsm(src, VIP_PRESET, 4);
    const mod = runAsm(src, MODERN_PRESET, 4);
    expect(rv(vip.tr[3], 1)).toBe(0x00); // vip：绘制阻塞，6111 未执行
    expect(rv(mod.tr[3], 1)).toBe(0x11); // modern：直接继续
    vip.vm.tickTimers();               // 一次 vblank
    trace(vip.vm, 1);
    expect(vip.vm.v[1]).toBe(0x11);    // 解锁后补执行
  });
});

describe('差分验收 3 · quirks 翻转差分（oracle 视角逐行对账）', () => {
  // quirks 结果屏 6 行的 y 区域：vf=1-4 mem=6-9 disp=11-14 clip=16-19 shift=21-24 jump=26-29
  const ROWS = {
    vfReset: { y0: 0, y1: 4 },
    memory: { y0: 5, y1: 9 },
    displayWait: { y0: 10, y1: 14 },
    clipping: { y0: 15, y1: 19 },
    shift: { y0: 20, y1: 24 },
    jump: { y0: 25, y1: 29 },
  } as const;

  function quirkScreen(cfg: Partial<typeof VIP_PRESET>): Uint8Array {
    const vm = new Chip8({ ...VIP_PRESET, ...cfg });
    vm.loadRom(loadOracle('5-quirks.ch8'));
    vm.memory[0x1FF] = 1; // CHIP-8 目标
    runFrames(vm, { maxFrames: 1200 });
    return vm.getDisplay();
  }

  it.skipIf(!oracleAvailable)('基线（VIP 全集）与参考位图一致', () => {
    const base = quirkScreen({});
    const expected = expectedBitmap('quirks');
    let diff = 0;
    for (let k = 0; k < 2048; k++) if (base[k] !== expected[k]) diff++;
    expect(diff, 'VIP 基线应与参考图逐像素一致').toBe(0);
  });

  it.skipIf(!oracleAvailable)('单独翻转 shift：画面只在 shift 行变化', () => {
    const base = quirkScreen({});
    const flipped = quirkScreen({ shift: 'modern' });
    const expected = expectedBitmap('quirks');
    // shift 行（y20-24）必须与参考图不同（oracle 检出 quirk 被翻转）
    let rowDiff = 0, otherDiff = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const k = y * 64 + x;
      if (flipped[k] !== expected[k]) {
        if (y >= ROWS.shift.y0 && y <= ROWS.shift.y1) rowDiff++;
        else otherDiff++;
      }
    }
    expect(rowDiff, 'shift 行应变化').toBeGreaterThan(0);
    expect(otherDiff, '其余行不应变化').toBe(0);
    void base;
  });

  it.skipIf(!oracleAvailable)('单独翻转 jump：画面只在 jump 行变化', () => {
    const flipped = quirkScreen({ jump: 'modern' });
    const expected = expectedBitmap('quirks');
    let rowDiff = 0, otherDiff = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const k = y * 64 + x;
      if (flipped[k] !== expected[k]) {
        if (y >= ROWS.jump.y0 && y <= ROWS.jump.y1) rowDiff++;
        else otherDiff++;
      }
    }
    expect(rowDiff, 'jump 行应变化').toBeGreaterThan(0);
    expect(otherDiff, '其余行不应变化').toBe(0);
  });

  it.skipIf(!oracleAvailable)('单独翻转 memory：画面只在 memory 行变化', () => {
    const flipped = quirkScreen({ memory: 'modern' });
    const expected = expectedBitmap('quirks');
    let rowDiff = 0, otherDiff = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const k = y * 64 + x;
      if (flipped[k] !== expected[k]) {
        if (y >= ROWS.memory.y0 && y <= ROWS.memory.y1) rowDiff++;
        else otherDiff++;
      }
    }
    expect(rowDiff, 'memory 行应变化').toBeGreaterThan(0);
    expect(otherDiff, '其余行不应变化').toBe(0);
  });

  it.skipIf(!oracleAvailable)('单独翻转 vfReset：画面只在 vf 行变化', () => {
    const flipped = quirkScreen({ vfReset: false });
    const expected = expectedBitmap('quirks');
    let rowDiff = 0, otherDiff = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const k = y * 64 + x;
      if (flipped[k] !== expected[k]) {
        if (y >= ROWS.vfReset.y0 && y <= ROWS.vfReset.y1) rowDiff++;
        else otherDiff++;
      }
    }
    expect(rowDiff, 'vf 行应变化').toBeGreaterThan(0);
    expect(otherDiff, '其余行不应变化').toBe(0);
  });

  it.skipIf(!oracleAvailable)('单独翻转 clipping：画面只在 clip 行变化', () => {
    const flipped = quirkScreen({ clipping: false });
    const expected = expectedBitmap('quirks');
    let rowDiff = 0, otherDiff = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const k = y * 64 + x;
      if (flipped[k] !== expected[k]) {
        if (y >= ROWS.clipping.y0 && y <= ROWS.clipping.y1) rowDiff++;
        else otherDiff++;
      }
    }
    expect(rowDiff, 'clip 行应变化').toBeGreaterThan(0);
    expect(otherDiff, '其余行不应变化').toBe(0);
  });
});
