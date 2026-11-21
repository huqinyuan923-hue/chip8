; ============================================================
; BREAKOUT · A-05 chip8 自写游戏
; 键位：4=板左移 6=板右移；3 条命；分数=打掉砖数（右上角）
; 砖墙：16 列 × 4 行，砖 4×3 像素（x=col*4 完美平铺）
; 碰撞：球 1px，落砖区按 (x>>2, (y-2)/3) 算格子；命中即碎+dy 取反
; 砖存活表：0x500 起 64 字节（1=活 0=碎）；增量绘制，绝对寻址
; ------------------------------------------------------------
; 寄存器：v0球x v1球y v2dx v3dy v4板x v5命 v6分数
;         v7行/临时 v8列/临时 v9/vA球坐标备份 vB偏移 vC常量/临时
; ============================================================

main:
  cls
  ld v5, 3           ; 命
  ld v6, 0           ; 分数
  ; 砖存活表填 1（8 字节一组，绝对地址寻址不依赖 I 自增口径）
  ld v0, 1
  ld v1, 1
  ld v2, 1
  ld v3, 1
  ld v4, 1
  ld v7, 1
  ld v8, 1
  ld v9, 1
  ld i, bricks
  ld [i], v9
  ld i, bricks + 8
  ld [i], v9
  ld i, bricks + 16
  ld [i], v9
  ld i, bricks + 24
  ld [i], v9
  ld i, bricks + 32
  ld [i], v9
  ld i, bricks + 40
  ld [i], v9
  ld i, bricks + 48
  ld [i], v9
  ld i, bricks + 56
  ld [i], v9
  ld v4, 29          ; 板 x（左缘，6 宽）
  call serve
  call draw_bricks
  ld i, ballpx
  draw v0, v1, 1     ; 先画一次球（否则首帧擦除会留点）

frame:
  ; ---- 帧节流 ----
  ld v9, 1
  ld dt, v9
wait:
  ld v9, dt
  se v9, 0
  jump wait

  ; ---- 板输入：擦旧板 → 移 → 画新板 ----
  ld v9, 4
  skp v9
  jump no_left
  ld i, paddle
  ld vA, 30
  draw v4, vA, 1     ; 擦旧板
  se v4, 0
  add v4, 0xFF
  draw v4, vA, 1
  jump paddle_done
no_left:
  ld v9, 6
  skp v9
  jump paddle_done
  ld i, paddle
  ld vA, 30
  draw v4, vA, 1
  se v4, 58
  add v4, 1
  draw v4, vA, 1
paddle_done:

  ; ---- 球：擦旧 → 顶墙反弹 → 移动 ----
  ld i, ballpx
  draw v0, v1, 1     ; 擦旧球
  se v1, 0
  jump no_top
  ld v3, 1
no_top:
  add v0, v2
  add v1, v3

  ; ---- 掉底：丢命 / 游戏结束 ----
  se v1, 31
  jump brick_check
  se v5, 0
  add v5, 0xFF
  se v5, 0          ; 命尽 → 跳过重发 → game over
  jump miss_serve
  jump game_over
miss_serve:
  call serve
  jump draw_now
brick_check:
  ; ---- 板碰撞：y==30 且 x ∈ [板x-1, 板x+6] ----
  se v1, 30
  jump brick_zone
  ld v7, v0
  add v7, 0xFF       ; x-1
  sub v7, v4         ; vF = (x-1 >= 板x)
  ld v8, vF
  ld v9, v4
  add v9, 6
  sub v9, v7         ; vF = (板x+6 >= x-1)
  and v8, vF         ; 双标志相与 → 命中
  sne v8, 0          ; 命中（非零）→ 跳过 jump → 反弹
  jump brick_zone
  ld v3, 0xFF        ; 反弹向上
  ; 打点位置决定水平向：x < 板x+3 → 左，否则右
  ld v9, v4
  add v9, 3
  sub v9, v0         ; vF = (板x+3 >= x)：1=左半 0=右半
  sne vF, 0
  jump pad_right
  ld v2, 0xFF
  jump pad_done
pad_right:
  ld v2, 1
pad_done:
  ld v9, 2
  ld st, v9

brick_zone:
  ; ---- 砖区守卫：y ∈ [2,13]（注意 7XNN 不置 vF，必须用 sub 取借位标志）----
  ; 守卫出口直达 draw_now（v0/v1 未被破坏，不需要 restore_ball）
  ld v7, v1
  ld vC, 2
  sub v7, vC         ; v7 = y-2；vF = (y >= 2)
  sne vF, 0
  jump draw_now      ; y < 2（借位）→ 出区
  ld vC, 13
  sub vC, v1         ; vF = (13 >= y)
  sne vF, 0
  jump draw_now      ; y > 13 → 出区
  ; col = x >> 2 → v8
  ld v8, v0
  shr v8, v8
  shr v8, v8
  ; row = (y-2)/3 → vB（v7 已是 y-2，循环减 3）
  ld vB, 0
row_loop:
  ld vC, 3
  sub vC, v7         ; vF = (3 >= 余量)
  se vF, 0
  jump row_done
  add vB, 1
  add v7, 0xFD
  jump row_loop
row_done:
  shl vB, vB
  shl vB, vB
  shl vB, vB
  shl vB, vB         ; row*16（两操作数在两代移位语义下等价）
  add vB, v8         ; offset = row*16 + col
  ; 读存活（先备份球坐标）
  ld v9, v0
  ld vA, v1
  ld i, bricks
  add i, vB
  ld v0, [i]         ; v0 = 存活字节（FX65 x=0）
  se v0, 0
  jump restore_ball
  ; ---- 命中：清表、擦砖、dy 取反、计分 ----
  ld v0, 0
  ld [i], v0         ; 存活表清 0
  ld vC, 15
  ld v8, vB
  and v8, vC         ; col = offset & 15
  ld v7, vB
  shr v7, v7
  shr v7, v7
  shr v7, v7
  shr v7, v7         ; row = offset >> 4
  shl v8, v8
  shl v8, v8         ; 擦砖 x = col*4（v9/vA 是球坐标备份，不能占用！）
  ld vB, v7
  add v7, v7
  add v7, vB
  add v7, 2          ; 擦砖 y = row*3+2
  ld i, brick
  draw v8, v7, 3     ; XOR 擦砖
  se v3, 1           ; dy 取反：dy==1 → 跳过 jump → 置 FF；dy==FF → 置 1
  jump set_dy_pos
  ld v3, 0xFF
  jump dy_set
set_dy_pos:
  ld v3, 1
dy_set:
  add v6, 1
  ld vE, 2
  ld st, vE          ; 蜂鸣（不能用 v9——v9/vA 是球坐标备份）
restore_ball:
  ld v0, v9
  ld v1, vA
draw_now:
  ld i, ballpx
  draw v0, v1, 1     ; 画新球

  ; 全清（64 砖）→ 胜利闪屏一次，球继续落下进入丢命循环
  se v6, 64
  jump frame
  call win_flash
  jump frame

; ---- 掉命/游戏结束 ----
game_over:
  cls
  ld v9, 30
  ld dt, v9
go_wait:
  ld vE, dt
  se vE, 0
  jump go_wait
  jump main

; ---- 发球：中上方，随机水平向（CXNN &1 → 0/1）----
serve:
  ld v0, 30
  ld v1, 20
  ld v3, 0xFF        ; 向上
  rnd v2, 1
  se v2, 0
  jump serve_r
  ld v2, 0xFF
  jump serve_done
serve_r:
  ld v2, 1
serve_done:
  ret

; ---- 整墙绘制（开局一次）----
draw_bricks:
  ld v7, 0           ; row
db_row:
  ld v8, 0           ; col
db_col:
  ld v9, v7
  shl v9, v9
  shl v9, v9
  shl v9, v9
  shl v9, v9
  add v9, v8         ; offset
  ld vB, v0          ; 备份球坐标
  ld vC, v1
  ld i, bricks
  add i, v9
  ld v0, [i]
  se v0, 0
  jump db_next
  ld v9, v8
  shl v9, v9
  shl v9, v9         ; x = col*4
  ld vA, v7
  add vA, vA
  add vA, v7
  add vA, 2          ; y = row*3+2
  ld i, brick
  draw v9, vA, 3
db_next:
  ld v0, vB
  ld v1, vC
  add v8, 1
  se v8, 16
  jump db_col
  add v7, 1
  se v7, 4
  jump db_row
  ret

; ---- 胜利闪屏 ----
win_flash:
  cls
  ld v9, 40
  ld dt, v9
wf_wait:
  ld vE, dt
  se vE, 0
  jump wf_wait
  ret

; ---- 数据 ----
ballpx:
  db 0x80
paddle:
  db 0xFC
brick:
  db 0xF0, 0xF0, 0xF0

  .org 0x500
bricks:
