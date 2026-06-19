import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Breakout on canvas, 10x neon style. Paddle + bouncing ball + brick wall.
const W = 480
const H = 560
const PADDLE_W = 88
const PADDLE_H = 12
const PADDLE_Y = H - 40
const PADDLE_SPEED = 460   // px/s (keyboard)
const BALL_R = 7
const BALL_SPEED = 280     // px/s at launch
const SPEEDUP = 1.00012    // gentle creep per frame while playing
const MAX_SPEED = 520

const COLS = 8
const ROWS = 5
const BRICK_GAP = 6
const WALL_TOP = 70
const WALL_SIDE = 16
const BRICK_W = (W - WALL_SIDE * 2 - BRICK_GAP * (COLS - 1)) / COLS
const BRICK_H = 20

const PINK = '#ff2d6f'
const MUTED = '#8a93ad'
const ROW_COLORS = ['#ff2d6f', '#b14aed', '#4d7cff', '#2de2e6', '#ffd60a']

const BEST_KEY = '10xgames.breakout.best'

export default function Breakout() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('breakout')

    let paddleX, ball, bricks, score, lives, level, state, best
    const keys = { left: false, right: false }
    let last = performance.now(), raf = 0

    // ---------- autoplay bot ----------
    let wantWin = shouldAutoWin('breakout')
    let clearedAWall = false            // win = advanced to level >= 2, or score >= 300
    let recorded = false                // guard recordAutoplayResult to once per session
    let restartAt = 0
    function newRound() {
      wantWin = shouldAutoWin('breakout')
      clearedAWall = false
      recorded = false
    }
    // Predict where the ball crosses the paddle line, accounting for side-wall bounces.
    function predictBallX() {
      if (ball.vy <= 0) return ball.x   // moving up: just hover under it
      const targetY = PADDLE_Y - BALL_R - 1
      const t = (targetY - ball.y) / ball.vy
      if (t <= 0) return ball.x
      // reflect predicted x off the side walls into [BALL_R, W-BALL_R]
      let x = ball.x + ball.vx * t
      const span = W - 2 * BALL_R
      let m = (x - BALL_R) % (2 * span)
      if (m < 0) m += 2 * span
      if (m > span) m = 2 * span - m
      return BALL_R + m
    }
    function botUpdate(dt, now) {
      if (state === 'ready') { launch(); return }
      if (state === 'over') {
        if (!restartAt) restartAt = now + 1300
        else if (now >= restartAt) { restartAt = 0; newGame(); newRound() }
        return
      }
      if (state !== 'playing') return
      // Smooth proportional motion toward the target paddle center, capped speed, no jitter.
      // win: aim at predicted impact x so the ball is almost never dropped.
      // lose (~5%): aim away so all lives drain early.
      const target = wantWin
        ? predictBallX()
        : ball.x + Math.sin(now / 240) * (PADDLE_W * 1.1) + 40
      const center = paddleX + PADDLE_W / 2
      const ease = wantWin ? 0.4 : 0.16   // proportional follow, no overshoot
      let next = center + (target - center) * ease
      const maxStep = (wantWin ? PADDLE_SPEED : PADDLE_SPEED * 0.55) * dt
      next = Math.max(center - maxStep, Math.min(center + maxStep, next))
      paddleX = Math.max(0, Math.min(W - PADDLE_W, next - PADDLE_W / 2))
    }

    best = Number(localStorage.getItem(BEST_KEY)) || 0

    function makeBricks() {
      const arr = []
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          arr.push({
            x: WALL_SIDE + c * (BRICK_W + BRICK_GAP),
            y: WALL_TOP + r * (BRICK_H + BRICK_GAP),
            color: ROW_COLORS[r % ROW_COLORS.length],
            alive: true,
          })
        }
      }
      return arr
    }

    function resetBall() {
      paddleX = W / 2 - PADDLE_W / 2
      ball = { x: W / 2, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, speed: BALL_SPEED }
      state = 'ready'
    }

    function newGame() {
      score = 0
      lives = 3
      level = 1
      bricks = makeBricks()
      resetBall()
    }

    function launch() {
      const angle = (Math.random() * 0.5 - 0.25) * Math.PI // -45°..45°
      ball.vx = ball.speed * Math.sin(angle)
      ball.vy = -ball.speed * Math.cos(angle)
      state = 'playing'
    }

    function loseLife() {
      lives--
      if (lives <= 0) {
        state = 'over'
        if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
        if (auto && !recorded) {
          recorded = true
          recordAutoplayResult('breakout', clearedAWall || score >= 300)
        }
      } else {
        resetBall()
      }
    }

    function nextLevel() {
      level++
      bricks = makeBricks()
      resetBall()
    }

    function update(dt) {
      // paddle keyboard
      if (keys.left) paddleX -= PADDLE_SPEED * dt
      if (keys.right) paddleX += PADDLE_SPEED * dt
      paddleX = Math.max(0, Math.min(W - PADDLE_W, paddleX))

      if (state === 'ready') {
        ball.x = paddleX + PADDLE_W / 2
        ball.y = PADDLE_Y - BALL_R - 1
        return
      }
      if (state !== 'playing') return

      // speed creep
      ball.speed = Math.min(MAX_SPEED, ball.speed * Math.pow(SPEEDUP, dt * 60))
      const sp = Math.hypot(ball.vx, ball.vy) || 1
      ball.vx = ball.vx / sp * ball.speed
      ball.vy = ball.vy / sp * ball.speed

      ball.x += ball.vx * dt
      ball.y += ball.vy * dt

      // walls
      if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx) }
      if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx) }
      if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy) }

      // below paddle -> lose life
      if (ball.y - BALL_R > H) { loseLife(); return }

      // paddle collision
      if (ball.vy > 0 &&
          ball.y + BALL_R >= PADDLE_Y && ball.y - BALL_R <= PADDLE_Y + PADDLE_H &&
          ball.x >= paddleX - BALL_R && ball.x <= paddleX + PADDLE_W + BALL_R) {
        const rel = (ball.x - (paddleX + PADDLE_W / 2)) / (PADDLE_W / 2) // -1..1
        const angle = rel * (Math.PI * 0.42) // up to ~75°
        ball.vx = ball.speed * Math.sin(angle)
        ball.vy = -ball.speed * Math.cos(angle)
        ball.y = PADDLE_Y - BALL_R - 1
      }

      // brick collisions
      for (const b of bricks) {
        if (!b.alive) continue
        if (ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + BRICK_W &&
            ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + BRICK_H) {
          b.alive = false
          score++
          // pick bounce axis by smallest overlap
          const overlapX = Math.min(ball.x + BALL_R - b.x, b.x + BRICK_W - (ball.x - BALL_R))
          const overlapY = Math.min(ball.y + BALL_R - b.y, b.y + BRICK_H - (ball.y - BALL_R))
          if (overlapX < overlapY) ball.vx = -ball.vx
          else ball.vy = -ball.vy
          break
        }
      }

      // win check
      if (bricks.every((b) => !b.alive)) {
        if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
        clearedAWall = true   // cleared the wall -> this autoplay session counts as a win
        nextLevel()
      }
    }

    // ---------- input ----------
    function onKeyDown(e) {
      const k = e.code
      if (k === 'ArrowLeft') { keys.left = true; e.preventDefault() }
      else if (k === 'ArrowRight') { keys.right = true; e.preventDefault() }
      else if (k === 'Space') {
        e.preventDefault()
        if (state === 'ready') launch()
        else if (state === 'over') newGame()
      }
    }
    function onKeyUp(e) {
      if (e.code === 'ArrowLeft') keys.left = false
      else if (e.code === 'ArrowRight') keys.right = false
    }
    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      paddleX = Math.max(0, Math.min(W - PADDLE_W, x - PADDLE_W / 2))
    }
    function onPointerDown() {
      if (state === 'ready') launch()
      else if (state === 'over') newGame()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
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
    function label(x, y, text, value) {
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText(text, x, y)
      ctx.fillRect(x, y + 4, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(value), x, y + 28)
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(26, 28, 5); sparkle(W - 26, H - 26, 4)

      // HUD
      label(16, 26, 'SCORE', score)
      ctx.textAlign = 'center'
      label(W / 2 - 18, 26, 'LIVES', lives)
      ctx.textAlign = 'right'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('BEST', W - 16, 26)
      ctx.fillRect(W - 38, 30, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(best), W - 16, 54)

      // bricks
      for (const b of bricks) {
        if (!b.alive) continue
        ctx.shadowColor = b.color; ctx.shadowBlur = 12
        ctx.fillStyle = b.color
        roundRect(b.x, b.y, BRICK_W, BRICK_H, 4); ctx.fill()
      }
      ctx.shadowBlur = 0

      // paddle
      ctx.shadowColor = PINK; ctx.shadowBlur = 16
      ctx.fillStyle = PINK
      roundRect(paddleX, PADDLE_Y, PADDLE_W, PADDLE_H, 6); ctx.fill()
      ctx.shadowBlur = 0

      // ball
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 16
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 0

      // level hint
      ctx.fillStyle = MUTED; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('LEVEL ' + level + '   ·   ← →  /  move mouse', W / 2, H - 14)

      if (state === 'ready') overlay('BREAKOUT', 'space / tap to launch')
      else if (state === 'over') overlay('GAME OVER', 'space / tap to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.78)'; ctx.fillRect(0, H / 2 - 70, W, 140)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 40px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 64, H / 2 + 12, 128, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 42)
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      if (auto) botUpdate(dt, now)
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
    <canvas ref={canvasRef} width={W} height={H} className="breakout-canvas" aria-label="Breakout game" />
  )
}
