// CHIP-8 汇编器：两遍扫描（前向引用标号）、.org/.db/.dw 伪指令、表达式（常量+标号运算）、
// 预定义符号（V0-VF、K0-KF 键值、SCREEN_W/SCREEN_H）。
// 语法为 Octo 风格子集（vfc 测试 ROM 源码即 Octo 语法，便于移植/对照）。
//
//   ; 或 # 开头为注释
//   label:            标号（可独占一行或与指令同行）
//   cls / ret / sys nnn
//   jump nnn | jump0 nnn          1NNN / BNNN
//   call nnn                      2NNN
//   se vX, nn | se vX, vY         3XNN / 5XY0
//   sne vX, nn | sne vX, vY       4XNN / 9XY0
//   ld vX, nn / vX, vY / vX, dt / vX, k / vX, [i]
//   ld i, nnn / dt, vX / st, vX / f, vX / b, vX / [i], vX
//   add vX, nn / vX, vY / i, vX   7XNN / 8XY4 / FX1E
//   sub vX, vY                    8XY5 (vX -= vY)
//   subr vX, vY                   8XY7 (vX = vY - vX)
//   or/and/xor vX, vY             8XY1/2/3
//   shr vX[, vY]                  8XY6（vY 缺省为 0）
//   shl vX[, vY]                  8XYE
//   rnd vX, nn                    CXNN
//   skp/sknp vX                   EX9E / EXA1
//   draw vX, vY, n                DXYN
//   .org NNNN  .db b[, b...]（支持字符串）  .dw w[, w...]
//
// 汇编错误抛 AsmError（带行号）；输出为覆盖 [最低写地址, 最高写地址) 的连续 ROM，
// .org 空洞补 0（默认基址 0x200，可直接 loadRom）。
export class AsmError extends Error {
  constructor(message: string, readonly line: number) {
    super(`第 ${line} 行：${message}`);
    this.name = 'AsmError';
  }
}

interface Line {
  /** 原始行号（1 起） */
  no: number;
  kind: 'instr' | 'org' | 'db' | 'dw';
  /** 助记符（小写） */
  mnemonic: string;
  /** 逗号分隔的操作数原始文本 */
  operands: string[];
  /** 本行定义的标号（可空） */
  label?: string;
}

/** 表达式求值器：+ - * / % & | ^ << >>（C 风格优先级）、一元 - ~、括号、常量与符号。
 *  手写递归下降解析器，不使用任何动态代码执行。 */
class Expr {
  private pos = 0;
  constructor(
    private readonly text: string,
    private readonly line: number,
    private readonly symbols: Map<string, number>,
  ) { }

  /** 求值入口（手写解析器，无动态执行）。 */
  static evaluate(text: string, line: number, symbols: Map<string, number>): number {
    return new Expr(text, line, symbols).parseExpr();
  }

  private fail(msg: string): never {
    throw new AsmError(`表达式 "${this.text}" ${msg}`, this.line);
  }
  private peek(): string {
    return this.text[this.pos] ?? '';
  }
  private skipWs(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] ?? '')) this.pos++;
  }
  private eat(str: string): boolean {
    this.skipWs();
    if (!this.text.startsWith(str, this.pos)) return false;
    // 仅当待匹配串本身以词字符结尾时，才要求后面不是词字符（避免误伤括号/运算符）
    if (/[\w]$/.test(str) && /[\w]/.test(this.text[this.pos + str.length] ?? '')) return false;
    this.pos += str.length;
    return true;
  }
  private eatOp(...ops: string[]): string | null {
    this.skipWs();
    // 双字符运算符优先
    for (const two of ['<<', '>>']) {
      if (this.text.startsWith(two, this.pos)) {
        if (ops.includes(two)) { this.pos += 2; return two; }
        return null;
      }
    }
    const c = this.peek();
    if (ops.includes(c)) { this.pos++; return c; }
    return null;
  }

  private parseExpr(): number {
    const v = this.parseBinop(0);
    this.skipWs();
    if (this.pos < this.text.length) this.fail(`有多余内容 "${this.text.slice(this.pos)}"`);
    return v;
  }

  private static readonly LEVELS: string[][] = [
    ['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '%'],
  ];

  private parseBinop(level: number): number {
    if (level >= Expr.LEVELS.length) return this.parseUnary();
    const ops = Expr.LEVELS[level] ?? [];
    let left = this.parseBinop(level + 1);
    for (;;) {
      this.skipWs();
      const op = this.eatOp(...ops);
      if (!op) return left;
      const right = this.parseBinop(level + 1);
      switch (op) {
        case '|': left = left | right; break;
        case '^': left = left ^ right; break;
        case '&': left = left & right; break;
        case '<<': left = left << right; break;
        case '>>': left = left >> right; break;
        case '+': left = left + right; break;
        case '-': left = left - right; break;
        case '*': left = left * right; break;
        case '/': if (right === 0) this.fail('除以 0'); left = Math.floor(left / right); break;
        case '%': if (right === 0) this.fail('模 0'); left = left % right; break;
      }
    }
  }

  private parseUnary(): number {
    this.skipWs();
    if (this.eat('-')) return -this.parseUnary();
    if (this.eat('~')) return ~this.parseUnary();
    if (this.eat('+')) return this.parseUnary();
    if (this.eat('(')) {
      const v = this.parseBinop(0);
      if (!this.eat(')')) this.fail('缺右括号');
      return v;
    }
    return this.parseAtom();
  }

  private matchAt(pattern: RegExp): RegExpMatchArray | null {
    // 从当前位置起匹配一个正则（等价于 sticky regex + test/capture）
    const rest = this.text.slice(this.pos);
    const m = rest.match(pattern);
    if (m && m.index === 0) return m;
    return null;
  }

  private parseAtom(): number {
    this.skipWs();
    const c = this.peek();
    if (c === "'") { // 字符字面量
      const m = this.matchAt(/^'(\\.|[^\\])'/);
      if (!m) this.fail('字符字面量格式错误');
      const inner = m[1] ?? '';
      this.pos += m[0].length;
      return inner.startsWith('\\')
        ? ({ n: 10, t: 9, r: 13 } as Record<string, number | undefined>)[inner[1] ?? ''] ?? inner.charCodeAt(1)
        : inner.charCodeAt(0);
    }
    const num = this.matchAt(/^(0[xX][0-9A-Fa-f]+|0[bB][01]+|\d+)/);
    if (num) {
      const t = num[0];
      this.pos += t.length;
      return t.toLowerCase().startsWith('0x') ? parseInt(t.slice(2), 16)
        : t.toLowerCase().startsWith('0b') ? parseInt(t.slice(2), 2)
        : parseInt(t, 10);
    }
    const id = this.matchAt(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (id) {
      const name = id[0];
      this.pos += name.length;
      const v = this.symbols.get(name.toUpperCase());
      if (v === undefined) this.fail(`未知符号 "${name}"`);
      return v;
    }
    this.fail(`无法解析 "${this.text.slice(this.pos) || '空表达式'}"`);
  }
}

/** 预定义符号：寄存器号、键值、屏幕尺寸。 */
export function predefinedSymbols(): Map<string, number> {
  const m = new Map<string, number>();
  for (let k = 0; k < 16; k++) {
    const h = k.toString(16).toUpperCase();
    m.set(`V${h}`, k);      // 寄存器号（表达式用）
    m.set(`K${h}`, k);      // 键值
  }
  m.set('SCREEN_W', 64);
  m.set('SCREEN_H', 32);
  return m;
}

const BUILTINS = predefinedSymbols();

// ---------------------------------------------------------------------------

/** 词法：把源码按行拆成 {标号, 助记符, 操作数}，剥离注释。 */
function tokenize(source: string): Line[] {
  const lines: Line[] = [];
  source.split(/\r?\n/).forEach((raw, idx) => {
    const no = idx + 1;
    // 剥离注释（.db 字符串内出现 ; 或 # 会被截断——记录为已知限制）
    let text = raw.replace(/[#;].*$/, '').trim();
    if (!text) return;

    let label: string | undefined;
    const labelM = text.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/);
    if (labelM) {
      label = labelM[1];
      text = (labelM[2] ?? '').trim();
      if (!text) { lines.push({ no, kind: 'instr', mnemonic: '', operands: [], label }); return; }
    }

    const mnemonic = (text.match(/^\S+/) ?? [''])[0].toLowerCase();
    const rest = text.slice(mnemonic.length).trim();
    const operands = rest ? rest.split(',').map(s => s.trim()) : [];
    if (mnemonic === '.org' || mnemonic === 'org') {
      lines.push({ no, kind: 'org', mnemonic: '.org', operands, label });
    } else if (mnemonic === '.db' || mnemonic === 'db') {
      lines.push({ no, kind: 'db', mnemonic: '.db', operands, label });
    } else if (mnemonic === '.dw' || mnemonic === 'dw') {
      lines.push({ no, kind: 'dw', mnemonic: '.dw', operands, label });
    } else {
      lines.push({ no, kind: 'instr', mnemonic, operands, label });
    }
  });
  return lines;
}

/** 语句编码后的大小（字节）。 */
function lineSize(l: Line): number {
  switch (l.kind) {
    case 'org': return 0;
    case 'db': return l.operands.length; // 每个操作数 1 字节（字符串按字符展开）
    case 'dw': return l.operands.length * 2;
    case 'instr': return l.mnemonic ? 2 : 0; // 纯标号行 0 字节
  }
}

interface Ctx {
  labels: Map<string, number>;
  addr: number;
}

function resolveSymbols(ctx: Ctx): Map<string, number> {
  const m = new Map(BUILTINS);
  for (const [k, v] of ctx.labels) m.set(k.toUpperCase(), v);
  return m;
}

/** 校验编码用的位域范围。 */
function checkRange(val: number, bits: number, what: string, line: number): void {
  if (!Number.isInteger(val) || val < 0 || val >= (1 << bits)) {
    throw new AsmError(`${what} = ${val} 超出 ${bits} 位范围`, line);
  }
}

function reg(token: string | undefined, line: number): number {
  const m = (token ?? '').match(/^v([0-9A-Fa-f])$/i);
  if (!m) throw new AsmError(`期望寄存器 v0-vF，得到 "${token}"`, line);
  return parseInt(m[1] ?? '0', 16);
}

function isReg(token: string | undefined): boolean {
  return token !== undefined && /^v[0-9A-Fa-f]$/i.test(token);
}

function needOperands(l: Line, n: number): void {
  if (l.operands.length !== n) {
    throw new AsmError(`${l.mnemonic} 需要 ${n} 个操作数，得到 ${l.operands.length}`, l.no);
  }
}

/** 编码一条指令（两遍扫描的第二遍调用）。 */
function encode(l: Line, ctx: Ctx): number[] {
  const sym = resolveSymbols(ctx);
  const ev = (text: string | undefined) => Expr.evaluate(text ?? '', l.no, sym);
  const mn = l.mnemonic;

  switch (mn) {
    case 'cls': needOperands(l, 0); return [0x00, 0xE0];
    case 'ret': needOperands(l, 0); return [0x00, 0xEE];
    case 'sys': {
      needOperands(l, 1);
      const nnn = ev(l.operands[0]);
      checkRange(nnn, 12, '地址', l.no);
      return [(nnn >> 8) & 0x0F, nnn & 0xFF];
    }
    case 'jump': {
      needOperands(l, 1);
      const nnn = ev(l.operands[0]);
      checkRange(nnn, 12, '地址', l.no);
      return [(nnn >> 8) | 0x10, nnn & 0xFF];
    }
    case 'jump0': {
      needOperands(l, 1);
      const nnn = ev(l.operands[0]);
      checkRange(nnn, 12, '地址', l.no);
      return [(nnn >> 8) | 0xB0, nnn & 0xFF];
    }
    case 'call': {
      needOperands(l, 1);
      const nnn = ev(l.operands[0]);
      checkRange(nnn, 12, '地址', l.no);
      return [(nnn >> 8) | 0x20, nnn & 0xFF];
    }
    case 'se': {
      needOperands(l, 2);
      const x = reg(l.operands[0], l.no);
      if (isReg(l.operands[1])) {
        const y = reg(l.operands[1], l.no);
        return [(0x5 << 4) | x, y << 4];
      }
      const nn = ev(l.operands[1]);
      checkRange(nn, 8, '立即数', l.no);
      return [(0x3 << 4) | x, nn];
    }
    case 'sne': {
      needOperands(l, 2);
      const x = reg(l.operands[0], l.no);
      if (isReg(l.operands[1])) {
        const y = reg(l.operands[1], l.no);
        return [(0x9 << 4) | x, y << 4];
      }
      const nn = ev(l.operands[1]);
      checkRange(nn, 8, '立即数', l.no);
      return [(0x4 << 4) | x, nn];
    }
    case 'ld': {
      needOperands(l, 2);
      const a = l.operands[0] ?? '';
      const b = l.operands[1] ?? '';
      // ld vX, ...
      if (isReg(a)) {
        const x = reg(a, l.no);
        if (isReg(b)) return [(0x8 << 4) | x, reg(b, l.no) << 4];
        if (b.toLowerCase() === 'dt') return [(0xF << 4) | x, 0x07];
        if (b.toLowerCase() === 'k') return [(0xF << 4) | x, 0x0A];
        if (b === '[i]') return [(0xF << 4) | x, 0x65];
        const nn = ev(b);
        checkRange(nn, 8, '立即数', l.no);
        return [(0x6 << 4) | x, nn];
      }
      if (a.toLowerCase() === 'i') { const nnn = ev(b); checkRange(nnn, 12, '地址', l.no); return [(0xA << 4) | (nnn >> 8), nnn & 0xFF]; }
      if (a.toLowerCase() === 'dt') { const x = reg(b, l.no); return [(0xF << 4) | x, 0x15]; }
      if (a.toLowerCase() === 'st') { const x = reg(b, l.no); return [(0xF << 4) | x, 0x18]; }
      if (a.toLowerCase() === 'f') { const x = reg(b, l.no); return [(0xF << 4) | x, 0x29]; }
      if (a.toLowerCase() === 'b') { const x = reg(b, l.no); return [(0xF << 4) | x, 0x33]; }
      if (a === '[i]') { const x = reg(b, l.no); return [(0xF << 4) | x, 0x55]; }
      throw new AsmError(`ld 不支持的操作数 "${a}, ${b}"`, l.no);
    }
    case 'add': {
      needOperands(l, 2);
      const a = l.operands[0] ?? '';
      if (isReg(a)) {
        const x = reg(a, l.no);
        if (isReg(l.operands[1])) {
          const y = reg(l.operands[1], l.no);
          return [(0x8 << 4) | x, (y << 4) | 0x4];
        }
        const nn = ev(l.operands[1]);
        checkRange(nn, 8, '立即数', l.no);
        return [(0x7 << 4) | x, nn];
      }
      if (a.toLowerCase() === 'i') { const x = reg(l.operands[1], l.no); return [(0xF << 4) | x, 0x1E]; }
      throw new AsmError(`add 不支持的操作数 "${l.operands.join(', ')}"`, l.no);
    }
    case 'sub': {
      needOperands(l, 2);
      const x = reg(l.operands[0], l.no);
      const y = reg(l.operands[1], l.no);
      return [(0x8 << 4) | x, (y << 4) | 0x5];
    }
    case 'subr': {
      needOperands(l, 2);
      const x = reg(l.operands[0], l.no);
      const y = reg(l.operands[1], l.no);
      return [(0x8 << 4) | x, (y << 4) | 0x7];
    }
    case 'or': case 'and': case 'xor': {
      needOperands(l, 2);
      const x = reg(l.operands[0], l.no);
      const y = reg(l.operands[1], l.no);
      const sub = mn === 'or' ? 1 : mn === 'and' ? 2 : 3;
      return [(0x8 << 4) | x, (y << 4) | sub];
    }
    case 'shr': case 'shl': {
      // 可选第二操作数（缺省 v0）
      if (l.operands.length !== 1 && l.operands.length !== 2) {
        throw new AsmError(`${mn} 需要 1-2 个操作数，得到 ${l.operands.length}`, l.no);
      }
      const x = reg(l.operands[0], l.no);
      const y = l.operands[1] !== undefined ? reg(l.operands[1], l.no) : 0;
      const sub = mn === 'shr' ? 0x6 : 0xE;
      return [(0x8 << 4) | x, (y << 4) | sub];
    }
    case 'skp': case 'sknp': {
      needOperands(l, 1);
      const x = reg(l.operands[0], l.no);
      return [(0xE << 4) | x, mn === 'skp' ? 0x9E : 0xA1];
    }
    case 'rnd': {
      needOperands(l, 2);
      const x = reg(l.operands[0], l.no);
      const nn = ev(l.operands[1]);
      checkRange(nn, 8, '立即数/掩码', l.no);
      return [(0xC << 4) | x, nn];
    }
    case 'draw': {
      needOperands(l, 3);
      const x = reg(l.operands[0], l.no);
      const y = reg(l.operands[1], l.no);
      const n = ev(l.operands[2]);
      checkRange(n, 4, '精灵行数', l.no);
      return [(0xD << 4) | x, (y << 4) | n];
    }
    default:
      throw new AsmError(`未知助记符 "${mn}"`, l.no);
  }
}

/** 汇编入口：两遍扫描。 */
export function assemble(source: string): Uint8Array {
  const lines = tokenize(source);

  // ---- 第一遍：算大小、记标号 ----
  const labels = new Map<string, number>();
  let addr = 0x200;
  for (const l of lines) {
    if (l.label) {
      const key = l.label.toUpperCase();
      if (labels.has(key)) throw new AsmError(`标号 "${l.label}" 重复定义`, l.no);
      labels.set(key, addr);
    }
    if (l.kind === 'org') {
      if (l.operands.length !== 1) throw new AsmError('.org 需要一个地址操作数', l.no);
      addr = Expr.evaluate(l.operands[0] ?? '', l.no, resolveSymbols({ labels, addr }));
      if (addr < 0 || addr > 0xFFF) throw new AsmError(`.org 地址 ${addr} 超出 12 位`, l.no);
      continue;
    }
    addr += lineSize(l);
  }

  // ---- 第二遍：编码 ----
  const chunks: { addr: number; bytes: number[] }[] = [];
  addr = 0x200;
  for (const l of lines) {
    if (l.kind === 'org') {
      addr = Expr.evaluate(l.operands[0] ?? '', l.no, resolveSymbols({ labels, addr }));
      continue;
    }
    const size = lineSize(l);
    if (size === 0) continue;
    let bytes: number[];
    if (l.kind === 'instr') {
      if (!l.mnemonic) continue;
      bytes = encode(l, { labels, addr });
      if (bytes.length !== 2) throw new AsmError(`内部错误：指令编码长度 ${bytes.length}`, l.no);
    } else {
      bytes = [];
      const sym = resolveSymbols({ labels, addr });
      for (const operand of l.operands) {
        if (/^"(?:\\.|[^\\])*"$/.test(operand)) { // 字符串
          const str = operand.slice(1, -1).replace(/\\(.)/g, (_, c: string) =>
            c === 'n' ? '\n' : c === 't' ? '\t' : c);
          for (const ch of str) bytes.push(ch.charCodeAt(0) & 0xFF);
        } else {
          const v = Expr.evaluate(operand, l.no, sym);
          if (l.kind === 'db') {
            if (!Number.isInteger(v) || v < 0 || v > 0xFF) throw new AsmError(`.db 字节 ${v} 超范围`, l.no);
            bytes.push(v);
          } else {
            if (!Number.isInteger(v) || v < 0 || v > 0xFFFF) throw new AsmError(`.dw 字 ${v} 趝范围`, l.no);
            bytes.push((v >> 8) & 0xFF, v & 0xFF);
          }
        }
      }
    }
    chunks.push({ addr, bytes });
    addr += bytes.length;
  }

  // ---- 拼接输出：覆盖 [minAddr, maxAddr)，空洞补 0 ----
  if (chunks.length === 0) return new Uint8Array(0);
  const lo = Math.min(...chunks.map(c => c.addr));
  const hi = Math.max(...chunks.map(c => c.addr + c.bytes.length));
  if (lo < 0x200) throw new AsmError(`输出起始地址 0x${lo.toString(16)} 低于 0x200`, 0);
  const out = new Uint8Array(hi - lo);
  for (const c of chunks) out.set(c.bytes, c.addr - lo);
  return out;
}
