import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Classic Simon (repeat-the-sequence) on canvas, 10x neon-on-black style.
const W = 440
const H = 480
const HEADER = 56
const PAD = 24

const PINK = '#ff2d6f'
const MUTED = '#8a93ad'

// Ring geometry
const RING_X = W / 2
const RING_Y = HEADER + PAD + (H - HEADER - PAD * 2) / 2 + 4
const R_OUTER = 180
const R_INNER = 64
const GAP = 8 // angular-ish gap rendered as a dark seam

// Four pads: dim base + bright lit + tone frequency. Order: TL, TR, BL, BR.
const PADS = [
  { dim: '#7a1538', lit: '#ff2d6f', freq: 277.18 }, // pink  (top-left)
  { dim: '#157070', lit: '#2de2e6', freq: 329.63 }, // cyan  (top-right)
  { dim: '#572574', lit: '#b14aed', freq: 392.0 },  // purple(bottom-left)
  { dim: '#806b05', lit: '#ffd60a', freq: 440.0 },  // yellow(bottom-right)
]

const BEST_KEY = '10xgames.simon.best'

export default function Simon() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('simon')

    let sequence = []      // computer's sequence of pad indices
    let inputPos = 0       // how far the player has matched this round
    let round = 0
    let state = 'idle'     // 'idle' | 'showing' | 'input' | 'over'
    let best = Number(localStorage.getItem(BEST_KEY)) || 0
    let litPad = -1        // pad currently lit (player or playback)
    let litUntil = 0       // timestamp when current flash ends
    let overFlash = 0      // intensity 0..1 of the game-over red wash

    let raf = 0
    const timeouts = new Set()
    let audioCtx = null

    function later(fn, ms) {
      const id = setTimeout(() => { timeouts.delete(id); fn() }, ms)
      timeouts.add(id)
      return id
    }
    function clearTimers() {
      for (const id of timeouts) clearTimeout(id)
      timeouts.clear()
    }

    // ---------- audio (lazy, autoplay-safe, fail silent) ----------
    function ensureAudio() {
      if (audioCtx) return
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (AC) audioCtx = new AC()
      } catch { audioCtx = null }
    }
    function beep(freq, dur = 0.32) {
      if (!audioCtx) return
      try {
        if (audioCtx.state === 'suspended') audioCtx.resume()
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        const t = audioCtx.currentTime
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        osc.connect(gain).connect(audioCtx.destination)
        osc.start(t)
        osc.stop(t + dur + 0.02)
      } catch { /* ignore */ }
    }

    // ---------- game flow ----------
    function flashPad(i, ms) {
      litPad = i
      litUntil = performance.now() + ms
      beep(PADS[i].freq, ms / 1000)
      later(() => { if (litPad === i) litPad = -1 }, ms)
    }

    function playSequence() {
      state = 'showing'
      litPad = -1
      // speed up slightly as rounds grow
      const flash = Math.max(220, 460 - round * 18)
      const gap = Math.max(110, 230 - round * 10)
      let delay = 520 // initial pause before playback
      sequence.forEach((padIdx) => {
        later(() => flashPad(padIdx, flash), delay)
        delay += flash + gap
      })
      later(() => {
        state = 'input'
        inputPos = 0
      }, delay)
    }

    function nextRound() {
      sequence.push(Math.floor(Math.random() * 4))
      round = sequence.length
      playSequence()
    }

    function startGame() {
      ensureAudio()
      clearTimers()
      sequence = []
      inputPos = 0
      round = 0
      overFlash = 0
      litPad = -1
      nextRound()
    }

    function gameOver() {
      clearTimers()
      state = 'over'
      litPad = -1
      overFlash = 1
      if (round - 1 > best) {
        best = round - 1
        localStorage.setItem(BEST_KEY, String(best))
      }
      if (auto && botSessionLive) {
        botSessionLive = false
        recordAutoplayResult('simon', botMaxRound >= 10)
      }
    }

    function handlePad(i) {
      if (state !== 'input') return
      // brief feedback flash for the player's press
      flashPad(i, 240)
      if (i === sequence[inputPos]) {
        inputPos++
        if (inputPos === sequence.length) {
          state = 'showing' // lock input during transition
          later(nextRound, 720)
        }
      } else {
        gameOver()
      }
    }

    // ---------- input mapping ----------
    function padAt(px, py) {
      const dx = px - RING_X
      const dy = py - RING_Y
      const dist = Math.hypot(dx, dy)
      if (dist < R_INNER || dist > R_OUTER) return -1
      const left = dx < 0
      const top = dy < 0
      if (top && left) return 0
      if (top && !left) return 1
      if (!top && left) return 2
      return 3
    }

    function onPointer(e) {
      ensureAudio()
      if (state === 'idle' || state === 'over') { startGame(); return }
      if (state !== 'input') return
      const rect = canvas.getBoundingClientRect()
      const scaleX = W / rect.width
      const scaleY = H / rect.height
      const px = (e.clientX - rect.left) * scaleX
      const py = (e.clientY - rect.top) * scaleY
      const i = padAt(px, py)
      if (i >= 0) handlePad(i)
    }

    function onKey(e) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        ensureAudio()
        if (state === 'idle' || state === 'over') startGame()
      }
    }

    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- autoplay bot (self-play demo) ----------
    // Drives the game's OWN handlePad() during the 'input' phase, one pad per tick.
    // It reads the live `sequence` array and replays it. Per SESSION it decides
    // wantWin via shouldAutoWin('simon') (self-corrects to ~95%):
    //   WIN  -> replay correctly every round until round >= 10, then press a wrong
    //           pad to end the demo (still counts as a win because it reached 10).
    //   LOSE -> replay correctly for a few steps, then a wrong pad to fail < round 10.
    // Smooth pacing: one pad per ~450-600ms, and only during the 'input' phase
    // (it waits out the 'showing' sequence replay, where input is locked anyway).
    let botTimer = 0
    let botSessionLive = false  // a session is in progress (start..gameOver)
    let botMaxRound = 0         // highest round reached this session
    let botWantWin = true       // this session's goal
    let botRound = -1           // which round's input plan we've built
    let botPlan = []            // pad indices to press this round (last may be wrong)
    let botStep = 0             // how many of botPlan we've pressed

    function botBeginSession() {
      startGame()
      botSessionLive = true
      botMaxRound = 0
      botWantWin = shouldAutoWin('simon')
      botRound = -1
      botPlan = []
      botStep = 0
    }

    function botWrongPad(idx) {
      // a pad that is NOT the correct one at sequence[idx]
      const right = sequence[idx]
      let wrong = Math.floor(Math.random() * 4)
      if (right != null) while (wrong === right) wrong = Math.floor(Math.random() * 4)
      return wrong
    }

    function buildPlan() {
      if (botWantWin) {
        if (round >= 10) {
          // Reached the win threshold: replay correctly then a wrong pad at the end
          // to end the demo so it cycles. Already counts as a win (botMaxRound >= 10).
          botPlan = sequence.slice()
          botPlan.push(botWrongPad(sequence.length))
        } else {
          // Replay the full sequence exactly -> advances to the next round.
          botPlan = sequence.slice()
        }
      } else {
        // Lose run: replay a few correct steps, then a wrong pad to fail early (< 10).
        const correct = Math.min(sequence.length, 1 + Math.floor(Math.random() * 3))
        botPlan = sequence.slice(0, correct)
        botPlan.push(botWrongPad(correct))
      }
      botStep = 0
    }

    // The bot loop must outlive clearTimers() (called by startGame/gameOver),
    // so it owns a plain timeout instead of the cleared `later()` set.
    function botSchedule(ms) {
      botTimer = setTimeout(botTick, ms)
    }

    function botTick() {
      if (state === 'idle' || state === 'over') {
        // Start, or restart ~1.6s after a game over, then keep the loop going.
        botBeginSession()
        botSchedule(1600)
        return
      }
      if (state === 'input') {
        if (round > botMaxRound) botMaxRound = round
        if (botRound !== round) {
          botRound = round
          buildPlan()
        }
        if (botStep < botPlan.length) {
          handlePad(botPlan[botStep])
          botStep++
        }
      }
      // 'showing' (sequence replay / transition): wait, input is locked anyway.
      botSchedule(450 + Math.floor(Math.random() * 150))
    }

    if (auto) botSchedule(600)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    // Draw one quarter-ring pad as a thick rounded arc segment.
    function drawPad(i, color, glow) {
      // start angle per quadrant, sweeping 90° with seam gaps
      const quad = [Math.PI, -Math.PI / 2, Math.PI / 2, 0] // TL, TR, BL, BR
      const seam = GAP / R_OUTER // radians of gap
      const a0 = quad[i] + seam
      const a1 = quad[i] + Math.PI / 2 - seam
      ctx.beginPath()
      ctx.arc(RING_X, RING_Y, R_OUTER, a0, a1)
      ctx.arc(RING_X, RING_Y, R_INNER, a1, a0, true)
      ctx.closePath()
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow }
      ctx.fillStyle = color
      ctx.fill()
      ctx.shadowBlur = 0
    }

    function draw(now) {
      // background
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, W, H)
      sparkle(W - 26, 24, 5)
      sparkle(26, H - 26, 4)

      // header: ROUND label + BEST
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK
      ctx.font = '700 12px system-ui, sans-serif'
      ctx.fillText('ROUND', PAD, PAD + 8)
      ctx.fillRect(PAD, PAD + 13, 24, 3)
      ctx.fillStyle = '#fff'
      ctx.font = '800 26px system-ui, sans-serif'
      ctx.fillText(String(round), PAD + 66, PAD + 14)

      ctx.textAlign = 'right'
      ctx.fillStyle = MUTED
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText('BEST  ' + best, W - PAD, PAD + 12)

      // pads
      const t = now || performance.now()
      for (let i = 0; i < 4; i++) {
        const active = i === litPad && t < litUntil
        if (active) drawPad(i, PADS[i].lit, 36)
        else drawPad(i, PADS[i].dim, 0)
      }

      // game-over red wash over pads
      if (overFlash > 0) {
        ctx.save()
        ctx.globalAlpha = overFlash * 0.55
        for (let i = 0; i < 4; i++) drawPad(i, '#ff2d3a', 0)
        ctx.restore()
        overFlash = Math.max(0, overFlash - 0.012)
      }

      // center hub
      ctx.beginPath()
      ctx.arc(RING_X, RING_Y, R_INNER - 4, 0, Math.PI * 2)
      ctx.fillStyle = '#101016'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.stroke()

      // hub content
      ctx.textAlign = 'center'
      if (state === 'idle') {
        ctx.fillStyle = PINK
        ctx.font = '800 16px system-ui, sans-serif'
        ctx.fillText('+', RING_X, RING_Y - 8)
        ctx.fillStyle = '#fff'
        ctx.font = '800 13px system-ui, sans-serif'
        ctx.fillText('SIMON', RING_X, RING_Y + 14)
      } else if (state === 'over') {
        ctx.fillStyle = PINK
        ctx.font = '800 15px system-ui, sans-serif'
        ctx.fillText('OVER', RING_X, RING_Y + 5)
      } else {
        ctx.fillStyle = '#fff'
        ctx.font = '800 40px system-ui, sans-serif'
        ctx.fillText(String(round), RING_X, RING_Y + 8)
        ctx.fillStyle = PINK
        ctx.font = '700 9px system-ui, sans-serif'
        ctx.fillText('SIMON', RING_X, RING_Y + 26)
      }

      // status text at bottom
      let status = ''
      let hint = ''
      if (state === 'idle') { status = 'TAP TO START'; hint = 'repeat the sequence' }
      else if (state === 'showing') { status = 'WATCH'; hint = 'memorize the pattern' }
      else if (state === 'input') { status = 'YOUR TURN'; hint = 'tap the pads in order' }
      else if (state === 'over') { status = 'GAME OVER'; hint = 'tap / space to play again' }

      const sy = H - 30
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK
      ctx.font = '800 22px system-ui, sans-serif'
      ctx.fillText(status, W / 2, sy)
      // pink underline-bar accent
      const bw = ctx.measureText(status).width
      ctx.fillRect(W / 2 - bw / 2, sy + 7, bw, 3)
      ctx.fillStyle = MUTED
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText(hint, W / 2, sy + 24)
    }

    function loop(now) {
      draw(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      clearTimers()
      if (botTimer) clearTimeout(botTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      if (audioCtx) { try { audioCtx.close() } catch { /* ignore */ } }
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="simon-canvas" aria-label="Simon game" />
  )
}
