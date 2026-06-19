import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Space Invaders on canvas, 10x neon style.
// Player cannon, marching invader formation, bombs, destructible shields.
const W = 560
const H = 600

const PLAYER_W = 38
const PLAYER_H = 16
const PLAYER_Y = H - 46
const PLAYER_SPEED = 360       // px/s
const FIRE_COOLDOWN = 0.34     // s between shots
const BULLET_SPEED = 560       // px/s (player, upward)
const BOMB_SPEED = 200         // px/s (invader, downward)

const ROWS = 5
const COLS = 9
const INV_W = 28
const INV_H = 20
const INV_GAP_X = 18
const INV_GAP_Y = 16
const FORM_TOP = 86
const STEP_DOWN = 18           // px dropped at each edge
const BOMB_BASE_CHANCE = 0.45  // bombs/sec from formation (scales with progress)

const SHIELD_COUNT = 4
const SHIELD_COLS = 7
const SHIELD_ROWS = 4
const CELL = 7                 // shield brick size
const SHIELD_Y = PLAYER_Y - 78

const PINK = '#ff2d6f'
const MUTED = '#8a93ad'
const ROW_COLORS = ['#ff2d6f', '#b14aed', '#4d7cff', '#2de2e6', '#54e346']
const ROW_SCORE = [50, 40, 30, 20, 10]

const BEST_KEY = '10xgames.invaders.best'

export default function SpaceInvaders() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('space-invaders')
    let wantWin = auto ? shouldAutoWin('space-invaders') : false // refreshed each round
    let restartTimer = 0                   // s countdown after game over (autoplay)
    let wavesCleared = 0                   // full waves cleared this session (autoplay win = >=1)
    let resultRecorded = false             // ensure recordAutoplayResult fires once per game over

    let player, invaders, dir, bullets, bombs, shields
    let score, lives, wave, state, best
    let fireTimer, bombTimer, animPhase
    const keys = { left: false, right: false }
    let last = performance.now(), raf = 0

    best = Number(localStorage.getItem(BEST_KEY)) || 0

    const formationWidth = COLS * INV_W + (COLS - 1) * INV_GAP_X

    function makeInvaders(startTop) {
      const arr = []
      const left = (W - formationWidth) / 2
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          arr.push({
            col: c,
            row: r,
            x: left + c * (INV_W + INV_GAP_X),
            y: startTop + r * (INV_H + INV_GAP_Y),
            color: ROW_COLORS[r],
            value: ROW_SCORE[r],
            alive: true,
          })
        }
      }
      return arr
    }

    function makeShields() {
      const arr = []
      const sw = SHIELD_COLS * CELL
      const slot = W / SHIELD_COUNT
      for (let i = 0; i < SHIELD_COUNT; i++) {
        const ox = slot * i + (slot - sw) / 2
        const bricks = []
        for (let r = 0; r < SHIELD_ROWS; r++) {
          for (let c = 0; c < SHIELD_COLS; c++) {
            // carve a small notch in the bottom-center for arch shape
            if (r >= SHIELD_ROWS - 1 && c >= 2 && c <= SHIELD_COLS - 3) continue
            bricks.push({ x: ox + c * CELL, y: SHIELD_Y + r * CELL, alive: true })
          }
        }
        arr.push(bricks)
      }
      return arr
    }

    function spawnWave(w) {
      const startTop = FORM_TOP + Math.min(w - 1, 5) * 14
      invaders = makeInvaders(startTop)
      dir = 1
      bullets = []
      bombs = []
      bombTimer = 0
    }

    function newGame() {
      score = 0
      lives = 3
      wave = 1
      player = { x: W / 2 - PLAYER_W / 2 }
      shields = makeShields()
      fireTimer = 0
      animPhase = 0
      wavesCleared = 0
      resultRecorded = false
      spawnWave(wave)
      state = 'ready'
    }

    function aliveCount() {
      let n = 0
      for (const inv of invaders) if (inv.alive) n++
      return n
    }

    function commitBest() {
      if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
    }

    function loseLife() {
      lives--
      if (lives <= 0) {
        state = 'over'
        commitBest()
        restartTimer = 1.3
      } else {
        // brief reset of player position + clear bombs to be fair
        player.x = W / 2 - PLAYER_W / 2
        bombs = []
      }
    }

    function fire() {
      if (fireTimer > 0) return
      bullets.push({ x: player.x + PLAYER_W / 2, y: PLAYER_Y - 4 })
      fireTimer = FIRE_COOLDOWN
    }

    // ---------- autoplay bot ----------
    // Drives player.x + fire() through the game's own functions (no synthetic keys).
    function botUpdate(dt) {
      // handle non-playing states: auto-start and auto-restart
      if (state === 'ready') { state = 'playing'; wantWin = shouldAutoWin('space-invaders'); return }
      if (state === 'over') {
        if (!resultRecorded) {
          recordAutoplayResult('space-invaders', wavesCleared >= 1)
          resultRecorded = true
        }
        restartTimer -= dt
        if (restartTimer <= 0) { newGame(); state = 'playing' }
        return
      }
      if (state !== 'playing') return

      const center = player.x + PLAYER_W / 2

      // find the nearest-in-x living invader (its column to target)
      let target = null, bestDx = Infinity
      for (const inv of invaders) {
        if (!inv.alive) continue
        const dx = Math.abs(inv.x + INV_W / 2 - center)
        if (dx < bestDx) { bestDx = dx; target = inv }
      }

      // dodge: find the most imminent bomb that threatens our footprint.
      // Predict where each bomb will be when it reaches the cannon line.
      let threat = null, threatTime = Infinity
      const margin = 10
      for (const bo of bombs) {
        if (bo.y > PLAYER_Y) continue
        const tHit = (PLAYER_Y - bo.y) / BOMB_SPEED  // s until it reaches cannon line
        const impactX = bo.x                          // bombs fall straight down
        if (impactX > player.x - margin && impactX < player.x + PLAYER_W + margin) {
          if (tHit < threatTime) { threatTime = tHit; threat = bo }
        }
      }

      let desired = center  // where we want the cannon center to be
      if (wantWin) {
        // good play: dodge imminent bombs, otherwise track the target accurately.
        if (threat && threatTime < 0.5) {
          // slide fully off to whichever side gives more room
          const left = threat.x - PLAYER_W / 2 - 18
          const right = threat.x + PLAYER_W / 2 + 18
          const goRight = (W - threat.x) >= threat.x
          desired = goRight ? Math.max(right, center) : Math.min(left, center)
        } else if (target) {
          desired = target.x + INV_W / 2
        }
      } else {
        // sloppy play: aim poorly (offset) and never dodge -> loses lives quickly
        if (target) desired = target.x + INV_W / 2 + 46
      }

      // smooth proportional movement: ease toward desired, clamped to top speed.
      // (no twitching — step shrinks as we approach the target)
      const diff = desired - center
      const maxStep = PLAYER_SPEED * dt
      let step = diff * Math.min(1, 12 * dt)   // proportional gain
      if (step > maxStep) step = maxStep
      else if (step < -maxStep) step = -maxStep
      if (Math.abs(diff) > 0.5) player.x += step
      player.x = Math.max(0, Math.min(W - PLAYER_W, player.x))

      // fire when well aligned on the target (tighter window when trying to win)
      const aimErr = wantWin ? 6 : 22
      const dodging = wantWin && threat && threatTime < 0.5
      if (!dodging && target && Math.abs(target.x + INV_W / 2 - (player.x + PLAYER_W / 2)) < aimErr) fire()
    }

    // ---------- update ----------
    function update(dt) {
      if (auto) botUpdate(dt)
      if (keys.left) player.x -= PLAYER_SPEED * dt
      if (keys.right) player.x += PLAYER_SPEED * dt
      player.x = Math.max(0, Math.min(W - PLAYER_W, player.x))
      if (fireTimer > 0) fireTimer -= dt

      if (state !== 'playing') return

      const total = ROWS * COLS
      const alive = aliveCount()
      const progress = 1 - alive / total // 0..1 as we clear
      // marching speed: faster as fewer remain and on later waves
      const speed = (40 + progress * 160 + (wave - 1) * 18)
      animPhase += dt * (4 + progress * 8)

      // move formation horizontally; detect edge
      let minX = Infinity, maxX = -Infinity
      for (const inv of invaders) {
        if (!inv.alive) continue
        inv.x += dir * speed * dt
        if (inv.x < minX) minX = inv.x
        if (inv.x + INV_W > maxX) maxX = inv.x + INV_W
      }
      if (minX <= 8 && dir < 0) {
        dir = 1
        for (const inv of invaders) if (inv.alive) inv.y += STEP_DOWN
      } else if (maxX >= W - 8 && dir > 0) {
        dir = -1
        for (const inv of invaders) if (inv.alive) inv.y += STEP_DOWN
      }

      // invaders reached the player line -> lose
      let lowest = 0
      for (const inv of invaders) if (inv.alive && inv.y + INV_H > lowest) lowest = inv.y + INV_H
      if (lowest >= SHIELD_Y - 6) {
        loseLife()
        if (state === 'playing') spawnWave(wave)
        return
      }

      // player bullets
      for (const b of bullets) {
        b.y -= BULLET_SPEED * dt
      }
      // bombs from invaders
      bombTimer -= dt
      const bombChance = BOMB_BASE_CHANCE + progress * 1.2 + (wave - 1) * 0.15
      if (bombTimer <= 0 && alive > 0) {
        // pick a random alive invader near the bottom of its column
        const bottom = {}
        for (const inv of invaders) {
          if (!inv.alive) continue
          if (!bottom[inv.col] || inv.y > bottom[inv.col].y) bottom[inv.col] = inv
        }
        const shooters = Object.values(bottom)
        const s = shooters[(Math.random() * shooters.length) | 0]
        if (s) bombs.push({ x: s.x + INV_W / 2, y: s.y + INV_H })
        bombTimer = 1 / bombChance
      }
      for (const bo of bombs) bo.y += BOMB_SPEED * dt

      // collisions: bullets vs invaders
      for (const b of bullets) {
        if (b.dead) continue
        for (const inv of invaders) {
          if (!inv.alive) continue
          if (b.x > inv.x && b.x < inv.x + INV_W && b.y > inv.y && b.y < inv.y + INV_H) {
            inv.alive = false
            b.dead = true
            score += inv.value
            break
          }
        }
      }

      // collisions: bullets & bombs vs shields
      function hitShield(p) {
        for (const br of shields) {
          for (const cell of br) {
            if (!cell.alive) continue
            if (p.x > cell.x && p.x < cell.x + CELL && p.y > cell.y && p.y < cell.y + CELL) {
              cell.alive = false
              return true
            }
          }
        }
        return false
      }
      for (const b of bullets) {
        if (b.dead) continue
        if (b.y < 0) { b.dead = true; continue }
        if (hitShield(b)) b.dead = true
      }
      for (const bo of bombs) {
        if (bo.dead) continue
        if (bo.y > H) { bo.dead = true; continue }
        if (hitShield(bo)) { bo.dead = true; continue }
        // bomb vs player
        if (bo.y + 8 > PLAYER_Y && bo.x > player.x && bo.x < player.x + PLAYER_W) {
          bo.dead = true
          loseLife()
          if (state !== 'playing') return
        }
      }

      bullets = bullets.filter((b) => !b.dead)
      bombs = bombs.filter((b) => !b.dead)

      // wave cleared
      if (aliveCount() === 0) {
        commitBest()
        wavesCleared++
        wave++
        shields = makeShields()
        spawnWave(wave)
      }
    }

    // ---------- input ----------
    function onKeyDown(e) {
      const k = e.code
      if (k === 'ArrowLeft' || k === 'KeyA') { keys.left = true; e.preventDefault() }
      else if (k === 'ArrowRight' || k === 'KeyD') { keys.right = true; e.preventDefault() }
      else if (k === 'Space') {
        e.preventDefault()
        if (state === 'ready') state = 'playing'
        else if (state === 'over') newGame()
        else fire()
      }
    }
    function onKeyUp(e) {
      const k = e.code
      if (k === 'ArrowLeft' || k === 'KeyA') keys.left = false
      else if (k === 'ArrowRight' || k === 'KeyD') keys.right = false
    }
    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      player.x = Math.max(0, Math.min(W - PLAYER_W, x - PLAYER_W / 2))
    }
    function onPointerDown() {
      if (state === 'ready') state = 'playing'
      else if (state === 'over') newGame()
      else fire()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }
    function label(x, y, text, value) {
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText(text, x, y)
      ctx.fillRect(x, y + 4, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(value), x, y + 28)
    }

    // blocky pixel-ish invader sprite drawn in a 5-wide grid, two frames
    const SPRITE_A = [
      '00100100',
      '00111100',
      '01111110',
      '11011011',
      '11111111',
      '00100100',
      '01000010',
    ]
    const SPRITE_B = [
      '00100100',
      '10111101',
      '11111111',
      '11011011',
      '11111111',
      '01000010',
      '10000001',
    ]
    function drawInvader(inv, frame) {
      const grid = frame ? SPRITE_B : SPRITE_A
      const cols = grid[0].length
      const px = INV_W / cols
      const py = INV_H / grid.length
      ctx.fillStyle = inv.color
      ctx.shadowColor = inv.color; ctx.shadowBlur = 10
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r][c] === '1') {
            ctx.fillRect(inv.x + c * px, inv.y + r * py, Math.ceil(px), Math.ceil(py))
          }
        }
      }
      ctx.shadowBlur = 0
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(26, 30, 5); sparkle(W - 26, H - 26, 4)

      // HUD
      label(16, 26, 'SCORE', score)
      ctx.textAlign = 'left'
      label(W / 2 - 24, 26, 'LIVES', lives)
      ctx.textAlign = 'right'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('BEST', W - 16, 26)
      ctx.fillRect(W - 38, 30, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(best), W - 16, 54)

      // shields
      ctx.fillStyle = '#2de2e6'
      ctx.shadowColor = '#2de2e6'; ctx.shadowBlur = 6
      for (const br of shields) {
        for (const cell of br) {
          if (cell.alive) ctx.fillRect(cell.x, cell.y, CELL - 1, CELL - 1)
        }
      }
      ctx.shadowBlur = 0

      // invaders (two-frame animation)
      const frame = (Math.floor(animPhase) % 2) === 0
      for (const inv of invaders) {
        if (inv.alive) drawInvader(inv, frame)
      }

      // player cannon
      ctx.fillStyle = '#54e346'
      ctx.shadowColor = '#54e346'; ctx.shadowBlur = 14
      const px = player.x
      ctx.fillRect(px, PLAYER_Y + 6, PLAYER_W, PLAYER_H - 6)
      ctx.fillRect(px + PLAYER_W / 2 - 8, PLAYER_Y + 2, 16, 6)
      ctx.fillRect(px + PLAYER_W / 2 - 2, PLAYER_Y - 6, 4, 8)
      ctx.shadowBlur = 0

      // bullets
      ctx.fillStyle = '#fff'
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 14
      for (const b of bullets) ctx.fillRect(b.x - 1.5, b.y - 8, 3, 12)
      ctx.shadowBlur = 0

      // bombs
      ctx.fillStyle = PINK
      ctx.shadowColor = PINK; ctx.shadowBlur = 10
      for (const bo of bombs) ctx.fillRect(bo.x - 1.5, bo.y, 3, 9)
      ctx.shadowBlur = 0

      // footer hint
      ctx.fillStyle = MUTED; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('WAVE ' + wave + '   ·   ← →  /  A D  move   ·   space  fire', W / 2, H - 14)

      if (state === 'ready') overlay('SPACE INVADERS', 'space / tap to start')
      else if (state === 'over') overlay('GAME OVER', 'space / tap to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.78)'; ctx.fillRect(0, H / 2 - 70, W, 140)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 38px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 70, H / 2 + 12, 140, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 42)
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    newGame()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="invaders-canvas" aria-label="Space Invaders game" />
  )
}
