// background.js — DoomScroll Blocker Service Worker

// Default sites that are declared in manifest.json content_scripts.matches
const DEFAULT_HOSTS = [
  'youtube.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'x.com', 'reddit.com', 'threads.net',
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enabled: true,
    paused: false,
    pauseUntil: null,
    breakUntil: null,
    scrollThreshold: 10000,
    shortsThreshold: 5,
    strictMode: false,
    lockdownSeconds: 30,
    trackedSites: [
      { host: 'youtube.com',   types: ['shorts']         },
      { host: 'facebook.com',  types: ['feed']           },
      { host: 'instagram.com', types: ['feed', 'shorts'] },
      { host: 'tiktok.com',    types: ['shorts']         },
      { host: 'x.com',         types: ['feed']           },
      { host: 'reddit.com',    types: ['feed']           },
      { host: 'threads.net',   types: ['feed']           },
    ],
  });
  // Register dynamic scripts for any custom sites carried over from previous version
  registerCustomSiteScripts();
});

// Re-register dynamic scripts on browser startup (they don't persist)
chrome.runtime.onStartup.addListener(() => {
  registerCustomSiteScripts();
});

// ─── Dynamic content-script registration for custom (non-default) sites ────
function isDefaultHost(host) {
  return DEFAULT_HOSTS.some(d => host === d || host.endsWith('.' + d));
}

async function registerCustomSiteScripts() {
  const data = await chrome.storage.sync.get('trackedSites');
  const sites = data.trackedSites || [];
  const customHosts = sites
    .map(s => typeof s === 'string' ? s : s.host)
    .filter(h => !isDefaultHost(h));

  // Unregister all existing dynamic scripts first to avoid duplicates
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const doomIds = existing.filter(s => s.id.startsWith('doom-custom-')).map(s => s.id);
    if (doomIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: doomIds });
    }
  } catch (e) { /* no scripts registered yet */ }

  // Register a script for each custom host
  for (const host of customHosts) {
    try {
      await chrome.scripting.registerContentScripts([{
        id: 'doom-custom-' + host,
        matches: [`*://*.${host}/*`],
        js: ['content.js'],
        css: ['content.css'],
        runAt: 'document_idle',
      }]);
    } catch (e) {
      console.warn('[DoomScroll] Failed to register script for', host, e);
    }
  }
}

async function registerSingleCustomSite(host) {
  const scriptId = 'doom-custom-' + host;
  try {
    // Remove if already registered
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    }
  } catch (e) { /* not registered yet */ }

  await chrome.scripting.registerContentScripts([{
    id: scriptId,
    matches: [`*://*.${host}/*`],
    js: ['content.js'],
    css: ['content.css'],
    runAt: 'document_idle',
  }]);
}

async function unregisterSingleCustomSite(host) {
  const scriptId = 'doom-custom-' + host;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
  } catch (e) { /* was not registered */ }
}

// Listen for alarm (break/pause timer expiry)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'breakOver') {
    chrome.storage.sync.set({ breakUntil: null, paused: false });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'BREAK_OVER' }).catch(() => { });
      });
    });
  }
  if (alarm.name === 'pauseOver') {
    chrome.storage.sync.set({ pauseUntil: null, paused: false });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'PAUSE_OVER' }).catch(() => { });
      });
    });
  }
});

// Unified message listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_BREAK') {
    const until = Date.now() + msg.minutes * 60 * 1000;
    chrome.storage.sync.set({ breakUntil: until, paused: true });
    chrome.alarms.create('breakOver', { delayInMinutes: msg.minutes });
    sendResponse({ ok: true, until });
  }
  if (msg.type === 'SET_PAUSE') {
    const until = msg.minutes ? Date.now() + msg.minutes * 60 * 1000 : null;
    chrome.storage.sync.set({ pauseUntil: until, paused: true });
    if (msg.minutes) {
      chrome.alarms.create('pauseOver', { delayInMinutes: msg.minutes });
    }
    sendResponse({ ok: true });
  }
  if (msg.type === 'OPEN_POPUP') {
    chrome.action.openPopup().catch(() => {
      // Fallback: open popup.html as a small window if openPopup() isn't available
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup',
        width: 340,
        height: 560,
      });
    });
    sendResponse({ ok: true });
  }
  if (msg.type === 'RESUME') {
    chrome.alarms.clear('breakOver');
    chrome.alarms.clear('pauseOver');
    chrome.storage.sync.set({ paused: false, pauseUntil: null, breakUntil: null });
    sendResponse({ ok: true });
  }
  if (msg.type === 'RESET_SCROLL') {
    sendResponse({ ok: true });
  }
  if (msg.type === 'REGISTER_CUSTOM_SITE') {
    registerSingleCustomSite(msg.host)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // keep channel open for async response
  }
  if (msg.type === 'UNREGISTER_CUSTOM_SITE') {
    unregisterSingleCustomSite(msg.host)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return true;
});
