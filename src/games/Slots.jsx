import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Slots — 5 reels x 3 rows, 8 paylines, neon 10x theme, with a 95% autoplay bot.
// Single useEffect, rAF loop for the spinning-reel animation, plain `let` state.
// All symbols are ORIGINAL neon shapes (10x logo, star, gem, seven, bell, cherry, bar) —
// no copyrighted characters or third-party IP is rendered.
const W = 480
const H = 720
const BEST_KEY = '10xgames.slots.best'

const PINK = '#ff2d6f'
const GREEN = '#54e346'
const GOLD = '#ffd60a'
const CYAN = '#2de2e6'
const PURPLE = '#b14aed'
const MUTED = '#8a93ad'

// ---------- symbols ----------
// Each symbol: id, neon color, and 3/4/5-of-a-kind payout as a multiple of the bet.
// Ordered low -> high value. `weight` biases the reel strip (low symbols common).
const SYMBOLS = [
  { id: 'cherry', color: '#ff3b6b', pay: [2, 5, 10], weight: 9 },
  { id: 'bell', color: '#ffd60a', pay: [3, 8, 15], weight: 8 },
  { id: 'bar', color: '#2de2e6', pay: [4, 10, 20], weight: 7 },
  { id: 'gem', color: '#b14aed', pay: [5, 15, 30], weight: 5 },
  { id: 'star', color: '#54e346', pay: [8, 20, 50], weight: 4 },
  { id: 'seven', color: '#ff2d6f', pay: [10, 30, 75], weight: 3 },
  { id: 'logo', color: '#ffffff', pay: [15, 50, 150], weight: 2 }, // 10x logo = top symbol
]
const NSYM = SYMBOLS.length

// Build a weighted reel strip (array of symbol indices) — independent strip per reel.
function buildStrip() {
  const strip = []
  for (let i = 0; i < NSYM; i++) {
    for (let w = 0; w < SYMBOLS[i].weight; w++) strip.push(i)
  }
  // shuffle so identical symbols aren't clustered
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[strip[i], strip[j]] = [strip[j], strip[i]]
  }
  return strip
}

// ---------- paylines ----------
// Each payline is a row index (0=top,1=mid,2=bottom) per reel, length 5.
const PAYLINES = [
  [1, 1, 1, 1, 1], // middle
  [0, 0, 0, 0, 0], // top
  [2, 2, 2, 2, 2], // bottom
  [0, 1, 2, 1, 0], // V
  [2, 1, 0, 1, 2], // ^
  [0, 0, 1, 2, 2], // descending step
  [2, 2, 1, 0, 0], // ascending step
  [1, 0, 1, 2, 1], // zigzag
]

// Evaluate a 5x3 grid (grid[reel][row] = symbol index).
// Returns { totalMult, lines:[{line, sym, count, mult}] }. A line pays when the
// FIRST 3+ reels (left-to-right, contiguous) share a symbol on that line's rows.
function evaluate(grid) {
  const wins = []
  let totalMult = 0
  for (let li = 0; li < PAYLINES.length; li++) {
    const rows = PAYLINES[li]
    const first = grid[0][rows[0]]
    let count = 1
    for (let r = 1; r < 5; r++) {
      if (grid[r][rows[r]] === first) count++
      else break
    }
    if (count >= 3) {
      const mult = SYMBOLS[first].pay[count - 3]
      totalMult += mult
      wins.push({ line: li, sym: first, count, mult })
    }
  }
  return { totalMult, lines: wins }
}

// ---------- rigged grids for autoplay demo ----------
const randSym = () => Math.floor(Math.random() * NSYM)

// A guaranteed WINNING grid: full middle row of one symbol (5-of-a-kind on line 0),
// with the rest of the grid randomized but NOT extending the line above/below.
function riggedWinGrid() {
  const sym = randSym()
  const grid = []
  for (let r = 0; r < 5; r++) {
    grid.push([randSym(), sym, randSym()]) // middle row = winning symbol
  }
  return grid
}

// A guaranteed NON-winning grid: ensure no payline has 3+ contiguous matches from reel 0.
function riggedLoseGrid() {
  for (let tries = 0; tries < 200; tries++) {
    const grid = []
    for (let r = 0; r < 5; r++) grid.push([randSym(), randSym(), randSym()])
    if (evaluate(grid).totalMult === 0) return grid
  }
  // fallback: a known dead grid (alternating reels)
  return [
    [0, 1, 2], [3, 4, 5], [6, 0, 1], [2, 3, 4], [5, 6, 0],
  ]
}

export default function Slots() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('slots')

    // ---- state ----
    let balance = 1000
    let bet = 20
    let lastWin = 0
    let best = 1000
    let state = 'idle' // 'idle' | 'spinning' | 'result'
    let turbo = false

    // strips + per-reel scroll positions for the animation
    const strips = [buildStrip(), buildStrip(), buildStrip(), buildStrip(), buildStrip()]
    // grid[reel][row] = symbol index — the *final* outcome of the current/last spin
    let grid = [
      [0, 1, 2], [3, 4, 5], [6, 0, 1], [2, 3, 4], [5, 6, 0],
    ]

    // Animation: each reel scrolls a strip; offset increases; it stops when its
    // stopTime passes, snapping to show `grid` rows. velocity controls scroll speed.
    const reels = []
    for (let r = 0; r < 5; r++) {
      reels.push({
        offset: Math.random() * strips[r].length, // fractional index at top visible cell
        vel: 0,
        spinning: false,
        stopAt: 0, // ms timestamp to begin stopping
        target: 0, // strip index that should land in the TOP visible row
      })
    }

    let spinStart = 0
    let winFlash = 0 // ms accumulator for flashing winning lines
    let winLines = [] // result of evaluate().lines for the current spin
    let payoutShown = 0 // count-up display of lastWin
    let payoutTarget = 0
    let raf = 0
    let autoTimer = 0
    let lastTs = 0
    let wantWin = true

    try { best = parseInt(localStorage.getItem(BEST_KEY) || '1000', 10) || 1000 } catch { best = 1000 }

    function saveBest() {
      if (balance > best) {
        best = balance
        try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* ignore */ }
      }
    }

    // ---- spin logic ----
    function rollFairGrid() {
      const g = []
      for (let r = 0; r < 5; r++) {
        const s = strips[r]
        const top = Math.floor(Math.random() * s.length)
        g.push([s[top], s[(top + 1) % s.length], s[(top + 2) % s.length]])
      }
      return g
    }

    // Place `grid` into the reel strips by writing the 3 outcome symbols into a known
    // strip window, then aiming each reel's `target` (top visible index) at that window.
    function lockGridToStrips() {
      for (let r = 0; r < 5; r++) {
        const s = strips[r]
        // pick a landing index well ahead of the current offset for a long spin
        const base = (Math.floor(reels[r].offset) + 30 + r * 6) % s.length
        s[base] = grid[r][0]
        s[(base + 1) % s.length] = grid[r][1]
        s[(base + 2) % s.length] = grid[r][2]
        reels[r].target = base
      }
    }

    function startSpin() {
      if (state === 'spinning') return
      if (bet > balance) bet = balance
      if (bet <= 0) return
      balance -= bet
      lastWin = 0
      payoutShown = 0
      payoutTarget = 0
      winLines = []
      winFlash = 0

      // decide outcome grid
      if (auto) {
        wantWin = shouldAutoWin('slots')
        grid = wantWin ? riggedWinGrid() : riggedLoseGrid()
      } else {
        grid = rollFairGrid()
      }
      lockGridToStrips()

      state = 'spinning'
      spinStart = performance.now()
      const base = turbo ? 360 : 650 // ms of free spin before reels start stopping
      const stagger = turbo ? 110 : 220
      for (let r = 0; r < 5; r++) {
        reels[r].spinning = true
        reels[r].vel = 0.045 + Math.random() * 0.01 // strip indices per ms
        reels[r].stopAt = spinStart + base + r * stagger
      }
    }

    // Snap a reel so its top visible cell == target, then mark stopped.
    function snapReel(r) {
      reels[r].offset = reels[r].target
      reels[r].vel = 0
      reels[r].spinning = false
    }

    function allStopped() {
      return reels.every((r) => !r.spinning)
    }

    function resolveSpin() {
      const res = evaluate(grid)
      winLines = res.lines
      lastWin = res.totalMult * bet
      payoutTarget = lastWin
      if (lastWin > 0) balance += lastWin
      state = 'result'
      saveBest()
      if (balance <= 0) balance = 1000 // keep the demo playable
      if (bet > balance) bet = Math.max(5, Math.min(balance, bet))

      if (auto) recordAutoplayResult('slots', lastWin > 0)
    }

    // ---- bet controls ----
    function changeBet(delta) {
      if (state === 'spinning') return
      bet = Math.max(5, Math.min(balance, bet + delta))
    }

    // ---------- buttons ----------
    const BTN_Y = H - 96
    const BTN_H = 64
    function buttons() {
      return [
        { id: 'minus', x: 20, y: BTN_Y, w: 60, h: BTN_H, label: '−' },
        { id: 'plus', x: 88, y: BTN_Y, w: 60, h: BTN_H, label: '+' },
        { id: 'spin', x: 156, y: BTN_Y, w: W - 176 - 76, h: BTN_H, label: state === 'spinning' ? '···' : 'SPIN', big: true },
        { id: 'turbo', x: W - 88, y: BTN_Y, w: 68, h: BTN_H, label: '⚡', on: turbo },
      ]
    }

    function handleButton(id) {
      switch (id) {
        case 'minus': changeBet(-5); break
        case 'plus': changeBet(5); break
        case 'spin': if (state !== 'spinning') startSpin(); break
        case 'turbo': turbo = !turbo; break
        default: break
      }
    }

    // ---------- input ----------
    function pointFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const scale = W / rect.width
      return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale }
    }
    function onPointer(e) {
      e.preventDefault()
      if (auto) return
      const { x, y } = pointFromEvent(e)
      for (const b of buttons()) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { handleButton(b.id); return }
      }
    }
    function onKey(e) {
      if (auto) return
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (state !== 'spinning') startSpin() }
      else if (e.code === 'ArrowUp') { e.preventDefault(); changeBet(5) }
      else if (e.code === 'ArrowDown') { e.preventDefault(); changeBet(-5) }
      else if (e.code === 'KeyT') { e.preventDefault(); turbo = !turbo }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- autoplay loop ----------
    // setTimeout-based, fires reliably. One full cycle = spin + resolve + pause.
    function scheduleAuto(delay) {
      if (!auto) return
      clearTimeout(autoTimer)
      autoTimer = setTimeout(autoStep, delay)
    }
    function autoStep() {
      if (!auto) return
      if (state === 'spinning') { scheduleAuto(120); return } // wait for reels to land
      // idle or result -> start the next spin
      bet = Math.max(20, Math.min(balance, Math.round(balance * 0.02 / 5) * 5))
      startSpin()
      // re-check after the spin should have resolved; cadence ~1.4-2s total
      scheduleAuto(1700)
    }

    // ---------- drawing helpers ----------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function labelBar(text, cx, y, color, size) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = color
      ctx.font = `900 ${size}px system-ui, sans-serif`
      ctx.fillText(text, cx, y)
      const w = ctx.measureText(text).width
      ctx.fillRect(cx - w / 2, y + 6, w, 3)
    }

    // ---- symbol art: original neon glyphs ----
    function drawSymbol(idx, cx, cy, size, glow) {
      const sym = SYMBOLS[idx]
      ctx.save()
      if (glow) { ctx.shadowColor = sym.color; ctx.shadowBlur = 18 }
      ctx.strokeStyle = sym.color
      ctx.fillStyle = sym.color
      ctx.lineWidth = 3
      const s = size

      if (sym.id === 'cherry') {
        // two berries on stems
        ctx.lineWidth = 2.5
        ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.55); ctx.quadraticCurveTo(cx - s * 0.4, cy - s * 0.1, cx - s * 0.28, cy + s * 0.2); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.55); ctx.quadraticCurveTo(cx + s * 0.4, cy - s * 0.1, cx + s * 0.28, cy + s * 0.2); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx - s * 0.28, cy + s * 0.34, s * 0.2, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(cx + s * 0.28, cy + s * 0.34, s * 0.2, 0, Math.PI * 2); ctx.fill()
      } else if (sym.id === 'bell') {
        ctx.beginPath()
        ctx.moveTo(cx - s * 0.42, cy + s * 0.32)
        ctx.quadraticCurveTo(cx - s * 0.42, cy - s * 0.45, cx, cy - s * 0.48)
        ctx.quadraticCurveTo(cx + s * 0.42, cy - s * 0.45, cx + s * 0.42, cy + s * 0.32)
        ctx.closePath(); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy + s * 0.44, s * 0.1, 0, Math.PI * 2); ctx.fill()
      } else if (sym.id === 'bar') {
        roundRect(cx - s * 0.5, cy - s * 0.18, s, s * 0.36, 5); ctx.stroke()
        ctx.font = `900 ${Math.round(s * 0.34)}px system-ui, sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('BAR', cx, cy + 1)
      } else if (sym.id === 'gem') {
        ctx.beginPath()
        ctx.moveTo(cx, cy - s * 0.45)
        ctx.lineTo(cx + s * 0.45, cy - s * 0.1)
        ctx.lineTo(cx, cy + s * 0.5)
        ctx.lineTo(cx - s * 0.45, cy - s * 0.1)
        ctx.closePath(); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(cx - s * 0.45, cy - s * 0.1); ctx.lineTo(cx + s * 0.45, cy - s * 0.1); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.45); ctx.lineTo(cx, cy + s * 0.5); ctx.stroke()
      } else if (sym.id === 'star') {
        ctx.beginPath()
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * (Math.PI * 2 / 5)
          const a2 = a + Math.PI / 5
          ctx.lineTo(cx + Math.cos(a) * s * 0.5, cy + Math.sin(a) * s * 0.5)
          ctx.lineTo(cx + Math.cos(a2) * s * 0.22, cy + Math.sin(a2) * s * 0.22)
        }
        ctx.closePath(); ctx.stroke()
      } else if (sym.id === 'seven') {
        ctx.font = `900 ${Math.round(s * 0.95)}px Georgia, serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('7', cx, cy + 2)
      } else if (sym.id === 'logo') {
        // 10x wordmark
        ctx.font = `900 ${Math.round(s * 0.5)}px system-ui, sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillStyle = PINK
        ctx.fillText('10', cx - s * 0.18, cy + 1)
        ctx.fillStyle = CYAN
        ctx.fillText('x', cx + s * 0.28, cy + 1)
      }
      ctx.restore()
    }

    function drawButton(b) {
      const big = b.big
      roundRect(b.x, b.y, b.w, b.h, 14)
      if (big) {
        const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h)
        g.addColorStop(0, 'rgba(255,45,111,0.35)')
        g.addColorStop(1, 'rgba(255,45,111,0.12)')
        ctx.fillStyle = g
        ctx.shadowColor = PINK; ctx.shadowBlur = 18
        ctx.fill()
        ctx.shadowBlur = 0
      } else {
        ctx.fillStyle = b.on ? 'rgba(255,214,10,0.22)' : 'rgba(255,45,111,0.12)'
        ctx.fill()
      }
      ctx.lineWidth = 2.5
      ctx.strokeStyle = b.on ? GOLD : PINK
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.font = big ? '900 26px system-ui, sans-serif' : '800 22px system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1)
    }

    // ---------- reel window geometry ----------
    const REEL_TOP = 188
    const REEL_PAD = 18
    const REEL_W = (W - REEL_PAD * 2)
    const CELL_W = REEL_W / 5
    const ROWS = 3
    const CELL_H = 108
    const REEL_H = CELL_H * ROWS

    // The symbol shown in reel r, visible row vr (0..2), given the animated offset.
    function visibleSym(r, vr) {
      const s = strips[r]
      const topIdx = Math.floor(reels[r].offset)
      return s[((topIdx + vr) % s.length + s.length) % s.length]
    }

    // ---------- main draw ----------
    function draw() {
      // background
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      const bg = ctx.createRadialGradient(W / 2, H * 0.32, 40, W / 2, H * 0.32, H * 0.7)
      bg.addColorStop(0, 'rgba(255,45,111,0.10)')
      bg.addColorStop(1, 'rgba(255,45,111,0)')
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
      sparkle(20, 22, 6); sparkle(W - 20, 22, 6)

      // title
      labelBar('10x SLOTS', W / 2, 50, PINK, 30)

      // readouts
      ctx.textBaseline = 'alphabetic'
      ctx.font = '800 16px system-ui, sans-serif'
      ctx.textAlign = 'left'; ctx.fillStyle = GOLD
      ctx.fillText('BALANCE ' + Math.round(balance), 20, 92)
      ctx.textAlign = 'right'; ctx.fillStyle = MUTED
      ctx.fillText('BEST ' + best, W - 20, 92)
      ctx.textAlign = 'left'; ctx.fillStyle = '#fff'
      ctx.fillText('BET ' + bet, 20, 116)
      ctx.textAlign = 'right'
      ctx.fillStyle = lastWin > 0 ? GREEN : MUTED
      ctx.fillText('WIN ' + Math.round(payoutShown), W - 20, 116)

      // paytable hint (top symbols)
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(138,147,173,0.85)'
      ctx.font = '700 12px system-ui, sans-serif'
      ctx.fillText('10x=15/50/150x  7=10/30/75x  ★=8/20/50x   (3/4/5 of a kind)', W / 2, 150)

      // ----- slot frame -----
      ctx.save()
      roundRect(REEL_PAD - 8, REEL_TOP - 10, REEL_W + 16, REEL_H + 20, 16)
      ctx.shadowColor = PINK; ctx.shadowBlur = 26
      ctx.strokeStyle = PINK; ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()

      // reel window background (clip)
      ctx.save()
      roundRect(REEL_PAD, REEL_TOP, REEL_W, REEL_H, 10)
      ctx.fillStyle = '#13131c'
      ctx.fill()
      ctx.clip()

      for (let r = 0; r < 5; r++) {
        const rx = REEL_PAD + r * CELL_W
        // draw 4 cells so scrolling looks continuous (one extra above)
        const frac = reels[r].offset - Math.floor(reels[r].offset)
        for (let vr = -1; vr < ROWS + 1; vr++) {
          const symIdx = visibleSym(r, ((vr % strips[r].length) + strips[r].length) % strips[r].length)
          const cy = REEL_TOP + (vr - frac) * CELL_H + CELL_H / 2
          if (cy < REEL_TOP - CELL_H || cy > REEL_TOP + REEL_H + CELL_H) continue
          // is this a winning cell? (only when resolved + flashing)
          let win = false
          if (state === 'result' && reels[r].spinning === false) {
            const actualRow = vr // when stopped, vr 0..2 are the locked rows
            for (const wl of winLines) {
              if (wl.line < PAYLINES.length && r < wl.count && PAYLINES[wl.line][r] === actualRow) win = true
            }
          }
          const flashOn = Math.floor(winFlash / 180) % 2 === 0
          drawSymbol(symIdx, rx + CELL_W / 2, cy, Math.min(CELL_W, CELL_H) * 0.62, win && flashOn)
          if (win && flashOn) {
            ctx.save()
            roundRect(rx + 4, REEL_TOP + vr * CELL_H + 4, CELL_W - 8, CELL_H - 8, 8)
            ctx.strokeStyle = GREEN; ctx.lineWidth = 3
            ctx.shadowColor = GREEN; ctx.shadowBlur = 14
            ctx.stroke()
            ctx.restore()
          }
        }
      }
      ctx.restore()

      // reel separators + row guides
      ctx.strokeStyle = 'rgba(255,45,111,0.18)'; ctx.lineWidth = 1
      for (let r = 1; r < 5; r++) {
        const x = REEL_PAD + r * CELL_W
        ctx.beginPath(); ctx.moveTo(x, REEL_TOP); ctx.lineTo(x, REEL_TOP + REEL_H); ctx.stroke()
      }

      // result banner
      const bannerY = REEL_TOP + REEL_H + 44
      if (state === 'result' && lastWin > 0) {
        const flashOn = Math.floor(winFlash / 180) % 2 === 0
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = flashOn ? GOLD : GREEN
        ctx.font = '900 28px system-ui, sans-serif'
        ctx.shadowColor = GREEN; ctx.shadowBlur = flashOn ? 20 : 8
        ctx.fillText('WIN +' + Math.round(payoutShown), W / 2, bannerY)
        ctx.shadowBlur = 0
      } else if (state === 'result') {
        ctx.textAlign = 'center'; ctx.fillStyle = MUTED
        ctx.font = '700 16px system-ui, sans-serif'
        ctx.fillText('No win — spin again', W / 2, bannerY)
      } else if (state === 'idle') {
        ctx.textAlign = 'center'; ctx.fillStyle = MUTED
        ctx.font = '700 16px system-ui, sans-serif'
        ctx.fillText('Set your bet and SPIN', W / 2, bannerY)
      } else {
        ctx.textAlign = 'center'; ctx.fillStyle = PINK
        ctx.font = '800 18px system-ui, sans-serif'
        ctx.fillText('SPINNING…', W / 2, bannerY)
      }

      // buttons
      for (const b of buttons()) drawButton(b)

      // footer hint
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(138,147,173,0.6)'
      ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillText(auto ? 'AUTOPLAY DEMO' : 'Space Spin · ↑↓ Bet · T Turbo · 8 paylines', W / 2, H - 14)
    }

    // ---------- rAF loop: advance reel scroll + payout count-up + redraw ----------
    function frame(ts) {
      const dt = lastTs ? Math.min(64, ts - lastTs) : 16
      lastTs = ts

      if (state === 'spinning') {
        const now = ts
        for (let r = 0; r < 5; r++) {
          const reel = reels[r]
          if (!reel.spinning) continue
          if (now < reel.stopAt) {
            // free spin: scroll down the strip
            reel.offset += reel.vel * dt
          } else {
            // ease toward the target index, then snap
            const s = strips[r]
            // shortest forward distance from current offset to target (top row)
            let cur = ((reel.offset % s.length) + s.length) % s.length
            let dist = (reel.target - cur)
            dist = ((dist % s.length) + s.length) % s.length
            if (dist < 0.04 || dist > s.length - 0.5) {
              snapReel(r)
            } else {
              // approach with eased velocity (never overshoot past target)
              const step = Math.max(0.012 * dt, dist * 0.18)
              reel.offset += Math.min(step, dist)
            }
          }
        }
        if (allStopped()) {
          resolveSpin()
        }
      }

      // payout count-up
      if (payoutShown < payoutTarget) {
        payoutShown = Math.min(payoutTarget, payoutShown + Math.max(1, payoutTarget / 30))
      }
      // winning-line flash timer
      if (state === 'result' && winLines.length) winFlash += dt

      draw()
      raf = requestAnimationFrame(frame)
    }

    if (auto) scheduleAuto(700)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(autoTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="slots-canvas"
      aria-label="Slots game"
    />
  )
}
