// M3：汇编器功能测试（标号/伪指令/表达式/错误处理）
import { describe, expect, it } from 'vitest';
import { assemble, AsmError } from '../src/assemble.js';
import { disassemble } from '../src/disassemble.js';

const bytes = (src: string): number[] => Array.from(assemble(src));

describe('M3 · 基本编码', () => {
  it('逐条助记符编码正确', () => {
    expect(bytes('ld v1, 0x20')).toEqual([0x61, 0x20]);
    expect(bytes('add v3, 0x0f')).toEqual([0x73, 0x0f]);
    expect(bytes('draw v1, v2, 5')).toEqual([0xD1, 0x25]);
    expect(bytes('cls')).toEqual([0x00, 0xE0]);
    expect(bytes('ret')).toEqual([0x00, 0xEE]);
    expect(bytes('jump 0x300')).toEqual([0x13, 0x00]);
    expect(bytes('call 0x2f0')).toEqual([0x22, 0xf0]);
    expect(bytes('jump0 0x123')).toEqual([0xB1, 0x23]);
    expect(bytes('se v3, 0x1a')).toEqual([0x33, 0x1a]);
    expect(bytes('sne v3, 0x1a')).toEqual([0x43, 0x1a]);
    expect(bytes('se v3, v4')).toEqual([0x53, 0x40]);
    expect(bytes('sne v3, v4')).toEqual([0x93, 0x40]);
    expect(bytes('ld i, 0x400')).toEqual([0xA4, 0x00]);
    expect(bytes('rnd v5, 0x7f')).toEqual([0xC5, 0x7f]);
    expect(bytes('skp v1')).toEqual([0xE1, 0x9E]);
    expect(bytes('sknp vA')).toEqual([0xEA, 0xA1]);
    expect(bytes('ld v3, dt')).toEqual([0xF3, 0x07]);
    expect(bytes('ld v3, k')).toEqual([0xF3, 0x0A]);
    expect(bytes('ld dt, v3')).toEqual([0xF3, 0x15]);
    expect(bytes('ld st, v3')).toEqual([0xF3, 0x18]);
    expect(bytes('add i, v3')).toEqual([0xF3, 0x1E]);
    expect(bytes('ld f, v3')).toEqual([0xF3, 0x29]);
    expect(bytes('ld b, v3')).toEqual([0xF3, 0x33]);
    expect(bytes('ld [i], vF')).toEqual([0xFF, 0x55]);
    expect(bytes('ld vF, [i]')).toEqual([0xFF, 0x65]);
    expect(bytes('or v1, v2')).toEqual([0x81, 0x21]);
    expect(bytes('and v1, v2')).toEqual([0x81, 0x22]);
    expect(bytes('xor v1, v2')).toEqual([0x81, 0x23]);
    expect(bytes('add v1, v2')).toEqual([0x81, 0x24]);
    expect(bytes('sub v1, v2')).toEqual([0x81, 0x25]);
    expect(bytes('subr v1, v2')).toEqual([0x81, 0x27]);
    expect(bytes('shr v1')).toEqual([0x81, 0x06]);
    expect(bytes('shr v1, v2')).toEqual([0x81, 0x26]);
    expect(bytes('shl v1')).toEqual([0x81, 0x0E]);
    expect(bytes('shl v1, v2')).toEqual([0x81, 0x2E]);
    expect(bytes('ld v1, v2')).toEqual([0x81, 0x20]);
    expect(bytes('sys 0x123')).toEqual([0x01, 0x23]);
  });
});

describe('M3 · 标号与伪指令', () => {
  it('前向引用标号（两遍扫描）', () => {
    const rom = bytes(`
      jump main
      main: ld v0, SCREEN_W
      loop: jump loop
    `);
    // main=0x202, loop=0x204
    expect(rom).toEqual([0x12, 0x02, 0x60, 64, 0x12, 0x04]);
  });
  it('后向引用与表达式运算', () => {
    const rom = bytes(`
      table: db 1, 2, 3
      ld i, table + 2
      ld i, table - 0x200 + 1
    `);
    // table = 0x200（3 字节），两条指令在 0x203/0x205；table+2=0x202；table-0x200+1=1
    expect(rom.slice(3, 5)).toEqual([0xA2, 0x02]);
    expect(rom.slice(5, 7)).toEqual([0xA0, 0x01]); // ld i, 1 → 0xA001
    expect(rom.slice(0, 3)).toEqual([1, 2, 3]);
  });
  it('.org 产生空洞补 0', () => {
    const rom = bytes(`
      ld v0, 1
      .org 0x210
      ret
    `);
    expect(rom.length).toBe(0x12); // 0x200..0x211
    expect(rom.slice(0, 2)).toEqual([0x60, 1]);
    expect(rom.slice(2, 0x10).every(b => b === 0)).toBe(true);
    expect(rom.slice(0x10)).toEqual([0x00, 0xEE]);
  });
  it('.db 字符串与 .dw 大端', () => {
    const rom = bytes(`
      .db "HI", 0
      .dw 0x1234, 0xABCD
    `);
    expect(rom).toEqual([0x48, 0x49, 0x00, 0x12, 0x34, 0xAB, 0xCD]);
  });
  it('预定义符号 V0-VF / K0-KF（表达式数值语境）', () => {
    const rom = bytes(`
      se v3, K5
      ld i, VF
      ld v1, SCREEN_H
    `);
    // K5=5；VF=15（作 ANNN 地址 → 0xA00F）；SCREEN_H=32
    expect(rom).toEqual([0x33, 0x05, 0xA0, 0x0F, 0x61, 0x20]);
  });
  it('表达式：算术/位运算/括号/优先级', () => {
    const rom = bytes('ld v1, (2 + 3) * 4 | 0x10');
    expect(rom).toEqual([0x61, ((2 + 3) * 4) | 0x10]);
    const rom2 = bytes('ld v1, 1 << 4 ^ 3 & 7');
    // 1<<4=16, 3&7=3, 16^3=19
    expect(rom2).toEqual([0x61, 19]);
  });
  it('注释与大小写不敏感', () => {
    const rom = bytes(`
      ; 注释行
      LD V1, 0x10 # 尾注释
      cls
    `);
    expect(rom).toEqual([0x61, 0x10, 0x00, 0xE0]);
  });
});

describe('M3 · 错误处理（AsmError 带行号）', () => {
  it('未知标号', () => {
    expect(() => assemble('jump nowhere')).toThrow(AsmError);
    try { assemble('\n\njump nowhere'); } catch (e) { expect((e as AsmError).line).toBe(3); }
  });
  it('重复标号', () => {
    expect(() => assemble('a:\na:\nret')).toThrow(/重复/);
  });
  it('位域超范围', () => {
    expect(() => assemble('ld v1, 0x1FF')).toThrow(/8 位/);
    expect(() => assemble('jump 0x1000')).toThrow(/12 位/);
    expect(() => assemble('draw v1, v2, 16')).toThrow(/4 位/);
  });
  it('坏寄存器/未知助记符/操作数个数', () => {
    expect(() => assemble('ld dt, vG')).toThrow(/寄存器/);
    expect(() => assemble('ld vG, 1')).toThrow(/不支持的操作数/);
    expect(() => assemble('frobnicate v1')).toThrow(/未知助记符/);
    expect(() => assemble('ld v1')).toThrow(/操作数/);
  });
  it('表达式错误', () => {
    expect(() => assemble('ld v1, 5/0')).toThrow(/除以 0/);
    expect(() => assemble('ld v1, (2+3')).toThrow(/括号/);
    expect(() => assemble('ld v1, 2 +')).toThrow();
  });
});

describe('M3 · 反汇编', () => {
  it('逐条编码映射到预期助记符', () => {
    const rom = new Uint8Array([0x00, 0xE0, 0x12, 0x04, 0xD1, 0x25, 0x00, 0x00]);
    const lines = disassemble(rom);
    expect(lines).toEqual(['cls', 'jump 0x204', 'draw v1, v2, 5', 'sys 0x000']);
  });
  it('未定义编码回退 db', () => {
    const rom = new Uint8Array([0x81, 0x28, 0x51, 0x11, 0xF1, 0x99]);
    expect(disassemble(rom)).toEqual(['db 0x81, 0x28', 'db 0x51, 0x11', 'db 0xF1, 0x99']);
  });
  it('shr/shl：y=0 紧凑形式，y≠0 带源寄存器', () => {
    const rom = new Uint8Array([0x81, 0x06, 0x81, 0x26, 0x81, 0x0E, 0x81, 0x2E]);
    expect(disassemble(rom)).toEqual(['shr v1', 'shr v1, v2', 'shl v1', 'shl v1, v2']);
  });
  it('奇数字节 ROM：尾字节输出 db 行（保持 round-trip）', () => {
    expect(disassemble(new Uint8Array([0x00, 0xE0, 0x7F]))).toEqual(['cls', 'db 0x7F']);
  });
});
