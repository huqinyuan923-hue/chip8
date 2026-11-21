// chip8-lab 主逻辑：虚拟机画布、键盘映射、汇编编辑器、调试器、Web Audio 蜂鸣。
// 游戏源码由 esbuild 以 text loader 内嵌，直接用自研汇编器现场汇编。
import { Chip8, VIP_PRESET, MODERN_PRESET } from '../vm.js';
import { assemble, AsmError } from '../assemble.js';
import { disassemble } from '../disassemble.js';
import pongSrc from '../../games/pong.ch8.asm';
import snakeSrc from '../../games/snake.ch8.asm';
import breakoutSrc from '../../games/breakout.ch8.asm';

// ---------- DOM ----------
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const canvas = $('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

const GAMES: Record<string, string> = {
  'Pong': pongSrc,
  'Snake': snakeSrc,
  'Breakout': breakoutSrc,
};

// ---------- 虚拟机 ----------
let vm = new Chip8(VIP_PRESET);
let running = false;
let speed = 8; // 倍速：每帧 speed×11 个周期
let romBytes: Uint8Array = new Uint8Array(0);
let romLines: string[] = [];

function loadRomBytes(bytes: Uint8Array): void {
  romBytes = bytes.slice();
  romLines = disassemble(romBytes);
  vm.loadRom(romBytes);
  render();
}

// ---------- 画布 ----------
const img = ctx.createImageData(64, 32);
function render(): void {
  const d = img.data;
  const disp = vm.display;
  for (let k = 0; k < 2048; k++) {
    const on = disp[k] ? 255 : 0;
    d[k * 4] = on; d[k * 4 + 1] = on; d[k * 4 + 2] = on; d[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- 蜂鸣（Web Audio 方波） ----------
let audio: AudioContext | null = null;
let osc: OscillatorNode | null = null;
function beep(on: boolean): void {
  if (on && !osc) {
    audio ??= new AudioContext();
    osc = audio.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 440;
    osc.connect(audio.destination);
    osc.start();
  } else if (!on && osc) {
    osc.stop();
    osc.disconnect();
    osc = null;
  }
}

// ---------- 主循环 ----------
const KEYMAP: Record<string, number> = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 0xC,
  KeyQ: 4, KeyW: 5, KeyE: 6, KeyR: 0xD,
  KeyA: 7, KeyS: 8, KeyD: 9, KeyF: 0xE,
  KeyZ: 0xA, KeyX: 0, KeyC: 0xB, KeyV: 0xF,
};

for (const code of Object.keys(KEYMAP)) {
  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    const k = KEYMAP[e.code];
    if (k === undefined) return;
    vm.setKey(k, true);
    e.preventDefault();
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.code];
    if (k === undefined) return;
    vm.setKey(k, false);
    e.preventDefault();
  });
}

function loop(): void {
  if (running) {
    for (let c = 0; c < speed * 11; c++) vm.tick();
    vm.tickTimers();
    beep(vm.beeping());
    render();
    updateDebugger();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- 控制按钮 ----------
$('btnRun').addEventListener('click', () => { running = !running; });
$('btnReset').addEventListener('click', () => { vm.reset(); render(); updateDebugger(); });
$('btnStep').addEventListener('click', () => { running = false; vm.tick(); render(); updateDebugger(); });
$('btnFrame').addEventListener('click', () => {
  running = false;
  for (let c = 0; c < speed * 11; c++) vm.tick();
  vm.tickTimers();
  render(); updateDebugger();
});
$('speed').addEventListener('input', e => {
  speed = Number((e.target as HTMLInputElement).value);
  $('speedVal').textContent = `${speed}×`;
});

// ---------- 行为开关 ----------
function syncConfig(): void {
  vm.config = {
    ...vm.config,
    shift: ($('qShift') as HTMLInputElement).checked ? 'modern' : 'vip',
    jump: ($('qJump') as HTMLInputElement).checked ? 'modern' : 'vip',
    memory: ($('qMem') as HTMLInputElement).checked ? 'modern' : 'vip',
    vfReset: ($('qVf') as HTMLInputElement).checked,
    clipping: ($('qClip') as HTMLInputElement).checked,
    displayWait: ($('qWait') as HTMLInputElement).checked,
  };
}
for (const id of ['qShift', 'qJump', 'qMem', 'qVf', 'qClip', 'qWait']) {
  $(id).addEventListener('change', syncConfig);
}
function applyPreset(preset: typeof VIP_PRESET): void {
  ($('qShift') as HTMLInputElement).checked = preset.shift === 'modern';
  ($('qJump') as HTMLInputElement).checked = preset.jump === 'modern';
  ($('qMem') as HTMLInputElement).checked = preset.memory === 'modern';
  ($('qVf') as HTMLInputElement).checked = preset.vfReset;
  ($('qClip') as HTMLInputElement).checked = preset.clipping;
  ($('qWait') as HTMLInputElement).checked = preset.displayWait;
  syncConfig();
}
$('btnVip').addEventListener('click', () => applyPreset(VIP_PRESET));
$('btnModern').addEventListener('click', () => applyPreset(MODERN_PRESET));
applyPreset(VIP_PRESET);

// ---------- Keypad 视图 ----------
const KEY_LABELS = [1, 2, 3, 0xC, 4, 5, 6, 0xD, 7, 8, 9, 0xE, 0xA, 0, 0xB, 0xF];
const keyButtons: HTMLButtonElement[] = [];
for (const k of KEY_LABELS) {
  const b = document.createElement('button');
  b.textContent = k.toString(16).toUpperCase();
  b.addEventListener('pointerdown', () => vm.setKey(k, true));
  b.addEventListener('pointerup', () => vm.setKey(k, false));
  b.addEventListener('pointerleave', () => vm.setKey(k, false));
  $('keypad').appendChild(b);
  keyButtons.push(b);
}
setInterval(() => {
  keyButtons.forEach((b, i) => {
    const k = KEY_LABELS[i];
    if (k === undefined) return;
    b.classList.toggle('down', vm.keys[k] === 1);
  });
}, 50);

// ---------- 汇编器 ----------
($('asmSrc') as HTMLTextAreaElement).value = GAMES['Pong'] ?? '';
const gameSel = $('gameSel') as HTMLSelectElement;
for (const name of Object.keys(GAMES)) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  gameSel.appendChild(opt);
}
$('btnLoadGame').addEventListener('click', () => {
  const name = gameSel.value;
  const src = GAMES[name];
  if (src === undefined) throw new Error(`内置游戏缺失：${name}`);
  ($('asmSrc') as HTMLTextAreaElement).value = src;
  assembleAndLoad();
});
$('btnAsm').addEventListener('click', assembleAndLoad);
function assembleAndLoad(): void {
  const msg = $('asmMsg');
  try {
    const rom = assemble(($('asmSrc') as HTMLTextAreaElement).value);
    running = false;
    loadRomBytes(rom);
    msg.textContent = `汇编成功：${rom.length} 字节，已载入`;
    msg.className = 'ok';
  } catch (e) {
    msg.textContent = e instanceof AsmError ? e.message : String(e);
    msg.className = 'err';
  }
}

// ---------- ROM 文件 ----------
$('romFile').addEventListener('change', async e => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  running = false;
  loadRomBytes(buf);
  ($('asmSrc') as HTMLTextAreaElement).value = disassemble(buf).join('\n');
  const msg = $('asmMsg');
  msg.textContent = `ROM 已载入：${buf.length} 字节`;
  msg.className = 'ok';
});

// ---------- 调试器 ----------
function hex(n: number, w: number): string {
  return '0x' + n.toString(16).toUpperCase().padStart(w, '0');
}
function updateDebugger(): void {
  const regs = $('regs');
  const lines: string[] = [];
  for (let r = 0; r < 16; r += 4) {
    for (let k = r; k < r + 4; k++) {
      lines.push(`<span><b>v${k.toString(16).toUpperCase()}</b>=${hex(vm.v[k] ?? 0, 2)}</span>`);
    }
  }
  lines.push(`<span><b>PC</b>=${hex(vm.pc, 3)}</span>`);
  lines.push(`<span><b>I</b>=${hex(vm.i, 3)}</span>`);
  lines.push(`<span><b>DT</b>=${vm.dt}</span>`);
  lines.push(`<span><b>ST</b>=${vm.st} ${vm.beeping() ? '♪' : ''}</span>`);
  regs.innerHTML = lines.join('');

  // 反汇编：PC 前后各 10 条
  const base = 0x200;
  const pcIdx = Math.max(0, Math.floor((vm.pc - base) / 2) - 5);
  const out: string[] = [];
  for (let k = pcIdx; k < pcIdx + 16 && k < romLines.length; k++) {
    const addr = hex(base + k * 2, 3);
    const cur = base + k * 2 === vm.pc ? ' class="cur"' : '';
    out.push(`<div${cur}>${addr}  ${romLines[k] ?? ''}</div>`);
  }
  $('disasm').innerHTML = out.join('');

  // 内存：0x200 起 8 行 × 16 字节
  const mem: string[] = [];
  for (let row = 0; row < 12; row++) {
    const addr = base + row * 16;
    let line = hex(addr, 3) + '  ';
    for (let k = 0; k < 16; k++) line += (vm.memory[addr + k] ?? 0).toString(16).padStart(2, '0') + ' ';
    mem.push(line);
  }
  $('mem').textContent = mem.join('\n');
}
updateDebugger();
