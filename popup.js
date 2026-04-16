(async function () {
  'use strict';

  let customDict = null;
  try {
    const { customLang } = await chrome.storage.sync.get('customLang');
    const lang = customLang || 'auto';
    const langSelect = document.getElementById('langSelect');
    if (langSelect) langSelect.value = lang;

    if (lang !== 'auto') {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_LOCALE_STRINGS', lang });
      if (resp && resp.ok) customDict = resp.data;
    }
  } catch (e) {
    console.error('[DoomScroll popup] failed to init i18n:', e);
  }

  function msg(key, subs = []) {
    let str = (customDict && customDict[key]) ? customDict[key].message : (chrome.i18n.getMessage(key) || key);
    if (subs.length && str) {
      str = str.replace(/\$[A-Z]+\$/g, '$1');
      subs.forEach((val, i) => str = str.replace(new RegExp(`\\$${i + 1}`, 'g'), val));
    }
    return str;
  }

  // ── Apply i18n ──
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const m = msg(key);
    if (!m) return;
    if (el.tagName === 'INPUT' && el.type !== 'button') el.placeholder = m;
    else el.innerHTML = m;
  });

  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      chrome.storage.sync.set({ customLang: langSelect.value }, () => {
        window.location.reload();
      });
    });
  }

  const enableToggle = document.getElementById('enableToggle');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const threshSlider = document.getElementById('threshSlider');
  const shortsSlider = document.getElementById('shortsSlider');
  const threshVal = document.getElementById('threshVal');
  const shortsVal = document.getElementById('shortsVal');
  const breakBtn = document.getElementById('breakBtn');
  const breakPicker = document.getElementById('breakPicker');
  const breakConfirm = document.getElementById('breakConfirm');
  const breakCustom = document.getElementById('breakCustom');
  const timerActive = document.getElementById('timerActive');
  const timerText = document.getElementById('timerText');
  const timerCancel = document.getElementById('timerCancel');
  const breakBtns = document.getElementById('breakBtns');
  const resetBtn = document.getElementById('resetBtn');
  const cooldownSlider = document.getElementById('cooldownSlider');
  const cooldownVal = document.getElementById('cooldownVal');
  const modeStrict = document.getElementById('modeStrict');
  const modeSoft = document.getElementById('modeSoft');
  const statPx = document.getElementById('statPx');
  const statShorts = document.getElementById('statShorts');
  const statPxBar = document.getElementById('statPxBar');
  const statShortsBar = document.getElementById('statShortsBar');

  let breakSelectedMins = 10;

  function loadState() {
    chrome.storage.sync.get(
      ['enabled', 'paused', 'breakUntil', 'pauseUntil', 'scrollThreshold', 'shortsThreshold', 'strictMode', 'lockdownSeconds'],
      (data) => {
        enableToggle.checked = data.enabled !== false;
        threshSlider.value = data.scrollThreshold || 10000;
        shortsSlider.value = data.shortsThreshold || 5;
        updateSliderDisplays();
        renderMode(data.strictMode === true);
        const mins = Math.round((data.lockdownSeconds || 30) / 60);
        if (cooldownSlider) cooldownSlider.value = Math.max(1, mins);
        if (cooldownVal) cooldownVal.textContent = Math.max(1, mins) + ' min';

        const now = Date.now();
        const isPaused = data.paused === true;
        const breakUntil = data.breakUntil;
        const pauseUntil = data.pauseUntil;

        if (!data.enabled) {
          setStatus('disabled', msg('statusDisabled')); hideTimer();
        } else if (breakUntil && now < breakUntil) {
          // Break set from either popup — show time remaining
          const r = Math.ceil((breakUntil - now) / 60000);
          setStatus('paused', msg('statusPausedMins', [r.toString()]));
          showTimer(msg('breakTimerDialog', [r.toString()]), resume);
        } else if (isPaused && pauseUntil && now < pauseUntil) {
          // Legacy pauseUntil — treat same as break
          const r = Math.ceil((pauseUntil - now) / 60000);
          setStatus('paused', msg('statusPausedMins', [r.toString()]));
          showTimer(msg('breakTimerDialog', [r.toString()]), resume);
        } else if (isPaused) {
          setStatus('paused', msg('statusPausedIndef'));
          showTimer(msg('timerActiveIndef'), resume);
        } else {
          // Probe the content script — if it responds, the page is being monitored
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
              setStatus('inactive', 'Not active on this page'); hideTimer();
              return;
            }
            // Catch error if content script not loaded
            if (tabs[0].url && tabs[0].url.startsWith('chrome://')) {
              setStatus('inactive', msg('statusInactive'));
              return;
            }
            chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATS' }, (resp) => {
              if (chrome.runtime.lastError || !resp) {
                setStatus('inactive', msg('statusInactive'));
              } else {
                setStatus('active', msg('statusActive'));
              }
              hideTimer();
            });
          });
        }
      }
    );
  }

  function setStatus(state, text) {
    statusText.textContent = text;
    statusBadge.className = 'status-badge' + (state === 'active' ? ' active' : '');
  }

  function showTimer(text, onCancel) {
    timerText.textContent = text;
    timerActive.classList.add('visible');
    breakBtns.style.display = 'none';

    breakPicker.classList.remove('open');
    timerCancel.onclick = onCancel;
  }

  function hideTimer() {
    timerActive.classList.remove('visible');
    breakBtns.style.display = 'flex';
  }

  function updateSliderDisplays() {
    threshVal.textContent = Number(threshSlider.value).toLocaleString() + msg('unitPx');
    shortsVal.textContent = shortsSlider.value + msg('unitVideos');
  }

  threshSlider.addEventListener('input', () => {
    updateSliderDisplays(); saveSettings(); notifyContent();
  });

  shortsSlider.addEventListener('input', () => {
    updateSliderDisplays(); saveSettings(); notifyContent();
  });

  function saveSettings() {
    chrome.storage.sync.set({
      scrollThreshold: parseInt(threshSlider.value),
      shortsThreshold: parseInt(shortsSlider.value),
    });
  }

  enableToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: enableToggle.checked });
    notifyContent(); loadState();
  });

  function setupPresets(containerId, onSelect) {
    document.getElementById(containerId).querySelectorAll('.preset-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.getElementById(containerId).querySelectorAll('.preset-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
        onSelect(parseInt(pill.dataset.mins));
      });
    });
  }

  setupPresets('breakPresets', (m) => { breakSelectedMins = m; });

  breakBtn.addEventListener('click', () => {
    breakPicker.classList.toggle('open');
  });

  breakConfirm.addEventListener('click', () => {
    const mins = breakCustom.value ? parseInt(breakCustom.value) : breakSelectedMins;
    // 0 = indefinite (from "Indefinite" preset)
    if (mins === 0) {
      chrome.runtime.sendMessage({ type: 'SET_PAUSE', minutes: 0 }, () => {
        notifyContent(); loadState();
      });
    } else {
      if (!mins || mins < 1) return;
      chrome.runtime.sendMessage({ type: 'SET_BREAK', minutes: mins }, () => {
        notifyContent(); loadState();
      });
    }
    breakPicker.classList.remove('open');
    breakCustom.value = '';
  });

  function resume() {
    chrome.runtime.sendMessage({ type: 'RESUME' }, () => { notifyContent(); loadState(); });
  }

  resetBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'RESET_SCROLL' }).catch(() => { });
    });
    resetBtn.textContent = msg('resetDone');
    setTimeout(() => { resetBtn.textContent = msg('resetScroll'); }, 1500);
  });

  function notifyContent() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED' }).catch(() => { });
    });
  }

  // ── Mode selector ───────────────────────────────────────────────────────────
  function renderMode(strict) {
    modeStrict.classList.toggle('selected', strict === true);
    modeSoft.classList.toggle('selected', strict !== true);
  }

  if (cooldownSlider) {
    cooldownSlider.addEventListener('input', () => {
      const mins = parseInt(cooldownSlider.value);
      if (cooldownVal) cooldownVal.textContent = mins + ' ' + msg('unitMin');
      chrome.storage.sync.set({ lockdownSeconds: mins * 60 });
      notifyContent();
    });
  }

  modeStrict.addEventListener('click', () => {
    chrome.storage.sync.set({ strictMode: true });
    renderMode(true);
    notifyContent();
  });

  modeSoft.addEventListener('click', () => {
    chrome.storage.sync.set({ strictMode: false });
    renderMode(false);
    notifyContent();
  });

  // ── Live stats polling ──────────────────────────────────────────────────────
  function updateStatDisplay(px, shorts, pxThreshold, shortsThreshold) {
    if (statPx) {
      const val = px >= 1000 ? (px / 1000).toFixed(1) + 'k' : String(px);
      statPx.innerHTML = val + '<span>' + msg('unitPx') + '</span>';
    }
    if (statShorts) {
      statShorts.innerHTML = shorts + '<span>' + msg('unitVideos') + '</span>';
    }

    // Bar: colour shifts safe → warn → danger based on % of threshold
    function barColor(pct) {
      if (pct < 0.5) return 'safe';
      if (pct < 0.85) return 'warn';
      return '';
    }

    const pxPct = Math.min(px / (pxThreshold || 10000), 1);
    if (statPxBar) {
      statPxBar.style.width = (pxPct * 100) + '%';
      statPxBar.className = 'stat-bar-fill ' + barColor(pxPct);
    }

    const sPct = Math.min(shorts / (shortsThreshold || 5), 1);
    if (statShortsBar) {
      statShortsBar.style.width = (sPct * 100) + '%';
      statShortsBar.className = 'stat-bar-fill ' + barColor(sPct);
    }
  }

  function pollStats() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATS' }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          // Tab not tracked (e.g. chrome:// page) — show dashes
          if (statPx) statPx.innerHTML = '—<span>' + msg('unitPx') + '</span>';
          if (statShorts) statShorts.innerHTML = '—<span>' + msg('unitVideos') + '</span>';
          return;
        }
        updateStatDisplay(resp.totalScrolled || 0, resp.swipeCount || 0, resp.scrollThreshold, resp.shortsThreshold);
      });
    });
  }

  pollStats();
  setInterval(pollStats, 1000);

  // ── Monitored sites ─────────────────────────────────────────────────────────
  const DEFAULT_SITES = [
    { host: 'youtube.com',   types: ['shorts']         },
    { host: 'facebook.com',  types: ['feed']           },
    { host: 'instagram.com', types: ['feed', 'shorts'] },
    { host: 'tiktok.com',    types: ['shorts']         },
    { host: 'x.com',         types: ['feed']           },
    { host: 'reddit.com',    types: ['feed']           },
    { host: 'threads.net',   types: ['feed']           },
  ];

  // Hosts that have static content_scripts in manifest.json (no permission request needed)
  const DEFAULT_HOSTS = [
    'youtube.com', 'facebook.com', 'instagram.com',
    'tiktok.com', 'x.com', 'reddit.com', 'threads.net',
  ];
  function isDefaultHost(host) {
    return DEFAULT_HOSTS.some(d => host === d || host.endsWith('.' + d));
  }

  const sitesList = document.getElementById('sitesList');
  const siteInput = document.getElementById('siteInput');
  const siteAddBtn = document.getElementById('siteAddBtn');
  const sitesBody = document.getElementById('sitesBody');
  const sitesChevron = document.getElementById('sitesChevron');
  const sitesHeader = document.getElementById('sitesToggleHeader');
  const addTypeToggle = document.getElementById('addTypeToggle');
  // Multi-select: both Feed and Shorts can be active simultaneously
  let addSelectedTypes = new Set(['feed']);

  // Collapse toggle
  sitesHeader.addEventListener('click', () => {
    const open = sitesBody.style.display !== 'none';
    sitesBody.style.display = open ? 'none' : 'block';
    sitesChevron.style.transform = open ? '' : 'rotate(90deg)';
    if (!open) sitesBody.style.marginTop = '10px';
  });

  // Type toggle in add row — each button toggles independently
  addTypeToggle.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.type;
      if (addSelectedTypes.has(t) && addSelectedTypes.size > 1) {
        addSelectedTypes.delete(t);
        btn.classList.remove('selected');
      } else {
        addSelectedTypes.add(t);
        btn.classList.add('selected');
      }
    });
  });

  function normalizeSite(raw) {
    return raw.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
  }

  function renderSites(sites) {
    sitesList.innerHTML = '';
    sites.forEach((site, i) => {
      const types = (site.types || [site.type || 'feed']).slice().sort((a, b) => a === 'feed' ? -1 : 1);
      const row = document.createElement('div');
      row.className = 'site-row';
      const badges = types.map(t => `<span class="type-badge ${t}">${t === 'feed' ? msg('badgeFeed') : msg('badgeShorts')}</span>`).join('');
      row.innerHTML = `
        <span class="site-row-name">${site.host}</span>
        <span style="display:flex;gap:3px;flex-shrink:0;">${badges}</span>
        <button class="site-row-btn edit-btn" data-i="${i}" title="Edit">✎</button>
        <button class="site-row-btn del-btn"  data-i="${i}" title="Remove">✕</button>
      `;
      sitesList.appendChild(row);
    });

    // Edit
    sitesList.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.i);
        const row = btn.closest('.site-row');
        const editTypes = new Set(sites[i].types || [sites[i].type || 'feed']);
        row.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:6px;width:100%;">
            <input class="site-edit-input" value="${sites[i].host}" style="width:100%;background:#111;border:1px solid rgba(255,45,45,0.3);border-radius:3px;outline:none;color:var(--red);font-family:var(--mono);font-size:11px;padding:5px 8px;" />
            <div style="display:flex;align-items:center;gap:6px;">
              <div class="type-toggle edit-type-toggle" style="flex:1;">
                <button class="type-btn ${editTypes.has('feed') ? 'selected' : ''}" data-type="feed" style="flex:1;">${msg('badgeFeed')}</button>
                <button class="type-btn ${editTypes.has('shorts') ? 'selected' : ''}" data-type="shorts" style="flex:1;">${msg('badgeShorts')}</button>
              </div>
              <button class="site-row-btn save-btn" title="Save" style="color:#4ade80;">${msg('save')}</button>
              <button class="site-row-btn cancel-btn" title="Cancel">${msg('cancel')}</button>
            </div>
          </div>
        `;
        row.querySelectorAll('.type-btn').forEach(b => {
          b.addEventListener('click', () => {
            const t = b.dataset.type;
            if (editTypes.has(t) && editTypes.size > 1) {
              editTypes.delete(t);
              b.classList.remove('selected');
            } else {
              editTypes.add(t);
              b.classList.add('selected');
            }
          });
        });
        row.querySelector('.save-btn').addEventListener('click', () => {
          const val = normalizeSite(row.querySelector('.site-edit-input').value);
          if (!val) return;
          sites[i] = { host: val, types: [...editTypes] };
          saveSites(sites);
        });
        row.querySelector('.cancel-btn').addEventListener('click', () => renderSites(sites));
      });
    });

    // Delete
    sitesList.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.i);
        const removed = sites[idx];
        sites.splice(idx, 1);
        // Unregister dynamic script for custom (non-default) sites
        if (removed && !isDefaultHost(removed.host)) {
          chrome.runtime.sendMessage({ type: 'UNREGISTER_CUSTOM_SITE', host: removed.host }).catch(() => {});
        }
        saveSites(sites);
      });
    });
  }

  function saveSites(sites) {
    chrome.storage.sync.set({ trackedSites: sites }, () => {
      notifyContent();
      renderSites(sites);
    });
  }

  function loadSites() {
    chrome.storage.sync.get('trackedSites', (data) => {
      const raw = data.trackedSites || DEFAULT_SITES;
      // Migrate: string[] → object[], and { type } → { types }
      const sites = raw.map(s => {
        if (typeof s === 'string') return { host: s, types: ['feed'] };
        if (s.type && !s.types) return { host: s.host, types: [s.type] };
        return s;
      });
      renderSites(sites);
    });
  }

  siteAddBtn.addEventListener('click', () => {
    const val = normalizeSite(siteInput.value);
    if (!val) return;
    chrome.storage.sync.get('trackedSites', (data) => {
      const raw = data.trackedSites || DEFAULT_SITES;
      const sites = raw.map(s => {
        if (typeof s === 'string') return { host: s, types: ['feed'] };
        if (s.type && !s.types) return { host: s.host, types: [s.type] };
        return s;
      });
      if (sites.some(s => s.host === val)) return;

      function doAdd() {
        sites.push({ host: val, types: [...addSelectedTypes] });
        saveSites(sites);
        siteInput.value = '';
        // Reset add toggle back to Feed only
        addSelectedTypes = new Set(['feed']);
        addTypeToggle.querySelectorAll('.type-btn').forEach(b => {
          b.classList.toggle('selected', b.dataset.type === 'feed');
        });
      }

      // Custom (non-default) sites need a host permission grant + dynamic script
      if (!isDefaultHost(val)) {
        chrome.permissions.request(
          { origins: [`*://*.${val}/*`] },
          (granted) => {
            if (!granted) return; // user declined
            chrome.runtime.sendMessage({ type: 'REGISTER_CUSTOM_SITE', host: val }, () => {
              doAdd();
            });
          }
        );
      } else {
        doAdd();
      }
    });
  });

  siteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') siteAddBtn.click(); });

  loadSites();
  loadState();
})();
