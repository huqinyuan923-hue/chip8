; ============================================================
; PONG · A-05 chip8 自写游戏（用本项目汇编器语法）
; 键位：2=板上移  8=板下移（左板）；右板 AI 四分之一速跟球（会被吊打）
; 计分：球出右界 +1（蜂鸣）；出左界清零重发；分数显示右上角
; 帧节流：delay timer = 1，等 60Hz；VIP displayWait 兼容
; ------------------------------------------------------------
; 寄存器：v1球x v2球y v3dx v4dy v5/v6/v7临时
;         vA玩家板y vB AI板y vC分数 v8 AI节拍 v9=1 vD/vE分数坐标
; ============================================================

main:
  cls
  ld v1, 30          ; 球 x
  ld v2, 15          ; 球 y
  ld v3, 0xFF        ; dx = -1
  ld v4, 1           ; dy = +1
  ld vA, 14          ; 玩家板 y
  ld vB, 14          ; AI 板 y
  ld vC, 0           ; 分数
  ld v8, 0           ; AI 节拍计数
  ld v9, 1           ; 常量 1
  ld vD, 58          ; 分数 x
  ld vE, 1           ; 分数 y
  call serve

frame:
  ; ---- 帧节流：dt=1 等 60Hz ----
  ld v6, 1
  ld dt, v6
wait:
  ld v6, dt
  se v6, 0
  jump wait

  ; ---- 玩家输入：2 上 / 8 下 ----
  ld v5, 2
  skp v5
  jump no_up
  se vA, 0
  add vA, 0xFF
no_up:
  ld v5, 8
  skp v5
  jump no_down
  se vA, 28
  add vA, 1
no_down:

  ; ---- AI 四分之一速跟球（v8 每帧 +1，&3 == 0 时才动）----
  add v8, 1
  ld v5, 3
  and v8, v5
  se v8, 0
  jump after_ai
  ld v7, v2          ; 球 y
  sub v7, vB         ; vF = (球y >= 板y)
  ld v5, vF
  se v5, 0
  jump ai_ge
  se vB, 0           ; 球在板上方：AI--（不越顶）
  add vB, 0xFF
  jump after_ai
ai_ge:
  ld v5, 3
  sub v5, v7         ; vF = (3 >= 球y-板y)：球在板行内则不动
  se vF, 0
  jump after_ai
  se vB, 28
  add vB, 1
after_ai:

  ; ---- 球上下反弹（移前检查，避免回绕）----
  se v2, 0
  jump chk_bottom
  ld v4, 1
  jump vert_done
chk_bottom:
  se v2, 31
  jump vert_done
  ld v4, 0xFF
vert_done:

  ; ---- 球移动 ----
  add v1, v3
  add v2, v4

  ; ---- 左板碰撞：x==4 且向左，y ∈ [板y-1, 板y+4] ----
  se v1, 4
  jump chk_right
  se v3, 0xFF
  jump chk_right
  ld v6, v2
  add v6, 1
  sub v6, vA         ; vF = (y+1 >= 板y)
  ld v5, vF
  ld v7, 6
  sub v7, v6         ; vF = (6 >= y+1-板y)
  and v5, vF         ; 两标志相与（0/1）→ 命中
  sne v5, 0          ; 命中（非零）→ 跳过 jump → 反弹
  jump no_lhit
  ld v3, 1
  ld v5, 2
  ld st, v5          ; 短 beep
no_lhit:
chk_right:
  ; ---- 右板（AI）碰撞：x==59 且向右 ----
  se v1, 59
  jump chk_miss_r
  se v3, 1
  jump chk_miss_r
  ld v6, v2
  add v6, 1
  sub v6, vB
  ld v5, vF
  ld v7, 6
  sub v7, v6
  and v5, vF
  sne v5, 0          ; 命中 → 反弹
  jump no_rhit
  ld v3, 0xFF
  ld v5, 2
  ld st, v5
no_rhit:
chk_miss_r:
  ; ---- 出界：x==63 得分重发；x==0 清零重发 ----
  se v1, 63
  jump chk_miss_l
  add vC, 1
  ld v5, 6
  ld st, v5          ; 长 beep
  call serve
  jump draw
chk_miss_l:
  se v1, 0
  jump draw
  ld vC, 0
  call serve

draw:
  cls
  ld f, vC           ; 分数字形（FX29）
  draw vD, vE, 5
  ld i, paddle
  ld v6, 4
  draw v6, vA, 4
  ld v6, 59
  draw v6, vB, 4
  ld i, ballpx
  draw v1, v2, 1
  jump frame

; ---- 发球：中心，方向按 v0 交替 ----
serve:
  ld v1, 32
  ld v2, 16
  ld v4, 1
  se v0, 0
  jump serve_r
  ld v3, 0xFF
  jump serve_dy
serve_r:
  ld v3, 1
serve_dy:
  xor v0, v9
  ret

; ---- 精灵 ----
paddle:
  db 0x80, 0x80, 0x80, 0x80
ballpx:
  db 0x80
