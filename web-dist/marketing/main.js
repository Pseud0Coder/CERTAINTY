/* Certainty marketing page: scroll-driven reveals, a pinned-visual
   "scrollytelling" sequence for the platform section, a count-up on the
   stats strip, and the light/dark toggle the app uses. No framework, no
   external script: IntersectionObserver only, and every animation is
   skipped outright under prefers-reduced-motion. */
import { currentTheme, initTheme, toggleTheme } from '../shared/theme.js';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* ---------- light/dark, shared with the app ---------- */
function initThemeToggle() {
    initTheme();
    const btn = document.getElementById('themeToggle');
    if (!btn)
        return;
    const paint = () => {
        btn.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    };
    paint();
    btn.addEventListener('click', () => { toggleTheme(); paint(); });
}
/* ---------- generic reveal-on-scroll ---------- */
function initReveals() {
    /* .beat is excluded: it has its own scroll-driven dim/highlight opacity
       from initScrollytelling, which a second opacity transition here would
       fight with. .hero-body is visible without scrolling, so it is not a
       "reveal" candidate either. */
    const targets = document.querySelectorAll('.section-head, .fcard, .ctable, .stat, .pcard-m');
    targets.forEach(el => el.classList.add('reveal'));
    if (reduceMotion) {
        targets.forEach(el => el.classList.add('in'));
        return;
    }
    const io = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (e.isIntersecting) {
                e.target.classList.add('in');
                io.unobserve(e.target);
            }
        }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(el => io.observe(el));
    /* Jumping to an anchor (the nav links) can carry an element clean past the
       observer without it ever crossing the threshold, leaving it stuck at
       opacity 0. Reveal anything that has scrolled above the fold. */
    const sweep = () => {
        document.querySelectorAll('.reveal:not(.in)').forEach(el => {
            if (el.getBoundingClientRect().top < 0) {
                el.classList.add('in');
                io.unobserve(el);
            }
        });
    };
    addEventListener('scroll', sweep, { passive: true });
    addEventListener('hashchange', () => requestAnimationFrame(sweep));
}
/* ---------- platform scrollytelling: pinned visual keyed to whichever
   beat is nearest the viewport center ---------- */
function initScrollytelling() {
    const beats = Array.from(document.querySelectorAll('.beat[data-beat]'));
    const images = Array.from(document.querySelectorAll('.beat-img[data-beat]'));
    const dots = Array.from(document.querySelectorAll('.stepvisual-index [data-dot]'));
    if (!beats.length)
        return;
    const setActive = (n) => {
        beats.forEach(b => b.classList.toggle('on', b.dataset.beat === n));
        images.forEach(img => img.classList.toggle('on', img.dataset.beat === n));
        dots.forEach(d => d.classList.toggle('on', d.dataset.dot === n));
    };
    setActive('0');
    const io = new IntersectionObserver(entries => {
        /* Pick the most-centered intersecting beat, not just "first seen":
           scrolling fast can intersect two beats in one frame. */
        let best = null;
        for (const e of entries) {
            if (!e.isIntersecting)
                continue;
            const el = e.target;
            const mid = e.boundingClientRect.top + e.boundingClientRect.height / 2;
            const d = Math.abs(mid - innerHeight / 2);
            if (!best || d < best.d)
                best = { n: el.dataset.beat, d };
        }
        if (best)
            setActive(best.n);
    }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-30% 0px -30% 0px' });
    beats.forEach(b => io.observe(b));
}
/* ---------- count-up stats ---------- */
function initStats() {
    const nums = document.querySelectorAll('.stat-n[data-count]');
    if (!nums.length)
        return;
    if (reduceMotion) {
        nums.forEach(n => { n.textContent = n.dataset.count ?? '0'; });
        return;
    }
    const animate = (el) => {
        const target = Number(el.dataset.count ?? '0');
        if (target === 0) {
            el.textContent = '0';
            return;
        }
        const duration = 900;
        const started = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - started) / duration);
            const eased = 1 - (1 - t) * (1 - t);
            el.textContent = String(Math.round(target * eased));
            if (t < 1)
                requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (e.isIntersecting) {
                animate(e.target);
                io.unobserve(e.target);
            }
        }
    }, { threshold: 0.6 });
    nums.forEach(n => io.observe(n));
}
/* ---------- lightbox: click any product screenshot to see it full size ---------- */
function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const closeBtn = document.getElementById('lightboxClose');
    if (!lightbox || !lightboxImg || !closeBtn)
        return;
    const shots = document.querySelectorAll('.beat-img, .ivshot img');
    const open = (src, alt) => {
        lightboxImg.src = src;
        lightboxImg.alt = alt;
        lightbox.classList.add('open');
    };
    const close = () => {
        lightbox.classList.remove('open');
    };
    shots.forEach(img => {
        img.addEventListener('click', () => open(img.src, img.alt));
    });
    lightbox.addEventListener('click', e => { if (e.target === lightbox)
        close(); });
    lightboxImg.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape')
            close();
    });
}
initThemeToggle();
initReveals();
initScrollytelling();
initStats();
initLightbox();
