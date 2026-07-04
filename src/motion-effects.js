import { animate, inView, stagger } from 'motion'

export function initAyoMotion() {
  const run = () => {
    animate(
      '.main-header',
      { opacity: [0, 1], y: [-12, 0] },
      { duration: 0.5, easing: 'ease-out' },
    )

    animate(
      '.hero-text > *, .hero-visual',
      { opacity: [0, 1], y: [22, 0] },
      { delay: stagger(0.08), duration: 0.55, easing: 'ease-out' },
    )

    inView('.glass-card, .lobby-card, .ref-card, .tip-card', ({ target }) => {
      animate(
        target,
        { opacity: [0, 1], y: [18, 0] },
        { duration: 0.45, easing: 'ease-out' },
      )
    }, { margin: '0px 0px -80px 0px' })

    initParallaxMorph()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
    return
  }

  run()
}

function initParallaxMorph() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const hero = document.querySelector('.hero-visual')
  const visual = document.querySelector('.main-visual')
  const badge = document.querySelector('.visual-floating-badge')
  if (!hero || !visual) return

  animate(
    visual,
    {
      borderRadius: ['16px', '26px 18px 30px 20px', '16px'],
    },
    {
      duration: 8,
      repeat: Infinity,
      easing: 'ease-in-out',
    },
  )

  if (badge) {
    animate(
      badge,
      { y: [0, -7, 0], rotate: [4, 2.5, 4] },
      { duration: 5.5, repeat: Infinity, easing: 'ease-in-out' },
    )
  }

  let pointerX = 0
  let pointerY = 0
  let scrollShift = 0
  let frame = 0

  const render = () => {
    frame = 0
    if (document.body.classList.contains('quiz-mode-active')) return

    hero.style.transform = `translate3d(${pointerX}px, ${pointerY + scrollShift}px, 0)`
    visual.style.transform = `perspective(1000px) rotateX(${-pointerY * 0.22}deg) rotateY(${pointerX * 0.2}deg)`
    if (badge) {
      badge.style.transform = `translate3d(${-pointerX * 0.45}px, ${-pointerY * 0.45}px, 0) rotate(4deg)`
    }
  }

  const requestRender = () => {
    if (!frame) frame = window.requestAnimationFrame(render)
  }

  window.addEventListener('pointermove', (event) => {
    const halfWidth = window.innerWidth / 2
    const halfHeight = window.innerHeight / 2
    pointerX = ((event.clientX - halfWidth) / halfWidth) * 8
    pointerY = ((event.clientY - halfHeight) / halfHeight) * 7
    requestRender()
  }, { passive: true })

  window.addEventListener('scroll', () => {
    scrollShift = Math.max(-18, Math.min(18, window.scrollY * -0.025))
    requestRender()
  }, { passive: true })

  hero.addEventListener('pointerleave', () => {
    pointerX = 0
    pointerY = 0
    requestRender()
  })
}
