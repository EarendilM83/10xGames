import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Real Flappy Bird sprites (samuelcust/flappy-bird-assets) — the exact set the Figma file uses.
import bgDay from '../assets/background-day.png'
import baseImg from '../assets/base.png'
import pipeImg from '../assets/pipe-green.png'
import birdDown from '../assets/yellowbird-downflap.png'
import birdMid from '../assets/yellowbird-midflap.png'
import birdUp from '../assets/yellowbird-upflap.png'
import messageImg from '../assets/message.png'
import gameoverImg from '../assets/gameover.png'
import d0 from '../assets/0.png'
import d1 from '../assets/1.png'
import d2 from '../assets/2.png'
import d3 from '../assets/3.png'
import d4 from '../assets/4.png'
import d5 from '../assets/5.png'
import d6 from '../assets/6.png'
import d7 from '../assets/7.png'
import d8 from '../assets/8.png'
import d9 from '../assets/9.png'

// Native sprite resolution — classic Flappy Bird canvas.
const W = 288
const H = 512
const BASE_Y = 400 // ground top (bird dies here)

// Physics (tuned by feel — the original 2013 constants were never published).
const GRAVITY = 0.42
const FLAP = -7.6
const MAX_FALL = 11
const PIPE_SPEED = 2.0
const PIPE_GAP = 120
const PIPE_SPACING = 170 // horizontal distance between pipe pairs
const PIPE_W = 52
const BIRD_X = 70
const BIRD_W = 34
const BIRD_H = 24

const HS_KEY = '10xgames.flappy.highscore'

export default function FlappyBird() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false // crisp pixel art

    const auto = isAutoplay('flappy-bird')

    // ---- load all sprites, then start ----
    const srcs = {
      bgDay, baseImg, pipeImg, birdDown, birdMid, birdUp, messageImg, gameoverImg,
      d0, d1, d2, d3, d4, d5, d6, d7, d8, d9,
    }
    const img = {}
    const digits = []
    let loaded = 0
    const total = Object.keys(srcs).length
    let raf = 0
    let started = false

    Object.entries(srcs).forEach(([key, src]) => {
      const im = new Image()
      im.onload = () => {
        if (++loaded === total && !started) {
          started = true
          raf = requestAnimationFrame(loop)
        }
      }
      im.src = src
      img[key] = im
    })
    for (let i = 0; i < 10; i++) digits.push(img['d' + i])

    // ---- game state ----
    let phase = 'ready' // ready | playing | over
    let birdY = H / 2
    let vel = 0
    let frameTick = 0 // for wing animation
    let baseX = 0
    let pipes = [] // { x, gapY, scored }
    let score = 0
    let high = Number(localStorage.getItem(HS_KEY)) || 0
    let last = performance.now()

    // ---- autoplay bot ----
    // The safe vertical band for the bird's TOP edge inside a gap is
    // [gapY, gapY + (PIPE_GAP - BIRD_H)]  (here ~[gapY, gapY+96]).
    // A single flap (-7.6) lifts the bird ~69px before gravity wins, so to glide
    // cleanly we trigger the flap LOW in the band (gapY + WIN_FLAP_OFFSET) and only
    // while descending. The bird then rises without ever clipping the top pipe,
    // producing an even, non-jittery tap rhythm (~1 flap per 34 frames).
    const WIN_FLAP_OFFSET = 76 // px below gap-top where the win bot taps
    let botRestartAt = 0   // timestamp at which the over->restart should fire (0 = none pending)
    let botWantWin = true  // this round: glide through cleanly vs. a clear early crash
    let botFlapOffset = WIN_FLAP_OFFSET // how deep in the gap to wait before flapping
    let botSkipChance = 0  // chance per flap decision to skip the flap (lose rounds only)
    let botSessionRecorded = false // ensure recordAutoplayResult fires once per session

    function botNewRound() {
      botWantWin = shouldAutoWin('flappy-bird')
      if (botWantWin) {
        // Steady, well-centered taps → reliably reaches 12+ pipes and glides smoothly.
        botFlapOffset = WIN_FLAP_OFFSET
        botSkipChance = 0.0
      } else {
        // Effectively stop flapping → the bird sinks and clearly crashes within a few pipes.
        botFlapOffset = WIN_FLAP_OFFSET
        botSkipChance = 0.6
      }
      botSessionRecorded = false
    }

    function botThink() {
      if (phase === 'ready') {
        botNewRound()
        flap() // ready -> playing
        return
      }
      if (phase === 'over') {
        if (!botSessionRecorded) {
          recordAutoplayResult('flappy-bird', score >= 12)
          botSessionRecorded = true
        }
        if (botRestartAt === 0) botRestartAt = performance.now() + 1300
        else if (performance.now() >= botRestartAt) {
          botRestartAt = 0
          flap() // over -> ready
        }
        return
      }
      // phase === 'playing': tap low inside the next gap, only while descending.
      let next = null
      for (const p of pipes) {
        if (p.x + PIPE_W >= BIRD_X) { next = p; break }
      }
      const trigger = next ? next.gapY + botFlapOffset : H / 2
      // Smooth rhythm: flap only when we've sunk past the trigger AND are falling.
      if (birdY > trigger && vel >= 0) {
        if (botSkipChance === 0 || Math.random() >= botSkipChance) flap()
      }
    }

    function reset() {
      birdY = H / 2
      vel = 0
      pipes = []
      score = 0
      baseX = 0
    }

    function seedPipes() {
      pipes = []
      let x = W + 40
      for (let i = 0; i < 3; i++) {
        pipes.push(makePipe(x))
        x += PIPE_SPACING
      }
    }

    function makePipe(x) {
      const margin = 50
      const gapY = margin + Math.random() * (BASE_Y - PIPE_GAP - margin * 2)
      return { x, gapY, scored: false }
    }

    function flap() {
      if (phase === 'ready') {
        phase = 'playing'
        seedPipes()
        vel = FLAP
      } else if (phase === 'playing') {
        vel = FLAP
      } else if (phase === 'over') {
        reset()
        phase = 'ready'
      }
    }

    function hits() {
      if (birdY + BIRD_H >= BASE_Y) return true
      if (birdY <= 0) return true
      const bx = BIRD_X, bw = BIRD_W, bh = BIRD_H
      for (const p of pipes) {
        if (bx + bw > p.x && bx < p.x + PIPE_W) {
          if (birdY < p.gapY || birdY + bh > p.gapY + PIPE_GAP) return true
        }
      }
      return false
    }

    function update(dt) {
      const step = dt / 16.67
      frameTick += step
      baseX = (baseX - PIPE_SPEED * step) % 48 // base is 336 wide, bg 288 → 48px of travel

      if (phase === 'playing') {
        vel = Math.min(vel + GRAVITY * step, MAX_FALL)
        birdY += vel * step

        for (const p of pipes) {
          p.x -= PIPE_SPEED * step
          if (!p.scored && p.x + PIPE_W < BIRD_X) {
            p.scored = true
            score += 1
          }
        }
        // recycle: drop offscreen pipes, append new ones to keep 3 ahead
        if (pipes.length && pipes[0].x + PIPE_W < 0) {
          pipes.shift()
          const lastX = pipes[pipes.length - 1].x
          pipes.push(makePipe(lastX + PIPE_SPACING))
        }

        if (hits()) {
          phase = 'over'
          if (score > high) {
            high = score
            localStorage.setItem(HS_KEY, String(high))
          }
        }
      } else if (phase === 'ready') {
        birdY = H / 2 + Math.sin(frameTick * 0.15) * 6
      }
    }

    function drawPipes() {
      for (const p of pipes) {
        // bottom pipe (upright)
        const botY = p.gapY + PIPE_GAP
        ctx.drawImage(img.pipeImg, p.x, botY, PIPE_W, BASE_Y - botY + 20)
        // top pipe (flipped vertically)
        ctx.save()
        ctx.translate(p.x, p.gapY)
        ctx.scale(1, -1)
        ctx.drawImage(img.pipeImg, 0, 0, PIPE_W, p.gapY + 20)
        ctx.restore()
      }
    }

    function drawBird() {
      const frames = [img.birdDown, img.birdMid, img.birdUp, img.birdMid]
      const f = frames[Math.floor(frameTick / 6) % 4]
      const tilt =
        phase === 'playing'
          ? Math.max(-0.45, Math.min(1.4, vel / 10))
          : 0
      ctx.save()
      ctx.translate(BIRD_X + BIRD_W / 2, birdY + BIRD_H / 2)
      ctx.rotate(tilt)
      ctx.drawImage(f, -BIRD_W / 2, -BIRD_H / 2, BIRD_W, BIRD_H)
      ctx.restore()
    }

    function drawScore(n, cy, scale) {
      const s = String(n)
      let w = 0
      for (const ch of s) w += digits[+ch].width * scale + 1
      let x = (W - w) / 2
      for (const ch of s) {
        const dg = digits[+ch]
        ctx.drawImage(dg, x, cy, dg.width * scale, dg.height * scale)
        x += dg.width * scale + 1
      }
    }

    function draw() {
      ctx.drawImage(img.bgDay, 0, 0, W, H)
      drawPipes()
      // base (scrolling, drawn twice to tile)
      ctx.drawImage(img.baseImg, baseX, BASE_Y, 336, 112)
      ctx.drawImage(img.baseImg, baseX + 336, BASE_Y, 336, 112)
      drawBird()

      if (phase === 'playing') {
        drawScore(score, 40, 1)
      } else if (phase === 'ready') {
        const mw = img.messageImg.width, mh = img.messageImg.height
        ctx.drawImage(img.messageImg, (W - mw) / 2, 80, mw, mh)
      } else if (phase === 'over') {
        const gw = img.gameoverImg.width, gh = img.gameoverImg.height
        ctx.drawImage(img.gameoverImg, (W - gw) / 2, 130, gw, gh)
        drawScore(score, 210, 1)
        // "best" label-free: smaller high score below
        drawScore(high, 270, 0.7)
        ctx.save()
        ctx.fillStyle = '#fff'
        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('BEST', W / 2, 262)
        ctx.fillText('tap / click / space to play again', W / 2, 320)
        ctx.restore()
      }
    }

    function loop(now) {
      let dt = now - last
      last = now
      if (dt > 50) dt = 50
      if (auto) botThink()
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    // ---- input ----
    const onKey = (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        flap()
      }
    }
    const onPointer = (e) => {
      e.preventDefault()
      flap()
    }
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="flappy-canvas"
      aria-label="Flappy Bird game"
    />
  )
}
