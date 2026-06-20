import { useEffect, useRef } from 'react'

// Original animated focal visual: a softly-glowing violet planet with an orbiting
// ring and a few satellites. Echoes the 10x cosmic mood without copying its artwork.
const W = 440
const H = 440

export default function HeroOrb() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cx = W / 2, cy = H / 2
    const R = 96
    let raf = 0, t0 = performance.now()
    const sats = [
      { rad: 150, sp: 0.22, ph: 0, size: 4.5, col: '#ff5d8f' },
      { rad: 150, sp: 0.22, ph: 2.1, size: 3, col: '#8b6dff' },
      { rad: 184, sp: -0.13, ph: 1.0, size: 3.5, col: '#5ad1ff' },
    ]

    function draw(now) {
      const t = reduce ? 0 : (now - t0) / 1000
      ctx.clearRect(0, 0, W, H)

      // soft outer glow
      const glow = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.4)
      glow.addColorStop(0, 'rgba(139,109,255,0.45)')
      glow.addColorStop(0.5, 'rgba(90,120,255,0.12)')
      glow.addColorStop(1, 'rgba(10,8,16,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)

      // tilted orbit ring (behind)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-0.42)
      ctx.scale(1, 0.34)
      ctx.strokeStyle = 'rgba(205,184,255,0.35)'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, 0, 150, Math.PI, Math.PI * 2); ctx.stroke() // back half
      ctx.restore()

      // the planet — radial gradient sphere
      const pulse = reduce ? 1 : 1 + Math.sin(t * 0.9) * 0.012
      const r = R * pulse
      const sphere = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r)
      sphere.addColorStop(0, '#b79bff')
      sphere.addColorStop(0.45, '#7a5cf0')
      sphere.addColorStop(1, '#3b2b8c')
      ctx.fillStyle = sphere
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()

      // a teal "sea" band across the lower planet (clipped)
      ctx.save()
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
      const band = ctx.createLinearGradient(0, cy + r * 0.05, 0, cy + r)
      band.addColorStop(0, 'rgba(46,224,196,0.0)')
      band.addColorStop(0.4, 'rgba(40,200,180,0.55)')
      band.addColorStop(1, 'rgba(30,150,200,0.55)')
      ctx.fillStyle = band
      ctx.beginPath()
      ctx.ellipse(cx, cy + r * 0.5, r * 1.1, r * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()
      // rim light
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()

      // tilted orbit ring (front)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-0.42)
      ctx.scale(1, 0.34)
      ctx.strokeStyle = 'rgba(205,184,255,0.5)'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI); ctx.stroke() // front half
      ctx.restore()

      // satellites orbiting (simple circular orbits, tilted)
      for (const s of sats) {
        const a = s.ph + t * s.sp
        const ox = Math.cos(a) * s.rad
        const oy = Math.sin(a) * s.rad * 0.34
        // rotate the orbit plane to match the ring tilt
        const rx = ox * Math.cos(-0.42) - oy * Math.sin(-0.42)
        const ry = ox * Math.sin(-0.42) + oy * Math.cos(-0.42)
        ctx.fillStyle = s.col
        ctx.shadowColor = s.col; ctx.shadowBlur = 10
        ctx.beginPath(); ctx.arc(cx + rx, cy + ry, s.size, 0, Math.PI * 2); ctx.fill()
        ctx.shadowBlur = 0
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={ref} width={W} height={H} className="hero-orb" aria-hidden />
}
