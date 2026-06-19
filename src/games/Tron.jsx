import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Tron Light Cycles on canvas, 10x neon style.
// Two cycles leave solid trails on a grid. Steer with turns only; can't reverse.
// P1 = pink (WASD), P2 = cyan (arrows). Crash into a wall or any trail = you lose.
// Head-on into the same cell = draw. Press A to make P2 a simple AI.
const CELL = 12
const COLS = 50
const ROWS = 50
const W = COLS * CELL // 600
const H = ROWS * CELL // 600
const STEP_MS = 55 // grid step interval
const ROUND_OVER_PAUSE = 900 // ms before next round can start

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const BEST_KEY = '10xgames.tron.best'

// directions: dx, dy. Opposite check prevents reversing.
const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}
const isOpposite = (a, b) => DIRS[a].x === -DIRS[b].x && DIRS[a].y === -DIRS[b].y

export default function Tron() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const auto = isAutoplay('tron')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    // autoplay self-play state
    let autoWantWin = false   // does P1 try to win this round?
    let autoNextAt = 0        // perf timestamp at which to advance to the next round

    // grid[y][x] = 0 empty, 1 = p1 trail, 2 = p2 trail
    let grid
    let p1, p2
    let state // 'ready' | 'playing' | 'round-over'
    let scoreP1 = 0, scoreP2 = 0
    let streak = 0 // current consecutive-win streak of the streak owner
    let streakOwner = null // 'P1' | 'P2' | null
    let aiOn = false
    let resultText = ''
    let acc = 0
    let last = performance.now()
    let roundOverAt = 0
    let raf = 0

    let best = 0
    try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0 } catch { best = 0 }

    function saveBest() {
      if (streak > best) {
        best = streak
        try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* ignore */ }
      }
    }

    function newGrid() {
      grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0))
    }

    function resetRound() {
      newGrid()
      const midY = Math.floor(ROWS / 2)
      p1 = { x: 8, y: midY, dir: 'right', next: 'right' }
      p2 = { x: COLS - 9, y: midY, dir: 'left', next: 'left' }
      grid[p1.y][p1.x] = 1
      grid[p2.y][p2.x] = 2
      resultText = ''
      state = 'ready'
    }

    function resetMatch() {
      scoreP1 = 0; scoreP2 = 0; streak = 0; streakOwner = null
      resetRound()
    }

    function startRound() {
      if (state === 'ready') { state = 'playing'; acc = 0 }
    }

    function turn(player, dir) {
      if (isOpposite(dir, player.dir)) return
      player.next = dir
    }

    // ---------- AI for P2 ----------
    function cellBlocked(x, y) {
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true
      return grid[y][x] !== 0
    }

    // count open cells reachable in a few steps (flood-fill cap) — rough open-space heuristic
    function openness(x, y, cap) {
      if (cellBlocked(x, y)) return 0
      const seen = new Set()
      const stack = [[x, y]]
      let count = 0
      while (stack.length && count < cap) {
        const [cx, cy] = stack.pop()
        const key = cy * COLS + cx
        if (seen.has(key)) continue
        seen.add(key)
        if (cellBlocked(cx, cy)) continue
        count++
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
      }
      return count
    }

    // Steer any player with the openness/avoidance heuristic.
    // strong=true: full lookahead (tends to survive/win).
    // strong=false: shallow lookahead + occasional bad turn (crashes sooner / loses).
    function aiSteer(player, strong) {
      const cur = player.dir
      const candidates = ['up', 'down', 'left', 'right'].filter(
        (d) => !isOpposite(d, cur)
      )

      // sloppy bot: sometimes make a deliberately random (possibly bad) turn.
      // Skip if going straight is unsafe so the bad turn doesn't get masked.
      if (!strong && Math.random() < 0.22) {
        const safeRandom = candidates.filter((d) => {
          if (d === cur) return false
          return !cellBlocked(player.x + DIRS[d].x, player.y + DIRS[d].y)
        })
        if (safeRandom.length) {
          turn(player, safeRandom[Math.floor(Math.random() * safeRandom.length)])
          return
        }
      }

      const cap = strong ? 160 : 8 // weaker lookahead = poorer survival
      // Strong bot keeps going straight unless turning is clearly better, so it
      // glides smoothly instead of zig-zagging. Weak bot has no such inertia.
      const straightBonus = strong ? 14 : 1
      let bestDir = cur
      let bestScore = -1
      for (const d of candidates) {
        const nx = player.x + DIRS[d].x
        const ny = player.y + DIRS[d].y
        if (cellBlocked(nx, ny)) continue
        // prefer the move that leaves the most open space; bonus to keep going straight
        let score = openness(nx, ny, cap)
        if (d === cur) score += straightBonus
        if (score > bestScore) { bestScore = score; bestDir = d }
      }
      turn(player, bestDir)
    }

    function aiChoose() {
      aiSteer(p2, true)
    }

    function stepPlayer(player) {
      player.dir = player.next
      return { x: player.x + DIRS[player.dir].x, y: player.y + DIRS[player.dir].y }
    }

    function crashes(pos) {
      if (pos.x < 0 || pos.x >= COLS || pos.y < 0 || pos.y >= ROWS) return true
      return grid[pos.y][pos.x] !== 0
    }

    function tick() {
      if (auto) {
        // P1 wants to win this round -> P1 strong, P2 sloppy. Otherwise reversed.
        aiSteer(p1, autoWantWin)
        aiSteer(p2, !autoWantWin)
      } else if (aiOn) {
        aiChoose()
      }

      const n1 = stepPlayer(p1)
      const n2 = stepPlayer(p2)

      const headOn = n1.x === n2.x && n1.y === n2.y
      const c1 = crashes(n1)
      const c2 = crashes(n2)

      if (headOn) { endRound('DRAW'); return }
      if (c1 && c2) { endRound('DRAW'); return }
      if (c1) { endRound('P2'); return }
      if (c2) { endRound('P1'); return }

      // both safe — commit
      p1.x = n1.x; p1.y = n1.y; grid[p1.y][p1.x] = 1
      p2.x = n2.x; p2.y = n2.y; grid[p2.y][p2.x] = 2
    }

    function endRound(winner) {
      // P1 won only if P1 survived (P2 crashed); a draw counts as not won.
      if (auto) recordAutoplayResult('tron', winner === 'P1')
      if (winner === 'P1') { scoreP1++; resultText = 'P1 WINS' }
      else if (winner === 'P2') { scoreP2++; resultText = 'P2 WINS' }
      else { resultText = 'DRAW' }

      // streak = consecutive wins by the same player; resets on draw or change of winner
      if (winner === 'DRAW') { streak = 0; streakOwner = null }
      else if (winner === streakOwner) { streak++ }
      else { streakOwner = winner; streak = 1 }

      state = 'round-over'
      roundOverAt = performance.now()
      saveBest()
    }

    // ---------- input ----------
    function onKeyDown(e) {
      const k = e.code

      if (k === 'KeyA' && !e.repeat) {
        // toggle AI only between rounds / ready to avoid mid-round confusion
        if (state !== 'playing') { aiOn = !aiOn }
        e.preventDefault()
        return
      }

      if (k === 'Space') {
        e.preventDefault()
        if (state === 'ready') startRound()
        else if (state === 'round-over' && performance.now() - roundOverAt >= ROUND_OVER_PAUSE) {
          resetRound()
        }
        return
      }

      // P1 — WASD
      if (k === 'KeyW') { turn(p1, 'up'); e.preventDefault(); return }
      if (k === 'KeyS') { turn(p1, 'down'); e.preventDefault(); return }
      if (k === 'KeyA') { turn(p1, 'left'); e.preventDefault(); return } // (KeyA handled above when not playing)
      if (k === 'KeyD') { turn(p1, 'right'); e.preventDefault(); return }

      // P2 — arrows (only when human)
      if (k === 'ArrowUp') { if (!aiOn) turn(p2, 'up'); e.preventDefault(); return }
      if (k === 'ArrowDown') { if (!aiOn) turn(p2, 'down'); e.preventDefault(); return }
      if (k === 'ArrowLeft') { if (!aiOn) turn(p2, 'left'); e.preventDefault(); return }
      if (k === 'ArrowRight') { if (!aiOn) turn(p2, 'right'); e.preventDefault(); return }
    }

    function onPointer() {
      if (state === 'ready') startRound()
      else if (state === 'round-over' && performance.now() - roundOverAt >= ROUND_OVER_PAUSE) {
        resetRound()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function drawGridLines() {
      ctx.strokeStyle = 'rgba(45,226,230,0.06)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= COLS; x++) {
        ctx.moveTo(x * CELL + 0.5, 0)
        ctx.lineTo(x * CELL + 0.5, H)
      }
      for (let y = 0; y <= ROWS; y++) {
        ctx.moveTo(0, y * CELL + 0.5)
        ctx.lineTo(W, y * CELL + 0.5)
      }
      ctx.stroke()
    }

    function drawTrails() {
      // pink trail
      ctx.shadowColor = PINK; ctx.shadowBlur = 8
      ctx.fillStyle = PINK
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (grid[y][x] === 1) ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
        }
      }
      // cyan trail
      ctx.shadowColor = CYAN
      ctx.fillStyle = CYAN
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (grid[y][x] === 2) ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
        }
      }
      ctx.shadowBlur = 0
    }

    function head(player, color) {
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 14
      ctx.fillStyle = '#fff'
      ctx.fillRect(player.x * CELL + 2, player.y * CELL + 2, CELL - 4, CELL - 4)
      ctx.shadowColor = color; ctx.shadowBlur = 10
      ctx.fillStyle = color
      ctx.fillRect(player.x * CELL + 3, player.y * CELL + 3, CELL - 6, CELL - 6)
      ctx.shadowBlur = 0
    }

    function drawHUD() {
      ctx.textAlign = 'left'
      // P1
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('P1', 14, 22)
      ctx.fillStyle = '#fff'; ctx.font = '800 22px system-ui, sans-serif'
      ctx.fillText(String(scoreP1), 14, 44)

      // P2 (right)
      ctx.textAlign = 'right'
      ctx.fillStyle = CYAN; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText(aiOn ? 'P2 (AI)' : 'P2', W - 14, 22)
      ctx.fillStyle = '#fff'; ctx.font = '800 22px system-ui, sans-serif'
      ctx.fillText(String(scoreP2), W - 14, 44)

      // BEST (center top)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#8a93ad'; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('BEST STREAK', W / 2, 22)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(best), W / 2, 44)

      // controls hint
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillText(
        'P1: W A S D      ' + (aiOn ? 'P2: AI' : 'P2: arrows') + '      A: toggle AI',
        W / 2,
        H - 12
      )
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.78)'
      ctx.fillRect(0, H / 2 - 70, W, 140)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 44px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 70, H / 2 + 12, 140, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 42)
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      drawGridLines()
      sparkle(30, 64, 5)
      sparkle(W - 30, H - 30, 4)

      drawTrails()
      head(p1, PINK)
      head(p2, CYAN)

      drawHUD()

      if (state === 'ready') {
        overlay('TRON', 'space / tap to start')
      } else if (state === 'round-over') {
        const canContinue = performance.now() - roundOverAt >= ROUND_OVER_PAUSE
        overlay(resultText, canContinue ? 'space / tap for next round' : '...')
      }
    }

    // autoplay round lifecycle: auto-start ready rounds, auto-advance after round-over.
    function autoDrive(now) {
      if (state === 'ready') {
        autoWantWin = shouldAutoWin('tron') // self-corrects toward ~95% P1 wins
        startRound()
      } else if (state === 'round-over') {
        if (!autoNextAt) autoNextAt = now + 1300
        else if (now >= autoNextAt) { autoNextAt = 0; resetRound() }
      }
    }

    function loop(now) {
      let dt = now - last
      last = now
      if (dt > 200) dt = 200

      if (auto) {
        aiOn = true // P2 is the AI in autoplay
        autoDrive(now)
      }

      if (state === 'playing') {
        acc += dt
        while (acc >= STEP_MS) {
          acc -= STEP_MS
          if (state === 'playing') tick()
        }
      }

      draw()
      raf = requestAnimationFrame(loop)
    }

    resetMatch()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="tron-canvas"
      aria-label="Tron light cycles game"
    />
  )
}
