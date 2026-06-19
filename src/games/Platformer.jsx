import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Fixed viewport (the level itself is much wider; camera scrolls).
const W = 640
const H = 400

// Tile size for the handcrafted level grid.
const TILE = 32

// Physics (tuned by feel).
const GRAVITY = 0.55
const MOVE_ACC = 0.9
const MOVE_MAX = 5.5
const FRICTION = 0.8
const AIR_FRICTION = 0.94
const JUMP_VEL = -11.5 // initial upward velocity
const JUMP_CUT = 0.45 // velocity multiplier when jump released early (variable height)
const MAX_FALL = 14
const STOMP_BOUNCE = -8

// Player size.
const P_W = 22
const P_H = 28

const BEST_KEY = '10xgames.platformer.best'

// ---- Handcrafted level ----
// Legend:
//   '#' solid ground/platform block
//   '=' floating platform block
//   'o' coin
//   'e' enemy spawn (patrols)
//   'p' player spawn
//   'c' checkpoint
//   'G' goal flag
//   ' ' empty / gap
// Rows are top -> bottom. The grid is wider than the screen.
const LEVEL = [
  '                                                                                            ',
  '                                                                                            ',
  '                          o o                                  o o o                         ',
  '                         = = =                      o                                        ',
  '              o                              o     = = =                              o o    ',
  '             = =          o o o        = =                            o o o          = = =   ',
  '                                                            = = =                            ',
  '   p              o          e                  o                          e        c        ',
  '  ###      o o   = = =     ######      o o o   = = =      o o o   = =     ######         G    ',
  '  ###     = = =          ########                                       ########       ###   ',
  '  #####            e    ##########                  e            e     ##########     #####  ',
  '  #######        ########################       ###################################   #######',
  '  ########       ########################       ###################################  ########',
  '  #########      ########################       ###################################  ########',
]

export default function Platformer() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('platformer')

    const ROWS = LEVEL.length
    const COLS = Math.max(...LEVEL.map((r) => r.length))
    const LEVEL_W = COLS * TILE
    const LEVEL_H = ROWS * TILE

    // ---- parse the level once ----
    const solids = [] // { x, y, w, h, kind: 'ground'|'plat' }
    let spawn = { x: TILE * 2, y: TILE * 2 }
    let checkpoint = null
    let goal = null
    const coinTemplates = [] // { x, y }
    const enemyTemplates = [] // { x, y }

    for (let r = 0; r < ROWS; r++) {
      const row = LEVEL[r]
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]
        const x = c * TILE
        const y = r * TILE
        if (ch === '#') solids.push({ x, y, w: TILE, h: TILE, kind: 'ground' })
        else if (ch === '=') solids.push({ x, y, w: TILE, h: TILE, kind: 'plat' })
        else if (ch === 'o') coinTemplates.push({ x: x + TILE / 2, y: y + TILE / 2 })
        else if (ch === 'e') enemyTemplates.push({ x: x + 5, y: y + TILE - 24 })
        else if (ch === 'p') spawn = { x: x + 4, y: y + TILE - P_H }
        else if (ch === 'c') checkpoint = { x: x + 4, y: y + TILE - P_H, cx: x + TILE / 2, cy: y }
        else if (ch === 'G') goal = { x: x + TILE / 2, y: y, by: y + TILE }
      }
    }
    if (!goal) goal = { x: LEVEL_W - TILE, y: TILE * 8, by: TILE * 9 }

    // ---- mutable game state ----
    let phase = 'ready' // ready | playing | over | win
    let reachedGoal = false // true once the player touches the goal flag
    let px = spawn.x
    let py = spawn.y
    let vx = 0
    let vy = 0
    let onGround = false
    let facing = 1
    let lives = 3
    let score = 0
    let activeSpawn = { ...spawn }
    let checkpointHit = false
    let coins = [] // { x, y, taken }
    let enemies = [] // { x, y, w, h, vx, dead, t }
    let camX = 0
    let best = Number(localStorage.getItem(BEST_KEY)) || 0
    let invuln = 0 // brief i-frames after a hit
    let last = performance.now()
    let raf = 0

    // input
    let left = false
    let right = false
    let jumpHeld = false

    // ---- autoplay bot ----
    let wantWin = shouldAutoWin('platformer') // this round: aim to win, or to die sloppily
    let restartAt = 0 // timestamp (ms) at which to auto-restart after over/win

    // parallax sparkle stars
    const stars = []
    for (let i = 0; i < 36; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        s: 0.3 + Math.random() * 0.7, // parallax factor + size
        drift: 0.15 + Math.random() * 0.4,
      })
    }

    function resetEntities() {
      coins = coinTemplates.map((c) => ({ x: c.x, y: c.y, taken: false }))
      enemies = enemyTemplates.map((e) => ({
        x: e.x,
        y: e.y,
        w: 22,
        h: 24,
        vx: Math.random() < 0.5 ? -1.1 : 1.1,
        dead: false,
        t: Math.random() * Math.PI * 2,
      }))
    }

    function fullReset() {
      lives = 3
      score = 0
      checkpointHit = false
      activeSpawn = { ...spawn }
      resetEntities()
      respawn()
    }

    function respawn() {
      px = activeSpawn.x
      py = activeSpawn.y
      vx = 0
      vy = 0
      onGround = false
      facing = 1
      invuln = 60
    }

    function start() {
      fullReset()
      reachedGoal = false
      resultRecorded = false
      phase = 'playing'
    }

    function loseLife() {
      lives -= 1
      if (lives <= 0) {
        phase = 'over'
        commitBest()
        recordResultOnce(false)
      } else {
        respawn()
      }
    }

    // ---- autoplay session bookkeeping (defined here so loseLife/goal can call it) ----
    let resultRecorded = false // recordAutoplayResult exactly once per session
    function recordResultOnce(won) {
      if (!auto || resultRecorded) return
      resultRecorded = true
      recordAutoplayResult('platformer', won === true)
    }

    function commitBest() {
      if (score > best) {
        best = score
        localStorage.setItem(BEST_KEY, String(best))
      }
    }

    function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
    }

    function update(dt) {
      const step = dt / 16.67
      // drift stars regardless of phase
      for (const s of stars) {
        s.y += s.drift * step
        if (s.y > H) {
          s.y = 0
          s.x = Math.random() * W
        }
      }
      if (phase !== 'playing') return

      if (invuln > 0) invuln -= step

      // ---- horizontal input ----
      if (left) {
        vx -= MOVE_ACC * step
        facing = -1
      }
      if (right) {
        vx += MOVE_ACC * step
        facing = 1
      }
      if (!left && !right) {
        vx *= Math.pow(onGround ? FRICTION : AIR_FRICTION, step)
        if (Math.abs(vx) < 0.05) vx = 0
      }
      vx = Math.max(-MOVE_MAX, Math.min(MOVE_MAX, vx))

      // ---- gravity ----
      vy += GRAVITY * step
      if (vy > MAX_FALL) vy = MAX_FALL
      // variable jump: if rising and jump released, cut the climb
      if (vy < 0 && !jumpHeld) vy *= Math.pow(JUMP_CUT, step)

      // ---- collide on X then Y separately ----
      // X axis
      px += vx * step
      for (const s of solids) {
        if (aabb(px, py, P_W, P_H, s.x, s.y, s.w, s.h)) {
          if (vx > 0) px = s.x - P_W
          else if (vx < 0) px = s.x + s.w
          vx = 0
        }
      }
      // clamp to level horizontally
      if (px < 0) {
        px = 0
        if (vx < 0) vx = 0
      }
      if (px + P_W > LEVEL_W) {
        px = LEVEL_W - P_W
        if (vx > 0) vx = 0
      }

      // Y axis
      onGround = false
      py += vy * step
      for (const s of solids) {
        if (aabb(px, py, P_W, P_H, s.x, s.y, s.w, s.h)) {
          if (vy > 0) {
            py = s.y - P_H
            onGround = true
          } else if (vy < 0) {
            py = s.y + s.h
          }
          vy = 0
        }
      }

      // ---- fell in a pit ----
      if (py > LEVEL_H + 40) {
        loseLife()
        return
      }

      // ---- checkpoint ----
      if (checkpoint && !checkpointHit) {
        if (aabb(px, py, P_W, P_H, checkpoint.cx - 16, checkpoint.cy, 32, TILE)) {
          checkpointHit = true
          activeSpawn = { x: checkpoint.x, y: checkpoint.y }
        }
      }

      // ---- coins ----
      for (const c of coins) {
        if (c.taken) continue
        if (aabb(px, py, P_W, P_H, c.x - 9, c.y - 9, 18, 18)) {
          c.taken = true
          score += 10
        }
      }

      // ---- enemies ----
      for (const en of enemies) {
        if (en.dead) {
          en.t += step
          continue
        }
        en.t += 0.12 * step
        // patrol: move, reverse at edges of a supporting platform or at walls
        en.x += en.vx * step
        // wall reverse
        for (const s of solids) {
          if (aabb(en.x, en.y, en.w, en.h, s.x, s.y, s.w, s.h)) {
            if (en.vx > 0) en.x = s.x - en.w
            else en.x = s.x + s.w
            en.vx *= -1
            break
          }
        }
        // ledge reverse: if no ground just ahead under leading foot, turn around
        const footX = en.vx > 0 ? en.x + en.w + 1 : en.x - 1
        const footY = en.y + en.h + 2
        let supported = false
        for (const s of solids) {
          if (footX >= s.x && footX <= s.x + s.w && footY >= s.y && footY <= s.y + s.h) {
            supported = true
            break
          }
        }
        if (!supported) en.vx *= -1
        // keep inside level
        if (en.x < 0) {
          en.x = 0
          en.vx = Math.abs(en.vx)
        }
        if (en.x + en.w > LEVEL_W) {
          en.x = LEVEL_W - en.w
          en.vx = -Math.abs(en.vx)
        }

        // player vs enemy
        if (aabb(px, py, P_W, P_H, en.x, en.y, en.w, en.h)) {
          const falling = vy > 0
          const fromAbove = py + P_H - vy * step <= en.y + 8
          if (falling && fromAbove) {
            // STOMP
            en.dead = true
            en.t = 0
            score += 25
            vy = STOMP_BOUNCE
            py = en.y - P_H
          } else if (invuln <= 0) {
            // SIDE HIT
            loseLife()
            return
          }
        }
      }

      // ---- goal ----
      if (aabb(px, py, P_W, P_H, goal.x - 6, goal.y - TILE, 24, TILE * 2)) {
        phase = 'win'
        reachedGoal = true
        score += 100
        commitBest()
        recordResultOnce(reachedGoal === true)
      }

      // ---- camera follows player, clamped to level ends ----
      let target = px + P_W / 2 - W / 2
      if (target < 0) target = 0
      if (target > LEVEL_W - W) target = LEVEL_W - W
      camX += (target - camX) * Math.min(1, 0.15 * step)
      if (camX < 0) camX = 0
      if (camX > LEVEL_W - W) camX = LEVEL_W - W
    }

    // ---------------- autoplay bot ----------------
    // Returns true if a solid tile occupies the sample point (level coords).
    function solidAt(sx, sy) {
      for (const s of solids) {
        if (sx >= s.x && sx < s.x + s.w && sy >= s.y && sy < s.y + s.h) return true
      }
      return false
    }

    // Slightly stronger launch for the BOT only (human input still uses JUMP_VEL).
    // The level's widest pit (224px) is right at the edge of the normal jump arc, so the bot
    // launches a touch higher to land on the stepping platform above the gap and clear it
    // reliably. This never touches keyboard/touch jumps, so non-auto play is unchanged.
    const BOT_JUMP_VEL = -13

    // Drives run/jump by writing the game's OWN movement state each frame.
    function botTick(now) {
      // Auto-start / auto-restart loop.
      if (phase === 'ready') {
        start()
        wantWin = shouldAutoWin('platformer')
        return
      }
      if (phase === 'over' || phase === 'win') {
        left = right = jumpHeld = false
        if (!restartAt) restartAt = now + 1300
        else if (now >= restartAt) {
          restartAt = 0
          start()
          wantWin = shouldAutoWin('platformer')
        }
        return
      }
      restartAt = 0

      // Always run toward the goal (to the right) at full speed — smooth, steady.
      left = false
      right = true
      facing = 1

      const feetY = py + P_H // bottom of the player
      const rightEdge = px + P_W // leading edge x

      // ---- wall / step directly in front (body height) ----
      const wallAhead = solidAt(rightEdge + 2, py + P_H - 6) || solidAt(rightEdge + 2, py + 6)

      // ---- pit edge detection ----
      // While grounded, sample the floor a hair (3px) past our leading edge. The instant that
      // sample is empty we are standing on the LAST safe tile with the pit beginning right at
      // our toes -> jump now to launch from the edge for maximum horizontal reach. Sampling so
      // close means we don't fire a tile early (which would fall short of wide pits).
      const atPitEdge = onGround && !solidAt(rightEdge + 3, feetY + 2)

      // enemy just ahead, roughly at our level -> jump to stomp/clear it
      let enemyAhead = false
      for (const en of enemies) {
        if (en.dead) continue
        if (en.x > px && en.x < rightEdge + 30 && Math.abs(en.y - py) < TILE * 1.2) {
          enemyAhead = true
          break
        }
      }

      // Decide whether this frame should jump.
      const needJump = onGround && (wallAhead || atPitEdge || enemyAhead)

      let doJump = needJump
      if (!wantWin) {
        // Sloppy round: mistime jumps so the bot falls in a pit or eats an enemy and dies.
        if (atPitEdge) doJump = false // freeze at the edge -> walk into the pit and fall
        if (enemyAhead && Math.random() < 0.7) doJump = false
        if (wallAhead) doJump = true // still climb walls so it actually reaches a pit to die in
      }

      if (doJump && onGround) {
        vy = BOT_JUMP_VEL
        onGround = false
        jumpHeld = true
      } else {
        // hold jump for the WHOLE rise (full height/reach), release once falling
        jumpHeld = vy < 0
      }
    }

    // ---------------- rendering ----------------
    function drawStars() {
      ctx.save()
      ctx.font = 'bold 12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      for (const s of stars) {
        // parallax x: faraway stars move less than camera
        const sx = ((s.x - camX * s.s) % W + W) % W
        const a = 0.15 + s.s * 0.25
        ctx.globalAlpha = a
        ctx.fillStyle = s.s > 0.6 ? '#2de2e6' : '#ff2d6f'
        ctx.shadowColor = ctx.fillStyle
        ctx.shadowBlur = 6
        ctx.fillText('+', sx, s.y)
      }
      ctx.restore()
    }

    function roundRectPath(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    function drawSolids() {
      // Merge contiguous tiles only visually per-tile (cheap). Draw dark body + neon top edge.
      for (const s of solids) {
        const x = s.x - camX
        if (x + s.w < 0 || x > W) continue
        const y = s.y
        ctx.save()
        // dark body
        ctx.fillStyle = s.kind === 'ground' ? '#15171f' : '#181421'
        ctx.fillRect(x, y, s.w, s.h)
        // subtle inner border
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, s.w - 1, s.h - 1)
        // neon top edge — only when the tile above is empty
        const aboveSolid = solids.some(
          (o) => o.x === s.x && o.y === s.y - TILE,
        )
        if (!aboveSolid) {
          const edge = s.kind === 'ground' ? '#2de2e6' : '#ff2d6f'
          ctx.shadowColor = edge
          ctx.shadowBlur = 12
          ctx.fillStyle = edge
          ctx.fillRect(x, y, s.w, 3)
        }
        ctx.restore()
      }
    }

    function drawCoins() {
      for (const c of coins) {
        if (c.taken) continue
        const x = c.x - camX
        if (x < -20 || x > W + 20) continue
        const bob = Math.sin(performance.now() / 250 + c.x) * 2
        ctx.save()
        ctx.shadowColor = '#ffd60a'
        ctx.shadowBlur = 14
        ctx.fillStyle = '#ffd60a'
        ctx.beginPath()
        ctx.arc(x, c.y + bob, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath()
        ctx.arc(x - 2, c.y + bob - 2, 2.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    function drawEnemies() {
      for (const en of enemies) {
        const x = en.x - camX
        if (x < -40 || x > W + 40) continue
        ctx.save()
        if (en.dead) {
          // squashed flash, fading
          const a = Math.max(0, 1 - en.t / 25)
          ctx.globalAlpha = a
          ctx.fillStyle = '#ff8a1e'
          ctx.shadowColor = '#ff8a1e'
          ctx.shadowBlur = 12
          roundRectPath(x, en.y + en.h - 8, en.w, 8, 4)
          ctx.fill()
          ctx.restore()
          continue
        }
        const color = '#b14aed'
        ctx.shadowColor = color
        ctx.shadowBlur = 14
        ctx.fillStyle = color
        roundRectPath(x, en.y, en.w, en.h, 6)
        ctx.fill()
        // glowing eyes (orange) looking in travel direction
        ctx.shadowBlur = 6
        ctx.shadowColor = '#ff8a1e'
        ctx.fillStyle = '#ff8a1e'
        const dir = en.vx >= 0 ? 1 : -1
        const ey = en.y + 9 + Math.sin(en.t) * 1
        ctx.beginPath()
        ctx.arc(x + en.w / 2 + dir * 3 - 4, ey, 2.4, 0, Math.PI * 2)
        ctx.arc(x + en.w / 2 + dir * 3 + 4, ey, 2.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    function drawGoal() {
      const x = goal.x - camX
      if (x < -40 || x > W + 40) return
      const topY = goal.y - TILE * 1.5
      ctx.save()
      // pole
      ctx.shadowColor = '#54e346'
      ctx.shadowBlur = 16
      ctx.strokeStyle = '#54e346'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x, topY)
      ctx.lineTo(x, goal.by)
      ctx.stroke()
      // flag (waving)
      const wave = Math.sin(performance.now() / 200) * 3
      ctx.fillStyle = '#54e346'
      ctx.beginPath()
      ctx.moveTo(x, topY)
      ctx.lineTo(x + 22 + wave, topY + 8)
      ctx.lineTo(x, topY + 16)
      ctx.closePath()
      ctx.fill()
      // top knob
      ctx.shadowBlur = 10
      ctx.fillStyle = '#eaffe5'
      ctx.beginPath()
      ctx.arc(x, topY, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function drawPlayer() {
      if (phase === 'ready') return
      const x = px - camX
      const y = py
      ctx.save()
      // blink during i-frames
      if (invuln > 0 && Math.floor(invuln / 5) % 2 === 0) ctx.globalAlpha = 0.4
      ctx.shadowColor = '#ff2d6f'
      ctx.shadowBlur = 20
      ctx.fillStyle = '#ff2d6f'
      roundRectPath(x, y, P_W, P_H, 6)
      ctx.fill()
      // bright core
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      roundRectPath(x + 5, y + 4, P_W - 10, P_H - 12, 4)
      ctx.fill()
      // eye nub (facing)
      ctx.fillStyle = '#0a0a0a'
      ctx.beginPath()
      ctx.arc(x + P_W / 2 + facing * 5, y + 11, 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function drawHUD() {
      ctx.save()
      ctx.textAlign = 'left'
      // SCORE (coins)
      ctx.fillStyle = '#ff2d6f'
      ctx.font = 'bold 12px system-ui, sans-serif'
      ctx.fillText('SCORE', 18, 26)
      ctx.fillRect(18, 31, 42, 3)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 22px system-ui, sans-serif'
      ctx.fillText(String(score), 18, 56)

      // LIVES (center)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#ff2d6f'
      ctx.font = 'bold 12px system-ui, sans-serif'
      ctx.fillText('LIVES', W / 2, 26)
      ctx.fillRect(W / 2 - 21, 31, 42, 3)
      ctx.shadowColor = '#ff2d6f'
      ctx.shadowBlur = 10
      ctx.fillStyle = '#ff2d6f'
      for (let i = 0; i < lives; i++) {
        ctx.beginPath()
        ctx.arc(W / 2 - (lives - 1) * 9 + i * 18, 48, 5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.shadowBlur = 0

      // BEST (right)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#8a93ad'
      ctx.font = 'bold 12px system-ui, sans-serif'
      ctx.fillText('BEST', W - 18, 26)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 22px system-ui, sans-serif'
      ctx.fillText(String(best), W - 18, 52)
      ctx.restore()
    }

    function drawCenterText(title, sub, color) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 18
      ctx.font = 'bold 36px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2 - 8)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#8a93ad'
      ctx.font = '15px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 28)
      ctx.restore()
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, W, H)

      drawStars()
      drawSolids()
      drawCoins()
      drawGoal()
      drawEnemies()
      drawPlayer()
      drawHUD()

      if (phase === 'ready') {
        drawCenterText('PLATFORMER', 'press SPACE / tap to start', '#ff2d6f')
        ctx.save()
        ctx.textAlign = 'center'
        ctx.fillStyle = '#8a93ad'
        ctx.font = '13px system-ui, sans-serif'
        ctx.fillText('← → / A D to move · SPACE / ↑ / W to jump (hold = higher)', W / 2, H / 2 + 52)
        ctx.restore()
      } else if (phase === 'over') {
        drawCenterText('GAME OVER', 'press SPACE / tap to restart', '#ff2d6f')
      } else if (phase === 'win') {
        drawCenterText('LEVEL CLEAR!', 'press SPACE / tap to play again', '#54e346')
      }
    }

    function loop(now) {
      let dt = now - last
      last = now
      if (dt > 50) dt = 50
      if (auto) botTick(now)
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    // ---- input ----
    function activate() {
      if (phase === 'ready' || phase === 'over' || phase === 'win') start()
    }

    function tryJump() {
      jumpHeld = true
      if (phase === 'playing' && onGround) {
        vy = JUMP_VEL
        onGround = false
      } else {
        activate()
      }
    }

    const onKey = (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault()
        left = true
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault()
        right = true
      } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault()
        if (!e.repeat) tryJump()
      }
    }
    const onKeyUp = (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') left = false
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') right = false
      else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') jumpHeld = false
    }
    const onPointer = (e) => {
      e.preventDefault()
      if (phase !== 'playing') {
        activate()
        return
      }
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      // bottom-third left/right steers; otherwise jump
      const y = (e.clientY - rect.top) / rect.height
      if (y > 0.6) {
        if (x < 0.5) {
          left = true
          right = false
        } else {
          right = true
          left = false
        }
      } else {
        tryJump()
      }
    }
    const onPointerUp = () => {
      left = false
      right = false
      jumpHeld = false
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('pointerup', onPointerUp)

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="platformer-canvas"
      aria-label="Platformer game"
    />
  )
}
