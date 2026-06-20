import { useEffect, useRef } from 'react'

// Subtle drifting starfield behind the whole landing — original, restrained, cosmic.
export default function Starfield() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let stars = []
    let raf = 0
    let w = 0, h = 0

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round((w * h) / 9000) // density scales with viewport
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.1 + 0.3,
        a: Math.random() * 0.5 + 0.2,
        tw: Math.random() * Math.PI * 2,
        sp: Math.random() * 0.04 + 0.012, // slow vertical drift
        big: Math.random() < 0.04,
      }))
    }

    function draw(t) {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        if (!reduce) {
          s.y += s.sp
          if (s.y > h + 2) s.y = -2
        }
        const tw = reduce ? 1 : 0.6 + 0.4 * Math.sin(t * 0.0012 + s.tw)
        ctx.globalAlpha = s.a * tw
        if (s.big) {
          // a faint 4-point sparkle for the few larger stars
          ctx.strokeStyle = '#cdb8ff'
          ctx.lineWidth = 0.8
          const L = s.r * 3
          ctx.beginPath()
          ctx.moveTo(s.x - L, s.y); ctx.lineTo(s.x + L, s.y)
          ctx.moveTo(s.x, s.y - L); ctx.lineTo(s.x, s.y + L)
          ctx.stroke()
        } else {
          ctx.fillStyle = '#e9e2ff'
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={ref} className="starfield" aria-hidden />
}
