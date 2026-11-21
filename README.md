# chip8 · A-05

CHIP-8 虚拟机 + 工具链：35 opcode 解释器（纯 TS，零运行时依赖）、64×32 单色屏、
蜂鸣器、keypad、两遍扫描汇编器（round-trip 校验）、反汇编器、Web UI（chip8-lab）。

## oracle（GPL-3.0，本地自备不入库）

`tests/fixtures/oracle/` 下的 Timendus/chip8-test-suite ROM 二进制是 GPL-3.0 授权物，
按版权纪律**不入库**。克隆后运行：

```bash
npm run fetch:oracle
```

从固定 commit 下载 1-5 号测试 ROM。缺失时 vfc 对拍测试会以 SKIP 结束（其余测试不受影响）。

## 常用命令

```bash
npm test            # 全部测试（单元 + round-trip + vfc 对拍 + 差分/模糊）
npm run typecheck   # tsc --noEmit
npm run build:web   # esbuild 打包单文件 Web UI -> dist/
```
