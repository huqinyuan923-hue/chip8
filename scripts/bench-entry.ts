// 性能基准入口（由 bench.mjs 用 esbuild 打包后运行）
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chip8, VIP_PRESET } from '../src/vm.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROM_PATH = join(HERE, '..', 'tests', 'fixtures', 'oracle', '3-corax+.ch8');

if (!existsSync(ROM_PATH)) {
  console.error('oracle ROM 缺失，先运行 npm run fetch:oracle');
  process.exit(1);
}

const vm = new Chip8(VIP_PRESET);
vm.loadRom(new Uint8Array(readFileSync(ROM_PATH)));

const CYCLES_PER_FRAME = 110; // 10 倍速（11 周期/帧 × 60 帧 × 10）
const FRAMES = 60 * 60;       // 60 秒模拟时间

let maxFrameMs = 0;
let sumFrameMs = 0;
const t0 = performance.now();
for (let f = 0; f < FRAMES; f++) {
  const tf = performance.now();
  vm.tickTimers();
  for (let c = 0; c < CYCLES_PER_FRAME; c++) vm.tick();
  const dt = performance.now() - tf;
  sumFrameMs += dt;
  if (dt > maxFrameMs) maxFrameMs = dt;
}
const wall = performance.now() - t0;

const totalCycles = FRAMES * CYCLES_PER_FRAME;
console.log('=== CHIP-8 性能基准（corax+ ROM，最重负载）===');
console.log(`模拟：60 秒 × 10 倍速 = ${totalCycles.toLocaleString()} 周期 / ${FRAMES} 帧`);
console.log(`墙钟：${wall.toFixed(0)} ms（相当于 ${((FRAMES / 60) / (wall / 1000)).toFixed(0)}× 实时 10 倍速合计）`);
console.log(`平均每帧：${(sumFrameMs / FRAMES).toFixed(3)} ms（预算 16.6 ms）`);
console.log(`最大每帧：${maxFrameMs.toFixed(3)} ms（预算 16.6 ms）`);
console.log(`吞吐：${Math.round(totalCycles / (wall / 1000)).toLocaleString()} 周期/秒`);
console.log(maxFrameMs < 16.6 ? '✅ 10 倍速无丢帧（最慢帧 < 16.6ms）' : '❌ 有丢帧风险');
