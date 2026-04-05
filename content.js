// content.js — DoomScroll Blocker

(function () {
  'use strict';



  // ─── Page context detection ──────────────────────────────────────────────────
  const host = location.hostname.replace('www.', '');
  const SITE = {
    isYoutube: host === 'youtube.com',
    isTiktok: host === 'tiktok.com',
    isInstagram: host === 'instagram.com',
    isTwitter: host === 'twitter.com' || host === 'x.com',
    isReddit: host === 'reddit.com',
    isFacebook: host === 'facebook.com',
    isThreads: host === 'threads.net' || host === 'threads.com',
  };

  function getMode() {
    // Custom site override set during init
    if (window._doomGetMode) return window._doomGetMode();
    const path = location.pathname;
    if (SITE.isYoutube) {
      if (path.startsWith('/shorts')) return 'shorts';
      if (path.startsWith('/watch')) return 'ignore';
      return 'ignore';
    }
    if (SITE.isTiktok) return 'shorts';
    if (SITE.isInstagram) {
      if (path.startsWith('/reels')) return 'shorts';
      if (path.startsWith('/stories')) return 'ignore';
      if (path.startsWith('/p/')) return 'ignore';       // individual post — comments
      return 'scroll';
    }
    if (SITE.isTwitter) {
      if (path.startsWith('/i/videos')) return 'shorts';
      if (/^\/[^/]+\/status\//.test(path)) return 'ignore'; // individual tweet — comments
      return 'scroll';
    }
    if (SITE.isReddit) {
      if (/\/comments\//.test(path)) return 'ignore';    // individual post — comments
      return 'scroll';
    }
    return 'scroll';
  }

  // ─── State ───────────────────────────────────────────────────────────────────
  let totalScrolled = 0;
  let swipeCount = 0;
  let lastUrl = location.href;
  let lastScrollY = window.scrollY;
  let maxScrollY = window.scrollY; // furthest point reached — only new ground counts
  let seenUrls = new Set();      // shorts: only count each video URL once
  let settings = {
    enabled: true, paused: false,
    breakUntil: null, pauseUntil: null,
    scrollThreshold: 10000, shortsThreshold: 5,
    strictMode: false, lockdownSeconds: 900,
  };
  let ticking = false;
  let initialized = false;
  let sessionStartTime = Date.now(); // for reflection timer
  let frozenElapsedMs = 0;          // elapsed time frozen when popup appears

  // ── Friction / lockdown state ─────────────────────────────────────────────────
  let frictionActive = false;
  let frictionRafId = null;
  let frictionStartTime = null;

  // ─── Properties that create a new containing block for position:fixed ────────
  const CONTAINING_BLOCK_PROPS = ['transform', 'filter', 'perspective', 'contain', 'will-change', 'overflow'];
  let savedHtmlStyles = {};
  let savedBodyStyles = {};

  // Some properties need a specific "neutral" value — 'none' is invalid for overflow
  const PROP_RESET_VALUE = { overflow: 'visible' };

  function neutralizeSiteTransforms() {
    const htmlEl = document.documentElement;
    const bodyEl = document.body || document.querySelector('body');
    CONTAINING_BLOCK_PROPS.forEach(p => {
      savedHtmlStyles[p] = htmlEl.style.getPropertyValue(p);
      savedBodyStyles[p] = bodyEl ? bodyEl.style.getPropertyValue(p) : '';
      const resetVal = PROP_RESET_VALUE[p] || 'none';
      htmlEl.style.setProperty(p, resetVal, 'important');
      if (bodyEl) bodyEl.style.setProperty(p, resetVal, 'important');
    });
  }

  function restoreSiteTransforms() {
    const htmlEl = document.documentElement;
    const bodyEl = document.body || document.querySelector('body');
    CONTAINING_BLOCK_PROPS.forEach(p => {
      if (savedHtmlStyles[p]) {
        htmlEl.style.setProperty(p, savedHtmlStyles[p]);
      } else {
        htmlEl.style.removeProperty(p);
      }
      if (bodyEl) {
        if (savedBodyStyles[p]) {
          bodyEl.style.setProperty(p, savedBodyStyles[p]);
        } else {
          bodyEl.style.removeProperty(p);
        }
      }
    });
    savedHtmlStyles = {};
    savedBodyStyles = {};
  }

  // ─── DOM — lockdown overlay ──────────────────────────────────────────────────
  const frictionEl = document.createElement('div');
  frictionEl.id = 'doomscroll-friction';

  // Force critical layout styles inline — wins over any host-page CSS
  frictionEl.style.setProperty('position', 'fixed', 'important');
  frictionEl.style.setProperty('top', '0', 'important');
  frictionEl.style.setProperty('left', '0', 'important');
  frictionEl.style.setProperty('right', '0', 'important');
  frictionEl.style.setProperty('bottom', '0', 'important');
  frictionEl.style.setProperty('overflow', 'hidden', 'important');

  // Built once, reused each trigger — only the backdrop now (no card inside)
  frictionEl.innerHTML = `
    <div id="doomscroll-word">DOOMSCROLLING</div>
  `;

  // ─── Card uses a native <dialog> element rendered in the browser TOP LAYER ───
  // Top layer sits above ALL normal DOM content — no transform, overflow, clip-path,
  // contain, or any other CSS on any ancestor (including Reddit's shreddit-app) can
  // affect it. This is the only approach that fully escapes Reddit's layout isolation.
  const frictionCardEl = document.createElement('dialog');
  frictionCardEl.id = 'doomscroll-friction-card';
  frictionCardEl.innerHTML = `
    <div id="doomscroll-card-word">doomscrolling detected</div>
    <div id="doomscroll-friction-btns">
      <button id="doomscroll-btn-continue"><span>keep wasting my life</span></button>
      <div id="doomscroll-btn-hint">press for 3 seconds to continue</div>
    </div>
  `;

  // ─── DOM — existing elements ─────────────────────────────────────────────────
  const overlay = document.createElement('div'); overlay.id = 'doomscroll-overlay';
  const label = document.createElement('div'); label.id = 'doomscroll-label'; label.textContent = 'doomscrolling';
  const counter = document.createElement('div'); counter.id = 'doomscroll-counter';
  const actionBar = document.createElement('div'); actionBar.id = 'doomscroll-action-bar';
  const pausedBanner = document.createElement('div');
  pausedBanner.id = 'doomscroll-paused-banner';
  pausedBanner.innerHTML = `
    <span id="doomscroll-paused-icon">🕐</span>
    <span id="doomscroll-paused-text">break</span>
    <span id="doomscroll-paused-timer"></span>
    <button id="doomscroll-stop-btn" title="Stop break">✕</button>
  `;

  function buildActionBar() {
    actionBar.innerHTML = '';
    const mk = (text, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'doom-btn' + (cls ? ' ' + cls : '');
      b.textContent = text;
      b.addEventListener('click', fn);
      return b;
    };
    actionBar.appendChild(mk('↺ Reset', '', resetScroll));
    actionBar.appendChild(mk('⏸ Pause 5m', '', () => pause(5)));
    actionBar.appendChild(mk('☕ Take a break', 'primary', openBreakDialog));
  }

  function injectElements() {
    if (initialized) return;
    initialized = true;
    const root = document.documentElement;
    root.appendChild(frictionEl);
    // dialog must be in the DOM before showModal() — append to body so it's accessible
    (document.body || root).appendChild(frictionCardEl);
    root.appendChild(overlay);
    root.appendChild(label);
    root.appendChild(counter);
    root.appendChild(actionBar);
    root.appendChild(pausedBanner);

    buildActionBar();

    // Friction card — press-and-hold to continue (3 seconds)
    (function () {
      const btn = document.getElementById('doomscroll-btn-continue');
      const HOLD_MS = 3000;
      let holdStart = null;
      let rafId = null;

      function startHold(e) {
        if (holdStart !== null) return; // already holding, ignore double-fire
        e.preventDefault();
        holdStart = Date.now();
        btn.classList.add('holding');

        function tick() {
          if (holdStart === null) return; // was cancelled
          const elapsed = Date.now() - holdStart;
          const pct = Math.min(elapsed / HOLD_MS, 1);
          btn.style.setProperty('--hold-pct', pct);
          if (pct < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            finishHold();
          }
        }
        rafId = requestAnimationFrame(tick);
      }

      function cancelHold() {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        holdStart = null;
        btn.classList.remove('holding');
        btn.style.setProperty('--hold-pct', 0);
      }

      function finishHold() {
        cancelHold();
        onContinue();
      }

      btn.addEventListener('mousedown', startHold);
      btn.addEventListener('touchstart', startHold, { passive: false });

      // Listen on window so releasing anywhere (even outside the button) always cancels
      window.addEventListener('mouseup', cancelHold);
      window.addEventListener('touchend', cancelHold);
      window.addEventListener('touchcancel', cancelHold);
    })();

    // Pill: click body → open popup (skipped if it was a drag)
    pausedBanner.addEventListener('click', (e) => {
      if (e.target.id === 'doomscroll-stop-btn') return;
      if (pillWasDrag) return; // suppress click after dragging
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    });
    // Pill: stop button → resume
    pausedBanner.addEventListener('click', (e) => {
      if (e.target.id !== 'doomscroll-stop-btn') return;
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'RESUME' }, () => {
        settings.paused = false;
        settings.breakUntil = null;
        settings.pauseUntil = null;
        hidePausedState();
      });
    });

    // ── Pill drag-to-move ────────────────────────────────────────────────────────
    // Works on all sites; pill is position:fixed so we just update left/top directly.
    let pillDragging = false, pillWasDrag = false, pillStartX, pillStartY, pillLeft, pillTop;
    pausedBanner.addEventListener('mousedown', (e) => {
      if (e.target.id === 'doomscroll-stop-btn') return; // don't drag when clicking X
      e.preventDefault();
      pillDragging = true;
      pillWasDrag = false; // reset on every new mousedown
      const r = pausedBanner.getBoundingClientRect();
      // Switch from right-anchored CSS to explicit left/top so we can freely reposition
      pausedBanner.style.right  = 'auto';
      pausedBanner.style.bottom = 'auto';
      pausedBanner.style.left = r.left + 'px';
      pausedBanner.style.top  = r.top  + 'px';
      pillStartX = e.clientX; pillStartY = e.clientY;
      pillLeft = r.left; pillTop = r.top;
      pausedBanner.style.cursor = 'grabbing';
      pausedBanner.style.transition = 'none'; // prevent lag from transform transition
    });
    document.addEventListener('mousemove', (e) => {
      if (!pillDragging) return;
      const dx = e.clientX - pillStartX;
      const dy = e.clientY - pillStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) pillWasDrag = true; // moved enough = drag
      pausedBanner.style.left = (pillLeft + dx) + 'px';
      pausedBanner.style.top  = (pillTop  + dy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!pillDragging) return;
      pillDragging = false;
      pausedBanner.style.cursor = 'grab';
    });
  }

  // ─── Settings ────────────────────────────────────────────────────────────────
  function loadSettings(cb) {
    chrome.storage.sync.get(
      ['enabled', 'paused', 'breakUntil', 'pauseUntil', 'scrollThreshold', 'shortsThreshold', 'strictMode', 'lockdownSeconds', 'trackedSites'],
      (data) => {
        settings = { ...settings, ...data };
        const now = Date.now();
        if (settings.breakUntil && now >= settings.breakUntil) {
          settings.paused = false; settings.breakUntil = null;
          chrome.storage.sync.set({ paused: false, breakUntil: null });
        }
        if (settings.pauseUntil && now >= settings.pauseUntil) {
          settings.paused = false; settings.pauseUntil = null;
          chrome.storage.sync.set({ paused: false, pauseUntil: null });
        }
        if (cb) cb();
      }
    );
  }

  // ─── Swipe counter ───────────────────────────────────────────────────────────
  function checkSwipe() {
    if (getMode() !== 'shorts') return;
    const url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;

    const valid =
      (SITE.isYoutube && /\/shorts\/[A-Za-z0-9_-]+/.test(location.pathname)) ||
      (SITE.isTiktok && /\/@[^/]+\/video\/\d+/.test(location.pathname)) ||
      (SITE.isInstagram && /\/reels\/[A-Za-z0-9_-]+/.test(location.pathname)) ||
      (SITE.isTwitter && /\/i\/videos\//.test(location.pathname)) ||
      (!!window._doomGetMode); // custom site typed as 'shorts'
    if (!valid) return;
    if (seenUrls.has(url)) return; // already counted — swiping back doesn't re-count
    seenUrls.add(url);

    swipeCount++;
    updateCounter(true);
    const threshold = settings.shortsThreshold || 5;
    if (swipeCount >= threshold && !frictionActive) triggerFriction();
  }

  // ─── Scroll handler ──────────────────────────────────────────────────────────
  function onScroll() {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }

  function update() {
    ticking = false;
    // Use cached settings — do NOT call loadSettings() here (storage is async + rate-limited)
    if (!settings.enabled || settings.paused) { showPausedState(); return; }
    hidePausedState();

    const mode = getMode();
    if (mode === 'ignore') {
      cancelFriction(); setOverlay(0); hideLabel(); hideActionBar(); counter.classList.remove('visible');
      return;
    }
    if (mode === 'shorts') return;

    const currentY = window.scrollY;
    if (currentY > maxScrollY) {
      totalScrolled += Math.min(currentY - maxScrollY, 600);
      maxScrollY = currentY;
    }
    lastScrollY = currentY;

    const threshold = settings.scrollThreshold || 10000;
    updateCounter(totalScrolled > threshold * 0.5);

    if (totalScrolled >= threshold) {
      if (!frictionActive) triggerFriction();
    } else {
      cancelFriction(); setOverlay(0); hideLabel(); hideActionBar();
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LOCKDOWN — full-page takeover with countdown
  // ════════════════════════════════════════════════════════════════════════════

  function triggerFriction() {
    frictionActive = true;
    frictionStartTime = null;

    // Freeze the timer at current session elapsed
    frozenElapsedMs = Date.now() - sessionStartTime;

    const shameBtn = document.getElementById('doomscroll-btn-continue');
    if (shameBtn) {
      shameBtn.innerHTML = '<span>THE ALGORITHM WINS AGAIN</span>';
      shameBtn.style.display = settings.strictMode ? 'none' : '';
    }

    // Show backdrop
    frictionEl.classList.add('visible');

    // Fly-in word animation
    const wordEl = document.getElementById('doomscroll-word');
    if (wordEl) {
      wordEl.classList.remove('animating');
      void wordEl.offsetWidth;
      wordEl.classList.add('animating');
    }

    // Reveal card after word animation — dialog.showModal() puts it in the top layer,
    // which is immune to ALL CSS on any ancestor element (Reddit, Twitter, etc.)
    setTimeout(() => {
      if (!frictionActive) return;
      if (!frictionCardEl.open) frictionCardEl.showModal();
      frictionCardEl.classList.add('card-visible');
    }, 820);
  }



  function onContinue() {
    sessionStartTime = Date.now() - frozenElapsedMs;
    totalScrolled = 0; swipeCount = 0;
    lastScrollY = window.scrollY; maxScrollY = window.scrollY; seenUrls = new Set();
    cancelFriction();
    updateCounter(false);
    if (settings.strictMode !== true) openBreakDialog();
  }

  function cancelFriction() {
    frictionActive = false;
    frictionStartTime = null;
    const wordEl = document.getElementById('doomscroll-word');
    frictionEl.classList.remove('visible');
    // Close the dialog (removes it from top layer)
    frictionCardEl.classList.remove('card-visible');
    if (frictionCardEl.open) frictionCardEl.close();
    if (wordEl) wordEl.classList.remove('animating');
  }

  // ─── Overlay ─────────────────────────────────────────────────────────────────
  function setOverlay(opacity) {
    overlay.style.opacity = opacity;
    overlay.classList.toggle('active', opacity > 0.05);
  }
  function hideLabel() { label.classList.remove('visible', 'pulse'); }
  function showActionBar() { actionBar.classList.add('visible'); }
  function hideActionBar() { actionBar.classList.remove('visible'); }

  function updateCounter(show) {
    if (!show) { counter.classList.remove('visible'); return; }
    counter.classList.add('visible');
    if (getMode() === 'shorts') {
      counter.textContent = `${swipeCount} / ${settings.shortsThreshold || 5} videos`;
    } else {
      counter.textContent = `scrolled ${(totalScrolled / 1000).toFixed(1)}k px`;
    }
  }

  // ─── Paused state ─────────────────────────────────────────────────────────────
  let pausedTickerId = null;

  function formatCountdown(ms) {
    if (ms <= 0) return '';
    const totalSecs = Math.ceil(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  }

  function showPausedState() {
    cancelFriction(); counter.classList.remove('visible');
    const iconEl = document.getElementById('doomscroll-paused-icon');
    const textEl = document.getElementById('doomscroll-paused-text');
    const timerEl = document.getElementById('doomscroll-paused-timer');
    if (pausedTickerId) { clearInterval(pausedTickerId); pausedTickerId = null; }

    function tick() {
      const now = Date.now();
      if (settings.breakUntil && settings.breakUntil > now) {
        if (iconEl) iconEl.textContent = '🕐';
        if (textEl) textEl.textContent = 'break';
        if (timerEl) timerEl.textContent = formatCountdown(settings.breakUntil - now);
      } else if (settings.pauseUntil && settings.pauseUntil > now) {
        if (iconEl) iconEl.textContent = '⏸';
        if (textEl) textEl.textContent = 'paused';
        if (timerEl) timerEl.textContent = formatCountdown(settings.pauseUntil - now);
      } else {
        if (iconEl) iconEl.textContent = '⏸';
        if (textEl) textEl.textContent = 'paused';
        if (timerEl) timerEl.textContent = '';
      }
    }

    tick();
    pausedTickerId = setInterval(tick, 1000);
    pausedBanner.classList.add('visible');
  }

  function hidePausedState() {
    pausedBanner.classList.remove('visible');
    if (pausedTickerId) { clearInterval(pausedTickerId); pausedTickerId = null; }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────
  function resetScroll() {
    totalScrolled = 0; swipeCount = 0; lastScrollY = window.scrollY; maxScrollY = window.scrollY; seenUrls = new Set();
    cancelFriction(); setOverlay(0); hideLabel(); hideActionBar(); updateCounter(false);
    chrome.runtime.sendMessage({ type: 'RESET_SCROLL' });
    chrome.storage.local.set({ bypassCount: 0 });
  }

  function pause(minutes) {
    chrome.runtime.sendMessage({ type: 'SET_PAUSE', minutes }, () => {
      settings.paused = true; showPausedState();
    });
  }

  function openBreakDialog() {
    const existing = document.getElementById('doom-break-dialog');
    if (existing) { try { existing.close(); } catch(e){} existing.remove(); }

    // Use a native <dialog> + showModal() so it renders in the browser top layer —
    // immune to Reddit's transform/overflow on ancestor elements (same fix as friction card)
    const dlg = document.createElement('dialog');
    dlg.id = 'doom-break-dialog';
    dlg.style.cssText = `
      background:#080f0a;
      border:1px solid rgba(74,222,128,0.35);border-radius:8px;
      padding:28px 32px;min-width:min(320px,90vw);max-width:90vw;
      box-shadow:0 0 60px rgba(74,222,128,0.1),0 20px 60px rgba(0,0,0,0.9);
      font-family:'Tomorrow',sans-serif;color:#4ade80;
      margin:auto;box-sizing:border-box;overflow:visible;
      line-height:1.2;
    `;
    dlg.innerHTML = `
      <div style="font-family:'Tomorrow',sans-serif;font-size:18px;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;color:#4ade80;text-shadow:0 0 15px rgba(74,222,128,0.4);margin-bottom:16px;animation:shimmerBlurGreen 3.5s ease-in-out infinite;">I deserve some free time</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.3);margin-bottom:22px;line-height:1.5;">The blocker will sleep for this long.<br>Scroll freely, no interruptions.</div>
      <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:10px;color:rgba(74,222,128,0.45);">how long do you need?</div>
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        ${[5, 10, 15, 30, 60].map(m => `<button class="doom-preset-btn" data-mins="${m}" style="padding:8px 14px;border:1px solid rgba(74,222,128,0.3);background:transparent;color:rgba(74,222,128,0.8);font-family:'Tomorrow',sans-serif;font-size:12px;cursor:pointer;border-radius:4px;transition:all 0.15s;" onmouseover="this.style.background='rgba(74,222,128,0.12)';this.style.borderColor='rgba(74,222,128,0.7)'" onmouseout="if(!this.classList.contains('selected-preset')){this.style.background='transparent';this.style.borderColor='rgba(74,222,128,0.3)'}">${m}m</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:20px;">
        <input id="doom-custom-mins" type="number" min="1" max="480" placeholder="Custom..." style="flex:1;padding:8px 12px;background:#0d1a10;border:1px solid rgba(74,222,128,0.2);border-radius:4px;color:#4ade80;font-family:'Tomorrow',sans-serif;font-size:13px;outline:none;line-height:1;"/>
        <span style="font-size:11px;color:rgba(74,222,128,0.4);">min</span>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="doom-break-confirm" style="flex:1;padding:11px;background:rgba(74,222,128,0.18);border:1px solid #4ade80;color:#4ade80;font-family:'Tomorrow',sans-serif;font-size:12px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;border-radius:4px;transition:all 0.15s;line-height:1;" onmouseover="this.style.background='rgba(74,222,128,0.3)'" onmouseout="this.style.background='rgba(74,222,128,0.18)'">enjoy the break ✓</button>
        <button id="doom-break-cancel" style="padding:11px 16px;background:transparent;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.3);font-family:'Tomorrow',sans-serif;font-size:12px;cursor:pointer;border-radius:4px;transition:all 0.15s;line-height:1;" onmouseover="this.style.borderColor='rgba(255,255,255,0.3)';this.style.color='rgba(255,255,255,0.5)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)';this.style.color='rgba(255,255,255,0.3)'">cancel</button>
      </div>
    `;

    document.body.appendChild(dlg);
    dlg.showModal();

    // Style the native ::backdrop via a one-time injected style tag
    if (!document.getElementById('doom-break-backdrop-style')) {
      const s = document.createElement('style');
      s.id = 'doom-break-backdrop-style';
      s.textContent = `#doom-break-dialog::backdrop { background:rgba(0,0,0,0.82); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }`;
      document.head.appendChild(s);
    }

    const close = () => { try { dlg.close(); } catch(e){} dlg.remove(); };

    dlg.querySelector('#doom-break-cancel').addEventListener('click', close);
    dlg.addEventListener('cancel', close); // ESC key

    let selectedMins = 10;
    const ci = dlg.querySelector('#doom-custom-mins');
    dlg.querySelectorAll('.doom-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedMins = parseInt(btn.dataset.mins); ci.value = btn.dataset.mins;
        dlg.querySelectorAll('.doom-preset-btn').forEach(b => {
          b.style.background = 'transparent';
          b.style.borderColor = 'rgba(74,222,128,0.3)';
          b.classList.remove('selected-preset');
        });
        btn.style.background = 'rgba(74,222,128,0.2)';
        btn.style.borderColor = 'rgba(74,222,128,0.8)';
        btn.classList.add('selected-preset');
      });
    });
    ci.addEventListener('input', () => {
      if (ci.value) { selectedMins = parseInt(ci.value); dlg.querySelectorAll('.doom-preset-btn').forEach(b => b.style.background = 'transparent'); }
    });
    dlg.querySelector('#doom-break-confirm').addEventListener('click', () => {
      const mins = ci.value ? parseInt(ci.value) : selectedMins;
      if (!mins || mins < 1) return;
      const breakUntil = Date.now() + mins * 60000;
      chrome.storage.sync.set({ paused: true, breakUntil }, () => {
        settings.paused = true;
        settings.breakUntil = breakUntil;
        close();
        cancelFriction();
        showPausedState();
      });
      chrome.runtime.sendMessage({ type: 'SET_BREAK', minutes: mins }).catch(() => { });
    });
  }

  // ─── SPA navigation ──────────────────────────────────────────────────────────

  function onUrlChange() {
    setTimeout(() => {
      const newMode = getMode();

      // When returning to the feed from an ignored page (e.g. Reddit post → feed),
      // keep the accumulated scroll count — just reset the scroll anchor to current position
      // so we start measuring new scroll from here.
      if (newMode === 'ignore') {
        cancelFriction();
      } else if (newMode === 'shorts') {
        // Entering shorts mode — reset scroll counters but keep swipes
        totalScrolled = 0;
        lastScrollY = window.scrollY;
        maxScrollY = window.scrollY;
      } else {
        // Returning to scroll mode — reset scroll position anchor only
        lastScrollY = window.scrollY;
        maxScrollY = window.scrollY;
      }

      checkSwipe();
    }, 150);
  }

  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = (...a) => { _push(...a); onUrlChange(); };
  history.replaceState = (...a) => { _replace(...a); onUrlChange(); };
  window.addEventListener('popstate', onUrlChange);

  // ─── Messages ────────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_STATS') {
      sendResponse({
        totalScrolled: totalScrolled,
        swipeCount: swipeCount,
        scrollThreshold: settings.scrollThreshold || 10000,
        shortsThreshold: settings.shortsThreshold || 5,
      });
      return true;
    }
    if (msg.type === 'BREAK_OVER' || msg.type === 'PAUSE_OVER') {
      settings.paused = false; settings.breakUntil = null; settings.pauseUntil = null;
      hidePausedState();
    }
    if (msg.type === 'SETTINGS_UPDATED') loadSettings(() => { });
    if (msg.type === 'RESET_SCROLL') resetScroll();
  });

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    loadSettings(() => {
      const trackedSites = settings.trackedSites || [
        { host: 'youtube.com',   types: ['shorts']         },
        { host: 'facebook.com',  types: ['feed']           },
        { host: 'instagram.com', types: ['feed', 'shorts'] },
        { host: 'tiktok.com',    types: ['shorts']         },
        { host: 'x.com',         types: ['feed']           },
        { host: 'reddit.com',    types: ['feed']           },
        { host: 'threads.net',   types: ['feed']           },
      ];

      const currentHost = location.hostname.replace('www.', '');

      // Migrate: string[] → { host, types[] }, and legacy { type } → { types }
      const sites = trackedSites.map(s => {
        if (typeof s === 'string') return { host: s, types: ['feed'] };
        if (s.type && !s.types) return { host: s.host, types: [s.type] };
        return s;
      });
      const match = sites.find(s => currentHost === s.host || currentHost.endsWith('.' + s.host));
      if (!match) return;

      const matchTypes = match.types || ['feed'];

      // For custom sites not in SITE map, override getMode() based on the first user-defined type
      const customModeOverride = (!SITE.isYoutube && !SITE.isTiktok && !SITE.isInstagram &&
        !SITE.isTwitter && !SITE.isReddit && !SITE.isFacebook && !SITE.isThreads)
        ? (matchTypes.includes('shorts') && !matchTypes.includes('feed') ? 'shorts' : 'scroll')
        : null;

      if (customModeOverride) {
        // Patch getMode for custom sites
        const _getMode = getMode;
        window._doomGetMode = () => customModeOverride;
      }

      injectElements();
      window.addEventListener('scroll', onScroll, { passive: true });

      // Enable swipe checking if types includes 'shorts' or is a known shorts site
      if (matchTypes.includes('shorts') || SITE.isYoutube || SITE.isTiktok || SITE.isInstagram || SITE.isTwitter) {
        setInterval(checkSwipe, 400);
      }
      setInterval(() => { if (settings.paused) showPausedState(); }, 30000);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
