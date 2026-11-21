// M4 · 差分验收 1：Timendus/chip8-test-suite（vfc）1-5 号画面全自动判定。
// oracle ROM 为 GPL-3.0，不入库（tests/fixtures/oracle/，npm run fetch:oracle 本地自备）；
// 预期位图（64×32 单色）从套件自带参考截图一次性解码，入库为测试向量。
// 判定路径（读测试的完成标记）：
//   1 号 splash：README 规定跑 39 周期即成图，随后 1nnn 自旋——精确周期跑 + 位图比对 + 自旋校验
//   2 号 IBM   ：同上，20 周期
//   3 号 corax+：测试跑完进入 `loop again` 自旋，画面静止——稳定态检测 + 位图比对
//   4 号 flags ：同上
//   5 号 quirks：按 README 自动化钩子，往 0x1FF 写 1（CHIP-8/VIP 平台）跳过菜单，
//                跑完静止后比对（VIP 行为全集：vF-reset=off/Memory=on/DisplayWait=on/
//                Clipping=off/Shifting=off/Jumping=off，全部应为 ✓）
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chip8, VIP_PRESET } from '../src/vm.js';
import type { Chip8Config } from '../src/vm.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, 'fixtures', 'oracle');
const EXPECTED_DIR = join(HERE, 'fixtures', 'expected');

const oracleAvailable = existsSync(join(ORACLE_DIR, '1-chip8-logo.ch8'));

function loadOracle(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ORACLE_DIR, name)));
}

/** 期望位图：hex（行优先 8 字节/行 × 32 行 = 512 字节，MSB 在前）→ 2048 字节 0/1 */
function expectedBitmap(name: string): Uint8Array {
  const hex = readFileSync(join(EXPECTED_DIR, `${name}.hex`), 'utf8').trim();
  const out = new Uint8Array(64 * 32);
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    const base = (i / 2) * 8;
    for (let b = 0; b < 8; b++) {
      if (byte & (0x80 >> b)) out[base + b] = 1;
    }
  }
  return out;
}

interface FrameRunOptions {
  maxFrames?: number;
  stableFrames?: number;
  cyclesPerFrame?: number;
}

/** 帧循环：每帧 tickTimers 一次 + N 个 tick，直到画面连续 stableFrames 帧不变或超时。 */
function runFrames(vm: Chip8, opts: FrameRunOptions = {}): { frames: number; stable: boolean } {
  const { maxFrames = 800, stableFrames = 40, cyclesPerFrame = 30 } = opts;
  let prev = '';
  let stableCount = 0;
  let frames = 0;
  for (; frames < maxFrames; frames++) {
    vm.tickTimers();
    for (let c = 0; c < cyclesPerFrame; c++) vm.tick();
    const cur = Array.from(vm.display).join('');
    if (cur === prev) {
      stableCount++;
      if (stableCount >= stableFrames) return { frames: frames + 1, stable: true };
    } else {
      stableCount = 0;
    }
    prev = cur;
  }
  return { frames, stable: false };
}

/** 位图差异报告：返回差异点列表与 ASCII 对照（失败诊断用）。 */
function diffDisplay(actual: Uint8Array, expected: Uint8Array, mask?: { x0: number; y0: number; x1: number; y1: number }) {
  const diffs: string[] = [];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      const idx = y * 64 + x;
      if (mask && x >= mask.x0 && x <= mask.x1 && y >= mask.y0 && y <= mask.y1) continue;
      if ((actual[idx] ?? 0) !== (expected[idx] ?? 0)) diffs.push(`(${x},${y})`);
    }
  }
  return diffs;
}

function asciiArt(bits: Uint8Array): string {
  const lines: string[] = [];
  for (let y = 0; y < 32; y++) {
    let row = '';
    for (let x = 0; x < 64; x++) row += bits[y * 64 + x] ? '#' : '.';
    lines.push(row);
  }
  return lines.join('\n');
}

function expectScreen(vm: Chip8, expectedName: string, what: string, mask?: { x0: number; y0: number; x1: number; y1: number }): void {
  const expected = expectedBitmap(expectedName);
  const diffs = diffDisplay(vm.getDisplay(), expected, mask);
  if (diffs.length > 0) {
    const actual = vm.getDisplay();
    console.error(`【${what}】${diffs.length} 像素不符（前 20 个）：${diffs.slice(0, 20).join(' ')}`);
    console.error('--- 实际 ---\n' + asciiArt(actual));
    console.error('--- 期望 ---\n' + asciiArt(expected));
  }
  expect(diffs, what).toEqual([]);
}

describe.skipIf(!oracleAvailable)('M4 · Timendus vfc 测试套件对拍（差分验收 1）', () => {
  it('1 号 splash：39 周期成图 + 自旋校验', () => {
    const vm = new Chip8({ ...VIP_PRESET, displayWait: false });
    vm.loadRom(loadOracle('1-chip8-logo.ch8'));
    for (let k = 0; k < 39; k++) vm.tick(); // README：39 周期出现完整 splash
    expectScreen(vm, 'chip-8-logo', 'splash 位图');
    // 1nnn 自旋：再跑若干周期 PC 不动
    const pc = vm.pc;
    for (let k = 0; k < 20; k++) vm.tick();
    expect(vm.pc, 'splash 自旋（jump 自身）').toBe(pc);
  });

  it('2 号 IBM logo：20 周期成图 + 自旋校验', () => {
    const vm = new Chip8({ ...VIP_PRESET, displayWait: false });
    vm.loadRom(loadOracle('2-ibm-logo.ch8'));
    for (let k = 0; k < 20; k++) vm.tick(); // README：20 周期出现 IBM logo
    expectScreen(vm, 'ibm-logo', 'IBM 位图');
    const pc = vm.pc;
    for (let k = 0; k < 20; k++) vm.tick();
    expect(vm.pc, 'IBM 自旋（jump 自身）').toBe(pc);
  });

  it('3 号 corax+ opcode 测试：全部 ✓', () => {
    const vm = new Chip8(VIP_PRESET);
    vm.loadRom(loadOracle('3-corax+.ch8'));
    const { stable } = runFrames(vm);
    expect(stable, 'corax+ 画面收敛').toBe(true);
    expectScreen(vm, 'corax+', 'corax+ 位图');
  });

  it('4 号 flags 测试：全部 ✓', () => {
    const vm = new Chip8(VIP_PRESET);
    vm.loadRom(loadOracle('4-flags.ch8'));
    const { stable } = runFrames(vm);
    expect(stable, 'flags 画面收敛').toBe(true);
    expectScreen(vm, 'flags', 'flags 位图');
  });

  it('5 号 quirks 测试（VIP 预设，0x1FF 自动化钩子）：全部 ✓', () => {
    const vm = new Chip8(VIP_PRESET);
    vm.loadRom(loadOracle('5-quirks.ch8'));
    vm.memory[0x1FF] = 1; // README：1 = CHIP-8 平台，跳过菜单
    const { stable, frames } = runFrames(vm, { maxFrames: 1200 });
    expect(stable, `quirks 画面收敛（跑了 ${frames} 帧）`).toBe(true);
    expectScreen(vm, 'quirks', 'quirks 位图（VIP）');
  });
});

// 供后续差分使用（现代预设跑 quirks 会翻转变体行，见 differential 测试）
export { runFrames, loadOracle, expectedBitmap, oracleAvailable };
export type { FrameRunOptions, Chip8Config };
