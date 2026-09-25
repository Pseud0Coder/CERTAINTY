/* Certainty marketing page: scroll-driven reveals, a pinned-visual
   "scrollytelling" sequence for the platform section, and a count-up on
   the stats strip. No framework, no external script: IntersectionObserver
   only, and every animation is skipped outright under
   prefers-reduced-motion. */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- generic reveal-on-scroll ---------- */
function initReveals(): void {
  /* .beat is excluded: it has its own scroll-driven dim/highlight opacity
     from initScrollytelling, which a second opacity transition here would
     fight with. .hero-body is visible without scrolling, so it is not a
     "reveal" candidate either. */
  const targets = document.querySelectorAll(
    '.section-head, .fcard, .ctable, .stat, .pcard-m');
  targets.forEach(el => el.classList.add('reveal'));
  if (reduceMotion) { targets.forEach(el => el.classList.add('in')); return; }

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  targets.forEach(el => io.observe(el));
}

/* ---------- platform scrollytelling: pinned visual keyed to whichever
   beat is nearest the viewport center ---------- */
function initScrollytelling(): void {
  const beats = Array.from(document.querySelectorAll<HTMLElement>('.beat[data-beat]'));
  const images = Array.from(document.querySelectorAll<HTMLElement>('.beat-img[data-beat]'));
  const dots = Array.from(document.querySelectorAll<HTMLElement>('.stepvisual-index [data-dot]'));
  if (!beats.length) return;

  const setActive = (n: string): void => {
    beats.forEach(b => b.classList.toggle('on', b.dataset.beat === n));
    images.forEach(img => img.classList.toggle('on', img.dataset.beat === n));
    dots.forEach(d => d.classList.toggle('on', d.dataset.dot === n));
  };
  setActive('0');

  const io = new IntersectionObserver(entries => {
    /* Pick the most-centered intersecting beat, not just "first seen":
       scrolling fast can intersect two beats in one frame. */
    let best: { n: string; d: number } | null = null;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      const mid = e.boundingClientRect.top + e.boundingClientRect.height / 2;
      const d = Math.abs(mid - innerHeight / 2);
      if (!best || d < best.d) best = { n: el.dataset.beat!, d };
    }
    if (best) setActive(best.n);
  }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-30% 0px -30% 0px' });
  beats.forEach(b => io.observe(b));
}

/* ---------- count-up stats ---------- */
function initStats(): void {
  const nums = document.querySelectorAll<HTMLElement>('.stat-n[data-count]');
  if (!nums.length) return;
  if (reduceMotion) {
    nums.forEach(n => { n.textContent = n.dataset.count ?? '0'; });
    return;
  }

  const animate = (el: HTMLElement): void => {
    const target = Number(el.dataset.count ?? '0');
    if (target === 0) { el.textContent = '0'; return; }
    const duration = 900;
    const started = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - t) * (1 - t);
      el.textContent = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) { animate(e.target as HTMLElement); io.unobserve(e.target); }
    }
  }, { threshold: 0.6 });
  nums.forEach(n => io.observe(n));
}

/* ---------- lightbox: click any product screenshot to see it full size ---------- */
function initLightbox(): void {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg') as HTMLImageElement | null;
  const closeBtn = document.getElementById('lightboxClose');
  if (!lightbox || !lightboxImg || !closeBtn) return;

  const shots = document.querySelectorAll<HTMLImageElement>('.beat-img, .ivshot img');

  const open = (src: string, alt: string): void => {
    lightboxImg.src = src;
    lightboxImg.alt = alt;
    lightbox.classList.add('open');
  };
  const close = (): void => {
    lightbox.classList.remove('open');
  };

  shots.forEach(img => {
    img.addEventListener('click', () => open(img.src, img.alt));
  });
  lightbox.addEventListener('click', e => { if (e.target === lightbox) close(); });
  lightboxImg.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });
}

initReveals();
initScrollytelling();
initStats();
initLightbox();
