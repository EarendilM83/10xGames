import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Pong on canvas, 10x neon style. Solo vs AI (default) or 2-player head-to-head.
const W = 640
const H = 400
const PADDLE_W = 12
const PADDLE_H = 74
const MARGIN = 24
const PADDLE_SPEED = 380   // px/s
const AI_SPEED = 300       // px/s (beatable)
const BALL_R = 8
const BALL_SPEED = 300
const SPEEDUP = 1.04
const WIN_SCORE = 7

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'

export default function Pong() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('pong')

    let leftY, rightY, ball, scoreL, scoreR, state, aiOn, serveDir
    const keys = { w: false, s: false, up: false, down: false }
    let last = performance.now(), raf = 0
    let wantWin = shouldAutoWin('pong')  // autoplay: should P1 win this match?
    let restartAt = 0                  // autoplay: timestamp to auto-restart after a match

    function reset() {
      leftY = H / 2 - PADDLE_H / 2
      rightY = H / 2 - PADDLE_H / 2
      scoreL = 0; scoreR = 0
      aiOn = true
      state = 'serve'
      serveDir = Math.random() < 0.5 ? -1 : 1
      centerBall()
    }

    function centerBall() {
      ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 }
    }

    function serve() {
      const angle = (Math.random() * 0.5 - 0.25) * Math.PI // -45°..45°
      ball.x = W / 2; ball.y = H / 2
      ball.vx = serveDir * BALL_SPEED * Math.cos(angle)
      ball.vy = BALL_SPEED * Math.sin(angle)
      state = 'playing'
    }

    function point(scorer) {
      if (scorer === 'L') scoreL++; else scoreR++
      if (scoreL >= WIN_SCORE || scoreR >= WIN_SCORE) { state = 'over'; return }
      serveDir = scorer === 'L' ? 1 : -1 // serve toward the loser
      centerBall(); state = 'serve'
    }

    // Autoplay: predict the ball's y when it reaches the left paddle plane,
    // reflecting off the top/bottom walls. Returns the y the paddle center
    // should aim for. Used only when wantWin and the ball is heading left.
    function predictLeftY() {
      const plane = MARGIN + PADDLE_W + BALL_R
      if (ball.vx >= 0) return ball.y
      const t = (ball.x - plane) / -ball.vx
      let y = ball.y + ball.vy * t
      // fold into [BALL_R, H - BALL_R] with reflections
      const span = H - 2 * BALL_R
      let m = (y - BALL_R) % (2 * span)
      if (m < 0) m += 2 * span
      if (m > span) m = 2 * span - m
      return BALL_R + m
    }

    function update(dt) {
      // paddles
      if (auto) {
        // Autoplay: drive P1 (left) toward the ball instead of human keys.
        // Smooth proportional tracking: move toward a target y with a capped
        // speed and a small dead-zone. No sinusoidal jitter.
        // wantWin  -> predict where the ball will reach the left plane and beat
        //             the CPU (P1_SPEED > AI_SPEED) so P1 reliably wins to 7.
        // !wantWin -> under-track (slower, just chase current ball.y) so the
        //             CPU outpaces P1 and wins.
        const center = leftY + PADDLE_H / 2
        let target
        if (wantWin && ball.vx < 0) {
          target = predictLeftY()        // intercept ahead of the ball
        } else {
          target = ball.y                // just follow the ball
        }
        const diff = target - center
        const dead = wantWin ? 3 : 12
        if (Math.abs(diff) > dead) {
          const sp = (wantWin ? PADDLE_SPEED : AI_SPEED * 0.7) * dt
          leftY += Math.max(-sp, Math.min(sp, diff))
        }
      } else {
        if (keys.w) leftY -= PADDLE_SPEED * dt
        if (keys.s) leftY += PADDLE_SPEED * dt
      }
      if (aiOn) {
        if (ball.vx > 0) {
          const target = ball.y - PADDLE_H / 2
          const d = target - rightY
          const mv = AI_SPEED * dt
          rightY += Math.max(-mv, Math.min(mv, d))
        }
      } else {
        if (keys.up) rightY -= PADDLE_SPEED * dt
        if (keys.down) rightY += PADDLE_SPEED * dt
      }
      leftY = Math.max(0, Math.min(H - PADDLE_H, leftY))
      rightY = Math.max(0, Math.min(H - PADDLE_H, rightY))

      if (state !== 'playing') return

      ball.x += ball.vx * dt
      ball.y += ball.vy * dt

      // top/bottom
      if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy) }
      if (ball.y + BALL_R > H) { ball.y = H - BALL_R; ball.vy = -Math.abs(ball.vy) }

      // left paddle
      if (ball.vx < 0 && ball.x - BALL_R < MARGIN + PADDLE_W && ball.x - BALL_R > MARGIN - 6 &&
          ball.y > leftY && ball.y < leftY + PADDLE_H) {
        bounce(leftY, 1)
      }
      // right paddle
      const rx = W - MARGIN - PADDLE_W
      if (ball.vx > 0 && ball.x + BALL_R > rx && ball.x + BALL_R < rx + PADDLE_W + 6 &&
          ball.y > rightY && ball.y < rightY + PADDLE_H) {
        bounce(rightY, -1)
      }

      // scoring
      if (ball.x < -BALL_R) point('R')
      else if (ball.x > W + BALL_R) point('L')
    }

    function bounce(paddleY, dir) {
      const rel = (ball.y - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2) // -1..1
      const speed = Math.hypot(ball.vx, ball.vy) * SPEEDUP
      const angle = rel * (Math.PI * 0.42) // up to ~75°
      ball.vx = dir * speed * Math.cos(angle)
      ball.vy = speed * Math.sin(angle)
      ball.x += dir * 4 // unstick
    }

    // ---------- input ----------
    function onKeyDown(e) {
      const k = e.code
      if (state === 'over') { if (['Space', 'Enter', 'KeyR'].includes(k)) { e.preventDefault(); reset() } return }
      if (k === 'KeyA') { if (!e.repeat) aiOn = !aiOn; return }
      if (k === 'Space') { e.preventDefault(); if (state === 'serve') serve(); return }
      if (k === 'KeyW') { keys.w = true; e.preventDefault() }
      else if (k === 'KeyS') { keys.s = true; e.preventDefault() }
      else if (k === 'ArrowUp') { keys.up = true; e.preventDefault() }
      else if (k === 'ArrowDown') { keys.down = true; e.preventDefault() }
    }
    function onKeyUp(e) {
      const k = e.code
      if (k === 'KeyW') keys.w = false
      else if (k === 'KeyS') keys.s = false
      else if (k === 'ArrowUp') keys.up = false
      else if (k === 'ArrowDown') keys.down = false
    }
    function onPointer() { if (state === 'serve') serve(); else if (state === 'over') reset() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function paddle(x, y, color) {
      ctx.shadowColor = color; ctx.shadowBlur = 16
      ctx.fillStyle = color; ctx.fillRect(x, y, PADDLE_W, PADDLE_H)
      ctx.shadowBlur = 0
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(28, 28, 5); sparkle(W - 28, H - 28, 4)

      // center dashed line
      ctx.strokeStyle = 'rgba(255,45,111,0.4)'; ctx.lineWidth = 3; ctx.setLineDash([10, 12])
      ctx.beginPath(); ctx.moveTo(W / 2, 12); ctx.lineTo(W / 2, H - 12); ctx.stroke(); ctx.setLineDash([])

      // scores
      ctx.fillStyle = '#fff'; ctx.font = '800 52px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(String(scoreL), W / 2 - 70, 64)
      ctx.fillText(String(scoreR), W / 2 + 70, 64)
      // labels
      ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillStyle = PINK; ctx.fillText('P1', W / 2 - 70, 80)
      ctx.fillStyle = CYAN; ctx.fillText(aiOn ? 'CPU' : 'P2', W / 2 + 70, 80)

      // paddles + ball
      paddle(MARGIN, leftY, PINK)
      paddle(W - MARGIN - PADDLE_W, rightY, CYAN)
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 14
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 0

      // controls hint
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('P1: W / S      ' + (aiOn ? 'CPU opponent' : 'P2: ↑ / ↓') + '      A: toggle AI', W / 2, H - 14)

      if (state === 'serve') overlay('PONG', 'space / tap to serve')
      else if (state === 'over') overlay(scoreL > scoreR ? 'P1 WINS' : (aiOn ? 'CPU WINS' : 'P2 WINS'), 'space / tap to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.78)'; ctx.fillRect(0, 90, W, H - 120)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 48px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 70, H / 2 + 12, 140, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 42)
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      if (auto) {
        if (state === 'serve') serve()
        else if (state === 'over') {
          if (!restartAt) { recordAutoplayResult('pong', scoreL > scoreR); restartAt = now + 1500 }
          else if (now >= restartAt) { restartAt = 0; wantWin = shouldAutoWin('pong'); reset() }
        }
      }
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="pong-canvas" aria-label="Pong game" />
  )
}
