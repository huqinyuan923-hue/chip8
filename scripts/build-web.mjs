// chip8-lab Web UI 构建脚本：esbuild 打包单文件（games/*.asm 以文本内嵌）。
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
mkdirSync(DIST, { recursive: true });

await build({
  entryPoints: [join(ROOT, 'src', 'web', 'main.ts')],
  bundle: true,
  outfile: join(DIST, 'bundle.js'),
  loader: { '.ch8.asm': 'text' },
  minify: true,
  logLevel: 'info',
});

const css = readCss();
function readCss() {
  // CSS 由 main.ts 里 import 内联进 bundle，这里只需要壳
  return '';
}

writeFileSync(join(DIST, 'index.html'), `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>chip8-lab · CHIP-8 虚拟机实验台</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #14161a; color: #d7dae0; font: 14px/1.5 "Cascadia Code", ui-monospace, Consolas, monospace; }
header { padding: 14px 20px; border-bottom: 1px solid #2a2e36; display: flex; gap: 16px; align-items: baseline; }
header h1 { font-size: 18px; margin: 0; color: #7ee787; }
header span { color: #8b949e; font-size: 12px; }
main { display: grid; grid-template-columns: auto 1fr; gap: 18px; padding: 18px 20px; max-width: 1280px; margin: 0 auto; }
canvas#screen { width: 640px; height: 320px; image-rendering: pixelated; background: #000; border: 1px solid #2a2e36; border-radius: 4px; }
.panel { background: #1b1e24; border: 1px solid #2a2e36; border-radius: 6px; padding: 12px 14px; margin-bottom: 14px; }
.panel h2 { font-size: 13px; margin: 0 0 10px; color: #79c0ff; text-transform: uppercase; letter-spacing: 1px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
button { background: #21262d; color: #d7dae0; border: 1px solid #363b44; border-radius: 4px; padding: 5px 12px; cursor: pointer; font: inherit; }
button:hover { background: #2a2f38; }
button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
button.warn { background: #b62324; border-color: #b62324; color: #fff; }
select, input[type=range], input[type=file] { font: inherit; color: #d7dae0; background: #21262d; border: 1px solid #363b44; border-radius: 4px; padding: 4px 8px; }
label { color: #8b949e; font-size: 12px; }
textarea { width: 100%; min-height: 320px; background: #10131a; color: #d7dae0; border: 1px solid #363b44; border-radius: 4px; padding: 10px; font: 12px/1.5 ui-monospace, Consolas, monospace; resize: vertical; }
#asmMsg { min-height: 18px; font-size: 12px; }
#asmMsg.ok { color: #7ee787; } #asmMsg.err { color: #ff7b72; }
.disasm { font-size: 12px; max-height: 260px; overflow-y: auto; background: #10131a; border: 1px solid #363b44; border-radius: 4px; padding: 6px 10px; }
.disasm div { white-space: pre; color: #8b949e; }
.disasm div.cur { color: #7ee787; background: #1d2a1d; }
.regs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 14px; font-size: 12px; }
.regs b { color: #79c0ff; font-weight: 600; }
.mem { font-size: 11px; max-height: 220px; overflow: auto; background: #10131a; border: 1px solid #363b44; border-radius: 4px; padding: 6px 10px; white-space: pre; color: #8b949e; }
.keys { display: grid; grid-template-columns: repeat(4, 44px); gap: 5px; }
.keys button { padding: 8px 0; user-select: none; }
.keys button.down { background: #1f6feb; border-color: #1f6feb; }
.help { color: #8b949e; font-size: 12px; }
input[type=checkbox] { accent-color: #1f6feb; }
</style>
</head>
<body>
<header><h1>chip8-lab</h1><span>A-05 · 纯 TS 手写 CHIP-8 虚拟机 + 汇编器 · 零运行时依赖</span></header>
<main>
  <section>
    <canvas id="screen" width="64" height="32"></canvas>
    <div class="panel">
      <h2>控制</h2>
      <div class="row">
        <button id="btnRun" class="primary">运行/暂停</button>
        <button id="btnReset">复位</button>
        <button id="btnStep">单步</button>
        <button id="btnFrame">单帧</button>
        <label>速度 <input id="speed" type="range" min="1" max="20" value="8"> <span id="speedVal">8×</span></label>
      </div>
      <div class="row">
        <label>行为预设</label>
        <button id="btnVip">原始 COSMAC VIP</button>
        <button id="btnModern">现代惯例</button>
      </div>
      <div class="row help">
        <label><input type="checkbox" id="qShift"> shift=vX</label>
        <label><input type="checkbox" id="qJump"> jump=vX</label>
        <label><input type="checkbox" id="qMem"> memory 不增 I</label>
        <label><input type="checkbox" id="qVf"> 逻辑清 vF</label>
        <label><input type="checkbox" id="qClip"> 裁剪不环绕</label>
        <label><input type="checkbox" id="qWait"> 绘制等 vblank</label>
      </div>
    </div>
    <div class="panel">
      <h2>Keypad（键盘映射 1234/qwer/asdf/zxcv）</h2>
      <div class="keys" id="keypad"></div>
    </div>
    <div class="panel">
      <h2>ROM</h2>
      <div class="row">
        <select id="gameSel"></select>
        <button id="btnLoadGame" class="primary">载入游戏</button>
        <input type="file" id="romFile" accept=".ch8,.bin">
      </div>
      <div class="help">也可在右侧汇编器直接编辑游戏源码并汇编载入。</div>
    </div>
  </section>
  <section>
    <div class="panel">
      <h2>汇编器</h2>
      <textarea id="asmSrc" spellcheck="false"></textarea>
      <div class="row" style="margin-top:8px">
        <button id="btnAsm" class="primary">汇编并载入</button>
        <span id="asmMsg"></span>
      </div>
    </div>
    <div class="panel">
      <h2>调试器</h2>
      <div class="regs" id="regs"></div>
      <div class="row" style="margin-top:10px"><h2 style="margin:0">反汇编（PC 附近）</h2></div>
      <div class="disasm" id="disasm"></div>
      <div class="row" style="margin-top:10px"><h2 style="margin:0">内存（PC 起点附近）</h2></div>
      <div class="mem" id="mem"></div>
    </div>
  </section>
</main>
<script src="bundle.js"></script>
</body>
</html>
`);
console.log('构建完成 → dist/');
