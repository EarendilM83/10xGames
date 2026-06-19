import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Classic Wordle on canvas, 10x neon-on-black style.
const W = 380
const H = 600

const PINK = '#ff2d6f'
const MUTED = '#8a93ad'
const GREEN = '#54e346'
const YELLOW = '#ffd60a'
const GRAY = '#3a3a44'

const ROWS = 6
const COLS = 5

// ~250 common 5-letter words. The secret answer is drawn at random from this list;
// any 5-letter A-Z guess is accepted (forgiving — unknown words allowed).
const ANSWERS = [
  'apple', 'beach', 'brain', 'bread', 'brick', 'bring', 'broad', 'brown', 'brush', 'build',
  'chair', 'chalk', 'charm', 'chart', 'chase', 'cheap', 'check', 'chest', 'chief', 'child',
  'clean', 'clear', 'click', 'climb', 'clock', 'close', 'cloth', 'cloud', 'coast', 'could',
  'count', 'court', 'cover', 'crack', 'craft', 'crash', 'cream', 'crime', 'cross', 'crowd',
  'crown', 'crude', 'curve', 'cycle', 'daily', 'dance', 'dealt', 'death', 'delay', 'depth',
  'dirty', 'doubt', 'dozen', 'draft', 'drama', 'drank', 'drawn', 'dream', 'dress', 'drift',
  'drill', 'drink', 'drive', 'eager', 'early', 'earth', 'eight', 'elite', 'empty', 'enemy',
  'enjoy', 'enter', 'entry', 'equal', 'error', 'event', 'every', 'exact', 'exist', 'extra',
  'faith', 'false', 'fault', 'favor', 'fence', 'field', 'fifth', 'fifty', 'fight', 'final',
  'first', 'fixed', 'flame', 'flash', 'fleet', 'float', 'floor', 'flour', 'fluid', 'focus',
  'force', 'forth', 'forty', 'forum', 'found', 'frame', 'frank', 'fraud', 'fresh', 'front',
  'frost', 'fruit', 'fully', 'funny', 'ghost', 'giant', 'given', 'glass', 'globe', 'glory',
  'grace', 'grade', 'grain', 'grand', 'grant', 'grape', 'graph', 'grass', 'grave', 'great',
  'green', 'greet', 'gross', 'group', 'grown', 'guard', 'guess', 'guest', 'guide', 'happy',
  'harsh', 'heart', 'heavy', 'hello', 'hence', 'hobby', 'honor', 'horse', 'hotel', 'house',
  'human', 'humor', 'ideal', 'image', 'index', 'inner', 'input', 'issue', 'ivory', 'joint',
  'judge', 'juice', 'knife', 'knock', 'known', 'label', 'large', 'laser', 'later', 'laugh',
  'layer', 'learn', 'least', 'leave', 'legal', 'lemon', 'level', 'light', 'limit', 'liver',
  'local', 'logic', 'loose', 'lower', 'loyal', 'lucky', 'lunch', 'lying', 'magic', 'major',
  'maker', 'march', 'match', 'maybe', 'mayor', 'meant', 'medal', 'media', 'melon', 'mercy',
  'merit', 'metal', 'meter', 'might', 'minor', 'mixed', 'model', 'money', 'month', 'moral',
  'motor', 'mount', 'mouse', 'mouth', 'movie', 'music', 'naked', 'nasty', 'naval', 'nerve',
  'never', 'newly', 'night', 'noble', 'noise', 'north', 'novel', 'nurse', 'ocean', 'offer',
  'often', 'olive', 'onion', 'order', 'other', 'ought', 'outer', 'owner', 'paint', 'panel',
  'paper', 'party', 'paste', 'patch', 'peace', 'pearl', 'pedal', 'phase', 'phone', 'photo',
  'piano', 'piece', 'pilot', 'pitch', 'place', 'plain', 'plane', 'plant', 'plate', 'plaza',
  'point', 'porch', 'pound', 'power', 'press', 'price', 'pride', 'prime', 'print', 'prior',
  'prize', 'proof', 'proud', 'prove', 'pulse', 'pupil', 'queen', 'query', 'quest', 'quick',
  'quiet', 'quite', 'quota', 'radio', 'raise', 'range', 'rapid', 'ratio', 'reach', 'react',
  'ready', 'realm', 'rebel', 'refer', 'relax', 'reply', 'rider', 'ridge', 'rifle', 'right',
  'rigid', 'risky', 'rival', 'river', 'roast', 'robot', 'rough', 'round', 'route', 'royal',
  'rural', 'sadly', 'salad', 'sauce', 'scale', 'scare', 'scene', 'scope', 'score', 'scout',
  'sense', 'serve', 'seven', 'shade', 'shake', 'shall', 'shame', 'shape', 'share', 'sharp',
  'sheep', 'sheet', 'shelf', 'shell', 'shift', 'shine', 'shirt', 'shock', 'shoot', 'shore',
  'short', 'shown', 'sight', 'silly', 'since', 'sixth', 'sixty', 'skill', 'sleep', 'slice',
  'slide', 'small', 'smart', 'smell', 'smile', 'smoke', 'snake', 'solar', 'solid', 'solve',
  'sorry', 'sound', 'south', 'space', 'spare', 'speak', 'speed', 'spell', 'spend', 'spent',
  'spice', 'spite', 'split', 'spoke', 'sport', 'staff', 'stage', 'stair', 'stake', 'stand',
  'stark', 'start', 'state', 'steam', 'steel', 'steep', 'steam', 'stick', 'still', 'stock',
  'stone', 'stood', 'store', 'storm', 'story', 'stove', 'strap', 'straw', 'strip', 'study',
  'stuff', 'style', 'sugar', 'suite', 'sunny', 'super', 'sweet', 'swell', 'swift', 'swing',
  'sword', 'table', 'taken', 'taste', 'taxes', 'teach', 'teeth', 'tempo', 'tenth', 'thank',
  'theft', 'their', 'theme', 'there', 'these', 'thick', 'thief', 'thing', 'think', 'third',
  'those', 'three', 'threw', 'throw', 'thumb', 'tight', 'title', 'toast', 'today', 'token',
  'topic', 'total', 'touch', 'tough', 'tower', 'track', 'trade', 'trail', 'train', 'treat',
  'trend', 'trial', 'tribe', 'trick', 'troop', 'truck', 'truly', 'trunk', 'trust', 'truth',
  'twice', 'twist', 'ultra', 'uncle', 'under', 'union', 'unite', 'unity', 'until', 'upper',
  'upset', 'urban', 'usage', 'usual', 'value', 'video', 'virus', 'visit', 'vital', 'vocal',
  'voice', 'voter', 'wagon', 'waste', 'watch', 'water', 'weary', 'wheat', 'wheel', 'where',
  'which', 'while', 'white', 'whole', 'whose', 'witch', 'woman', 'world', 'worry', 'worse',
  'worst', 'worth', 'would', 'wound', 'wrist', 'write', 'wrong', 'wrote', 'yacht', 'yield',
  'young', 'youth', 'alloy', 'angle', 'ankle', 'amber',
]

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '⏎aszxcvbnm⌫']
const TOP = 'qwertyuiop'
const MID = 'asdfghjkl'
const BOT = 'zxcvbnm'

const BEST_KEY = '10xgames.wordle.best'

export default function Wordle() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('wordle')

    let answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]
    let guesses = []          // array of submitted guess strings (lowercase)
    let states = []           // array of per-letter state arrays: 'green'|'yellow'|'gray'
    let current = ''          // letters typed in the active row
    let state = 'playing'     // 'playing' | 'over'
    let won = false
    let keyState = {}         // letter -> best known 'green'|'yellow'|'gray'
    let streak = 0            // current win streak
    let best = Number(localStorage.getItem(BEST_KEY)) || 0

    // animation: flip reveal of the last-submitted row
    let flipRow = -1          // which row index is flipping (-1 = none)
    let flipStart = 0
    const FLIP_PER_TILE = 280 // ms per tile
    const FLIP_STAGGER = 180  // ms delay between tiles

    // shake on invalid input
    let shakeRow = -1
    let shakeStart = 0
    const SHAKE_MS = 360

    let raf = 0

    // ---------- layout ----------
    const GRID_TOP = 96
    const TILE = 56
    const TILE_GAP = 8
    const gridW = COLS * TILE + (COLS - 1) * TILE_GAP
    const gridX = (W - gridW) / 2

    function tilePos(r, c) {
      return {
        x: gridX + c * (TILE + TILE_GAP),
        y: GRID_TOP + r * (TILE + TILE_GAP),
      }
    }

    // ---------- keyboard layout ----------
    const KB_TOP = GRID_TOP + ROWS * TILE + (ROWS - 1) * TILE_GAP + 40
    const KEY_H = 50
    const KEY_GAP = 6
    const KB_PAD = 8

    // Build key rectangles. Row 3 has ENTER (wide) + letters + backspace (wide).
    function buildKeys() {
      const keys = []
      // rows 1 & 2: plain letters
      const rowLetters = [TOP, MID]
      rowLetters.forEach((letters, ri) => {
        const n = letters.length
        const kw = (W - 2 * KB_PAD - (n - 1) * KEY_GAP) / n
        // row 2 (asdf) is slightly inset to mimic real keyboards
        const inset = ri === 1 ? kw * 0.5 : 0
        const totalW = n * kw + (n - 1) * KEY_GAP
        const startX = (W - totalW) / 2
        const y = KB_TOP + ri * (KEY_H + KEY_GAP)
        for (let i = 0; i < n; i++) {
          keys.push({
            label: letters[i], key: letters[i],
            x: startX + i * (kw + KEY_GAP), y, w: kw, h: KEY_H,
          })
        }
        void inset
      })
      // row 3: ENTER + zxcvbnm + backspace
      const ri = 2
      const y = KB_TOP + ri * (KEY_H + KEY_GAP)
      const n = BOT.length
      const letterKw = (W - 2 * KB_PAD - (n - 1 + 2) * KEY_GAP) / (n + 2 * 1.5)
      const wideKw = letterKw * 1.5
      let x = KB_PAD
      keys.push({ label: 'ENTER', key: 'enter', x, y, w: wideKw, h: KEY_H })
      x += wideKw + KEY_GAP
      for (let i = 0; i < n; i++) {
        keys.push({ label: BOT[i], key: BOT[i], x, y, w: letterKw, h: KEY_H })
        x += letterKw + KEY_GAP
      }
      keys.push({ label: '⌫', key: 'backspace', x, y, w: wideKw, h: KEY_H })
      return keys
    }
    const keys = buildKeys()
    void KEY_ROWS

    // ---------- Wordle coloring with correct duplicate handling ----------
    function scoreGuess(guess) {
      const res = new Array(COLS).fill('gray')
      const counts = {}
      for (const ch of answer) counts[ch] = (counts[ch] || 0) + 1
      // pass 1: greens
      for (let i = 0; i < COLS; i++) {
        if (guess[i] === answer[i]) {
          res[i] = 'green'
          counts[guess[i]]--
        }
      }
      // pass 2: yellows limited by remaining counts
      for (let i = 0; i < COLS; i++) {
        if (res[i] === 'green') continue
        const ch = guess[i]
        if (counts[ch] > 0) {
          res[i] = 'yellow'
          counts[ch]--
        }
      }
      return res
    }

    const RANK = { gray: 0, yellow: 1, green: 2 }
    function updateKeyState(guess, res) {
      for (let i = 0; i < COLS; i++) {
        const ch = guess[i]
        const s = res[i]
        if (!keyState[ch] || RANK[s] > RANK[keyState[ch]]) keyState[ch] = s
      }
    }

    // ---------- game flow ----------
    function newGame() {
      answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]
      guesses = []
      states = []
      current = ''
      state = 'playing'
      won = false
      keyState = {}
      flipRow = -1
      shakeRow = -1
    }

    function submit() {
      if (state !== 'playing') return
      if (current.length !== COLS) {
        shakeRow = guesses.length
        shakeStart = performance.now()
        return
      }
      const guess = current
      const res = scoreGuess(guess)
      guesses.push(guess)
      states.push(res)
      updateKeyState(guess, res)
      current = ''
      flipRow = guesses.length - 1
      flipStart = performance.now()
      if (guess === answer) {
        won = true
        state = 'over'
        streak += 1
        if (streak > best) {
          best = streak
          localStorage.setItem(BEST_KEY, String(best))
        }
      } else if (guesses.length >= ROWS) {
        won = false
        state = 'over'
        streak = 0
      }
    }

    function typeLetter(ch) {
      if (state !== 'playing') return
      if (current.length >= COLS) return
      current += ch
    }
    function backspace() {
      if (state !== 'playing') return
      current = current.slice(0, -1)
    }

    // ---------- input ----------
    function onKey(e) {
      if (state === 'over') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault()
          newGame()
        }
        return
      }
      if (e.code === 'Enter') { e.preventDefault(); submit(); return }
      if (e.code === 'Backspace') { e.preventDefault(); backspace(); return }
      const k = e.key
      if (k.length === 1 && /[a-zA-Z]/.test(k)) {
        e.preventDefault()
        typeLetter(k.toLowerCase())
      }
    }

    function onPointer(e) {
      const rect = canvas.getBoundingClientRect()
      const sx = W / rect.width
      const sy = H / rect.height
      const px = (e.clientX - rect.left) * sx
      const py = (e.clientY - rect.top) * sy
      if (state === 'over') { newGame(); return }
      for (const key of keys) {
        if (px >= key.x && px <= key.x + key.w && py >= key.y && py <= key.y + key.h) {
          if (key.key === 'enter') submit()
          else if (key.key === 'backspace') backspace()
          else typeLetter(key.key)
          return
        }
      }
    }

    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    function colorFor(s) {
      if (s === 'green') return GREEN
      if (s === 'yellow') return YELLOW
      if (s === 'gray') return GRAY
      return null
    }

    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function drawTile(r, c, now) {
      const { x, y } = tilePos(r, c)
      let letter = ''
      let st = null
      let revealed = false

      if (r < guesses.length) {
        letter = guesses[r][c].toUpperCase()
        st = states[r][c]
        revealed = true
      } else if (r === guesses.length && state === 'playing') {
        letter = current[c] ? current[c].toUpperCase() : ''
      }

      // shake offset
      let dx = 0
      if (r === shakeRow) {
        const t = (now - shakeStart) / SHAKE_MS
        if (t < 1) dx = Math.sin(t * Math.PI * 6) * 6 * (1 - t)
        else shakeRow = -1
      }

      // flip animation for the just-submitted row
      let scaleY = 1
      let showColor = revealed
      if (revealed && r === flipRow) {
        const elapsed = now - flipStart - c * FLIP_STAGGER
        if (elapsed < 0) {
          // not started: show as filled-but-uncolored
          scaleY = 1
          showColor = false
        } else if (elapsed < FLIP_PER_TILE) {
          const half = FLIP_PER_TILE / 2
          if (elapsed < half) {
            scaleY = 1 - elapsed / half
            showColor = false
          } else {
            scaleY = (elapsed - half) / half
            showColor = true
          }
        } else {
          scaleY = 1
          showColor = true
        }
      }

      const cx = x + TILE / 2 + dx
      const cy = y + TILE / 2

      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1, Math.max(0.02, scaleY))
      ctx.translate(-cx, -cy)

      const fill = showColor ? colorFor(st) : null
      if (fill) {
        ctx.shadowColor = fill
        ctx.shadowBlur = 14
        roundRect(x + dx, y, TILE, TILE, 6)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.shadowBlur = 0
      } else {
        // empty / filled-no-color tile
        roundRect(x + dx, y, TILE, TILE, 6)
        ctx.fillStyle = letter ? '#16161d' : '#0e0e12'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = letter ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)'
        ctx.stroke()
      }

      if (letter) {
        ctx.fillStyle = (showColor && st === 'yellow') ? '#0a0a0a'
          : (showColor && st === 'green') ? '#0a0a0a'
          : '#fff'
        ctx.font = '800 30px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(letter, cx, cy + 1)
      }
      ctx.restore()
    }

    function drawKey(key) {
      const ks = key.key.length === 1 ? keyState[key.key] : null
      const fill = ks ? colorFor(ks) : '#272730'
      roundRect(key.x, key.y, key.w, key.h, 6)
      if (ks) { ctx.shadowColor = fill; ctx.shadowBlur = 8 }
      ctx.fillStyle = fill
      ctx.fill()
      ctx.shadowBlur = 0

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const dark = ks === 'green' || ks === 'yellow'
      ctx.fillStyle = dark ? '#0a0a0a' : '#fff'
      const small = key.key === 'enter' || key.key === 'backspace'
      ctx.font = small ? '700 13px system-ui, sans-serif' : '700 18px system-ui, sans-serif'
      ctx.fillText(key.label.toUpperCase(), key.x + key.w / 2, key.y + key.h / 2 + 1)
    }

    function draw(now) {
      ctx.textBaseline = 'alphabetic'
      // background
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, W, H)
      sparkle(W - 24, 22, 5)
      sparkle(22, H - 22, 4)
      sparkle(24, 22, 4)

      // title
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK
      ctx.font = '800 30px system-ui, sans-serif'
      ctx.fillText('WORDLE', W / 2, 48)
      const tw = ctx.measureText('WORDLE').width
      ctx.fillRect(W / 2 - tw / 2, 58, tw, 4)

      // streak + best
      ctx.textAlign = 'left'
      ctx.fillStyle = MUTED
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText('STREAK  ' + streak, 18, 84)
      ctx.textAlign = 'right'
      ctx.fillText('BEST  ' + best, W - 18, 84)

      // tiles
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) drawTile(r, c, now)
      }

      // keyboard
      for (const key of keys) drawKey(key)

      // game over message overlay
      if (state === 'over') {
        const my = KB_TOP - 16
        ctx.textAlign = 'center'
        ctx.fillStyle = won ? GREEN : PINK
        ctx.font = '800 22px system-ui, sans-serif'
        const msg = won ? 'YOU WIN!' : 'ANSWER: ' + answer.toUpperCase()
        ctx.fillText(msg, W / 2, my)
        const mw = ctx.measureText(msg).width
        ctx.fillStyle = won ? GREEN : PINK
        ctx.fillRect(W / 2 - mw / 2, my + 6, mw, 3)
        ctx.fillStyle = MUTED
        ctx.font = '600 11px system-ui, sans-serif'
        ctx.fillText('enter / tap for a new word', W / 2, my + 22)
      }
    }

    function loop(now) {
      draw(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // ---------- autoplay bot ----------
    // Drives the game's own submit/type logic on a timer so the flip reveal is visible.
    // wantWin rounds: a couple plausible openers, then the actual answer (win by guess 2-4).
    // sloppy rounds: always wrong words, never the answer, so it loses after 6 and reveals it.
    let botTimer = 0
    const GUESS_MS = 900
    const RESTART_MS = 1600
    let botPlan = []
    let botPlanIdx = 0
    let botRecorded = false   // ensure recordAutoplayResult fires once per round

    // Type a full 5-letter word into the active row, then submit.
    function botPlayWord(word) {
      current = ''
      for (let i = 0; i < COLS && i < word.length; i++) typeLetter(word[i])
      submit()
    }

    // Pick a 5-letter word from ANSWERS that is NOT the answer and not already guessed.
    function botWrongWord() {
      for (let tries = 0; tries < 50; tries++) {
        const w = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]
        if (w !== answer && !guesses.includes(w)) return w
      }
      return answer === 'zzzzz' ? 'qqqqq' : 'zzzzz'
    }

    // Build the guess plan for a fresh round.
    function makePlan() {
      const wantWin = shouldAutoWin('wordle')
      if (wantWin) {
        // 1-2 plausible openers, then the real answer (read from game state) -> win by guess 2-4
        const openers = []
        const nOpeners = 1 + Math.floor(Math.random() * 2) // 1 or 2
        const pool = ['crane', 'slate', 'adieu', 'audio', 'roast', 'trace', 'stare']
        for (let i = 0; i < nOpeners; i++) {
          let w = pool[Math.floor(Math.random() * pool.length)]
          if (w === answer) w = botWrongWord()
          openers.push(w)
        }
        return [...openers, answer] // always lands the answer within 6 guesses
      }
      // sloppy (~5%): ROWS wrong words, never the answer -> guaranteed loss + reveal
      const plan = []
      for (let i = 0; i < ROWS; i++) plan.push(botWrongWord())
      return plan
    }

    function botStartRound() {
      newGame()
      botPlan = makePlan()
      botPlanIdx = 0
      botRecorded = false
    }

    function botTick() {
      botTimer = setTimeout(botTick, state === 'over' ? RESTART_MS : GUESS_MS)
      if (state === 'over') {
        // Round finished (solved within 6, or out of guesses). Record once, then restart.
        if (!botRecorded) {
          recordAutoplayResult('wordle', won === true)
          botRecorded = true
        }
        botStartRound()
        return
      }
      if (botPlanIdx < botPlan.length) {
        botPlayWord(botPlan[botPlanIdx])
        botPlanIdx++
      }
    }

    if (auto) {
      botStartRound()
      botTick()
    }

    return () => {
      cancelAnimationFrame(raf)
      if (botTimer) clearTimeout(botTimer)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="wordle-canvas" aria-label="Wordle game" />
  )
}
