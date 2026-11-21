// 从 Timendus/chip8-test-suite 下载 oracle 测试 ROM（GPL-3.0，不入库）。
// 固定 commit 保证测试可复现；README.md 说明使用方式。
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'tests', 'fixtures', 'oracle');

const COMMIT = '742e9eac9f5d44466c1c9d83fcaa8158c6683cb1'; // main @ 2026-11 体检时点（git rev-parse 实测）
const FILES = [
  '1-chip8-logo.ch8',
  '2-ibm-logo.ch8',
  '3-corax+.ch8',
  '4-flags.ch8',
  '5-quirks.ch8',
];
const BASE = `https://raw.githubusercontent.com/Timendus/chip8-test-suite/${COMMIT}/bin/`;

mkdirSync(DEST, { recursive: true });
let ok = 0;
for (const f of FILES) {
  const out = join(DEST, f);
  if (existsSync(out)) { console.log(`已存在，跳过: ${f}`); ok++; continue; }
  let buf = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(BASE + encodeURIComponent(f));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      break;
    } catch (e) {
      console.warn(`  第 ${attempt} 次尝试失败: ${e.message}${attempt < 3 ? '，重试…' : ''}`);
      await new Promise(r => setTimeout(r, 800 * attempt));
    }
  }
  if (!buf) { console.error(`下载失败 ${f}`); process.exitCode = 1; continue; }
  writeFileSync(out, buf);
  console.log(`已下载: ${f} (${buf.length} 字节)`);
  ok++;
}
console.log(ok === FILES.length ? 'oracle ROM 就绪' : '部分下载失败，请检查网络');
