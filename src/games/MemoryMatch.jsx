import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Memory (concentration) match-the-pairs on canvas, 10x neon style.
// 4x4 grid = 8 pairs. Fewest moves wins; best persisted to localStorage.
const N = 4
const CELL = 96
const GAP = 12
const PAD = 24
const HEADER = 64
const BOARD = N * CELL + (N - 1) * GAP
const BOARD_X = PAD
const BOARD_Y = PAD + HEADER
const W = PAD * 2 + BOARD // 480
const H = BOARD_Y + BOARD + PAD + 22 // 560

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const MUTED = '#8a93ad'
const HS_KEY = '10xgames.memory.best'

const SYMBOLS = ['🚀', '⭐', '💎', '🎮', '🔥', '⚡', '🎯', '👾']
const FLIP_MS = 220 // half-flip duration (scale-x 1→0 or 0→1)
const MISMATCH_MS = 700 // hold before flipping mismatched cards back

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function MemoryMatch() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('memory')

    let cards, first, second, moves, lock, matchedCount, state, best
    let raf = 0, mismatchTimer = 0
    best = Number(localStorage.getItem(HS_KEY)) || 0

    function reset() {
      const deck = shuffle([...SYMBOLS, ...SYMBOLS])
      cards = deck.map((sym) => ({
        sym,
        // face: 0 = down, 1 = up; flip = animated progress toward face
        face: 0,
        flip: 0, // 0..1 visual reveal (1 = fully shown)
        matched: false,
        flipStart: 0, // timestamp the current flip animation began
        flipFrom: 0, // flip value at animation start
      }))
      first = -1
      second = -1
      moves = 0
      lock = false
      matchedCount = 0
      state = 'playing'
      clearTimeout(mismatchTimer)
    }

    function startFlip(card, toFace, now) {
      card.face = toFace
      card.flipStart = now
      card.flipFrom = card.flip
    }

    function flip(i) {
      if (state !== 'playing' || lock) return
      const c = cards[i]
      if (c.matched || c.face === 1 || i === first) return
      const now = performance.now()
      startFlip(c, 1, now)

      if (first === -1) {
        first = i
        return
      }
      // second card of a pair attempt
      second = i
      moves++
      lock = true
      if (cards[first].sym === cards[second].sym) {
        // match: mark after they finish flipping up
        mismatchTimer = setTimeout(() => {
          cards[first].matched = true
          cards[second].matched = true
          matchedCount++
          first = -1
          second = -1
          lock = false
          if (matchedCount === SYMBOLS.length) {
            state = 'won'
            if (best === 0 || moves < best) {
              best = moves
              localStorage.setItem(HS_KEY, String(best))
            }
          }
        }, FLIP_MS + 60)
      } else {
        // mismatch: flip both back after a delay
        mismatchTimer = setTimeout(() => {
          const t = performance.now()
          startFlip(cards[first], 0, t)
          startFlip(cards[second], 0, t)
          first = -1
          second = -1
          lock = false
        }, MISMATCH_MS)
      }
    }

    // ---------- input ----------
    function cellFromXY(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width) - BOARD_X
      const y = (e.clientY - rect.top) * (H / rect.height) - BOARD_Y
      if (x < 0 || y < 0 || x >= BOARD || y >= BOARD) return -1
      const col = Math.floor(x / (CELL + GAP))
      const row = Math.floor(y / (CELL + GAP))
      if (col < 0 || col >= N || row < 0 || row >= N) return -1
      // reject the gap regions
      if (x - col * (CELL + GAP) > CELL) return -1
      if (y - row * (CELL + GAP) > CELL) return -1
      return row * N + col
    }
    function onPointer(e) {
      e.preventDefault()
      if (state === 'won') { reset(); return }
      const i = cellFromXY(e)
      if (i >= 0) flip(i)
    }
    function onKey(e) {
      if (e.code === 'Space') {
        e.preventDefault()
        if (state === 'won') reset()
      } else if (e.code === 'KeyR') {
        e.preventDefault()
        reset()
      }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    function roundRect(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2)
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

    function cellXY(i) {
      const r = Math.floor(i / N), c = i % N
      return [BOARD_X + c * (CELL + GAP), BOARD_Y + r * (CELL + GAP)]
    }

    // update flip animation progress for one card
    function updateCard(card, now) {
      const elapsed = now - card.flipStart
      const t = Math.min(1, elapsed / FLIP_MS)
      const target = card.face // 1 up, 0 down
      card.flip = card.flipFrom + (target - card.flipFrom) * t
    }

    function drawCard(card, x, y, now) {
      updateCard(card, now)
      const flip = card.flip
      const showFace = flip > 0.5 // past the midpoint we render the face content
      // scale-x flip: width shrinks to 0 at 0.5 then grows back
      const scaleX = Math.abs(flip - 0.5) * 2 // 1 at flip=0 or 1, 0 at 0.5
      const cw = CELL * scaleX
      const cx = x + (CELL - cw) / 2

      const pulse = card.matched ? 0.5 + 0.5 * Math.sin(now / 260) : 0

      if (showFace) {
        // face-up tile
        ctx.fillStyle = '#23232e'
        roundRect(cx, y, cw, CELL, 12); ctx.fill()
        if (card.matched) {
          ctx.shadowColor = PINK; ctx.shadowBlur = 14 + pulse * 12
          ctx.strokeStyle = CYAN; ctx.lineWidth = 3
          roundRect(cx + 1.5, y + 1.5, cw - 3, CELL - 3, 11); ctx.stroke()
          ctx.shadowColor = CYAN; ctx.shadowBlur = 10 + pulse * 10
          ctx.strokeStyle = PINK; ctx.lineWidth = 2
          roundRect(cx + 1.5, y + 1.5, cw - 3, CELL - 3, 11); ctx.stroke()
          ctx.shadowBlur = 0
        } else {
          ctx.strokeStyle = 'rgba(255,45,111,0.55)'; ctx.lineWidth = 2
          roundRect(cx + 1, y + 1, cw - 2, CELL - 2, 11); ctx.stroke()
        }
        // symbol (only render when wide enough so it doesn't look squished)
        if (scaleX > 0.35) {
          ctx.save()
          ctx.translate(x + CELL / 2, y + CELL / 2)
          ctx.scale(scaleX, 1)
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.font = '44px system-ui, sans-serif'
          ctx.fillText(card.sym, 0, 4)
          ctx.restore()
        }
      } else {
        // face-down tile
        ctx.fillStyle = '#15151c'
        roundRect(cx, y, cw, CELL, 12); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2
        roundRect(cx + 1, y + 1, cw - 2, CELL - 2, 11); ctx.stroke()
        if (scaleX > 0.35) {
          ctx.save()
          ctx.translate(x + CELL / 2, y + CELL / 2)
          ctx.scale(scaleX, 1)
          ctx.fillStyle = PINK
          ctx.font = '800 40px system-ui, sans-serif'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText('+', 0, 2)
          ctx.restore()
        }
      }
      ctx.textBaseline = 'alphabetic'
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.85)'
      roundRect(BOARD_X, BOARD_Y, BOARD, BOARD, 14); ctx.fill()
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 30px system-ui, sans-serif'
      ctx.fillText(title, BOARD_X + BOARD / 2, BOARD_Y + BOARD / 2 - 6)
      ctx.fillStyle = PINK
      ctx.fillRect(BOARD_X + BOARD / 2 - 60, BOARD_Y + BOARD / 2 + 8, 120, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, BOARD_X + BOARD / 2, BOARD_Y + BOARD / 2 + 38)
    }

    function draw(now) {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 24, 22, 5); sparkle(24, H - 22, 4)

      // header: MOVES (left) + BEST (right)
      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('MOVES', PAD, PAD + 12); ctx.fillRect(PAD, PAD + 17, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 26px system-ui, sans-serif'
      ctx.fillText(String(moves), PAD, PAD + 48)

      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'right'
      ctx.fillText('BEST', W - PAD, PAD + 12); ctx.fillRect(W - PAD - 22, PAD + 17, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 26px system-ui, sans-serif'
      ctx.fillText(best ? String(best) : '—', W - PAD, PAD + 48)

      // cards
      for (let i = 0; i < cards.length; i++) {
        const [x, y] = cellXY(i)
        drawCard(cards[i], x, y, now)
      }

      if (state === 'won') overlay('CLEARED IN ' + moves + ' MOVES', 'tap / space to play again')
    }

    function loop(now) { draw(now); raf = requestAnimationFrame(loop) }

    // ---------- autoplay bot ----------
    // Strong memory bot wins by clearing the board in few moves; a ~5% "lose"
    // round flips at random and blows past the move threshold.
    const WIN_MOVES = 14 // clear in <= this many moves to count as a win
    let botTimer = 0
    let wantWin = shouldAutoWin('memory')
    const seen = new Map() // id -> sym (every card symbol the bot has revealed)
    let restartArmed = false

    function botStep() {
      if (state === 'won') {
        // board cleared: record the result once, pause, then start a fresh round
        if (!restartArmed) {
          restartArmed = true
          recordAutoplayResult('memory', moves <= WIN_MOVES)
          botTimer = setTimeout(() => {
            restartArmed = false
            seen.clear()
            wantWin = shouldAutoWin('memory')
            reset()
            scheduleBot(700)
          }, 1600)
        }
        return
      }
      if (lock) { scheduleBot(140); return } // only act when idle (not mid flip-back)

      // learn from any face-up, unmatched cards currently visible
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i]
        if (c.face === 1 && !c.matched) seen.set(i, c.sym)
      }

      const downIdx = []
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i]
        if (!c.matched && c.face === 0 && i !== first) downIdx.push(i)
      }
      if (downIdx.length === 0) { scheduleBot(300); return }

      let pick = -1
      if (wantWin) {
        // perfect-recall play: flip known matching pairs immediately; when
        // forced to explore, reveal an unknown card and if it turns out we
        // already know its match, complete the pair on the next step.
        if (first === -1) {
          const known = findKnownPair(downIdx)
          pick = known ? known[0] : pickUnknown(downIdx)
        } else {
          // a first card is up: if we know where its match is, flip it now
          const want = cards[first].sym
          let match = -1
          for (const i of downIdx) {
            if (i !== first && seen.get(i) === want) { match = i; break }
          }
          // otherwise reveal a new unknown card (cheapest way to learn)
          pick = match >= 0 ? match : pickUnknown(downIdx)
        }
      } else {
        // sloppy: flip a random face-down card every turn (no memory used)
        pick = downIdx[Math.floor(Math.random() * downIdx.length)]
      }

      if (pick >= 0) flip(pick)
      scheduleBot(600 + Math.floor(Math.random() * 250)) // smooth 600-850ms
    }

    function findKnownPair(downIdx) {
      const bySym = new Map()
      for (const i of downIdx) {
        const s = seen.get(i)
        if (s == null) continue
        if (bySym.has(s)) return [bySym.get(s), i]
        bySym.set(s, i)
      }
      return null
    }

    function pickUnknown(downIdx) {
      const unknown = downIdx.filter((i) => !seen.has(i))
      if (unknown.length) return unknown[Math.floor(Math.random() * unknown.length)]
      return downIdx[Math.floor(Math.random() * downIdx.length)]
    }

    function scheduleBot(ms) {
      clearTimeout(botTimer)
      botTimer = setTimeout(botStep, ms)
    }

    reset()
    raf = requestAnimationFrame(loop)
    if (auto) scheduleBot(700)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(mismatchTimer)
      clearTimeout(botTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="memory-canvas" aria-label="Memory match game" />
  )
}
