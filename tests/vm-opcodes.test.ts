// M1/M2：逐 opcode 单元测试（内存/栈/寄存器/标志位），两代行为开关都覆盖。
// 注意：loadRom 会复位全部状态，需要预置寄存器的用例在 loadRom 之后、tick 之前设置。
import { describe, expect, it } from 'vitest';
import { Chip8, VIP_PRESET, MODERN_PRESET } from '../src/vm.js';
import type { Chip8Config } from '../src/vm.js';

/** 把 4 位十六进制立即数列表拼成 ROM（每条 2 字节）并连跑 n 个周期 */
function run(instrs: number[], cycles?: number, cfg: Partial<Chip8Config> = {}) {
  const vm = new Chip8(cfg);
  const rom = new Uint8Array(instrs.length * 2);
  instrs.forEach((instr, i) => {
    rom[i * 2] = (instr >> 8) & 0xFF;
    rom[i * 2 + 1] = instr & 0xFF;
  });
  vm.loadRom(rom);
  for (let k = 0; k < (cycles ?? instrs.length); k++) vm.tick();
  return vm;
}

describe('M1 · 加载与内存', () => {
  it('ROM 载入 0x200，PC 复位', () => {
    const vm = new Chip8();
    vm.loadRom(new Uint8Array([0x61, 0x00]));
    expect(vm.pc).toBe(0x200);
    expect(vm.memory[0x200]).toBe(0x61);
    expect(vm.memory[0x201]).toBe(0x00);
  });
  it('字体驻留 0x000-0x04F，FX29 取字体地址', () => {
    const vm = run([0xF029]);
    expect(vm.i).toBe(0);            // '0' 字体地址 = 0*5
    expect(vm.memory[0]).toBe(0xF0);
    const vm3 = run([0x630C, 0xF329]);
    expect(vm3.i).toBe(0xC * 5);     // 'C'
    expect(vm3.memory[0xC * 5]).toBe(0xF0);
    expect(vm3.memory[0xC * 5 + 4]).toBe(0xF0);
    expect(vm3.memory[0xC * 5 + 1]).toBe(0x80);
  });
  it('超长 ROM 截断到 4KB 不崩', () => {
    const vm = new Chip8();
    expect(() => vm.loadRom(new Uint8Array(6000))).not.toThrow();
    expect(vm.memory.length).toBe(4096);
  });
});

describe('M1 · 立即数与跳转', () => {
  it('6XNN 载入 / 7XNN 相加（回绕）', () => {
    const vm = run([0x61AB, 0x71FF, 0x7103]);
    expect(vm.v[1]).toBe(0xAD); // 0xAB +0xFF→0xAA，+3→0xAD
    expect(vm.v[2]).toBe(0x00); // 7XNN 只动 vX
  });
  it('1NNN 跳转', () => {
    const vm = run([0x1206, 0x0000, 0x0000, 0x6F11], 2);
    expect(vm.pc).toBe(0x208);   // 0x206 处执行 6F11 后
    expect(vm.v[0xF]).toBe(0x11);
  });
  it('2NNN 调用 / 00EE 返回，栈深 16 不崩', () => {
    const vmA = run([0x2204, 0x6F22, 0x00EE], 1);
    expect(vmA.stack).toEqual([0x202]);
    expect(vmA.pc).toBe(0x204);
    const vm = run([0x2204, 0x6F22, 0x00EE], 3);
    expect(vm.stack).toEqual([]);
    expect(vm.v[0xF]).toBe(0x22);
    // 深度耗尽：连续 17 次调用，第 17 次被拒并计数
    const vm3 = new Chip8();
    vm3.loadRom(new Uint8Array(4096 - 0x200).fill(0x22)); // 全内存都是 2222 (call 0x222)
    for (let k = 0; k < 17; k++) vm3.tick();
    expect(vm3.stack.length).toBe(16);
    expect(vm3.stackErrorCount).toBe(1);
    // 空栈返回不崩
    const vm4 = run([0x00EE, 0x6F11], 2);
    expect(vm4.stackErrorCount).toBe(1);
    expect(vm4.v[0xF]).toBe(0x11);
  });
  it('条件跳过 3XNN/4XNN/5XY0/9XY0', () => {
    // 6105,3105(跳过 6FAA),6206,4206(v2==6 不跳→6FBB),6307,5310(7≠5 不跳→6FCC),6407,9400(7≠0 跳过 6FDD)
    const vm = run([0x6105, 0x3105, 0x6FAA, 0x6206, 0x4206, 0x6FBB, 0x6307, 0x5310, 0x6FCC, 0x6407, 0x9400, 0x6FDD]);
    expect(vm.v[0xF]).toBe(0xCC);
    // 6207,6307,5320(v3==v2 跳过 6FAA),6407,9400(v4≠0 跳过 6FBB) → vF 不被写
    const v2 = run([0x6207, 0x6307, 0x5320, 0x6FAA, 0x6407, 0x9400, 0x6FBB]);
    expect(v2.v[0xF]).toBe(0x00);
  });
  it('ANNN 载 I / BNNN 两代行为', () => {
    const a = run([0xA403]);
    expect(a.i).toBe(0x403);
    const vip = run([0x6003, 0xB205], 2);
    expect(vip.pc).toBe(0x208);            // vip: nnn+v0=0x205+3
    const vip0 = run([0x6103, 0xB205], 2);
    expect(vip0.pc).toBe(0x205);           // 6103 只写 v1，BNNN 用 v0=0
    const modern = run([0x6103, 0xB205], 2, { jump: 'modern' });
    expect(modern.pc).toBe(0x205);         // modern: vX = nnn 高半字节=2 → v2=0
    const modern2 = run([0x6203, 0xB205], 2, { jump: 'modern' });
    expect(modern2.pc).toBe(0x208);        // v2=3 → 0x205+3
  });
  it('CXNN 随机数被 NN 掩码', () => {
    for (let t = 0; t < 50; t++) {
      const vm = run([0xC0FF, 0xC10F]);
      expect(vm.v[0]).toBeLessThanOrEqual(0xFF);
      expect((vm.v[1] ?? 0) & 0xF0).toBe(0);
    }
  });
});

describe('M1 · ALU 与标志位', () => {
  it('8XY0-8XY3 逻辑运算', () => {
    const vm = run([0x61F0, 0x620F, 0x8120, 0x8121, 0x8123], 5);
    // v1=F0 → v1=v2=0F → |=0F → ^=0F=00
    expect(vm.v[1]).toBe(0x00);
    const vm2 = run([0x61F0, 0x620F, 0x8122], 3);
    expect(vm2.v[1]).toBe(0x00); // F0 & 0F = 0
  });
  it('8XY4 加法进位', () => {
    const vm = run([0x61FF, 0x6202, 0x8124], 3);
    expect(vm.v[1]).toBe(0x01);
    expect(vm.v[0xF]).toBe(1);
  });
  it('8XY5 减法借位', () => {
    const vm = run([0x6105, 0x6203, 0x8125], 3);
    expect(vm.v[1]).toBe(0x02); expect(vm.v[0xF]).toBe(1);
    const vm2 = run([0x6103, 0x6205, 0x8125], 3);
    expect(vm2.v[1]).toBe(0xFE); expect(vm2.v[0xF]).toBe(0);
  });
  it('8XY7 反减', () => {
    const vm = run([0x6103, 0x6205, 0x8127], 3);
    expect(vm.v[1]).toBe(0x02); expect(vm.v[0xF]).toBe(1);
    const vm2 = run([0x6105, 0x6203, 0x8127], 3);
    expect(vm2.v[1]).toBe(0xFE); expect(vm2.v[0xF]).toBe(0);
  });
  it('8XY6/8XYE 移位与移出位（两代）', () => {
    const vip = run([0x61F1, 0x62E0, 0x8126], 3);
    expect(vip.v[1]).toBe(0x70); expect(vip.v[0xF]).toBe(0); // vip: v1=v2>>1=0x70，vF=LSB(E0)=0
    const m2 = run([0x61F1, 0x8126], 2, { shift: 'modern' });
    expect(m2.v[1]).toBe(0x78); expect(m2.v[0xF]).toBe(1);   // modern: v1=v1>>1，移出 LSB=1
    const vleft = run([0x6180, 0x811E], 2);
    expect(vleft.v[1]).toBe(0x00); expect(vleft.v[0xF]).toBe(1);
  });
  it('vF 作操作数（先算后存：用旧 vF 参与运算）', () => {
    // 8FF4: vF = vF + v0，旧 vF=0x10 参与运算 → 0x10+0xF0=0x100 → 结果 0，进位 1 → vF=1
    // 若实现错误（先写进位再算），结果会是 0xF0+1=0xF1 → vF=0，两种口径可区分
    const vm = new Chip8();
    vm.loadRom(new Uint8Array([0x8F, 0x04])); // 8F04: vF = vF + v0
    vm.v[0xF] = 0x10; vm.v[0] = 0xF0;
    vm.tick();
    expect(vm.v[0xF]).toBe(1);
    // 80F4: v0 = v0 + vF，旧 vF=0x10 参与 → 0xF0+0x10=0x100 → v0=0, vF=1
    const vm2 = new Chip8();
    vm2.loadRom(new Uint8Array([0x80, 0xF4]));
    vm2.v[0xF] = 0x10; vm2.v[0] = 0xF0;
    vm2.tick();
    expect(vm2.v[0]).toBe(0x00);
    expect(vm2.v[0xF]).toBe(1);
  });
  it('vfReset 开关：逻辑运算清 vF 与不清', () => {
    const modern = new Chip8({ vfReset: true });
    modern.loadRom(new Uint8Array([0x81, 0x12])); // 8112: v1 = v1 & v1
    modern.v[1] = 0xFF; modern.v[0xF] = 1;
    modern.tick();
    expect(modern.v[0xF]).toBe(0);
    const vip = new Chip8();
    vip.loadRom(new Uint8Array([0x81, 0x12]));
    vip.v[1] = 0xFF; vip.v[0xF] = 1;
    vip.tick();
    expect(vip.v[0xF]).toBe(1); // VIP：逻辑运算不动 vF
  });
  it('未定义 opcode（8XY8-8XYD、5XYn/9XYn n≠0）当 NOP 并计数', () => {
    const vm = run([0x8128, 0x8129, 0x812A, 0x812B, 0x812C, 0x812D, 0x6111, 0x5111, 0x9111], 9);
    expect(vm.undefinedCount).toBe(8);
    expect(vm.v[1]).toBe(0x11);
  });
});

describe('M1 · FX 系', () => {
  it('FX07/FX15/FX18 定时器', () => {
    const vm = run([0x6132, 0xF115, 0xF107], 3);
    expect(vm.dt).toBe(0x32);
    expect(vm.v[1]).toBe(0x32);   // FX07 读 DT（tickTimers 前不递减）
    const vm2 = run([0x6132, 0xF118]);
    expect(vm2.st).toBe(0x32);
    expect(vm2.beeping()).toBe(true);
    vm2.tickTimers();
    expect(vm2.st).toBe(0x31);
  });
  it('FX33 BCD', () => {
    const vm = run([0x61FA, 0xA400, 0xF133], 3);
    expect(vm.memory[0x400]).toBe(2);
    expect(vm.memory[0x401]).toBe(5);
    expect(vm.memory[0x402]).toBe(0);
  });
  it('FX1E I 累加（12 位回绕，不动 vF）', () => {
    const vm = new Chip8();
    vm.loadRom(new Uint8Array([0x61, 0xFF, 0xF1, 0x1E]));
    vm.i = 0xFF01;
    vm.tick(); vm.tick();
    expect(vm.i).toBe(0x0000); // 0xFF01+0xFF=0x10000 → &0xFFF=0
    expect(vm.v[0xF]).toBe(0);
  });
  it('FX55/FX65 两代 I 行为', () => {
    const vip = new Chip8();
    vip.loadRom(new Uint8Array([0xA4, 0x00, 0xF2, 0x55]));
    vip.tick(); // A400
    vip.v[0] = 0x11; vip.v[1] = 0xAA; vip.v[2] = 0xBB;
    vip.tick(); // F255
    expect(vip.memory[0x400]).toBe(0x11);
    expect(vip.memory[0x401]).toBe(0xAA);
    expect(vip.memory[0x402]).toBe(0xBB);
    expect(vip.i).toBe(0x403); // vip：I 递增 X+1
    const modern = new Chip8({ memory: 'modern' });
    modern.loadRom(new Uint8Array([0xA4, 0x00, 0xF2, 0x55]));
    modern.tick();
    modern.v[0] = 0x11; modern.v[1] = 0xAA; modern.v[2] = 0xBB;
    modern.tick();
    expect(modern.memory[0x401]).toBe(0xAA);
    expect(modern.i).toBe(0x400); // modern：I 不动
    const back = new Chip8();
    back.loadRom(new Uint8Array([0xA4, 0x00, 0xF2, 0x65]));
    back.tick();
    back.memory[0x400] = 0x11; back.memory[0x401] = 0x22;
    back.tick(); // F265
    expect(back.v[0]).toBe(0x11);
    expect(back.v[1]).toBe(0x22);
    expect(back.i).toBe(0x403);
  });
});

describe('M2 · 显示（XOR 精灵 + VF 碰撞）', () => {
  it('DXYN 绘制/擦除与碰撞', () => {
    const vm = new Chip8();
    // 0x206 处放精灵数据 F0/0F，1202 回跳构成"画→跳回"循环
    vm.loadRom(new Uint8Array([0xA2, 0x06, 0xD0, 0x05, 0x12, 0x02, 0xF0, 0x0F]));
    vm.tick(); vm.tick(); // A206; D005（绘制）
    expect(vm.display[0]).toBe(1); expect(vm.display[3]).toBe(1);   // 0xF0 → y0 x0-3
    expect(vm.display[68]).toBe(1); expect(vm.display[71]).toBe(1); // 0x0F → y1 x4-7
    expect(vm.display[64]).toBe(0);
    expect(vm.v[0xF]).toBe(0);
    vm.tickTimers(); // vip 默认 displayWait：先放行 vblank
    vm.tick();       // 1202 回跳
    vm.tickTimers(); // （上一次绘制的 vblank 已在回跳前释放）
    vm.tick();       // D005 重画 → XOR 擦除 + 碰撞
    expect(vm.display[0]).toBe(0);
    expect(vm.display[68]).toBe(0);
    expect(vm.v[0xF]).toBe(1);
  });
  it('未对齐绘制：位仍按列展开', () => {
    const vm = new Chip8();
    vm.loadRom(new Uint8Array([0x61, 0x07, 0xA2, 0x06, 0xD1, 0x02, 0x80, 0x80]));
    vm.tick(); vm.tick(); vm.tick();
    expect(vm.display[7]).toBe(1);   // (7,0)
    expect(vm.display[8]).toBe(0);   // 0x80 只有 bit7
    expect(vm.display[71]).toBe(1);  // (7,1)
  });
  it('VIP 环绕 vs 现代裁剪（两代行为开关）', () => {
    const make = (cfg: Partial<Chip8Config>) => {
      const vm = new Chip8(cfg);
      vm.loadRom(new Uint8Array([0x60, 63, 0x61, 31, 0xA2, 0x08, 0xD0, 0x02, 0xFF, 0xFF]));
      for (let k = 0; k < 4; k++) vm.tick();
      return vm;
    };
    const vip = make({});
    expect(vip.display[31 * 64 + 63]).toBe(1);       // (63,31)
    expect(vip.display[31 * 64 + 0]).toBe(1);        // (64,31) → 环绕到 (0,31)
    expect(vip.display[63]).toBe(1);                 // (63,32) → 环绕到 (63,0)
    expect(vip.v[0xF]).toBe(0);
    const modern = make({ clipping: true });
    expect(modern.display[31 * 64 + 63]).toBe(1);    // 只有 (63,31) 在屏内
    expect(modern.display[31 * 64 + 0]).toBe(0);
    expect(modern.display[63]).toBe(0);
    expect(modern.v[0xF]).toBe(0);                   // 空白处绘制无碰撞
  });
  it('displayWait：绘制后空转，tickTimers 解锁', () => {
    const vm = new Chip8();
    vm.loadRom(new Uint8Array([0xA2, 0x08, 0xD0, 0x01, 0x61, 0x11, 0x80, 0x01, 0x80]));
    vm.tick(); vm.tick(); // A208; D001 → display[0]=1，drawWait
    expect(vm.display[0]).toBe(1);
    vm.tick(); vm.tick(); // 阻塞中，6111 不执行
    expect(vm.v[1]).toBe(0);
    vm.tickTimers();      // vblank
    vm.tick(); vm.tick(); // 6111; 8001
    expect(vm.v[1]).toBe(0x11);
    const noWait = new Chip8({ displayWait: false });
    noWait.loadRom(new Uint8Array([0xA2, 0x08, 0xD0, 0x01, 0x61, 0x11, 0x80, 0x01, 0x80]));
    noWait.tick(); noWait.tick(); noWait.tick();
    expect(noWait.v[1]).toBe(0x11); // 不等待
    expect(noWait.display[0]).toBe(1);
  });
});

describe('M2 · Keypad（EX9E/EXA1/FX0A）', () => {
  it('EX9E 按下跳过 / EXA1 未按下跳过', () => {
    const vm = new Chip8();
    vm.loadRom(new Uint8Array([0x61, 0x05, 0xE1, 0x9E, 0x6F, 0xAA, 0xE1, 0xA1, 0x6F, 0xBB]));
    vm.setKey(5, true);
    vm.tick(); vm.tick(); // 6105; E19E 按下 → 跳过 6FAA
    expect(vm.v[0xF]).toBe(0x00);
    vm.tick(); vm.tick(); // E1A1 按下 → 不跳过 → 6FBB
    expect(vm.v[0xF]).toBe(0xBB);
    const vm2 = new Chip8();
    vm2.loadRom(new Uint8Array([0x61, 0x05, 0xE1, 0x9E, 0x6F, 0xAA, 0xE1, 0xA1, 0x6F, 0xBB]));
    vm2.tick(); vm2.tick(); vm2.tick(); // 6105; E19E 未按下不跳; 6FAA
    expect(vm2.v[0xF]).toBe(0xAA);
    vm2.tick(); vm2.tick(); // E1A1 未按下 → 跳过 6FBB
    expect(vm2.v[0xF]).toBe(0xAA);
  });
  it('FX0A 阻塞：等按下→等松开→写入 vX（VIP 语义）', () => {
    const vm = new Chip8();
    vm.loadRom(new Uint8Array([0xF1, 0x0A, 0x6F, 0x99]));
    vm.tick(); // FX0A：阻塞
    expect(vm.isWaitingForKey()).toBe(true);
    vm.tick(); vm.tick(); // 无按键仍阻塞
    vm.setKey(0xC, true);
    vm.tick(); // 捕获按下
    expect(vm.isWaitingForKey()).toBe(true);
    vm.tick(); vm.tick(); // 等松开
    vm.setKey(0xC, false);
    vm.tick(); // 松开 → 写入 v1（FX0A 的 X），继续
    expect(vm.v[1]).toBe(0xC);
    expect(vm.v[0xC]).toBe(0);
    expect(vm.isWaitingForKey()).toBe(false);
    vm.tick(); // 6F99
    expect(vm.v[0xF]).toBe(0x99);
  });
  it('FX0A 阻塞期间定时器照常走', () => {
    const vm = new Chip8();
    vm.loadRom(new Uint8Array([0xF1, 0x0A]));
    vm.dt = 5;
    vm.tick();
    vm.setKey(1, true); vm.tick(); // 捕获
    vm.tickTimers(); vm.tickTimers();
    expect(vm.dt).toBe(3);
  });
  it('setKey 越界抛 RangeError', () => {
    const vm = new Chip8();
    expect(() => vm.setKey(16, true)).toThrow(RangeError);
    expect(() => vm.setKey(-1, true)).toThrow(RangeError);
  });
});

describe('配置预设', () => {
  it('VIP / MODERN 预设字段', () => {
    expect(VIP_PRESET.shift).toBe('vip');
    expect(VIP_PRESET.displayWait).toBe(true);
    expect(VIP_PRESET.clipping).toBe(false);
    expect(MODERN_PRESET.shift).toBe('modern');
    expect(MODERN_PRESET.vfReset).toBe(true);
    expect(MODERN_PRESET.memory).toBe('modern');
  });
});
