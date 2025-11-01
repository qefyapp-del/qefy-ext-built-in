// background.js (MV3 service worker)
// Core coordination: create offscreen doc, relay messages, cache state

import { MessageType } from './messages.js';

let offscreenPort = null;

function keepOffscreenAlive() {
  if (offscreenPort) {
    offscreenPort.postMessage({ type: 'ping' });
  } else {
    offscreenPort = chrome.runtime.connect({ name: 'keep-alive' });
    offscreenPort.onDisconnect.addListener(() => {
      offscreenPort = null;
      console.log('[QEFY Background] Offscreen document disconnected, will reconnect on next ping.');
    });
    offscreenPort.onMessage.addListener((msg) => {
      if (msg.type === 'pong') {
        // console.log('[QEFY Background] Received pong from offscreen document.');
      }
    });
  }
}

setInterval(keepOffscreenAlive, 20000); // Ping every 20 seconds
const OFFSCREEN_URL = 'offscreen.html';

let latestCompiledQueue = null;
let authState = { status: 'signed_out', uid: null, email: null };
let hijackedTabId = null;

async function ensureFloatingUi(tabId) {
  try { 
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['tab_floating_ui.css'] }); 
    await chrome.scripting.executeScript({ target: { tabId }, files: ['i18n.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['tab_floating_ui.js'] });
  } catch (e) {
    console.error('[QEFY Background] Failed to inject floating UI:', e);
  }
}

async function setTabFavicon(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Create a link element for the favicon
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        link.href = chrome.runtime.getURL('icons/icon16.png');
        
        // Remove existing favicon if any
        const existingFavicon = document.querySelector('link[rel="icon"]');
        if (existingFavicon) {
          existingFavicon.remove();
        }
        
        // Add the new favicon
        document.head.appendChild(link);
      }
    });
  } catch (e) {
    console.warn('[QEFY] Failed to set tab favicon', e);
  }
}

function getFirstUrlFromFolder(queue, folder) {
  try {
    const q = queue?.queue || {};
    const arr = Array.isArray(q[folder]) ? q[folder] : [];
    for (const it of arr) {
      if (it && typeof it.url === 'string' && it.url) return it.url;
    }
  } catch (_) {}
  return null;
}

async function openInHijackedTab(url) {
  if (!url) return;
  try {
    // First, try to update the hijacked tab if we have one
    if (hijackedTabId) {
      try {
        // Verify the tab still exists before trying to update it
        await chrome.tabs.get(hijackedTabId);
        await chrome.tabs.update(hijackedTabId, { active: true, url });
        // Inject floating UI after tab loads
        const targetId = hijackedTabId;
        const listener = async (tabId, info) => {
          if (tabId === targetId && info.status === 'complete') {
            try { 
              await ensureFloatingUi(targetId);
              await setTabFavicon(targetId);
            } catch (_) {}
            chrome.tabs.onUpdated.removeListener(listener);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        return;
      } catch (_) {
        // Tab doesn't exist or update failed, clear the reference
        hijackedTabId = null;
      }
    }
    
    // Try to find and reuse any existing YouTube tab before creating a new one
    const existingTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    if (existingTabs && existingTabs.length > 0) {
      const targetTab = existingTabs[0];
      hijackedTabId = targetTab.id;
      await chrome.tabs.update(hijackedTabId, { active: true, url });
      
      // Inject floating UI after tab loads
      const targetId = hijackedTabId;
      const listener = async (tabId, info) => {
        if (tabId === targetId && info.status === 'complete') {
          try { 
            await ensureFloatingUi(targetId);
            await setTabFavicon(targetId);
          } catch (_) {}
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      return;
    }
    
    // Only create a new tab if no existing YouTube tabs found
    const created = await chrome.tabs.create({ url, active: true });
    hijackedTabId = created.id || null;
    if (hijackedTabId) {
      // Inject floating UI after tab loads
      const targetId = hijackedTabId;
      const listener = async (tabId, info) => {
        if (tabId === targetId && info.status === 'complete') {
          try { 
            await ensureFloatingUi(targetId);
            await setTabFavicon(targetId);
          } catch (_) {}
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    }
  } catch (e) {
    console.warn('[QEFY] Failed to open hijacked tab', e);
  }
}

async function ensureOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['DOM_SCRAPING'],
    justification: 'Run Firebase + Core App with DOM and long-lived listeners'
  });
}

async function loadConfig() {
  try {
    const url = chrome.runtime.getURL('firebase-config.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error('missing firebase-config.json');
    return await res.json();
  } catch (e) {
    console.warn('[QEFY] No firebase-config.json found. Create one from firebase-config.example.json');
    return null;
  }
}


async function init() {
  await ensureOffscreenDocument();
  keepOffscreenAlive(); // Start the keep-alive mechanism
  const config = await loadConfig();
  chrome.runtime.sendMessage({ type: MessageType.OFFSCREEN_INIT, payload: { config } }, () => void chrome.runtime.lastError);
  
  // Load cached queue data on startup
  try {
    const cached = await chrome.storage.local.get(['qefy_compiled_queue']);
    latestCompiledQueue = cached.qefy_compiled_queue || null;
  } catch (e) {
    console.warn('[QEFY Background] Failed to load cached queue on startup:', e);
  }
  
  // Set extension flag on QEFY web pages
  try {
    await setQefyExtensionFlag(true);
  } catch (e) {
    console.warn('[QEFY Background] Failed to set extension flag on startup:', e);
  }
  
}

chrome.runtime.onInstalled.addListener(() => {
  init();
});

chrome.runtime.onStartup?.addListener(() => {
  init();
});

// Clean up hijackedTabId when tab is closed and send STOP command
chrome.tabs.onRemoved.addListener((tabId) => {
  if (hijackedTabId !== null && tabId === hijackedTabId) {
    console.log('[QEFY BG] Hijacked tab closed - sending STOP command');
    hijackedTabId = null;
    
    // Send STOP command to offscreen to update Real-time DB
    chrome.runtime.sendMessage({
      type: 'TAB_CLOSED_STOP_PLAYBACK'
    }, () => void chrome.runtime.lastError);
  }
});

// Set extension flag when QEFY web pages are loaded
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isQefyWeb = tab.url.includes('qefy-playlist.web.app') || 
                     tab.url.includes('localhost:8080') || 
                     tab.url.includes('127.0.0.1:8080');
    
    if (isQefyWeb) {
      try {
        await setQefyExtensionFlag(true);
        console.log('[QEFY Background] Set extension flag on QEFY web page:', tab.url);
      } catch (e) {
        console.warn('[QEFY Background] Failed to set extension flag on QEFY web page:', e);
      }
    }
  }
});

// Extension flag management functions
async function setQefyExtensionFlag(enabled = true) {
  try {
    // Try to set the flag via content script on QEFY web app and localhost
    const qefyTabs = await chrome.tabs.query({ url: "https://qefy-playlist.web.app/*" });
    const localhostTabs = await chrome.tabs.query({ url: ["http://localhost:8080/*", "https://localhost:8080/*"] });
    const allTabs = [...qefyTabs, ...localhostTabs];
    
    for (const tab of allTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'QEFY_SET_EXTENSION_FLAG',
          enabled: enabled
        });
      } catch (e) {
        console.log('[QEFY] Could not set extension flag on tab', tab.id, ':', e.message);
      }
    }
    
    // Also store in extension's local storage as backup
    await chrome.storage.local.set({ qefy_extension_enabled: enabled });
    
    console.log('[QEFY] Extension flag set to:', enabled);
    return { ok: true, enabled };
  } catch (e) {
    console.error('[QEFY] Failed to set extension flag:', e);
    return { ok: false, error: String(e) };
  }
}

async function getQefyExtensionFlag() {
  try {
    // Try to get the flag from QEFY web app and localhost content scripts
    const qefyTabs = await chrome.tabs.query({ url: "https://qefy-playlist.web.app/*" });
    const localhostTabs = await chrome.tabs.query({ url: ["http://localhost:8080/*", "https://localhost:8080/*"] });
    const allTabs = [...qefyTabs, ...localhostTabs];
    
    for (const tab of allTabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'QEFY_GET_EXTENSION_FLAG'
        });
        
        if (response?.success) {
          return { ok: true, enabled: response.enabled };
        }
      } catch (e) {
        // Don't log connection errors for tabs that might be closed or not ready
        if (!e.message.includes('Receiving end does not exist')) {
          console.log('[QEFY] Could not get extension flag from tab', tab.id, ':', e.message);
        }
      }
    }
    
    // Fallback to extension's local storage
    const { qefy_extension_enabled } = await chrome.storage.local.get(['qefy_extension_enabled']);
    return { ok: true, enabled: qefy_extension_enabled || false };
  } catch (e) {
    console.error('[QEFY] Failed to get extension flag:', e);
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case MessageType.OFFSCREEN_READY: {
      // Offscreen is ready, re-send init/config if needed
      loadConfig().then((config) => {
        chrome.runtime.sendMessage({ type: MessageType.OFFSCREEN_INIT, payload: { config } }, () => void chrome.runtime.lastError);
      });
      break;
    }
    case MessageType.AUTH_STATE: {
      authState = message.payload || authState;
      chrome.runtime.sendMessage({ type: MessageType.AUTH_STATE_UPDATE, payload: authState }, () => void chrome.runtime.lastError);
      try {
        // Switch popup based on auth state
        const path = authState?.status === 'signed_in' ? 'popup.html' : 'login.html';
        chrome.action.setPopup({ popup: path });
      } catch (_) {}
      
      // Also notify all YouTube tabs so content scripts can update their UI immediately
      try {
        chrome.tabs.query({ url: 'https://www.youtube.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            try {
              chrome.tabs.sendMessage(tab.id, { type: MessageType.AUTH_STATE_UPDATE, payload: authState }, () => void chrome.runtime.lastError);
            } catch (_) {}
          });
        });
      } catch (_) {}
      
      break;
    }
    case MessageType.COMPILED_QUEUE_UPDATE: {
      latestCompiledQueue = message.payload || null;
      chrome.storage.local.set({ qefy_compiled_queue: latestCompiledQueue });
      // Send to popup and other runtime listeners
      chrome.runtime.sendMessage({ type: MessageType.COMPILED_QUEUE_UPDATE, payload: latestCompiledQueue }, () => void chrome.runtime.lastError);
      
      // Send specifically to hijacked tab (floating UI)
      if (hijackedTabId) {
        chrome.tabs.sendMessage(hijackedTabId, { type: MessageType.COMPILED_QUEUE_UPDATE, payload: latestCompiledQueue });
      }
      
      // Send to all YouTube tabs (content scripts)
      chrome.tabs.query({ url: 'https://www.youtube.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: MessageType.COMPILED_QUEUE_UPDATE, payload: latestCompiledQueue }, () => {
            // Ignore errors for tabs that don't have the content script
            if (chrome.runtime.lastError) {
              // Content script not ready or tab closed
            }
          });
        });
      });
      break;
    }
    case MessageType.AUTH_CREDENTIALS_REQUIRED: {
      chrome.runtime.sendMessage({ type: MessageType.AUTH_CREDENTIALS_REQUIRED }, () => void chrome.runtime.lastError);
      break;
    }
    case MessageType.POPUP_GET_STATE: {
      // Try to load cached queue data if we don't have it in memory
      if (!latestCompiledQueue) {
        chrome.storage.local.get(['qefy_compiled_queue']).then((cached) => {
          latestCompiledQueue = cached.qefy_compiled_queue || null;
          sendResponse({ authState, latestCompiledQueue });
        }).catch((e) => {
          console.warn('[QEFY Background] Failed to load cached queue:', e);
          sendResponse({ authState, latestCompiledQueue });
        });
        return true;
      }
      sendResponse({ authState, latestCompiledQueue });
      return true;
    }
    case MessageType.POPUP_SIGN_IN: {
      const creds = message?.payload || null;
      chrome.runtime.sendMessage({ type: MessageType.OFFSCREEN_SIGN_IN, payload: creds }, () => void chrome.runtime.lastError);
      break;
    }
    case MessageType.POPUP_SIGN_OUT: {
      chrome.runtime.sendMessage({ type: MessageType.OFFSCREEN_SIGN_OUT }, async (response) => {
        if (chrome.runtime.lastError) {
          console.error('[QEFY Background] Error during sign out:', chrome.runtime.lastError);
          return;
        }
        
        if (response && response.ok) {
          console.log('[QEFY Background] Cleaning up storage after sign out...');
          
          // Clean up extension data from storage (keep language preference)
          try {
            await chrome.storage.local.remove([
              'qefy_compiled_queue',
              'qefy_extension_enabled'
            ]);
            console.log('[QEFY Background] ✅ Storage cleaned up (language preference preserved)');
          } catch (e) {
            console.error('[QEFY Background] ❌ Error cleaning storage:', e);
          }
          
          // Update auth state
          authState = { status: 'signed_out', uid: null, email: null };
          latestCompiledQueue = null;
          hijackedTabId = null;
          
          // Update popup action to login.html
          try {
            chrome.action.setPopup({ popup: 'login.html' });
            // Note: Chrome extension popups opened via action have a default width
            // The HTML/CSS will set the actual content width to 520px
            console.log('[QEFY Background] ✅ Popup action updated to login.html');
          } catch (e) {
            console.error('[QEFY Background] ❌ Error updating popup action:', e);
          }
        } else {
          console.error('[QEFY Background] Sign out failed:', response?.error);
        }
      });
      break;
    }
    case MessageType.POPUP_PLAY_NOW: {
      const folder = message?.payload?.folder;
      const url = message?.payload?.url;
      
      if (url) {
        // Direct URL navigation (for auto-navigation to next video)
        openInHijackedTab(url);
      } else if (folder) {
        // Folder-based navigation (for manual play now)
        const firstUrl = getFirstUrlFromFolder(latestCompiledQueue, folder);
        if (firstUrl) openInHijackedTab(firstUrl);
      }
      break;
    }
    case MessageType.POPUP_OPEN_APP: {
      const url = 'https://qefy-playlist.web.app/';
      (async () => {
        try {
          const tabs = await chrome.tabs.query({ url: url + '*' });
          if (tabs && tabs.length) {
            await chrome.tabs.update(tabs[0].id, { active: true });
            await chrome.windows.update(tabs[0].windowId, { focused: true });
          } else {
            await chrome.tabs.create({ url, active: true });
          }
        } catch (_) {}
      })();
      break;
    }
    case MessageType.POPUP_MARK_DONE_NEXT: {
      // Use sender tab if available (content script), otherwise fall back to stored hijackedTabId
      const targetId = hijackedTabId ?? sender?.tab?.id ?? null;
      if (!targetId) break;
      chrome.scripting.executeScript({
        target: { tabId: targetId },
        world: 'MAIN',
        func: () => { try { chrome.runtime?.sendMessage({ type: 'QEFY_NEAR_END', payload: { url: location.href } }, () => void chrome.runtime?.lastError); } catch(_){} }
      });
      break;
    }
    case MessageType.OPEN_ACTION_POPUP: {
      // Attempt to open the extension popup. If the API fails (e.g. due to
      // missing user gesture constraints), fall back to opening a popup window
      // pointing at the correct page (login or main popup) based on auth state.
      try {
        chrome.action.openPopup?.(() => {
          if (chrome.runtime.lastError) {
            try {
              const path = authState?.status === 'signed_in' ? 'popup.html' : 'login.html';
              const url = chrome.runtime.getURL(path);
              const width = path === 'login.html' ? 520 : 380;
              chrome.windows.create({ url, type: 'popup', width, height: 560 });
            } catch (_) {}
          }
          try { sendResponse && sendResponse({ ok: true }); } catch (_) {}
        });
      } catch (_) {
        try {
          const path = authState?.status === 'signed_in' ? 'popup.html' : 'login.html';
          const url = chrome.runtime.getURL(path);
          const width = path === 'login.html' ? 520 : 380;
          chrome.windows.create({ url, type: 'popup', width, height: 560 });
        } catch (_) {}
        try { sendResponse && sendResponse({ ok: true }); } catch (_) {}
      }
      return true;
    }
    case MessageType.POPUP_PLAYER_CONTROL: {
      // Use sender tab if available (content script), otherwise fall back to stored hijackedTabId
      const targetId = hijackedTabId ?? sender?.tab?.id ?? null;
      if (!targetId) return;
      const raw = message.payload || {};
      const cmd = typeof raw.cmd === 'string' ? raw.cmd : '';
      const value = Number(raw.value ?? 0);
      chrome.scripting.executeScript({
        target: { tabId: targetId },
        world: 'MAIN',
        func: (command, val) => {
          const media = document.querySelector('video, audio');
          if (!media) return;
          switch (command) {
            case 'play': media.play().catch(()=>{}); break;
            case 'pause': media.pause(); break;
            case 'toggle_play': media.paused ? media.play().catch(()=>{}) : media.pause(); break;
            case 'seek_rel': {
              const d = Number(val)||0;
              const dur = Number.isFinite(media.duration) ? media.duration : Infinity;
              media.currentTime = Math.max(0, Math.min(dur, (Number(media.currentTime)||0)+d));
              break;
            }
            case 'seekto': {
              const t = Number(val)||0;
              const dur = Number.isFinite(media.duration) ? media.duration : Infinity;
              media.currentTime = Math.max(0, Math.min(dur, t));
              break;
            }
            case 'set_rate': {
              let r = Number(val)||1; r = Math.min(4, Math.max(0.1, r));
              media.playbackRate = r;
              break;
            }
          }
        },
        args: [cmd, value]
      });
      break;
    }
    case MessageType.SEND_ACTION_TO_CORE: {
      // Forward action to offscreen document
      console.log('[QEFY Background] Forwarding SEND_ACTION_TO_CORE to offscreen:', message.payload);
      chrome.runtime.sendMessage({
        type: MessageType.SEND_ACTION_TO_CORE,
        payload: message.payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[QEFY Background] Error forwarding to offscreen:', chrome.runtime.lastError);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[QEFY Background] Offscreen response:', response);
          sendResponse(response);
        }
      });
      return true;
    }
    case MessageType.SYNC_PENDING_ACTIONS: {
      // Forward sync request to offscreen document
      chrome.runtime.sendMessage({
        type: MessageType.SYNC_PENDING_ACTIONS,
        payload: message.payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true;
    }
    case MessageType.FIND_FOLDER_NAME: {
      // Forward find folder name request to offscreen document
      chrome.runtime.sendMessage({
        type: MessageType.FIND_FOLDER_NAME,
        payload: message.payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true;
    }
    case MessageType.FIND_VIDEO_ITEM: {
      // Forward find video item request to offscreen document
      chrome.runtime.sendMessage({
        type: MessageType.FIND_VIDEO_ITEM,
        payload: message.payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true;
    }
    case 'TEST_MESSAGE': {
      console.log('[QEFY Background] Received test message from YouTube content script:', message.payload);
      sendResponse({ ok: true, message: 'Background script is responsive' });
      return true;
    }
    case 'QEFY_SET_EXTENSION_FLAG': {
      const enabled = message?.enabled !== false;
      setQefyExtensionFlag(enabled).then(result => {
        sendResponse(result);
      });
      return true;
    }
    case 'QEFY_GET_EXTENSION_FLAG': {
      getQefyExtensionFlag().then(result => {
        sendResponse(result);
      });
      return true;
    }
    case MessageType.EXECUTE_MEDIA_COMMAND: {
      const { command, url, mediaId } = message?.payload || {};
      console.log('[QEFY BG] EXECUTE_MEDIA_COMMAND received - command:', command, 'url:', url, 'mediaId:', mediaId);
      
      if (command === 'navigate' && url) {
        console.log('[QEFY BG] Navigating to URL:', url, 'in hijacked tab:', hijackedTabId);
        // Navigate to the URL in the hijacked tab or create a new one
        if (hijackedTabId) {
          console.log('[QEFY BG] Updating existing hijacked tab:', hijackedTabId);
          chrome.tabs.update(hijackedTabId, { url, active: true }, () => {
            if (chrome.runtime.lastError) {
              console.log('[QEFY BG] Error navigating hijacked tab, creating new tab:', chrome.runtime.lastError);
              chrome.tabs.create({ url }, (tab) => {
                hijackedTabId = tab.id;
                console.log('[QEFY BG] Created new hijacked tab:', hijackedTabId);
              });
            } else {
              console.log('[QEFY BG] Successfully navigated hijacked tab to:', url);
            }
          });
        } else {
          console.log('[QEFY BG] No hijacked tab, creating new one');
          chrome.tabs.create({ url }, (tab) => {
            hijackedTabId = tab.id;
            console.log('[QEFY BG] Created new hijacked tab:', hijackedTabId);
          });
        }
      } else if (command === 'stop') {
        // Close the hijacked tab
        console.log('[QEFY BG] Stopping playback - closing hijacked tab:', hijackedTabId);
        if (hijackedTabId) {
          chrome.tabs.remove(hijackedTabId, () => {
            if (chrome.runtime.lastError) {
              console.log('[QEFY BG] Error closing hijacked tab:', chrome.runtime.lastError);
            } else {
              console.log('[QEFY BG] Hijacked tab closed');
            }
            hijackedTabId = null;
          });
        }
      }
      break;
    }
    case 'REQUEST_MEDIA_STATUS': {
      // Forward request to the hijacked tab to get immediate status
      if (hijackedTabId) {
        chrome.tabs.sendMessage(hijackedTabId, { type: 'REQUEST_MEDIA_STATUS' }, () => {
          // Ignore errors if tab doesn't exist or content script not ready
          void chrome.runtime.lastError;
        });
      }
      break;
    }
    case 'GET_DEVICE_ID': {
      // Forward request to offscreen document to get device ID
      chrome.runtime.sendMessage({ type: 'GET_DEVICE_ID' }, (response) => {
        if (response && response.deviceId) {
          sendResponse({ deviceId: response.deviceId });
        } else {
          sendResponse({ deviceId: null });
        }
      });
      return true;
    }
    case 'GET_MEDIA_STATUS': {
      // Forward request to offscreen document to get media status
      chrome.runtime.sendMessage({ type: 'GET_MEDIA_STATUS' }, (response) => {
        if (response && response.mediaStatus) {
          sendResponse({ mediaStatus: response.mediaStatus });
        } else {
          sendResponse({ mediaStatus: null });
        }
      });
      return true;
    }
    case 'SEND_MEDIA_COMMAND': {
      // Forward media command to offscreen document
      chrome.runtime.sendMessage({ 
        type: 'SEND_MEDIA_COMMAND', 
        payload: message.payload 
      }, (response) => {
        if (response && response.ok) {
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: response?.error || 'Failed to send command' });
        }
      });
      return true;
    }
    case MessageType.CLOSE_TABS: {
      // Close multiple tabs by ID
      const tabIds = message?.payload?.tabIds || [];
      if (tabIds.length > 0) {
        chrome.tabs.remove(tabIds, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ ok: true });
          }
        });
      } else {
        sendResponse({ ok: true });
      }
      return true;
    }
    case MessageType.BATCH_ADD_ACTIONS: {
      // Forward batch actions to offscreen document
      chrome.runtime.sendMessage({
        type: MessageType.BATCH_ADD_ACTIONS,
        payload: message.payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response || { ok: true });
        }
      });
      return true;
    }
    case MessageType.EXTRACT_VIDEO_DATA: {
      // Forward to offscreen document for extraction
      chrome.runtime.sendMessage({
        type: MessageType.EXTRACT_VIDEO_DATA,
        payload: message.payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true;
    }
    default: break;
  }
});


