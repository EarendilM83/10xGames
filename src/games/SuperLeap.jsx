import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Classic side-scrolling platformer ("World 1-1" spirit), 10x neon-meets-retro.
// Original art only: a generic plumber-style hero, mushroom-ish enemies, ? blocks,
// bricks, green pipes, coins, clouds, and a goal flag. All drawn as simple shapes.
// Gravity + run + variable-height jump; AABB collision resolved X then Y; follow
// camera; stomp enemies from above, side contact costs a life; reach the flag to win.
// Includes a 95% autoplay bot that runs right and jumps over pits/walls/enemies.
const W = 640
const H = 400
const T = 32                 // tile size (px)
const BEST_KEY = '10xgames.superleap.best'

// ----- palette (cheerful sky, tinted with the 10x neon palette) -----
const SKY_TOP = '#2b6df0'
const SKY_BOT = '#7fc4ff'
const PINK = '#ff2d6f'
const BRICK = '#c8642d'
const BRICK_DK = '#8f3f17'
const QBLOCK = '#ffb01e'
const QBLOCK_DK = '#c97c00'
const PIPE = '#2bd44a'
const PIPE_DK = '#138a2b'
const GROUND = '#b5651d'
const GROUND_TOP = '#54e346'
const COIN = '#ffd24a'

// ----- physics (px, seconds) -----
const GRAV = 1750            // px/s^2
const RUN_ACC = 1400
const MAX_RUN = 220
const FRICTION = 1300
const JUMP_V = 560           // initial jump velocity (variable height while held)
const JUMP_HOLD = 1100       // extra upward accel applied while jump held (counters gravity)
const MAX_FALL = 720

// ----- level map -----
// Legend: ' ' empty, 'X' ground, 'B' brick, '?' question block, 'C' coin,
//         'P' pipe top, 'p' pipe body, 'E' enemy spawn, 'F' flag pole, '=' flag base.
// 17 rows tall. Ground sits on the bottom rows; gaps are columns with no 'X'.
// Designed so the widest pit is 3 tiles (96px) — well within the jump arc.
const MAP = [
  '                                                                                                            ',
  '                                                                                                            ',
  '                                                                                                            ',
  '                                                                                                            ',
  '                                                                                                            ',
  '             C C                                          C C C                                             ',
  '                                                                                                            ',
  '         ?  B?B           C C            B B B                        ?B?                                   ',
  '                        C     C                                                                          F  ',
  '                       C       C                  E            E                                         F  ',
  '              E                              P             P                          E         E        F  ',
  '   E                       B B B             p             p                                             F  ',
  'XXXXXXXX   XXXXXXXXXX   XXXXXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXXXXXXXXXXXXXXXXX==X',
  'XXXXXXXX   XXXXXXXXXX   XXXXXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXX   XXXXXXXXXX   XXXXXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXX   XXXXXXXXXX   XXXXXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXX   XXXXXXXXXX   XXXXXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXX   XXXXXXXXXXXXXX   XXXXXXXXXXXXXXXXXXXXXXXXXX',
]
const ROWS = MAP.length
const COLS = MAP[0].length
const LEVEL_W = COLS * T
const LEVEL_H = ROWS * T

function tileAt(c, r) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return ' '
  return MAP[r][c] || ' '
}
// Solid tiles for collision: ground, bricks, ? blocks, pipes.
function isSolidChar(ch) {
  return ch === 'X' || ch === 'B' || ch === '?' || ch === 'P' || ch === 'p'
}
function solidAt(c, r) { return isSolidChar(tileAt(c, r)) }

export default function SuperLeap() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const auto = isAutoplay('superleap')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    // ----- best (max coins reached) -----
    let best = 0
    try {
      const v = parseInt(localStorage.getItem(BEST_KEY) || '0', 10)
      if (isFinite(v) && v > 0) best = v
    } catch { best = 0 }
    function saveBest() { try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* ignore */ } }

    // ----- mutable world (coins collected from ? blocks become inert; collected coin tiles removed) -----
    // We copy the map into a flat array so bumps/coins can mutate it per run.
    let grid = []
    function buildGrid() {
      grid = MAP.map(row => row.split(''))
    }
    function gAt(c, r) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return ' '
      return grid[r][c]
    }
    function gSolid(c, r) { return isSolidChar(gAt(c, r)) }

    // ----- entities -----
    const SPAWN_X = 1 * T
    const SPAWN_Y = 12 * T - 28 - 1   // feet resting on the ground row (row 12)
    let hero = null
    let enemies = []
    let particles = []   // bumped-coin floaters
    let camX = 0

    function makeHero() {
      return {
        x: SPAWN_X, y: SPAWN_Y, w: 22, h: 28,
        vx: 0, vy: 0, onGround: false,
        face: 1, anim: 0, dead: false, deadT: 0,
      }
    }

    function spawnEnemies() {
      enemies = []
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (MAP[r][c] === 'E') {
            enemies.push({
              x: c * T + 4, y: r * T + 4, w: 24, h: 24,
              vx: -50, vy: 0, alive: true, squashT: 0, anim: 0,
            })
          }
        }
      }
    }

    // ----- game state -----
    let state = 'ready'   // 'ready' | 'playing' | 'over' | 'win'
    let lives = 3
    let coins = 0
    let score = 0
    let timeLeft = 300    // classic countdown
    let raf = 0
    let last = performance.now()
    let resultText = ''

    // autoplay control
    let autoWantWin = true
    let autoRecorded = false
    let autoTimer = 0
    // autoplay deliberate-miss: when a lose round is chosen we sabotage one jump.
    let autoSabotage = false
    let autoSabotageDone = false

    function resetRun(fullReset) {
      buildGrid()
      hero = makeHero()
      spawnEnemies()
      particles = []
      camX = 0
      timeLeft = 300
      if (fullReset) { lives = 3; coins = 0; score = 0 }
      autoSabotageDone = false
      if (auto) {
        // Decide once per round whether to aim to win; ~5% of rounds intentionally die.
        autoSabotage = autoWantWin ? false : true
      }
    }

    function startGame() {
      if (auto) autoWantWin = shouldAutoWin('superleap')
      autoRecorded = false
      resetRun(true)
      state = 'playing'
    }

    function loseLife() {
      lives -= 1
      if (lives <= 0) {
        state = 'over'
        finishAuto(false)
      } else {
        // respawn at start with the level reset (coins/score persist)
        buildGrid()
        hero = makeHero()
        spawnEnemies()
        particles = []
        camX = 0
        timeLeft = 300
        autoSabotageDone = false   // give the bot a fresh fair attempt
      }
    }

    function winGame() {
      state = 'win'
      score += timeLeft * 10
      if (coins > best) { best = coins; saveBest() }
      finishAuto(true)
    }

    function finishAuto(won) {
      if (!auto || autoRecorded) return
      autoRecorded = true
      recordAutoplayResult('superleap', won)
      clearTimeout(autoTimer)
      autoTimer = setTimeout(() => { startGame() }, 2000)
    }

    // ----- input -----
    const keys = Object.create(null)
    function onKeyDown(e) {
      const k = e.key
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' ||
          k === 'ArrowDown' || k === ' ' || k === 'Spacebar') {
        e.preventDefault()
      }
      keys[k] = true
      if (k === ' ' || k === 'Spacebar' || k === 'ArrowUp') {
        if (state === 'ready' || state === 'over' || state === 'win') startGame()
      }
    }
    function onKeyUp(e) { keys[e.key] = false }
    function onPointer(e) {
      e.preventDefault()
      if (state === 'ready' || state === 'over' || state === 'win') startGame()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointer)

    // ----- AABB collision against the tile grid (resolve X then Y) -----
    function collideX(o) {
      const top = Math.floor(o.y / T)
      const bot = Math.floor((o.y + o.h - 1) / T)
      if (o.vx > 0) {
        const col = Math.floor((o.x + o.w) / T)
        for (let r = top; r <= bot; r++) {
          if (gSolid(col, r)) { o.x = col * T - o.w; o.vx = 0; return true }
        }
      } else if (o.vx < 0) {
        const col = Math.floor(o.x / T)
        for (let r = top; r <= bot; r++) {
          if (gSolid(col, r)) { o.x = (col + 1) * T; o.vx = 0; return true }
        }
      }
      return false
    }

    // Returns: 0 none, 1 landed (hit floor), 2 bonked head (hit ceiling)
    function collideY(o) {
      const left = Math.floor(o.x / T)
      const right = Math.floor((o.x + o.w - 1) / T)
      if (o.vy > 0) {
        const row = Math.floor((o.y + o.h) / T)
        for (let c = left; c <= right; c++) {
          if (gSolid(c, row)) { o.y = row * T - o.h; o.vy = 0; return 1 }
        }
      } else if (o.vy < 0) {
        const row = Math.floor(o.y / T)
        for (let c = left; c <= right; c++) {
          if (gSolid(c, row)) {
            o.y = (row + 1) * T; o.vy = 0
            return 2 + c * 65536 + row * 256 // encode the bonked tile for ? handling
          }
        }
      }
      return 0
    }

    function bumpBlock(c, r) {
      const ch = gAt(c, r)
      if (ch === '?') {
        grid[r][c] = 'U'                 // used block (inert, drawn darker)
        coins += 1; score += 100
        if (coins > best) { best = coins; saveBest() }
        particles.push({ x: c * T + T / 2, y: r * T, vy: -160, life: 0.5 })
      }
    }

    // ----- autoplay brain: sense a pit/wall/enemy ahead, jump from the edge -----
    let autoJumpHold = 0   // frames remaining to keep jump held (variable height)
    function autoControl(dt) {
      // Clear synthetic keys then set them based on sensors.
      keys.ArrowRight = true
      keys.ArrowLeft = false

      const footC = Math.floor((hero.x + hero.w / 2) / T)
      const footR = Math.floor((hero.y + hero.h) / T)

      // Look ahead a couple tiles for a pit (no ground within fall range).
      function groundAhead(colOffset) {
        const c = footC + colOffset
        for (let r = footR; r < ROWS; r++) {
          if (gSolid(c, r)) return r
        }
        return -1
      }
      const aheadCol = Math.floor((hero.x + hero.w + 6) / T)
      // Is there a pit starting just ahead? (no solid directly under the next 1-3 cols near foot level)
      let pitAhead = false
      for (let off = 1; off <= 3; off++) {
        const c = footC + off
        let hasNearGround = false
        for (let r = footR; r <= footR + 1; r++) {
          if (gSolid(c, r)) { hasNearGround = true; break }
        }
        if (!hasNearGround) { pitAhead = true; break }
      }

      // Wall ahead? solid tile at hero body height in the column just ahead.
      let wallAhead = false
      const bodyTop = Math.floor((hero.y + 2) / T)
      const bodyMid = Math.floor((hero.y + hero.h / 2) / T)
      for (let r = bodyTop; r <= bodyMid + 1; r++) {
        if (gSolid(aheadCol, r)) { wallAhead = true; break }
      }

      // Enemy close ahead on roughly same level → jump to stomp/avoid.
      let enemyAhead = false
      for (const e of enemies) {
        if (!e.alive) continue
        const dx = e.x - hero.x
        const dy = Math.abs((e.y + e.h / 2) - (hero.y + hero.h / 2))
        if (dx > 0 && dx < 70 && dy < 30) { enemyAhead = true; break }
      }

      const wantJump = hero.onGround && (pitAhead || wallAhead || enemyAhead)

      // Deliberate sabotage on lose-rounds: skip one jump near the first wide pit.
      if (autoSabotage && !autoSabotageDone && wantJump && pitAhead && hero.x > 280) {
        autoSabotageDone = true
        keys[' '] = false
        autoJumpHold = 0
        return
      }

      if (wantJump) {
        keys[' '] = true
        autoJumpHold = 14   // hold long enough for a near-full jump
      } else if (autoJumpHold > 0) {
        keys[' '] = true
        autoJumpHold -= 1
      } else {
        keys[' '] = false
      }
    }

    function updateHero(dt) {
      if (hero.dead) {
        hero.deadT += dt
        hero.vy += GRAV * dt
        hero.y += hero.vy * dt
        if (hero.deadT > 0.9) loseLife()
        return
      }

      const left = keys.ArrowLeft
      const right = keys.ArrowRight
      const jumpHeld = keys[' '] || keys.Spacebar || keys.ArrowUp

      // horizontal
      if (left && !right) { hero.vx -= RUN_ACC * dt; hero.face = -1 }
      else if (right && !left) { hero.vx += RUN_ACC * dt; hero.face = 1 }
      else {
        // friction toward zero
        if (hero.vx > 0) hero.vx = Math.max(0, hero.vx - FRICTION * dt)
        else if (hero.vx < 0) hero.vx = Math.min(0, hero.vx + FRICTION * dt)
      }
      hero.vx = Math.max(-MAX_RUN, Math.min(MAX_RUN, hero.vx))

      // jump (variable height): start on press while grounded; extra lift while held & rising
      if (jumpHeld && hero.onGround) {
        hero.vy = -JUMP_V
        hero.onGround = false
      }
      if (jumpHeld && hero.vy < 0) {
        hero.vy -= JUMP_HOLD * dt   // counter gravity a bit → higher hold = higher jump
      }

      // gravity
      hero.vy += GRAV * dt
      if (hero.vy > MAX_FALL) hero.vy = MAX_FALL

      // integrate + collide (X then Y)
      hero.x += hero.vx * dt
      collideX(hero)

      hero.y += hero.vy * dt
      const yres = collideY(hero)
      hero.onGround = (yres === 1)
      if (yres >= 2 && yres !== 1) {
        // head bonk: decode tile and bump it
        const code = yres - 2
        const c = Math.floor(code / 65536)
        const r = Math.floor((code % 65536) / 256)
        bumpBlock(c, r)
      }

      // clamp to level left edge
      if (hero.x < 0) { hero.x = 0; if (hero.vx < 0) hero.vx = 0 }

      // coin pickup (walk-through 'C' tiles)
      const hc0 = Math.floor(hero.x / T)
      const hc1 = Math.floor((hero.x + hero.w - 1) / T)
      const hr0 = Math.floor(hero.y / T)
      const hr1 = Math.floor((hero.y + hero.h - 1) / T)
      for (let r = hr0; r <= hr1; r++) {
        for (let c = hc0; c <= hc1; c++) {
          if (gAt(c, r) === 'C') { grid[r][c] = ' '; coins += 1; score += 100; if (coins > best) { best = coins; saveBest() } }
          if (gAt(c, r) === 'F') { winGame(); return }
        }
      }

      // fell into a pit
      if (hero.y > LEVEL_H + 40) {
        hero.dead = true; hero.vy = -200; hero.deadT = 0.6
        return
      }

      hero.anim += Math.abs(hero.vx) * dt * 0.06
    }

    function updateEnemies(dt) {
      for (const e of enemies) {
        if (!e.alive) { e.squashT += dt; continue }
        e.anim += dt * 6
        // gravity
        e.vy += GRAV * dt
        if (e.vy > MAX_FALL) e.vy = MAX_FALL

        // horizontal move + turn at walls/ledges
        e.x += e.vx * dt
        if (collideX(e)) e.vx = -e.vx
        // ledge detection: if no ground ahead under the leading foot, turn around
        const dir = e.vx > 0 ? 1 : -1
        const aheadC = Math.floor((e.x + (dir > 0 ? e.w : 0)) / T)
        const belowR = Math.floor((e.y + e.h + 2) / T)
        if (!gSolid(aheadC, belowR) && e.vy === 0) e.vx = -e.vx

        e.y += e.vy * dt
        collideY(e)

        // collision with hero
        if (!hero.dead && aabb(hero, e)) {
          const heroFootPrev = hero.y + hero.h - hero.vy * dt
          // stomp if hero is falling onto the enemy's upper region
          if (hero.vy > 0 && heroFootPrev <= e.y + e.h * 0.6) {
            e.alive = false; e.squashT = 0
            hero.vy = -JUMP_V * 0.62   // bounce
            score += 200
          } else {
            // side contact: lose a life
            hero.dead = true; hero.vy = -260; hero.deadT = 0
          }
        }
      }
    }

    function aabb(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    }

    // ----- main loop -----
    function frame(now) {
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.045) dt = 0.045   // clamp delta

      if (state === 'playing') {
        if (auto) autoControl(dt)
        updateHero(dt)
        if (state === 'playing') updateEnemies(dt)

        // particles
        for (const p of particles) { p.y += p.vy * dt; p.life -= dt }
        particles = particles.filter(p => p.life > 0)

        // time
        timeLeft -= dt * 0.85
        if (timeLeft <= 0) { timeLeft = 0; if (!hero.dead) { hero.dead = true; hero.vy = -200; hero.deadT = 0.6 } }

        // camera follows hero, clamped to level bounds
        const targetCam = hero.x + hero.w / 2 - W * 0.4
        camX = Math.max(0, Math.min(LEVEL_W - W, targetCam))
      }

      render()
      raf = requestAnimationFrame(frame)
    }

    // ----- rendering -----
    function render() {
      // sky gradient
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, SKY_TOP)
      g.addColorStop(1, SKY_BOT)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)

      drawClouds()
      drawHills()

      ctx.save()
      ctx.translate(-Math.round(camX), 0)
      drawTiles()
      drawParticles()
      drawEnemies()
      if (hero) drawHero()
      ctx.restore()

      drawHUD()
      drawSparkles()

      if (state === 'ready') {
        drawCenter('SUPER LEAP', 'SPACE / TAP TO START', 'RUN, JUMP, STOMP, RAISE THE FLAG')
      } else if (state === 'over') {
        drawCenter('GAME OVER', auto ? '' : 'SPACE / TAP TO RETRY', `COINS ${coins}`)
      } else if (state === 'win') {
        drawCenter('LEVEL CLEAR', auto ? '' : 'SPACE / TAP TO PLAY AGAIN', `SCORE ${score}`)
      }
    }

    function drawClouds() {
      // parallax clouds (slow)
      const off = (camX * 0.3) % 320
      ctx.save()
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      for (let i = -1; i < 4; i++) {
        const bx = i * 320 - off + 60
        cloud(bx, 60)
        cloud(bx + 170, 110)
      }
      ctx.restore()
    }
    function cloud(x, y) {
      ctx.beginPath()
      ctx.arc(x, y, 18, 0, Math.PI * 2)
      ctx.arc(x + 22, y + 4, 22, 0, Math.PI * 2)
      ctx.arc(x + 48, y, 16, 0, Math.PI * 2)
      ctx.rect(x, y, 48, 18)
      ctx.fill()
    }
    function drawHills() {
      const off = (camX * 0.5)
      ctx.save()
      ctx.fillStyle = 'rgba(60,200,90,0.55)'
      for (let i = -1; i < 6; i++) {
        const bx = i * 260 - (off % 260)
        ctx.beginPath()
        ctx.moveTo(bx, H - 64)
        ctx.quadraticCurveTo(bx + 80, H - 150, bx + 160, H - 64)
        ctx.fill()
      }
      ctx.restore()
    }

    function drawTiles() {
      const c0 = Math.max(0, Math.floor(camX / T) - 1)
      const c1 = Math.min(COLS - 1, Math.floor((camX + W) / T) + 1)
      for (let r = 0; r < ROWS; r++) {
        for (let c = c0; c <= c1; c++) {
          const ch = grid[r][c]
          const x = c * T, y = r * T
          if (ch === 'X') drawGround(x, y, c, r)
          else if (ch === 'B') drawBrick(x, y)
          else if (ch === '?') drawQBlock(x, y, true)
          else if (ch === 'U') drawQBlock(x, y, false)
          else if (ch === 'P') drawPipeTop(x, y)
          else if (ch === 'p') drawPipeBody(x, y)
          else if (ch === 'C') drawCoin(x + T / 2, y + T / 2)
          else if (ch === 'F') drawFlag(x, y, r)
          else if (ch === '=') drawFlagBase(x, y)
        }
      }
    }

    function drawGround(x, y, c, r) {
      const topExposed = !gSolid(c, r - 1)
      ctx.fillStyle = GROUND
      ctx.fillRect(x, y, T, T)
      if (topExposed) {
        ctx.fillStyle = GROUND_TOP
        ctx.fillRect(x, y, T, 7)
      }
      // pixel speckles
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(x + 5, y + 14, 4, 4)
      ctx.fillRect(x + 20, y + 22, 4, 4)
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1)
    }
    function drawBrick(x, y) {
      ctx.fillStyle = BRICK
      ctx.fillRect(x, y, T, T)
      ctx.strokeStyle = BRICK_DK
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, T - 2, T - 2)
      ctx.beginPath()
      ctx.moveTo(x, y + T / 2); ctx.lineTo(x + T, y + T / 2)
      ctx.moveTo(x + T / 2, y); ctx.lineTo(x + T / 2, y + T / 2)
      ctx.moveTo(x + T / 4, y + T / 2); ctx.lineTo(x + T / 4, y + T)
      ctx.moveTo(x + 3 * T / 4, y + T / 2); ctx.lineTo(x + 3 * T / 4, y + T)
      ctx.stroke()
    }
    function drawQBlock(x, y, active) {
      ctx.fillStyle = active ? QBLOCK : '#7a5a2a'
      ctx.fillRect(x, y, T, T)
      ctx.strokeStyle = active ? QBLOCK_DK : '#4a3618'
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, T - 2, T - 2)
      // corner rivets
      ctx.fillStyle = active ? '#fff3c0' : '#c9b27a'
      for (const [dx, dy] of [[4, 4], [T - 7, 4], [4, T - 7], [T - 7, T - 7]]) ctx.fillRect(x + dx, y + dy, 3, 3)
      if (active) {
        ctx.fillStyle = '#7a4d00'
        ctx.font = 'bold 20px monospace'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('?', x + T / 2, y + T / 2 + 1)
      }
    }
    function drawPipeTop(x, y) {
      ctx.fillStyle = PIPE
      ctx.fillRect(x - 3, y, T + 6, 12)
      ctx.fillRect(x, y + 12, T, T - 12)
      ctx.fillStyle = PIPE_DK
      ctx.fillRect(x - 3, y, 4, 12)
      ctx.fillRect(x, y + 12, 5, T - 12)
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(x + 6, y + 2, 6, 8)
    }
    function drawPipeBody(x, y) {
      ctx.fillStyle = PIPE
      ctx.fillRect(x, y, T, T)
      ctx.fillStyle = PIPE_DK
      ctx.fillRect(x, y, 5, T)
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.fillRect(x + 9, y, 5, T)
    }
    function drawCoin(cx, cy) {
      const bob = Math.sin(performance.now() / 200 + cx) * 2
      ctx.save()
      ctx.translate(cx, cy + bob)
      ctx.fillStyle = COIN
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 11, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#c99a16'
      ctx.beginPath(); ctx.ellipse(0, 0, 4, 7, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
    function drawFlag(x, y, r) {
      // pole segment
      ctx.fillStyle = '#dfe7ee'
      ctx.fillRect(x + T / 2 - 3, y, 6, T)
      // flag triangle only on the top pole row
      if (r === 8) {
        ctx.fillStyle = PINK
        ctx.beginPath()
        ctx.moveTo(x + T / 2 - 3, y + 4)
        ctx.lineTo(x + T / 2 - 30, y + 12)
        ctx.lineTo(x + T / 2 - 3, y + 20)
        ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#54e346'
        ctx.beginPath(); ctx.arc(x + T / 2, y, 5, 0, Math.PI * 2); ctx.fill()
      }
    }
    function drawFlagBase(x, y) {
      ctx.fillStyle = '#54e346'
      ctx.fillRect(x, y, T, T)
      ctx.strokeStyle = '#138a2b'
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, T - 2, T - 2)
    }

    function drawParticles() {
      ctx.save()
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 2)
        drawCoin(p.x, p.y)
      }
      ctx.globalAlpha = 1
      ctx.restore()
    }

    function drawEnemies() {
      for (const e of enemies) {
        if (!e.alive) {
          if (e.squashT < 0.5) {
            // squashed mushroom
            ctx.fillStyle = '#d23b3b'
            ctx.fillRect(e.x, e.y + e.h - 8, e.w, 8)
          }
          continue
        }
        const wob = Math.sin(e.anim) * 2
        // body (mushroom-ish): rounded cap + stubby feet
        ctx.fillStyle = '#d23b3b'
        ctx.beginPath()
        ctx.arc(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, Math.PI, 0)
        ctx.rect(e.x, e.y + e.h / 2, e.w, e.h / 2)
        ctx.fill()
        // spots
        ctx.fillStyle = '#ffe2e2'
        ctx.beginPath(); ctx.arc(e.x + 8, e.y + 9, 3, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(e.x + e.w - 8, e.y + 9, 3, 0, Math.PI * 2); ctx.fill()
        // feet
        ctx.fillStyle = '#f4d6a0'
        ctx.fillRect(e.x + 2, e.y + e.h - 4 + wob, 7, 4)
        ctx.fillRect(e.x + e.w - 9, e.y + e.h - 4 - wob, 7, 4)
        // eyes
        ctx.fillStyle = '#fff'
        ctx.fillRect(e.x + 6, e.y + e.h / 2, 4, 6)
        ctx.fillRect(e.x + e.w - 10, e.y + e.h / 2, 4, 6)
        ctx.fillStyle = '#222'
        ctx.fillRect(e.x + 8, e.y + e.h / 2 + 1, 2, 3)
        ctx.fillRect(e.x + e.w - 8, e.y + e.h / 2 + 1, 2, 3)
      }
    }

    function drawHero() {
      const x = hero.x, y = hero.y, w = hero.w, h = hero.h
      ctx.save()
      // flip for facing
      if (hero.face < 0) { ctx.translate(x + w, 0); ctx.scale(-1, 1); ctx.translate(-x, 0) }
      const stride = hero.onGround ? Math.sin(hero.anim) * 3 : 4

      // legs (blue overalls)
      ctx.fillStyle = '#2b4cd8'
      ctx.fillRect(x + 3, y + h - 9 + stride, 6, 9)
      ctx.fillRect(x + w - 9, y + h - 9 - stride, 6, 9)
      // shoes
      ctx.fillStyle = '#5a3414'
      ctx.fillRect(x + 2, y + h - 3 + stride, 8, 3)
      ctx.fillRect(x + w - 10, y + h - 3 - stride, 8, 3)
      // body / overalls
      ctx.fillStyle = '#2b4cd8'
      ctx.fillRect(x + 2, y + 12, w - 4, h - 18)
      // red shirt arms/torso top
      ctx.fillStyle = '#e23b3b'
      ctx.fillRect(x + 2, y + 11, w - 4, 6)
      ctx.fillRect(x, y + 13, 4, 8)         // arm
      ctx.fillRect(x + w - 4, y + 13, 4, 8) // arm
      // overall straps
      ctx.fillStyle = '#1e3699'
      ctx.fillRect(x + 6, y + 12, 3, 8)
      ctx.fillRect(x + w - 9, y + 12, 3, 8)
      // face / skin
      ctx.fillStyle = '#f4c79a'
      ctx.fillRect(x + 4, y + 4, w - 8, 9)
      // hat (red cap with brim)
      ctx.fillStyle = '#e23b3b'
      ctx.fillRect(x + 3, y, w - 6, 5)
      ctx.fillRect(x + w - 9, y + 3, 8, 3) // brim
      // eye + mustache
      ctx.fillStyle = '#222'
      ctx.fillRect(x + w - 10, y + 6, 2, 3)       // eye
      ctx.fillStyle = '#3a2410'
      ctx.fillRect(x + w - 12, y + 10, 8, 2)      // mustache
      ctx.restore()
    }

    function fmtTime(t) { return String(Math.ceil(t)).padStart(3, '0') }

    function drawHUD() {
      ctx.save()
      ctx.fillStyle = PINK
      ctx.font = 'bold 15px monospace'
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      const items = [
        ['SCORE', String(score).padStart(6, '0')],
        ['COINS', '×' + String(coins).padStart(2, '0')],
        ['WORLD', '1-1'],
        ['TIME', fmtTime(timeLeft)],
      ]
      let x = 14
      for (const [label, val] of items) {
        const txt = label
        ctx.fillStyle = PINK
        ctx.fillText(txt, x, 10)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 15px monospace'
        ctx.fillText(val, x, 26)
        ctx.fillStyle = PINK
        const wlab = ctx.measureText(txt).width
        ctx.fillRect(x, 25, Math.max(wlab, ctx.measureText(val).width), 2)
        x += Math.max(72, ctx.measureText(txt).width + 30)
      }
      // lives top-right
      ctx.textAlign = 'right'
      ctx.fillStyle = PINK
      ctx.fillText('LIVES', W - 14, 10)
      ctx.fillStyle = '#fff'
      ctx.fillText('×' + lives, W - 14, 26)
      ctx.fillStyle = PINK
      ctx.fillRect(W - 14 - 36, 25, 36, 2)

      ctx.textAlign = 'left'
      if (auto) {
        ctx.fillStyle = 'rgba(255,45,111,0.75)'
        ctx.font = 'bold 11px monospace'
        ctx.fillText('AUTOPLAY', 14, H - 20)
      }
      ctx.fillStyle = 'rgba(255,45,111,0.6)'
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'right'
      ctx.fillText('BEST ×' + best, W - 14, H - 20)
      ctx.restore()
    }

    function drawCenter(big, sub, sub2) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(0,0,0,0.32)'
      ctx.fillRect(0, H / 2 - 60, W, 120)
      ctx.fillStyle = PINK
      ctx.shadowColor = PINK
      ctx.shadowBlur = 16
      ctx.font = 'bold 42px monospace'
      ctx.fillText(big, W / 2, H / 2 - 14)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 14px monospace'
      if (sub) ctx.fillText(sub, W / 2, H / 2 + 22)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = '12px monospace'
      if (sub2) ctx.fillText(sub2, W / 2, H / 2 + 44)
      ctx.restore()
    }

    function drawSparkles() {
      ctx.save()
      ctx.fillStyle = PINK
      ctx.font = 'bold 18px monospace'
      ctx.shadowColor = PINK
      ctx.shadowBlur = 8
      const m = 8
      ctx.fillText('+', m, m + 16)
      ctx.fillText('+', W - m - 12, m + 16)
      ctx.fillText('+', m, H - m - 2)
      ctx.fillText('+', W - m - 12, H - m - 2)
      ctx.restore()
    }

    // ----- boot -----
    resetRun(true)
    state = 'ready'
    if (auto) autoTimer = setTimeout(() => { startGame() }, 700)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(autoTimer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="superleap-canvas"
      aria-label="Platform adventure game"
    />
  )
}
