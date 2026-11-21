// 性能基准编排：esbuild 打包 bench-entry.ts → .tmp 后运行（裸 Node 不解析 .js→.ts 映射）。
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '.tmp', 'bench.mjs');
mkdirSync(join(HERE, '..', '.tmp'), { recursive: true });

await build({
  entryPoints: [join(HERE, 'bench-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: OUT,
  logLevel: 'silent',
});

await import(pathToFileURL(OUT).href);
