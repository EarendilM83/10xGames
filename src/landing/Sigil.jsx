import { useEffect, useRef } from 'react'

// A small generative "sigil" drawn per game — a distinctive abstract mark in the
// game's accent colour, deterministic from its id. Replaces emoji with crafted art.
const SIZE = 60

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function Sigil({ id, accent = '#8b6dff' }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = SIZE * dpr; canvas.height = SIZE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const rng = mulberry32(hash(id))
    const c = SIZE / 2
    const kind = Math.floor(rng() * 5)

    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.strokeStyle = accent
    ctx.fillStyle = accent
    ctx.lineWidth = 1.6
    ctx.lineCap = 'round'

    if (kind === 0) {
      // concentric orbit rings + a satellite dot
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.35 + i * 0.18
        ctx.beginPath(); ctx.arc(c, c, 7 + i * 6, 0, Math.PI * 2); ctx.stroke()
      }
      const a = rng() * Math.PI * 2
      ctx.globalAlpha = 1
      ctx.beginPath(); ctx.arc(c + Math.cos(a) * 19, c + Math.sin(a) * 19, 3.2, 0, Math.PI * 2); ctx.fill()
    } else if (kind === 1) {
      // constellation: seeded points joined by lines
      const pts = Array.from({ length: 5 }, () => [8 + rng() * 44, 8 + rng() * 44])
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
      ctx.globalAlpha = 1
      for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill() }
    } else if (kind === 2) {
      // dot grid with a few accented
      for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < 4; gy++) {
        const x = 12 + gx * 12, y = 12 + gy * 12
        const on = rng() < 0.4
        ctx.globalAlpha = on ? 1 : 0.25
        ctx.beginPath(); ctx.arc(x, y, on ? 3 : 1.6, 0, Math.PI * 2); ctx.fill()
      }
    } else if (kind === 3) {
      // nested arcs (a "rising" motif)
      ctx.globalAlpha = 1
      for (let i = 0; i < 3; i++) {
        const off = rng() * 0.6
        ctx.globalAlpha = 0.45 + i * 0.2
        ctx.beginPath(); ctx.arc(c, c + 6, 9 + i * 7, Math.PI + off, Math.PI * 2 - off); ctx.stroke()
      }
    } else {
      // vertical bars (an "equalizer / score" motif)
      const n = 5
      for (let i = 0; i < n; i++) {
        const bx = 11 + i * 9.5
        const bh = 8 + rng() * 28
        ctx.globalAlpha = 0.55 + (bh / 36) * 0.45
        ctx.fillRect(bx - 2.2, c + 18 - bh, 4.4, bh)
      }
    }
    ctx.globalAlpha = 1
  }, [id, accent])

  return <canvas ref={ref} className="sigil" width={SIZE} height={SIZE} aria-hidden />
}
