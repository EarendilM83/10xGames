import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Classic Snake on canvas, 10x neon-on-black style.
const GRID = 20
const CELL = 24
const PAD = 16
const HEADER = 40
const GAP = 8
const PLAY = GRID * CELL
const PLAY_X = PAD
const PLAY_Y = PAD + HEADER + GAP
const W = PAD * 2 + PLAY
const H = PLAY_Y + PLAY + PAD

const PINK = '#ff2d6f'
const FOOD = '#2de2e6'

const STEP_START = 140 // ms per move
const STEP_MIN = 70
const HS_KEY = '10xgames.snake.best'

export default function Snake() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('snake')

    let snake, dir, pendingDir, food, score, step, state, best
    best = Number(localStorage.getItem(HS_KEY)) || 0
    let acc = 0, last = performance.now(), raf = 0
    // autoplay round state
    let wantWin = true, restartAt = 0

    function reset() {
      snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }]
      dir = { x: 1, y: 0 }
      pendingDir = dir
      score = 0
      step = STEP_START
      state = 'ready'
      placeFood()
    }

    function placeFood() {
      let f
      do {
        f = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) }
      } while (snake.some((s) => s.x === f.x && s.y === f.y))
      food = f
    }

    function tick() {
      dir = pendingDir
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
      // wall collision
      if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) { return gameOver() }
      const willGrow = head.x === food.x && head.y === food.y
      // self collision (the tail vacates unless we grow)
      const hitsBody = snake.some((s, i) =>
        s.x === head.x && s.y === head.y && !(i === snake.length - 1 && !willGrow))
      if (hitsBody) return gameOver()

      snake.unshift(head)
      if (willGrow) {
        score++
        if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
        step = Math.max(STEP_MIN, STEP_START - score * 4)
        placeFood()
      } else {
        snake.pop()
      }
    }

    function gameOver() {
      state = 'over'
      if (auto) recordAutoplayResult('snake', score >= 18)
    }

    // ---------- input ----------
    function setDir(x, y) {
      // ignore 180° reversal
      if (x === -dir.x && y === -dir.y) return
      pendingDir = { x, y }
    }
    // ---------- autoplay bot ----------
    // Drives the snake through the game's own setDir/pendingDir, inside the step loop.
    const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
    function isSafe(head, d) {
      const nx = head.x + d.x, ny = head.y + d.y
      if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) return false
      const willGrow = nx === food.x && ny === food.y
      // tail vacates next move unless we grow
      return !snake.some((s, i) =>
        s.x === nx && s.y === ny && !(i === snake.length - 1 && !willGrow))
    }
    // Flood-fill: count reachable open cells from (sx,sy), treating the snake body
    // (minus its tail, which vacates) as walls. More reachable space = less risk of trapping.
    function openSpace(sx, sy) {
      if (sx < 0 || sx >= GRID || sy < 0 || sy >= GRID) return 0
      const blocked = new Set()
      for (let i = 0; i < snake.length - 1; i++) blocked.add(snake[i].x + ',' + snake[i].y)
      const start = sx + ',' + sy
      if (blocked.has(start)) return 0
      const seen = new Set([start])
      const stack = [[sx, sy]]
      let count = 0
      while (stack.length) {
        const [cx, cy] = stack.pop()
        count++
        for (const d of DIRS) {
          const nx = cx + d.x, ny = cy + d.y
          if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue
          const k = nx + ',' + ny
          if (seen.has(k) || blocked.has(k)) continue
          seen.add(k)
          stack.push([nx, ny])
        }
      }
      return count
    }
    function botStep() {
      const head = snake[0]
      // non-reversing candidate directions
      const cand = DIRS.filter((d) => !(d.x === -dir.x && d.y === -dir.y))
      const safe = cand.filter((d) => isSafe(head, d))
      const dist = (d) => Math.abs(head.x + d.x - food.x) + Math.abs(head.y + d.y - food.y)

      let pick
      if (wantWin) {
        // Smooth, survival-first bot: among safe moves, prefer ones that keep the most
        // open space (flood-fill), breaking ties by moving toward the food. This avoids
        // self-trapping and erratic backtracking, so it survives long, clean runs.
        const pool = safe.length ? safe : cand
        const space = (d) => openSpace(head.x + d.x, head.y + d.y)
        pick = pool.slice().sort((a, b) => {
          const sd = space(b) - space(a)
          if (sd !== 0) return sd
          if (dist(a) !== dist(b)) return dist(a) - dist(b)
          // tie-break toward keeping current heading -> fewer twitchy turns
          const ka = (a.x === dir.x && a.y === dir.y) ? 0 : 1
          const kb = (b.x === dir.x && b.y === dir.y) ? 0 : 1
          return ka - kb
        })[0]
      } else {
        // sloppy round: often a random/unsafe move so it dies early
        if (Math.random() < 0.55) pick = cand[Math.floor(Math.random() * cand.length)]
        else pick = (safe.length ? safe : cand).sort((a, b) => dist(a) - dist(b))[0]
      }
      // Only change direction when needed — keep heading if it's already the pick.
      if (pick && !(pick.x === dir.x && pick.y === dir.y)) setDir(pick.x, pick.y)
    }
    function onKey(e) {
      if (auto) return
      const k = e.code
      if (state === 'over') {
        if (['Space', 'Enter', 'KeyR'].includes(k)) { e.preventDefault(); reset() }
        return
      }
      if (k === 'KeyP') { if (!e.repeat) state = state === 'paused' ? 'playing' : 'paused'; return }
      let moved = true
      if (k === 'ArrowUp' || k === 'KeyW') setDir(0, -1)
      else if (k === 'ArrowDown' || k === 'KeyS') setDir(0, 1)
      else if (k === 'ArrowLeft' || k === 'KeyA') setDir(-1, 0)
      else if (k === 'ArrowRight' || k === 'KeyD') setDir(1, 0)
      else moved = false
      if (moved) {
        e.preventDefault()
        if (state === 'ready') { state = 'playing'; last = performance.now(); acc = 0 }
      }
    }
    function onPointer() { if (auto) return; if (state === 'over') reset() }
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function cell(gx, gy, color, inset = 2, glow = 0) {
      const x = PLAY_X + gx * CELL, y = PLAY_Y + gy * CELL
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow }
      ctx.fillStyle = color
      roundRect(x + inset, y + inset, CELL - inset * 2, CELL - inset * 2, 5)
      ctx.fill()
      ctx.shadowBlur = 0
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 26, 22, 5); sparkle(26, H - 26, 4)

      // header: SCORE + BEST
      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('SCORE', PAD, PAD + 12); ctx.fillRect(PAD, PAD + 17, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 24px system-ui, sans-serif'
      ctx.fillText(String(score), PAD + 60, PAD + 18)
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'right'
      ctx.fillText('BEST  ' + best, W - PAD, PAD + 16)

      // playfield bg + grid
      ctx.fillStyle = '#101016'; ctx.fillRect(PLAY_X, PLAY_Y, PLAY, PLAY)
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1
      for (let i = 1; i < GRID; i++) {
        ctx.beginPath(); ctx.moveTo(PLAY_X + i * CELL, PLAY_Y); ctx.lineTo(PLAY_X + i * CELL, PLAY_Y + PLAY); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(PLAY_X, PLAY_Y + i * CELL); ctx.lineTo(PLAY_X + PLAY, PLAY_Y + i * CELL); ctx.stroke()
      }

      // food (pulsing glow)
      cell(food.x, food.y, FOOD, 4, 14)

      // snake — head brightest, body fades toward tail
      for (let i = snake.length - 1; i >= 0; i--) {
        const s = snake[i]
        if (i === 0) cell(s.x, s.y, PINK, 1, 12)
        else {
          const t = 1 - i / (snake.length + 4)
          cell(s.x, s.y, `rgba(255,45,111,${0.45 + t * 0.5})`, 2)
        }
      }

      // frame
      ctx.strokeStyle = PINK; ctx.lineWidth = 2; ctx.strokeRect(PLAY_X - 1, PLAY_Y - 1, PLAY + 2, PLAY + 2)

      if (state === 'ready') overlay('SNAKE', 'arrow keys / WASD to start')
      else if (state === 'paused') overlay('PAUSED', 'press P to resume')
      else if (state === 'over') overlay('GAME OVER', 'tap / space to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.8)'; ctx.fillRect(PLAY_X, PLAY_Y, PLAY, PLAY)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 34px system-ui, sans-serif'
      ctx.fillText(title, PLAY_X + PLAY / 2, PLAY_Y + PLAY / 2 - 6)
      ctx.fillStyle = PINK; ctx.fillRect(PLAY_X + PLAY / 2 - 55, PLAY_Y + PLAY / 2 + 6, 110, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, PLAY_X + PLAY / 2, PLAY_Y + PLAY / 2 + 36)
    }

    function newRound() {
      reset()
      wantWin = shouldAutoWin('snake')
      // good rounds run a touch faster (longer, higher-score look); sloppy a touch slower
      step = wantWin ? STEP_START : STEP_START + 30
    }

    function loop(now) {
      const dt = now - last; last = now
      if (auto) {
        if (state === 'ready') { state = 'playing'; acc = 0 }
        else if (state === 'over') {
          if (!restartAt) restartAt = now + 1300
          else if (now >= restartAt) { restartAt = 0; newRound(); state = 'playing'; acc = 0 }
        }
      }
      if (state === 'playing') {
        acc += dt
        if (acc >= step) { acc -= step; if (auto) botStep(); tick() }
      }
      draw()
      raf = requestAnimationFrame(loop)
    }

    if (auto) newRound(); else reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="snake-canvas" aria-label="Snake game" />
  )
}
