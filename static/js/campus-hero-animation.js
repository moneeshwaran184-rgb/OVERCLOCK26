/**
 * CampusOps Full-Page Scroll-Driven Campus Dual-Photo Video Transition Animation Controller
 * 
 * Drives a seamless, high-definition full-viewport background animation from Photo 1 (Aerial Quad)
 * to Photo 2 (Historic Clock Tower) playing continuously across the entire landing page.
 */

(function(window) {
  'use strict';

  const TOTAL_FRAMES = 95;
  const FRAME_DIR = '/static/campus_hero_frames/';
  const FRAME_OPT_PREFIX = 'frame_opt_';
  const FRAME_PREFIX = 'frame_';
  const FRAME_EXT = '.jpg';

  function formatFrameNumber(idx) {
    return String(idx).padStart(3, '0');
  }

  function getFrameUrl(idx, highRes = false) {
    const prefix = highRes ? FRAME_PREFIX : FRAME_OPT_PREFIX;
    return `${FRAME_DIR}${prefix}${formatFrameNumber(idx)}${FRAME_EXT}`;
  }

  const CampusHeroAnimation = {
    canvas: null,
    ctx: null,
    bgContainer: null,
    progressBar: null,
    progressLabel: null,
    indicatorStage: null,

    // Frames cache
    frames: new Array(TOTAL_FRAMES + 1),
    loadedCount: 0,
    photo1: null,
    photo2: null,
    photo1Loaded: false,
    photo2Loaded: false,

    // State
    targetProgress: 0,
    currentProgress: 0,
    isRafRunning: false,
    isDestroyed: false,
    prefersReducedMotion: false,
    boundScroll: null,
    boundResize: null,

    init() {
      this.isDestroyed = false;
      this.canvas = document.getElementById('campusHeroCanvas');
      this.bgContainer = document.getElementById('campusFullscreenBg');
      this.progressBar = document.getElementById('heroTransitionBar');
      this.progressLabel = document.getElementById('heroTransitionPercent');
      this.indicatorStage = document.getElementById('heroTransitionStage');

      if (!this.canvas) {
        return;
      }

      // Activate full-page background canvas
      document.body.classList.add('campus-landing-active');
      if (this.bgContainer) {
        this.bgContainer.classList.remove('hidden');
      }

      this.ctx = this.canvas.getContext('2d', { alpha: false });

      // Check prefers-reduced-motion
      this.prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Handle canvas resolution
      this.handleResize();
      this.boundResize = () => this.handleResize();
      window.addEventListener('resize', this.boundResize, { passive: true });

      // Scroll listener across the whole window
      this.boundScroll = () => this.handleScroll();
      window.addEventListener('scroll', this.boundScroll, { passive: true });

      // Interactive scrubber if bar clicked
      this.setupInteractiveScrubber();

      // Begin preloading assets
      this.preloadImages();

      // Initial scroll position calculation
      this.handleScroll();
    },

    setupInteractiveScrubber() {
      const scrubContainer = document.getElementById('heroScrubberTrack');
      if (!scrubContainer) return;

      const onScrub = (e) => {
        const rect = scrubContainer.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        
        const docH = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight || 0
        );
        const winH = window.innerHeight || 800;
        const maxScroll = Math.max(1, docH - winH);
        const targetY = ratio * maxScroll;
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      };

      scrubContainer.addEventListener('click', onScrub);
    },

    handleResize() {
      if (!this.canvas || this.isDestroyed) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round((window.innerWidth || 1920) * dpr);
      const h = Math.round((window.innerHeight || 1080) * dpr);

      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }

      this.render();
    },

    preloadImages() {
      // 1. Immediately load Photo 1 (frame 1) and Photo 2 (frame 95)
      const p1 = new Image();
      p1.crossOrigin = 'anonymous';
      p1.onload = () => {
        this.photo1 = p1;
        this.photo1Loaded = true;
        this.frames[1] = p1;
        this.render();
        this.startStaggeredPreload();
      };
      p1.src = getFrameUrl(1, false);

      const p2 = new Image();
      p2.crossOrigin = 'anonymous';
      p2.onload = () => {
        this.photo2 = p2;
        this.photo2Loaded = true;
        this.frames[TOTAL_FRAMES] = p2;
        this.render();
      };
      p2.src = getFrameUrl(TOTAL_FRAMES, false);
    },

    startStaggeredPreload() {
      // Priority 1: Keyframes (every 4th frame)
      const keyframes = [];
      for (let i = 4; i < TOTAL_FRAMES; i += 4) {
        keyframes.push(i);
      }

      // Priority 2: All remaining intermediate frames
      const remaining = [];
      for (let i = 2; i < TOTAL_FRAMES; i++) {
        if (i % 4 !== 0) remaining.push(i);
      }

      const queue = [...keyframes, ...remaining];
      const MAX_CONCURRENT = 6;
      let activeRequests = 0;

      const pump = () => {
        if (this.isDestroyed) return;
        while (activeRequests < MAX_CONCURRENT && queue.length > 0) {
          const idx = queue.shift();
          activeRequests++;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            this.frames[idx] = img;
            this.loadedCount++;
            activeRequests--;
            pump();
          };
          img.onerror = () => {
            activeRequests--;
            pump();
          };
          img.src = getFrameUrl(idx, false);
        }
      };

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => pump(), { timeout: 800 });
      } else {
        setTimeout(pump, 50);
      }
    },

    handleScroll() {
      if (this.isDestroyed) return;

      const scrollY = window.scrollY || window.pageYOffset || 0;
      const docH = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight || 0
      );
      const winH = window.innerHeight || 800;
      const totalDist = Math.max(1, docH - winH);

      // Buffer distance slightly so the full transition (frame 95) is comfortably displayed
      // by the time visitors reach the CTA and footer, ensuring nothing is missed out
      const effectiveDist = Math.max(1, totalDist - 80);
      const progress = Math.max(0, Math.min(1, scrollY / effectiveDist));
      this.targetProgress = progress;

      this.startRaf();
    },

    startRaf() {
      if (this.isRafRunning || this.isDestroyed) return;
      this.isRafRunning = true;
      requestAnimationFrame(() => this.tick());
    },

    stopRaf() {
      this.isRafRunning = false;
    },

    tick() {
      if (!this.isRafRunning || this.isDestroyed) return;

      // Smooth lerp: delta * 0.22 gives snappy yet buttery response
      const delta = this.targetProgress - this.currentProgress;
      this.currentProgress += delta * 0.22;

      this.render();

      if (Math.abs(delta) < 0.0006) {
        this.currentProgress = this.targetProgress;
        this.render();
        this.stopRaf();
        return;
      }

      requestAnimationFrame(() => this.tick());
    },

    render() {
      if (!this.ctx || !this.canvas) return;

      const p = Math.max(0, Math.min(1, this.currentProgress));
      this.updateUI(p);

      const cw = this.canvas.width;
      const ch = this.canvas.height;
      const ctx = this.ctx;

      // Handle reduced-motion: gentle pure crossfade between Photo 1 & Photo 2
      if (this.prefersReducedMotion) {
        this.renderReducedMotion(ctx, cw, ch, p);
        return;
      }

      // Calculate continuous floating frame index (1.0 to 95.0)
      const exactFrame = 1 + p * (TOTAL_FRAMES - 1);
      const floorIndex = Math.min(TOTAL_FRAMES, Math.max(1, Math.floor(exactFrame)));
      const ceilIndex = Math.min(TOTAL_FRAMES, Math.max(1, Math.ceil(exactFrame)));
      const blendFraction = exactFrame - floorIndex; // 0.0 to 1.0

      // Retrieve primary and secondary frames (or nearest loaded fallback)
      const primaryImg = this.getNearestFrame(floorIndex);
      const secondaryImg = (ceilIndex !== floorIndex) ? this.getNearestFrame(ceilIndex) : null;

      if (!primaryImg && !secondaryImg) {
        ctx.fillStyle = '#0f2420';
        ctx.fillRect(0, 0, cw, ch);
        return;
      }

      // Draw primary base frame
      if (primaryImg) {
        this.drawCoverImage(ctx, primaryImg, cw, ch, 1.0);
      }

      // Smoothly blend secondary frame with sub-frame alpha
      if (secondaryImg && secondaryImg !== primaryImg && blendFraction > 0.01) {
        this.drawCoverImage(ctx, secondaryImg, cw, ch, blendFraction);
      }
    },

    renderReducedMotion(ctx, cw, ch, progress) {
      const img1 = this.photo1 || this.getNearestFrame(1);
      const img2 = this.photo2 || this.getNearestFrame(TOTAL_FRAMES);

      if (img1) {
        this.drawCoverImage(ctx, img1, cw, ch, 1.0);
      }
      if (img2 && progress > 0.02) {
        this.drawCoverImage(ctx, img2, cw, ch, progress);
      }
    },

    drawCoverImage(ctx, img, cw, ch, alpha) {
      if (!img || !img.complete || (img.naturalWidth === 0 && img.width === 0)) return;

      const imgW = img.naturalWidth || img.width;
      const imgH = img.naturalHeight || img.height;

      // Full edge-to-edge seamless coverage:
      const scale = Math.max(cw / imgW, ch / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;

      // Center horizontally so quad and clock tower remain centered:
      const offsetX = (cw - drawW) * 0.5;

      // Top-anchored vertical framing: preserves the clock tower cross, dome & spire at the top with headroom
      const offsetY = drawH > ch ? (ch - drawH) * 0.14 : (ch - drawH) * 0.5;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, 0, 0, imgW, imgH, offsetX, offsetY, drawW, drawH);
      ctx.restore();
    },

    getNearestFrame(targetIdx) {
      if (this.frames[targetIdx] && this.frames[targetIdx].complete && this.frames[targetIdx].naturalWidth > 0) {
        return this.frames[targetIdx];
      }

      for (let offset = 1; offset < TOTAL_FRAMES; offset++) {
        const left = targetIdx - offset;
        if (left >= 1 && this.frames[left] && this.frames[left].complete && this.frames[left].naturalWidth > 0) {
          return this.frames[left];
        }
        const right = targetIdx + offset;
        if (right <= TOTAL_FRAMES && this.frames[right] && this.frames[right].complete && this.frames[right].naturalWidth > 0) {
          return this.frames[right];
        }
      }

      return this.photo1 || this.photo2 || null;
    },

    updateUI(p) {
      const pct = Math.round(p * 100);

      if (this.progressBar) {
        this.progressBar.style.width = `${pct}%`;
      }
      if (this.progressLabel) {
        this.progressLabel.textContent = `${pct}%`;
      }
      if (this.indicatorStage) {
        if (p < 0.20) {
          this.indicatorStage.textContent = 'Photo 1 · Aerial Quad';
        } else if (p < 0.80) {
          this.indicatorStage.textContent = 'Descent Transition';
        } else {
          this.indicatorStage.textContent = 'Photo 2 · Clock Tower';
        }
      }
    },

    destroy() {
      this.isDestroyed = true;
      this.stopRaf();
      document.body.classList.remove('campus-landing-active');
      if (this.bgContainer) {
        this.bgContainer.classList.add('hidden');
      }
      if (this.boundScroll) {
        window.removeEventListener('scroll', this.boundScroll);
      }
      if (this.boundResize) {
        window.removeEventListener('resize', this.boundResize);
      }
    }
  };

  window.CampusHeroAnimation = CampusHeroAnimation;

})(window);
