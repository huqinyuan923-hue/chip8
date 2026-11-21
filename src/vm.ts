// CHIP-8 解释器核心：35 个 opcode、64×32 单色屏、60Hz 定时器、keypad、蜂鸣器。
//
// 行为变体（两代开关）——任务书要求可配置并测试两代行为。
// VIP 基线以 oracle（Timendus 测试套件，经 Emma O2/Cadmium VIP 模式验证）为准：
//   - shift   : 'vip'(vX = vY>>1 / vY<<1) vs 'modern'(vX = vX>>1 / vX<<1)
//   - jump    : 'vip'(BNNN → nnn + v0)         vs 'modern'(BNNN → nnn + vX，X 取 nnn 高半字节)
//   - memory  : 'vip'(FX55/FX65 后 I 递增)      vs 'modern'(I 不变)
//   - vfReset : 8XY1/2/3 将 vF 清零——VIP 与 S-CHIP 系均为 true（套件 CHIP-8 目标期望 ON）
//   - clipping: DXYN 越界像素裁剪——VIP 与 S-CHIP 系均为 true（套件 CHIP-8 目标期望 ON）
//   - displayWait: DXYN 等待垂直消隐、最多 60 绘制/秒（true，VIP）vs 不等待（false，S-CHIP 系）
//
// 固定口径（任务书差分验收 4）：未定义 opcode 一律当 NOP 执行并计数（undefinedCount），
// 不抛错——保证坏 ROM 不崩。栈溢出/栈下溢同样不崩，计数 stackErrorCount。
// I 为 12 位（0x000-0xFFF），加法按 0x1000 取模；PC 亦为 12 位。
import { FONT } from './font.js';

/** 行为开关集合（差分验收的核心配置面）。 */
export interface Chip8Config {
  shift: 'vip' | 'modern';
  jump: 'vip' | 'modern';
  memory: 'vip' | 'modern';
  vfReset: boolean;
  clipping: boolean;
  displayWait: boolean;
}

/** 原始 COSMAC VIP 行为（1977，oracle 验证基线）。 */
export const VIP_PRESET: Chip8Config = {
  shift: 'vip', jump: 'vip', memory: 'vip',
  vfReset: true, clipping: true, displayWait: true,
};

/** "现代"惯例（CHIP-48/S-CHIP 系默认值；SUPER-CHIP 本身不在本期范围）。 */
export const MODERN_PRESET: Chip8Config = {
  shift: 'modern', jump: 'modern', memory: 'modern',
  vfReset: true, clipping: true, displayWait: false,
};

const MEM_SIZE = 4096;
const SCREEN_W = 64;
const SCREEN_H = 32;
const STACK_DEPTH = 16;

/** 公开 API：CHIP-8 虚拟机。 */
export class Chip8 {
  readonly memory = new Uint8Array(MEM_SIZE);
  readonly v = new Uint8Array(16);
  readonly display = new Uint8Array(SCREEN_W * SCREEN_H);
  readonly keys = new Uint8Array(16);
  readonly stack: number[] = [];

  i = 0;
  pc = 0x200;
  dt = 0;
  st = 0;

  /** 诊断计数（差分与坏 ROM 口径的观测点）。 */
  undefinedCount = 0;
  stackErrorCount = 0;

  config: Chip8Config;

  // 内部状态
  private waitingForKey = false;
  private keyLatched = -1;        // FX0A：先等按下，再等松开（VIP 语义）
  private fx0aTarget = 0;         // FX0A 的目标寄存器 X
  private drawWait = false;       // displayWait 开启时：绘制后等待 vblank

  constructor(config: Partial<Chip8Config> = {}) {
    this.config = { ...VIP_PRESET, ...config };
    this.memory.set(FONT, 0);
  }

  /** 载入 ROM 到 0x200 并复位（字体常驻 0x000-0x04F）。 */
  loadRom(rom: Uint8Array): void {
    this.memory.fill(0);
    this.memory.set(FONT, 0);
    const n = Math.min(rom.length, MEM_SIZE - 0x200);
    this.memory.set(rom.subarray(0, n), 0x200);
    this.v.fill(0);
    this.display.fill(0);
    this.keys.fill(0);
    this.stack.length = 0;
    this.i = 0;
    this.pc = 0x200;
    this.dt = 0;
    this.st = 0;
    this.undefinedCount = 0;
    this.stackErrorCount = 0;
    this.waitingForKey = false;
    this.keyLatched = -1;
    this.fx0aTarget = 0;
    this.drawWait = false;
  }

  /** 复位全部状态但保留 ROM 与配置（调试器用）。 */
  reset(): void {
    const rom = this.memory.slice(0x200);
    this.loadRom(rom);
  }

  /** 一个 CPU 周期。displayWait 挂起或 FX0A 等待按键时，本周期空转。 */
  tick(): void {
    if (this.drawWait) return; // 等垂直消隐：本周期不取指
    if (this.waitingForKey) {
      if (this.keyLatched < 0) {
        // 阶段一：等待任意键按下
        for (let k = 0; k < 16; k++) {
          if (this.keys[k]) { this.keyLatched = k; break; }
        }
      } else if (!this.keys[this.keyLatched]) {
        // 阶段二：等待该键松开后写入 FX0A 指定的 vX（VIP 语义）
        this.v[this.fx0aTarget] = this.keyLatched;
        this.waitingForKey = false;
        this.keyLatched = -1;
      }
      return; // FX0A 未完成：不推进 PC
    }
    this.step();
  }

  /** 60Hz 定时器节拍：DT/ST 递减，释放 displayWait 的 vblank。 */
  tickTimers(): void {
    if (this.drawWait) this.drawWait = false;
    if (this.dt > 0) this.dt--;
    if (this.st > 0) this.st--;
  }

  /** 蜂鸣器是否发声（ST > 0）。 */
  beeping(): boolean {
    return this.st > 0;
  }

  /** 64×32 位图快照（每像素一字节 0/1，行优先）。 */
  getDisplay(): Uint8Array {
    return this.display.slice();
  }

  /** keypad 状态。key 0-15，down=true 按下。 */
  setKey(key: number, down: boolean): void {
    if (key < 0 || key > 15) throw new RangeError(`key 必须在 0-15：${key}`);
    this.keys[key] = down ? 1 : 0;
  }

  /** FX0A 是否处于阻塞等待中（调试器观察点）。 */
  isWaitingForKey(): boolean {
    return this.waitingForKey;
  }

  // ------------------------------------------------------------------
  // 取指与执行

  private fetch(): number {
    const hi = this.memory[this.pc & 0xFFF] ?? 0;
    const lo = this.memory[(this.pc + 1) & 0xFFF] ?? 0;
    this.pc = (this.pc + 2) & 0xFFF;
    return (hi << 8) | lo;
  }

  private step(): void {
    const op = this.fetch();
    const x = (op >> 8) & 0xF;
    const y = (op >> 4) & 0xF;
    const n = op & 0xF;
    const nn = op & 0xFF;
    const nnn = op & 0xFFF;
    const vx = this.v[x] ?? 0;
    const vy = this.v[y] ?? 0;

    switch (op >> 12) {
      case 0x0:
        if (op === 0x00E0) { this.display.fill(0); return; }
        if (op === 0x00EE) { this.ret(); return; }
        this.nop(op); return; // 00CN/00FB-00FF 等为 SUPER-CHIP，不在范围
      case 0x1: this.pc = nnn; return;                      // 1NNN jump
      case 0x2: this.call(nnn); return;                     // 2NNN call
      case 0x3: if (vx === nn) this.pc = (this.pc + 2) & 0xFFF; return; // 3XNN
      case 0x4: if (vx !== nn) this.pc = (this.pc + 2) & 0xFFF; return; // 4XNN
      case 0x5: // 5XY0
        if (n === 0) { if (vx === vy) this.pc = (this.pc + 2) & 0xFFF; return; }
        this.nop(op); return;
      case 0x6: this.v[x] = nn; return;                     // 6XNN
      case 0x7: this.v[x] = (vx + nn) & 0xFF; return;       // 7XNN
      case 0x8: this.alu(op, x, y, n); return;
      case 0x9: // 9XY0
        if (n === 0) { if (vx !== vy) this.pc = (this.pc + 2) & 0xFFF; return; }
        this.nop(op); return;
      case 0xA: this.i = nnn; return;                       // ANNN
      case 0xB: // BNNN：两代行为
        if (this.config.jump === 'vip') this.pc = (nnn + (this.v[0] ?? 0)) & 0xFFF;
        else this.pc = (nnn + (this.v[(nnn >> 8) & 0xF] ?? 0)) & 0xFFF;
        return;
      case 0xC: this.v[x] = (Math.random() * 256 | 0) & nn; return; // CXNN
      case 0xD: this.draw(x, y, n); return;                 // DXYN
      case 0xE:
        if (nn === 0x9E) { if (this.keys[vx & 0xF]) this.pc = (this.pc + 2) & 0xFFF; return; }
        if (nn === 0xA1) { if (!this.keys[vx & 0xF]) this.pc = (this.pc + 2) & 0xFFF; return; }
        this.nop(op); return;
      case 0xF: this.fx(op, x, nn); return;
    }
  }

  private nop(op: number): void {
    this.undefinedCount++;
    void op;
  }

  private call(nnn: number): void {
    if (this.stack.length >= STACK_DEPTH) { this.stackErrorCount++; return; }
    this.stack.push(this.pc);
    this.pc = nnn;
  }

  private ret(): void {
    const addr = this.stack.pop();
    if (addr === undefined) { this.stackErrorCount++; return; }
    this.pc = addr;
  }

  private alu(op: number, x: number, y: number, n: number): void {
    const vx = this.v[x] ?? 0;
    const vy = this.v[y] ?? 0;
    switch (n) {
      case 0x0: this.v[x] = vy; return;                       // 8XY0 vX = vY
      case 0x1: this.v[x] = vx | vy; if (this.config.vfReset) this.v[0xF] = 0; return;
      case 0x2: this.v[x] = vx & vy; if (this.config.vfReset) this.v[0xF] = 0; return;
      case 0x3: this.v[x] = vx ^ vy; if (this.config.vfReset) this.v[0xF] = 0; return;
      case 0x4: { const s = vx + vy; this.v[x] = s & 0xFF; this.v[0xF] = s > 0xFF ? 1 : 0; return; }
      case 0x5: { this.v[x] = (vx - vy) & 0xFF; this.v[0xF] = vx >= vy ? 1 : 0; return; }
      case 0x6: { // 8XY6 右移：vip 位移 vY，modern 只动 vX
        const src = this.config.shift === 'vip' ? vy : vx;
        this.v[x] = (src >> 1) & 0xFF;
        this.v[0xF] = src & 1;
        return;
      }
      case 0x7: { this.v[x] = (vy - vx) & 0xFF; this.v[0xF] = vy >= vx ? 1 : 0; return; }
      case 0xE: { // 8XYE 左移：vip 位移 vY，modern 只动 vX
        const src = this.config.shift === 'vip' ? vy : vx;
        this.v[x] = (src << 1) & 0xFF;
        this.v[0xF] = (src >> 7) & 1;
        return;
      }
      default: this.nop(op); return; // 8XY8-8XYD 未定义
    }
  }

  private draw(x: number, y: number, n: number): void {
    const ox = (this.v[x] ?? 0) % SCREEN_W;
    const oy = (this.v[y] ?? 0) % SCREEN_H;
    let collision = 0;
    for (let row = 0; row < n; row++) {
      const sprite = this.memory[(this.i + row) & 0xFFF] ?? 0;
      for (let col = 0; col < 8; col++) {
        if ((sprite & (0x80 >> col)) === 0) continue;
        const px = this.config.clipping
          ? ox + col
          : (ox + col) % SCREEN_W;
        const py = this.config.clipping
          ? oy + row
          : (oy + row) % SCREEN_H;
        if (px >= SCREEN_W || py >= SCREEN_H) continue; // 裁剪模式丢弃越界像素
        const idx = py * SCREEN_W + px;
        if (this.display[idx]) { collision = 1; this.display[idx] = 0; }
        else this.display[idx] = 1;
      }
    }
    this.v[0xF] = collision;
    if (this.config.displayWait) this.drawWait = true; // 等到下一个 tickTimers 才继续取指
  }

  private fx(op: number, x: number, nn: number): void {
    switch (nn) {
      case 0x07: this.v[x] = this.dt; return;              // FX07
      case 0x0A: this.waitingForKey = true; this.keyLatched = -1; this.fx0aTarget = x; return; // FX0A 阻塞
      case 0x15: this.dt = this.v[x] ?? 0; return;         // FX15
      case 0x18: this.st = this.v[x] ?? 0; return;         // FX18
      case 0x1E: this.i = (this.i + (this.v[x] ?? 0)) & 0xFFF; return; // FX1E
      case 0x29: this.i = ((this.v[x] ?? 0) & 0xF) * 5; return; // FX29 字体地址
      case 0x33: { // FX33 BCD
        const v = this.v[x] ?? 0;
        this.memory[this.i & 0xFFF] = Math.floor(v / 100);
        this.memory[(this.i + 1) & 0xFFF] = Math.floor(v / 10) % 10;
        this.memory[(this.i + 2) & 0xFFF] = v % 10;
        return;
      }
      case 0x55: { // FX55 存寄存器：vip 递增 I，modern 不动
        for (let k = 0; k <= x; k++) this.memory[(this.i + k) & 0xFFF] = this.v[k] ?? 0;
        if (this.config.memory === 'vip') this.i = (this.i + x + 1) & 0xFFF;
        return;
      }
      case 0x65: { // FX65 载寄存器：vip 递增 I，modern 不动
        for (let k = 0; k <= x; k++) this.v[k] = this.memory[(this.i + k) & 0xFFF] ?? 0;
        if (this.config.memory === 'vip') this.i = (this.i + x + 1) & 0xFFF;
        return;
      }
      default: this.nop(op); return;
    }
  }
}
