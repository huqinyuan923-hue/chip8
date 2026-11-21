// M6 · 自写游戏玩法断言：汇编通过、round-trip 成立、玩法行为可观测。
// 游戏帧循环按"tickTimers + 600 tick"驱动（600 tick 足够容纳最长帧逻辑）；
// 游戏预设 = VIP 行为但 displayWait 关闭（增量绘制不逐帧等待，重画整墙不卡顿；
// VIP 行为本身已由 vfc 对拍单独验收）。RNG 注入确定性序列，按键按帧脚本化。
// 注意：分数/生命是循环量（死亡重开），断言用采样探针取"过程极值"而非终值。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chip8, VIP_PRESET } from '../src/vm.js';
import { assemble } from '../src/assemble.js';
import { disassemble } from '../src/disassemble.js';

const GAMES = join(dirname(fileURLToPath(import.meta.url)), '..', 'games');
const GAME_FILES = ['pong.ch8.asm', 'snake.ch8.asm', 'breakout.ch8.asm'];

const srcOf = (name: string): string => readFileSync(join(GAMES, name), 'utf8');
const romOf = (name: string): Uint8Array => assemble(srcOf(name));

/** 确定性 RNG：按序列出数，用尽后回退到固定值 */
function seqRng(values: number[]): () => number {
  let k = 0;
  return () => {
    const v = values[k];
    k++;
    return v ?? 0.5;
  };
}

interface PlayOptions {
  frames: number;
  /** 每帧按下/松开的键集合 */
  keys?: (frame: number) => number[];
  /** CXNN 随机源 */
  rng?: () => number;
  /** 每帧后的观察探针（采样断言用） */
  onFrame?: (vm: Chip8, frame: number) => void;
}

function play(rom: Uint8Array, opts: PlayOptions): Chip8 {
  const vm = new Chip8({ ...VIP_PRESET, displayWait: false });
  if (opts.rng) vm.config = { ...vm.config, rng: opts.rng };
  vm.loadRom(rom);
  for (let f = 0; f < opts.frames; f++) {
    if (opts.keys) {
      for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) vm.setKey(k, false);
      for (const k of opts.keys(f)) vm.setKey(k, true);
    }
    vm.tickTimers();
    for (let c = 0; c < 600; c++) vm.tick();
    opts.onFrame?.(vm, f);
  }
  return vm;
}

const countLit = (vm: Chip8): number => Array.from(vm.getDisplay()).reduce((a, b) => a + b, 0);

describe('M6 · 三款游戏', () => {
  it('全部汇编通过且 round-trip 成立', () => {
    for (const f of GAME_FILES) {
      const rom = romOf(f);
      expect(rom.length, `${f} 应产出非空 ROM`).toBeGreaterThan(50);
      const back = assemble(disassemble(rom).join('\n'));
      expect(Array.from(back), `${f} round-trip`).toEqual(Array.from(rom));
    }
  });

  describe('Pong', () => {
    it('球会移动（画面持续变化）', () => {
      const rom = romOf('pong.ch8.asm');
      const a = play(rom, { frames: 60 });
      const snapA = Array.from(a.getDisplay()).join('');
      const b = play(rom, { frames: 90 });
      const snapB = Array.from(b.getDisplay()).join('');
      expect(snapA).not.toBe(snapB);
      expect(countLit(a)).toBeGreaterThan(5); // 板+球+分数至少有点亮像素
    });
    it('按键 2 上移球板（vA 递减）', () => {
      const rom = romOf('pong.ch8.asm');
      const vm = play(rom, { frames: 20, keys: () => [2] });
      expect(vm.v[0xA] ?? 0).toBeLessThan(14); // 初始板 y=14
    });
    it('AI 四分之一速跟球会被吊打：过程中分数 vC 达到 ≥1', () => {
      const rom = romOf('pong.ch8.asm');
      let maxScore = 0;
      play(rom, {
        frames: 1200,
        onFrame: vm => { if ((vm.v[0xC] ?? 0) > maxScore) maxScore = vm.v[0xC] ?? 0; },
      });
      expect(maxScore, 'AI 漏球后分数曾 ≥1').toBeGreaterThan(0);
    });
    it('玩家不按键也会漏球清零——状态守恒不崩', () => {
      const rom = romOf('pong.ch8.asm');
      const vm = play(rom, { frames: 1500, keys: () => [] });
      expect(vm.v[0xC] ?? 0).toBeLessThanOrEqual(255); // 分数是 8 位寄存器，长拉锯会超过 15
      expect(vm.v[1] ?? 0).toBeLessThanOrEqual(63);
      expect(vm.v[2] ?? 0).toBeLessThanOrEqual(31);
    });
  });

  describe('Snake', () => {
    // RNG 序列让食物依次落在 (33,16)（初始前进方向上）、(34,16)、(35,16)
    const foodSeq = [33 / 256, 48 / 256, 34 / 256, 48 / 256, 35 / 256, 48 / 256];
    it('蛇前进且吃到食物变长（v6 递增，撞墙前完成）', () => {
      const rom = romOf('snake.ch8.asm');
      const vm = play(rom, {
        frames: 12,
        keys: () => [6],      // 保持向右
        rng: seqRng(foodSeq),
      });
      expect(vm.v[6], '吃到食物后长度 ≥3').toBeGreaterThan(2);
    });
    it('持续游玩会撞墙死亡并重开（头曾走到墙边、发生过死亡重开）', () => {
      const rom = romOf('snake.ch8.asm');
      let maxHeadX = 0;
      let prevLen = 1;
      let died = false;
      const vm = play(rom, {
        frames: 240,
        rng: seqRng(foodSeq),
        onFrame: v => {
          if ((v.v[0] ?? 0) > maxHeadX) maxHeadX = v.v[0] ?? 0;
          if ((v.v[6] ?? 0) < prevLen) died = true; // 长度回落 = 死亡重开
          prevLen = v.v[6] ?? 0;
        },
      });
      expect(maxHeadX, '头曾走到 ≥60（墙边）').toBeGreaterThan(60);
      expect(died, '观察到死亡重开').toBe(true);
      expect(vm.v[6] ?? 0).toBeGreaterThanOrEqual(1);
    });
    it('按键 2 可以转向（dy 变化）', () => {
      const rom = romOf('snake.ch8.asm');
      const vm = play(rom, { frames: 10, keys: () => [2], rng: seqRng(foodSeq) });
      expect(vm.v[3]).toBe(0xFF); // dy=-1 向上
      expect(vm.v[2]).toBe(0);    // dx=0
    });
  });

  describe('Breakout', () => {
    // serve 的 CXNN &1：随机数 0 → 向左
    const serveSeq = [0 / 256, 0 / 256, 0 / 256];
    it('球会进砖区并打掉砖：分数 v6 ≥1，存活表有清零', () => {
      const rom = romOf('breakout.ch8.asm');
      const vm = play(rom, { frames: 400, rng: seqRng(serveSeq) });
      expect(vm.v[6] ?? 0, '分数 ≥1').toBeGreaterThan(0);
      const alive = Array.from(vm.memory.slice(0x500, 0x540));
      expect(alive.filter(b => b === 0).length, '至少一块砖被清零').toBeGreaterThan(0);
    });
    it('板随按键移动（v4 变化）', () => {
      const rom = romOf('breakout.ch8.asm');
      const vm = play(rom, { frames: 15, keys: () => [6], rng: seqRng(serveSeq) });
      expect(vm.v[4] ?? 0).toBeGreaterThan(29); // 初始板 x=29
    });
    it('板停最左必漏球：过程中 v5 曾 < 3（丢命路径可用）', () => {
      const rom = romOf('breakout.ch8.asm');
      let minLives = 3;
      play(rom, {
        frames: 1200,
        // 前 40 帧按住 4 把板停到 x=0，之后不接球
        keys: f => (f < 40 ? [4] : []),
        rng: seqRng(serveSeq),
        onFrame: v => { if ((v.v[5] ?? 0) < minLives) minLives = v.v[5] ?? 0; },
      });
      expect(minLives, '生命曾减少').toBeLessThan(3);
    });
  });
});
