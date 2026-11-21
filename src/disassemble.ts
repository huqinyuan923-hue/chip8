// CHIP-8 反汇编器：与 assemble.ts 的助记符严格互逆，保证 asm→disasm→asm 逐字节相等。
// 未定义编码一律输出 db 伪指令（assemble() 可原样重组），任意字节序列都能 round-trip。
export interface DisasmOptions {
  /** 起始地址（显示用），默认 0x200 */
  base?: number;
}

const hex2 = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;
const hex3 = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(3, '0')}`;
const rg = (n: number): string => `v${n.toString(16).toUpperCase()}`;

/** 反汇编 ROM（2 字节一条），返回与指令条数相同的字符串数组。 */
export function disassemble(rom: Uint8Array, options: DisasmOptions = {}): string[] {
  const out: string[] = [];
  for (let off = 0; off + 1 < rom.length; off += 2) {
    const hi = rom[off] ?? 0;
    const lo = rom[off + 1] ?? 0;
    const op = (hi << 8) | lo;
    const x = (op >> 8) & 0xF;
    const y = (op >> 4) & 0xF;
    const n = op & 0xF;
    const nn = op & 0xFF;
    const nnn = op & 0xFFF;
    out.push(fmt(op, x, y, n, nn, nnn, hi, lo));
  }
  // 奇数字节 ROM：尾字节单独成行（db 可原样重组，保持 round-trip）
  if (rom.length % 2 === 1) {
    out.push(`db ${hex2(rom[rom.length - 1] ?? 0)}`);
  }
  return out;
}

function fmt(op: number, x: number, y: number, n: number, nn: number, nnn: number, hi: number, lo: number): string {
  switch (op >> 12) {
    case 0x0:
      if (op === 0x00E0) return 'cls';
      if (op === 0x00EE) return 'ret';
      return `sys ${hex3(nnn)}`;                    // 含 0x0000 → sys 0x000
    case 0x1: return `jump ${hex3(nnn)}`;
    case 0x2: return `call ${hex3(nnn)}`;
    case 0x3: return `se ${rg(x)}, ${hex2(nn)}`;
    case 0x4: return `sne ${rg(x)}, ${hex2(nn)}`;
    case 0x5:
      if (n === 0) return `se ${rg(x)}, ${rg(y)}`;
      return `db ${hex2(hi)}, ${hex2(lo)}`;
    case 0x6: return `ld ${rg(x)}, ${hex2(nn)}`;
    case 0x7: return `add ${rg(x)}, ${hex2(nn)}`;
    case 0x8:
      switch (n) {
        case 0x0: return `ld ${rg(x)}, ${rg(y)}`;
        case 0x1: return `or ${rg(x)}, ${rg(y)}`;
        case 0x2: return `and ${rg(x)}, ${rg(y)}`;
        case 0x3: return `xor ${rg(x)}, ${rg(y)}`;
        case 0x4: return `add ${rg(x)}, ${rg(y)}`;
        case 0x5: return `sub ${rg(x)}, ${rg(y)}`;
        case 0x6: return y === 0 ? `shr ${rg(x)}` : `shr ${rg(x)}, ${rg(y)}`;
        case 0x7: return `subr ${rg(x)}, ${rg(y)}`;
        case 0xE: return y === 0 ? `shl ${rg(x)}` : `shl ${rg(x)}, ${rg(y)}`;
        default: return `db ${hex2(hi)}, ${hex2(lo)}`;
      }
    case 0x9:
      if (n === 0) return `sne ${rg(x)}, ${rg(y)}`;
      return `db ${hex2(hi)}, ${hex2(lo)}`;
    case 0xA: return `ld i, ${hex3(nnn)}`;
    case 0xB: return `jump0 ${hex3(nnn)}`;
    case 0xC: return `rnd ${rg(x)}, ${hex2(nn)}`;
    case 0xD: return `draw ${rg(x)}, ${rg(y)}, ${n}`;
    case 0xE:
      if (nn === 0x9E) return `skp ${rg(x)}`;
      if (nn === 0xA1) return `sknp ${rg(x)}`;
      return `db ${hex2(hi)}, ${hex2(lo)}`;
    case 0xF:
      switch (nn) {
        case 0x07: return `ld ${rg(x)}, dt`;
        case 0x0A: return `ld ${rg(x)}, k`;
        case 0x15: return `ld dt, ${rg(x)}`;
        case 0x18: return `ld st, ${rg(x)}`;
        case 0x1E: return `add i, ${rg(x)}`;
        case 0x29: return `ld f, ${rg(x)}`;
        case 0x33: return `ld b, ${rg(x)}`;
        case 0x55: return `ld [i], ${rg(x)}`;
        case 0x65: return `ld ${rg(x)}, [i]`;
        default: return `db ${hex2(hi)}, ${hex2(lo)}`;
      }
    default: return `db ${hex2(hi)}, ${hex2(lo)}`;
  }
}
