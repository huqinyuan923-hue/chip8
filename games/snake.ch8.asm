; ============================================================
; SNAKE · A-05 chip8 自写游戏
; 键位：2=上 4=左 6=右 8=下（禁止 180° 掉头）
; 吃食物变长（最长 60），撞墙或撞自己重开；食物由 CXNN 随机
; 增量绘制：每帧只画新头 + 擦尾（VIP displayWait 兼容）
; ------------------------------------------------------------
; 寄存器：v0头x v1头y（兼作 FX55/65 存取对）v2dx v3dy
;         v4食物x v5食物y v6长度 v7头指针 v8尾指针
;         v9/vA临时 vB游标 vC=63 vE计数 vF标志
; 环形缓冲：buf=0x500，64 项 × (x,y) 两字节
; ============================================================

main:
  cls
  ld v0, 32          ; 头 x
  ld v1, 16          ; 头 y
  ld v2, 1           ; dx=+1
  ld v3, 0           ; dy=0
  ld v6, 1           ; 长度
  ld v7, 1           ; 头指针（槽 0 存初始头）
  ld v8, 0           ; 尾指针
  ld vC, 63          ; 环形掩码
  ld i, buf
  ld [i], v1         ; buf[0] = 初始头（FX55 x=1 写 v0,v1）
  call spawn_food
  ld i, pix
  draw v4, v5, 1     ; 画食物
  draw v0, v1, 1     ; 画头

frame:
  ; ---- 帧节流 ----
  ld vE, 1
  ld dt, vE
wait:
  ld vE, dt
  se vE, 0
  jump wait

  ; ---- 输入（垂直/水平互斥，禁止掉头）----
  ld v9, 2           ; 上
  skp v9
  jump no_up
  se v3, 0
  jump no_up
  ld v2, 0
  ld v3, 0xFF
  jump input_done
no_up:
  ld v9, 8           ; 下
  skp v9
  jump no_down
  se v3, 0
  jump no_down
  ld v2, 0
  ld v3, 1
  jump input_done
no_down:
  ld v9, 4           ; 左
  skp v9
  jump no_left
  se v2, 0
  jump no_left
  ld v2, 0xFF
  ld v3, 0
  jump input_done
no_left:
  ld v9, 6           ; 右
  skp v9
  jump input_done
  se v2, 0
  jump input_done
  ld v2, 1
  ld v3, 0
input_done:

  ; ---- 撞墙（移前检查；se 相等时跳过下一跳，故"方向相等→跳过 continue→dead"）----
  se v0, 0          ; x==0？
  jump w1
  se v2, 0xFF       ; 向左？
  jump w1
  jump dead
w1:
  se v0, 63         ; x==63？
  jump w2
  se v2, 1          ; 向右？
  jump w2
  jump dead
w2:
  se v1, 0          ; y==0？
  jump w3
  se v3, 0xFF       ; 向上？
  jump w3
  jump dead
w3:
  se v1, 31         ; y==31？
  jump w4
  se v3, 1          ; 向下？
  jump w4
  jump dead
w4:

  ; ---- 新头 (v9,vA) ----
  ld v9, v0
  add v9, v2
  ld vA, v1
  add vA, v3

  ; ---- 自撞检测：从尾起遍历 v6 项 ----
  ld vB, v8          ; 游标 = 尾
  ld vE, v6          ; 计数
collide_loop:
  se vE, 0
  jump collide_body
  jump collide_done
collide_body:
  ld i, buf
  add i, vB
  add i, vB          ; I = buf + 2*游标
  ld v1, [i]         ; v0,v1 = 槽内容（旧头随时可覆盖）
  se v0, v9          ; x 相等才查 y
  jump collide_next
  se v1, vA          ; y 也相等 → 跳过下一条 → 撞了
  jump collide_next
  jump dead
collide_next:
  add vB, 1
  and vB, vC
  add vE, 0xFF
  jump collide_loop
collide_done:

  ; ---- 写入新头并绘制 ----
  ld v0, v9
  ld v1, vA
  ld i, buf
  add i, v7
  add i, v7
  ld [i], v1         ; buf[头指针] = 新头
  ld i, pix
  draw v0, v1, 1
  add v7, 1
  and v7, vC

  ; ---- 吃食物？ ----
  se v0, v4
  jump no_eat
  se v1, v5
  jump no_eat
  se v6, 60          ; 长度封顶 60
  add v6, 1
  ld v9, 3
  ld st, v9          ; beep
  call spawn_food    ; 头坐标在 spawn_food 内部保存/恢复
  ld i, pix
  draw v4, v5, 1     ; 画新食物
  jump frame         ; 吃到不擦尾 → 变长
no_eat:
  ; ---- 擦尾（未吃到才前进尾指针）----
  ld i, buf
  add i, v8
  add i, v8
  ld v1, [i]         ; v0,v1 = 尾槽（会被覆盖！）
  ld i, pix
  draw v0, v1, 1     ; XOR 擦除
  add v8, 1
  and v8, vC
  ld v0, v9          ; 恢复头坐标（FX65 覆盖了 v0/v1，下一帧墙检要用）
  ld v1, vA
  jump frame

; ---- 死亡：闪屏 + 暂停 + 重开 ----
dead:
  cls
  ld v9, 20
  ld dt, v9
dead_wait:
  ld vE, dt
  se vE, 0
  jump dead_wait
  jump main

; ---- 食物重生：随机落点，避开蛇身 ----
spawn_food:
  ld v9, v0          ; 保存头（FX65 会覆盖 v0,v1）
  ld vA, v1
spawn_reroll:
  rnd v4, 63
  rnd v5, 31
  ld vB, v8
  ld vE, v6
sf_loop:
  se vE, 0
  jump sf_body
  jump sf_ok
sf_body:
  ld i, buf
  add i, vB
  add i, vB
  ld v1, [i]
  se v0, v4
  jump sf_next
  se v1, v5          ; y 也相等 → 跳过下一条 → 重摇
  jump sf_next
  jump spawn_reroll  ; 落在蛇身上 → 重摇
sf_next:
  add vB, 1
  and vB, vC
  add vE, 0xFF
  jump sf_loop
sf_ok:
  ld v0, v9          ; 恢复头
  ld v1, vA
  ret

; ---- 数据 ----
pix:
  db 0x80

  .org 0x500          ; 128 字节运行区，远离代码段
buf:
