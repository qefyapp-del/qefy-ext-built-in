// offscreen.js: Runs Firebase + Firestore listener + Core App (compiled Dart)

let firebaseApp = null;
let auth = null;
let firestore = null;
let unsubscribe = null;
let currentUser = null;
let coreReady = false;
let coreInitialized = false;
let configCache = null;

// Current media tracking for cross-device control
let currentPlayingMediaId = null;
let currentPlayingUrl = null;

import { MessageType } from './messages.js';
import { Config } from './config.js';
import { normalizeQueueDocument } from './queue_normalizer.js';

// Provide hook for compiled Dart to call when loaded
globalThis.onDartReady = () => {
  coreReady = true;
  chrome.runtime.sendMessage({ type: MessageType.LOG, payload: '[QEFY] Core App ready' }, () => void chrome.runtime.lastError);
  // Re-wire onQueueUpdated to forward compiled queue
  try {
    if (typeof globalThis.onQueueUpdated === 'function') {
      globalThis.onQueueUpdated((compiled) => {
        chrome.runtime.sendMessage({ type: MessageType.COMPILED_QUEUE_UPDATE, payload: compiled }, () => void chrome.runtime.lastError);
      });
    }
    // Set API base ASAP when core is ready
    const apiBase = (configCache && configCache.apiBaseUrl) ? configCache.apiBaseUrl : Config.apiBaseDefault;
    if (typeof globalThis.setApiBaseUrl === 'function') {
      try { globalThis.setApiBaseUrl(apiBase); } catch (_) {}
    }
    // If already authenticated, try initializing CoreApp now (only if config is ready)
    if (currentUser && configCache && configCache.firebase &&
        typeof globalThis.initializeCoreApp === 'function' && !coreInitialized) {
      const firebaseConfig = { firebase: configCache.firebase, apiBaseUrl: apiBase };
      coreInitialized = true;
      globalThis.initializeCoreApp(apiBase, firebaseConfig, currentUser.uid, false)
        .then(async () => {
          console.log('[QEFY] CoreApp initializeCoreApp succeeded (onDartReady)');
          await setupCrossDeviceControl();
        })
        .catch((e) => { console.error('[QEFY] initializeCoreApp failed (onDartReady)', e); coreInitialized = false; });
    }
  } catch (e) {
    console.warn('[QEFY] Failed to register onQueueUpdated', e);
  }
};

async function loadCoreApp() {
  const scriptUrl = chrome.runtime.getURL('vendor/core_app/main.dart.js');
  await import(scriptUrl).catch(async () => {
    // Fallback to classic script injection if import fails
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = scriptUrl;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  });
}

// removed inline normalizer in favor of module

async function initFirebase(cfg) {
  firebaseApp = firebase.initializeApp(cfg.firebase);
  auth = firebase.auth();
  firestore = firebase.firestore();

  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    let token = null;
    try { token = user ? await user.getIdToken() : null; } catch (_) {}
    chrome.runtime.sendMessage({
      type: MessageType.AUTH_STATE,
      payload: { status: user ? 'signed_in' : 'signed_out', uid: user?.uid || null, email: user?.email || null, idToken: token }
    }, () => void chrome.runtime.lastError);

    if (user) {
      attachQueueListener(user.uid);
      if (coreReady && typeof globalThis.setBearerToken === 'function') {
        try { globalThis.setBearerToken(token || ''); } catch (_) {}
      }
      
      // Set up token refresh listener
      setupTokenRefresh(user);

      // Initialize CoreApp (Realtime DB) once when user is signed in and core is ready
      try {
        if (coreReady && cfg && cfg.firebase && typeof globalThis.initializeCoreApp === 'function' && !coreInitialized) {
          const apiBase = (configCache && configCache.apiBaseUrl) ? configCache.apiBaseUrl : Config.apiBaseDefault;
          const firebaseConfig = { firebase: cfg.firebase, apiBaseUrl: apiBase };
          coreInitialized = true;
          await globalThis.initializeCoreApp(apiBase, firebaseConfig, user.uid, false);
          console.log('[QEFY] CoreApp initialized for uid:', user.uid);
          await setupCrossDeviceControl();
        }
      } catch (e) {
        console.error('[QEFY] initializeCoreApp failed (auth change)', e);
        coreInitialized = false; // allow retry on next auth event
      }
    } else {
      detachQueueListener();
      coreInitialized = false;
    }
  });
}

function detachQueueListener() {
  try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (_) {}
  unsubscribe = null;
}


function setupTokenRefresh(user) {
  if (!auth) return;
  
  // Listen for token refresh events
  auth.onIdTokenChanged(async (user) => {
    if (user && coreReady) {
      try {
        const token = await user.getIdToken();
        if (typeof globalThis.setBearerToken === 'function') {
          globalThis.setBearerToken(token);
        }
        
        // Also notify background script of token update
        chrome.runtime.sendMessage({
          type: MessageType.AUTH_STATE,
          payload: { 
            status: 'signed_in', 
            uid: user.uid, 
            email: user.email, 
            idToken: token 
          }
        }, () => void chrome.runtime.lastError);
      } catch (e) {
        console.error('[QEFY] Failed to refresh auth token:', e);
      }
    }
  });

  // Periodic token refresh as backup (every 45 minutes)
  const refreshInterval = setInterval(async () => {
    if (currentUser && coreReady) {
      try {
        const token = await currentUser.getIdToken(true); // Force refresh
        if (typeof globalThis.setBearerToken === 'function') {
          globalThis.setBearerToken(token);
        }
      } catch (e) {
        console.error('[QEFY] Failed to periodically refresh auth token:', e);
        clearInterval(refreshInterval);
      }
    } else {
      clearInterval(refreshInterval);
    }
  }, 45 * 60 * 1000); // 45 minutes
}

function attachQueueListener(uid) {
  detachQueueListener();
  const ref = firestore.collection(Config.firestore.queueCollection).doc(uid);
  unsubscribe = ref.onSnapshot((snap) => {
    const raw = snap.data() || {};
    const data = normalizeQueueDocument(raw);
    try {
      if (coreReady && typeof globalThis.updateQueue === 'function') {
        globalThis.updateQueue(JSON.stringify(data));
      }
    } catch (e) {
      console.warn('[QEFY] Failed to send queue to core', e);
    }
  }, (error) => { 
    console.error('[QEFY] Firestore listener error', error);
  });
  
}

async function initialize(cfg) {
  configCache = cfg || configCache;
  await Promise.all([
    loadCoreApp(),
    cfg?.firebase ? initFirebase(cfg) : Promise.resolve()
  ]);

  // Configure Core App with optional API and token
  try {
    const apiBase = (cfg && cfg.apiBaseUrl) ? cfg.apiBaseUrl : 'https://us-central1-qefy-playlist.cloudfunctions.net';
    if (typeof globalThis.setApiBaseUrl === 'function') {
      globalThis.setApiBaseUrl(apiBase);
    }
    if (cfg?.bearerToken && typeof globalThis.setBearerToken === 'function') {
      globalThis.setBearerToken(cfg.bearerToken);
    }
  } catch (e) {}
}

async function signIn(creds) {
  if (!auth) return;
  try {
    const email = creds?.email || configCache?.credentials?.email;
    const password = creds?.password || configCache?.credentials?.password;
    if (email && password) {
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      chrome.runtime.sendMessage({ type: MessageType.AUTH_CREDENTIALS_REQUIRED }, () => void chrome.runtime.lastError);
      return;
    }
  } catch (e) {
    console.error('[QEFY] Sign-in failed', e);
  }
}

async function signOut() {
  if (!auth) return;
  try {
    console.log('[QEFY Offscreen] Signing out from Firebase...');
    
    // Detach Firestore queue listener
    detachQueueListener();
    console.log('[QEFY Offscreen] Firestore listener detached');
    
    // Clear bearer token from Core App
    if (typeof globalThis.setBearerToken === 'function') {
      try {
        globalThis.setBearerToken('');
        console.log('[QEFY Offscreen] Bearer token cleared from Core App');
      } catch (e) {
        console.warn('[QEFY Offscreen] Failed to clear bearer token:', e);
      }
    }
    
    // Sign out from Firebase (this will trigger onAuthStateChanged)
    await auth.signOut();
    console.log('[QEFY Offscreen] ✅ Successfully signed out from Firebase');
  } catch (e) {
    console.error('[QEFY Offscreen] ❌ Error signing out:', e);
    throw e;
  }
}

// Notify background we are ready
chrome.runtime.sendMessage({ type: MessageType.OFFSCREEN_READY }, () => void chrome.runtime.lastError);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case MessageType.OFFSCREEN_INIT: {
      initialize(message.payload?.config).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    case MessageType.OFFSCREEN_SIGN_IN: {
      signIn(message?.payload);
      break;
    }
    case MessageType.OFFSCREEN_SIGN_OUT: {
      signOut().then(() => {
        console.log('[QEFY Offscreen] Sign out completed');
        sendResponse({ ok: true });
      }).catch((e) => {
        console.error('[QEFY Offscreen] Sign out failed:', e);
        sendResponse({ ok: false, error: String(e) });
      });
      return true; // Keep channel open for async response
    }
    case MessageType.SEND_ACTION_TO_CORE: {
      try {
        console.log('[QEFY Offscreen] SEND_ACTION_TO_CORE received:', message.payload);
        console.log('[QEFY Offscreen] Core ready:', coreReady, 'newAction available:', typeof globalThis.newAction === 'function');
        
        if (coreReady && typeof globalThis.newAction === 'function') {
          console.log('[QEFY Offscreen] Calling globalThis.newAction with:', message.payload.actionJson);
          globalThis.newAction(message.payload.actionJson);
          console.log('[QEFY Offscreen] Action sent to Core App successfully');
          sendResponse({ ok: true });
        } else {
          console.error('[QEFY Offscreen] Core app not ready or newAction not available');
          sendResponse({ ok: false, error: 'Core app not ready' });
        }
      } catch (e) {
        console.error('[QEFY Offscreen] Error in SEND_ACTION_TO_CORE:', e);
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    case MessageType.SYNC_PENDING_ACTIONS: {
      try {
        if (coreReady && typeof globalThis.syncPendingActions === 'function') {
          globalThis.syncPendingActions();
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: 'Core app not ready' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    case MessageType.FIND_FOLDER_NAME: {
      try {
        if (coreReady && typeof globalThis.findFolderName === 'function') {
          const url = message.payload?.url;
          if (!url) {
            sendResponse({ ok: false, error: 'URL is required' });
            return true;
          }
          
          // Call the Dart function and handle the promise
          globalThis.findFolderName(url).then((folderName) => {
            sendResponse({ ok: true, folderName: folderName || null });
          }).catch((e) => {
            sendResponse({ ok: false, error: String(e) });
          });
        } else {
          sendResponse({ ok: false, error: 'Core app not ready' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    case MessageType.FIND_VIDEO_ITEM: {
      try {
        if (coreReady && typeof globalThis.findVideoItem === 'function') {
          const url = message.payload?.url;
          if (!url) {
            sendResponse({ ok: false, error: 'URL is required' });
            return true;
          }
          
          // Call the Dart function and handle the promise
          globalThis.findVideoItem(url).then((result) => {
            if (result && result.item && result.folder) {
              sendResponse({ ok: true, item: result.item, folder: result.folder });
            } else {
              sendResponse({ ok: true, item: result || null });
            }
          }).catch((e) => {
            sendResponse({ ok: false, error: String(e) });
          });
        } else {
          sendResponse({ ok: false, error: 'Core app not ready' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    case MessageType.GET_DEVICE_ID: {
      try {
        if (coreReady && typeof globalThis.getDeviceId === 'function' && typeof globalThis.getDeviceIdInfo === 'function') {
          // Call the Dart functions and handle the promises
          Promise.all([
            globalThis.getDeviceId(),
            globalThis.getDeviceIdInfo()
          ]).then(([deviceId, deviceIdInfo]) => {
            sendResponse({ ok: true, deviceId: deviceId, deviceIdInfo: deviceIdInfo });
          }).catch((e) => {
            sendResponse({ ok: false, error: String(e) });
          });
        } else {
          sendResponse({ ok: false, error: 'Core app not ready' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    case MessageType.BATCH_ADD_ACTIONS: {
      try {
        if (coreReady && typeof globalThis.newAction === 'function') {
          const actions = message.payload?.actions || [];
          console.log('[QEFY Offscreen] Processing batch of', actions.length, 'actions');
          
          // Send each action to Core App
          for (const action of actions) {
            try {
              const actionJson = JSON.stringify(action);
              globalThis.newAction(actionJson);
            } catch (e) {
              console.error('[QEFY Offscreen] Error adding action:', e);
            }
          }
          
          sendResponse({ ok: true, count: actions.length });
        } else {
          sendResponse({ ok: false, error: 'Core app not ready' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    case MessageType.EXTRACT_VIDEO_DATA: {
      extractVideoDataViaFetch(message.payload)
        .then((data) => {
          sendResponse({ ok: true, data });
        })
        .catch((error) => {
          sendResponse({ ok: false, error: error.message });
        });
      return true;
    }
    case 'TAB_CLOSED_STOP_PLAYBACK': {
      try {
        console.log('[QEFY] Hijacked tab closed - updating status to closed in Real-time DB');
        
        // Clear current playing media
        currentPlayingMediaId = null;
        currentPlayingUrl = null;
        
        // Update status to 'closed' in Real-time Database
        if (coreReady && typeof globalThis.updateMediaMetadata === 'function') {
          globalThis.updateMediaMetadata(0, 0, 'closed', '')
            .then(() => {
              console.log('[QEFY] Status set to closed in Real-time DB');
            })
            .catch((e) => {
              console.error('[QEFY] Error setting status to closed:', e);
            });
        }
        
        // Clear both command and mediaStatus nodes from database when tab is closed by user
        console.log('[QEFY] Tab closed by user - clearing cross-device data...');
        console.log('[QEFY] Checking for clearCrossDeviceData function...');
        console.log('[QEFY] globalThis.clearCrossDeviceData type:', typeof globalThis.clearCrossDeviceData);
        console.log('[QEFY] Available globalThis methods:', Object.keys(globalThis).filter(k => k.includes('clear')));
        
        if (typeof globalThis.clearCrossDeviceData === 'function') {
          console.log('[QEFY] Calling clearCrossDeviceData...');
          globalThis.clearCrossDeviceData();
          console.log('[QEFY] Cleared command and mediaStatus nodes from database');
        } else {
          console.warn('[QEFY] clearCrossDeviceData function not available');
          console.log('[QEFY] Available methods:', Object.keys(globalThis).filter(k => k.includes('clear') || k.includes('Clear')));
        }
      } catch (e) {
        console.error('[QEFY] Error handling tab closed:', e);
      }
      break;
    }
    case MessageType.UPDATE_MEDIA_PROGRESS: {
      try {
        if (coreReady && typeof globalThis.updateMediaMetadata === 'function') {
          const { currentSeconds, totalSeconds, status, url } = message.payload || {};
          console.log('[QEFY] UPDATE_MEDIA_PROGRESS - URL:', url, 'Status:', status, 'Progress:', currentSeconds);
          
          // Use stored mediaId if available, otherwise try to look it up
          if (currentPlayingMediaId) {
            console.log('[QEFY] Using stored mediaId:', currentPlayingMediaId);
            
            // Verify URL matches if we have both
            if (currentPlayingUrl && url && !url.includes(currentPlayingUrl) && !currentPlayingUrl.includes(url)) {
              console.log('[QEFY] URL changed from', currentPlayingUrl, 'to', url, '- clearing stored mediaId');
              currentPlayingMediaId = null;
              currentPlayingUrl = null;
            } else {
              // Update with stored mediaId
              globalThis.updateMediaMetadata(currentSeconds || 0, totalSeconds || 0, status || '', currentPlayingMediaId)
                .then(() => {
                  console.log('[QEFY] Media metadata updated with stored mediaId:', currentPlayingMediaId);
                  if (sendResponse) sendResponse({ ok: true });
                })
                .catch((e) => {
                  console.error('[QEFY] Error updating media metadata:', e);
                  if (sendResponse) sendResponse({ ok: false, error: String(e) });
                });
              return true;
            }
          }
          
          // Fallback: Try to find the media ID from the URL
          console.log('[QEFY] No stored mediaId, attempting URL lookup for:', url);
          if (typeof globalThis.findVideoItem === 'function' && url) {
            globalThis.findVideoItem(url).then((result) => {
              const mediaId = result?.item?.uuid || '';
              console.log('[QEFY] Found media item for URL - mediaId:', mediaId, 'title:', result?.item?.metadata?.title);
              
              // Store for future updates
              if (mediaId) {
                currentPlayingMediaId = mediaId;
                currentPlayingUrl = url;
              }
              
              // Update metadata with mediaId
              globalThis.updateMediaMetadata(currentSeconds || 0, totalSeconds || 0, status || '', mediaId)
                .then(() => {
                  console.log('[QEFY] Media metadata updated with found mediaId:', mediaId);
                  if (sendResponse) sendResponse({ ok: true });
                })
                .catch((e) => {
                  console.error('[QEFY] Error updating media metadata:', e);
                  if (sendResponse) sendResponse({ ok: false, error: String(e) });
                });
            }).catch((e) => {
              console.error('[QEFY] Error finding video item for URL:', url, e);
              // Still update without mediaId
              globalThis.updateMediaMetadata(currentSeconds || 0, totalSeconds || 0, status || '', '')
                .then(() => {
                  console.log('[QEFY] Media metadata updated without mediaId (lookup failed)');
                  if (sendResponse) sendResponse({ ok: true });
                })
                .catch((e) => {
                  if (sendResponse) sendResponse({ ok: false, error: String(e) });
                });
            });
          } else {
            console.log('[QEFY] No findVideoItem or url, updating without mediaId');
            // No findVideoItem or url, update without mediaId
            globalThis.updateMediaMetadata(currentSeconds || 0, totalSeconds || 0, status || '', '')
              .then(() => {
                if (sendResponse) sendResponse({ ok: true });
              })
              .catch((e) => {
                console.error('[QEFY] Error updating media metadata:', e);
                if (sendResponse) sendResponse({ ok: false, error: String(e) });
              });
          }
        } else {
          console.log('[QEFY] Core app not ready for UPDATE_MEDIA_PROGRESS');
          if (sendResponse) sendResponse({ ok: false, error: 'Core app not ready' });
        }
      } catch (e) {
        console.error('[QEFY] Error in UPDATE_MEDIA_PROGRESS handler:', e);
        if (sendResponse) sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    case 'GET_DEVICE_ID': {
      try {
        if (typeof globalThis.getDeviceId === 'function') {
          globalThis.getDeviceId().then((deviceId) => {
            sendResponse({ deviceId: deviceId });
          }).catch((error) => {
            console.error('[QEFY] Error getting device ID:', error);
            sendResponse({ deviceId: null });
          });
        } else {
          console.log('[QEFY] Core App not ready, getDeviceId not available');
          sendResponse({ deviceId: null });
        }
      } catch (error) {
        console.error('[QEFY] Error getting device ID:', error);
        sendResponse({ deviceId: null });
      }
      return true;
    }
    case 'GET_MEDIA_STATUS': {
      try {
        if (typeof globalThis.getMediaStatus === 'function') {
          globalThis.getMediaStatus().then((mediaStatus) => {
            sendResponse({ mediaStatus: mediaStatus });
          }).catch((error) => {
            console.error('[QEFY] Error getting media status:', error);
            sendResponse({ mediaStatus: null });
          });
        } else {
          console.log('[QEFY] Core App not ready, getMediaStatus not available');
          sendResponse({ mediaStatus: null });
        }
      } catch (error) {
        console.error('[QEFY] Error getting media status:', error);
        sendResponse({ mediaStatus: null });
      }
      return true;
    }
    case 'SEND_MEDIA_COMMAND': {
      try {
        const { commandType, commandValue, mediaId, targetDeviceId } = message.payload || {};
        console.log('[QEFY] Sending media command:', { commandType, commandValue, mediaId, targetDeviceId });
        
        // Send command to Firebase Realtime Database via Core App
        sendCommandToDatabase(commandType, commandValue, mediaId, targetDeviceId).then(() => {
          console.log('[QEFY] Command sent to database successfully');
          sendResponse({ ok: true });
        }).catch((error) => {
          console.error('[QEFY] Error sending command to database:', error);
          sendResponse({ ok: false, error: error.toString() });
        });
        
      } catch (error) {
        console.error('[QEFY] Error in SEND_MEDIA_COMMAND handler:', error);
        sendResponse({ ok: false, error: error.toString() });
      }
      return true;
    }
    default: break;
  }
});

// ============================================================================
// Cross-Device Media Control
// ============================================================================

// Send command directly to Firebase Realtime Database via Core App
async function sendCommandToDatabase(commandType, commandValue, mediaId, targetDeviceId) {
  try {
    if (typeof globalThis.sendMediaCommand === 'function') {
      console.log('[QEFY] Sending command via Core App to database');
      await globalThis.sendMediaCommand(commandType, commandValue, mediaId, targetDeviceId);
      console.log('[QEFY] Command sent to database via Core App successfully');
    } else {
      console.error('[QEFY] Core App sendMediaCommand function not available');
      throw new Error('Core App sendMediaCommand function not available');
    }
  } catch (error) {
    console.error('[QEFY] Error sending command to database via Core App:', error);
    throw error;
  }
}

async function setupCrossDeviceControl() {
  try {
    console.log('[QEFY] Setting up cross-device media control...');
    
    // Set app type to EXECUTOR
    if (typeof globalThis.setAppType === 'function') {
      await globalThis.setAppType('EXECUTOR');
      console.log('[QEFY] App type set to EXECUTOR');
    }
    
    // Register device
    if (typeof globalThis.registerDevice === 'function') {
      await globalThis.registerDevice();
      console.log('[QEFY] Device registered');
    }
    
    // Setup media command listener
    if (typeof globalThis.onMediaCommand === 'function') {
      globalThis.onMediaCommand((commandData) => {
        console.log('[QEFY] Received media command:', commandData);
        executeMediaCommand(commandData);
      });
      console.log('[QEFY] Media command listener registered');
    }
    
    // Setup metadata update listener (forward to popup/floating UI)
    if (typeof globalThis.onMetadataUpdate === 'function') {
      globalThis.onMetadataUpdate((metadata) => {
        console.log('[QEFY] Received metadata update:', metadata);
        
        // Check if executorDeviceId changed (another device took over)
        if (metadata && metadata.deviceId && typeof globalThis.getDeviceId === 'function') {
          globalThis.getDeviceId().then((currentDeviceId) => {
            // More robust device ID comparison
            if (currentDeviceId && 
                metadata.deviceId && 
                metadata.deviceId.trim() !== '' && 
                currentDeviceId.trim() !== '' &&
                metadata.deviceId !== currentDeviceId) {
              console.log('[QEFY] Executor device changed:', metadata.deviceId, 'current device:', currentDeviceId);
              console.log('[QEFY] Another device took over as executor - closing tab immediately');
              
              // Close the hijacked tab immediately
              chrome.runtime.sendMessage({
                type: MessageType.EXECUTE_MEDIA_COMMAND,
                payload: { command: 'stop' }
              }, () => void chrome.runtime.lastError);
            }
          }).catch((error) => {
            console.error('[QEFY] Error checking device ID in metadata update:', error);
          });
        }
        
        chrome.runtime.sendMessage({
          type: MessageType.REMOTE_MEDIA_METADATA,
          payload: metadata
        }, () => void chrome.runtime.lastError);
      });
      console.log('[QEFY] Metadata update listener registered');
    }
    
    console.log('[QEFY] Cross-device media control setup complete');
  } catch (e) {
    console.error('[QEFY] Error setting up cross-device media control:', e);
  }
}

async function executeMediaCommand(commandData) {
  try {
    const { commandType, commandValue, mediaId, targetDeviceId } = commandData || {};
    
    // Check if this command is targeted at a different device
    if (targetDeviceId && targetDeviceId.trim() !== '' && typeof globalThis.getDeviceId === 'function') {
      try {
        const currentDeviceId = await globalThis.getDeviceId();
        // More robust device ID comparison
        if (currentDeviceId && 
            targetDeviceId && 
            targetDeviceId.trim() !== '' && 
            currentDeviceId.trim() !== '' &&
            targetDeviceId !== currentDeviceId) {
          console.log('[QEFY] Command targeted at different device:', targetDeviceId, 'current device:', currentDeviceId);
          console.log('[QEFY] Another instance is taking over - closing tab immediately');
          
          // Close the hijacked tab immediately to prevent conflicts
          chrome.runtime.sendMessage({
            type: MessageType.EXECUTE_MEDIA_COMMAND,
            payload: { command: 'stop' }
          }, () => void chrome.runtime.lastError);
          
          return; // Don't execute the command
        }
      } catch (error) {
        console.error('[QEFY] Error checking device ID:', error);
        // Continue with command execution if we can't verify device ID
      }
    }
    
    // Normalize command type to lowercase for consistent handling
    const normalizedCommandType = commandType ? commandType.toLowerCase() : '';
    
    // Special handling for startPlay command - force close other instances
    if (normalizedCommandType === 'startplay' && typeof globalThis.getDeviceId === 'function') {
      try {
        const currentDeviceId = await globalThis.getDeviceId();
        
        // Always close if there's a targetDeviceId and it's different from current device
        if (currentDeviceId && 
            targetDeviceId && 
            targetDeviceId.trim() !== '' && 
            currentDeviceId.trim() !== '' &&
            targetDeviceId !== currentDeviceId) {
          console.log('[QEFY] startPlay command for different device - closing current instance');
          console.log('[QEFY] New media starting on device:', targetDeviceId, 'closing current device:', currentDeviceId);
          
          // Force close the current instance
          chrome.runtime.sendMessage({
            type: MessageType.EXECUTE_MEDIA_COMMAND,
            payload: { command: 'stop' }
          }, () => void chrome.runtime.lastError);
          
          return; // Don't execute the command
        }
        
        // If there's no targetDeviceId, this is a broadcast startPlay - close if we're already playing
        if (currentDeviceId && (!targetDeviceId || targetDeviceId.trim() === '')) {
          console.log('[QEFY] Broadcast startPlay command received');
          
          // If we're already playing something, close to let the new media take over
          if (currentPlayingMediaId) {
            console.log('[QEFY] Already playing media - closing to allow new media');
            console.log('[QEFY] Current media:', currentPlayingMediaId, 'New media:', mediaId);
            
            // Force close the current instance
            chrome.runtime.sendMessage({
              type: MessageType.EXECUTE_MEDIA_COMMAND,
              payload: { command: 'stop' }
            }, () => void chrome.runtime.lastError);
            
            return; // Don't execute the command
          }
        }
      } catch (error) {
        console.error('[QEFY] Error checking device ID for startPlay:', error);
        // Continue with command execution if we can't verify device ID
      }
    }
    
    console.log('[QEFY] Executing media command:', normalizedCommandType, 'with value:', commandValue, 'for media:', mediaId);
    
    // Track if this command affects playback state
    let shouldSendImmediateUpdate = false;
    
    switch (normalizedCommandType) {
      case 'startplay': {
        // Start playing a new media item
        console.log('[QEFY] ========================================');
        console.log('[QEFY] Starting playback for media:', mediaId);
        
        // Store the mediaId for future progress updates
        currentPlayingMediaId = mediaId;
        console.log('[QEFY] Stored current playing mediaId:', currentPlayingMediaId);
        
        // Find the media item in the queue and use POPUP_PLAY_NOW flow
        if (typeof globalThis.getCompiledQueue === 'function') {
          try {
            // Get the compiled queue to find the media item
            const compiledQueue = await globalThis.getCompiledQueue();
            console.log('[QEFY] Compiled queue retrieved:', compiledQueue ? 'success' : 'null');
            
            if (compiledQueue && compiledQueue.queue) {
              let mediaUrl = null;
              let folderPath = null;
              
              // Search through all folders for the media ID
              for (const folder in compiledQueue.queue) {
                const items = compiledQueue.queue[folder];
                const item = items.find(i => i.uuid === mediaId);
                if (item) {
                  mediaUrl = item.url;
                  folderPath = folder;
                  currentPlayingUrl = mediaUrl;
                  console.log('[QEFY] Found media:', {
                    url: mediaUrl,
                    folder: folderPath,
                    title: item.metadata?.title
                  });
                  break;
                }
              }
              
              if (mediaUrl && folderPath) {
                console.log('[QEFY] Sending POPUP_PLAY_NOW with specific URL:', mediaUrl);
                console.log('[QEFY] Folder context:', folderPath);
                
                // Use the existing POPUP_PLAY_NOW flow with direct URL
                // First, notify background to select the folder for context (auto-navigation)
                chrome.runtime.sendMessage({
                  type: MessageType.POPUP_FOLDER_SELECTED,
                  payload: { folder: folderPath }
                }, () => void chrome.runtime.lastError);
                
                // Then trigger playback with the SPECIFIC URL (not folder)
                // This will play the exact media item requested, not the first in folder
                chrome.runtime.sendMessage({
                  type: MessageType.POPUP_PLAY_NOW,
                  payload: { url: mediaUrl }  // Pass URL directly, not folder
                }, (response) => {
                  if (response && response.ok) {
                    console.log('[QEFY] ✅ Successfully started playback of specific media');
                  } else {
                    console.log('[QEFY] ⚠️ Playback response:', response);
                  }
                });
                
                shouldSendImmediateUpdate = true;
                console.log('[QEFY] ========================================');
              } else {
                console.error('[QEFY] ❌ Media item not found in queue for mediaId:', mediaId);
                console.log('[QEFY] ========================================');
              }
            } else {
              console.error('[QEFY] ❌ No compiled queue available');
              console.log('[QEFY] ========================================');
            }
          } catch (e) {
            console.error('[QEFY] ❌ Error finding media item:', e);
            console.log('[QEFY] ========================================');
          }
        } else {
          console.error('[QEFY] ❌ getCompiledQueue not available');
          console.log('[QEFY] ========================================');
        }
        break;
      }
      case 'play': {
        console.log('[QEFY] Sending play command');
        chrome.runtime.sendMessage({
          type: MessageType.POPUP_PLAYER_CONTROL,
          payload: { cmd: 'play' }
        }, () => void chrome.runtime.lastError);
        shouldSendImmediateUpdate = true;
        break;
      }
      case 'pause': {
        console.log('[QEFY] Sending pause command');
        chrome.runtime.sendMessage({
          type: MessageType.POPUP_PLAYER_CONTROL,
          payload: { cmd: 'pause' }
        }, () => void chrome.runtime.lastError);
        shouldSendImmediateUpdate = true;
        break;
      }
      case 'toggleplay': {
        console.log('[QEFY] Sending toggle play command');
        chrome.runtime.sendMessage({
          type: MessageType.POPUP_PLAYER_CONTROL,
          payload: { cmd: 'toggle_play' }
        }, () => void chrome.runtime.lastError);
        shouldSendImmediateUpdate = true;
        break;
      }
      case 'jumpto': {
        const position = parseInt(commandValue) || 0;
        console.log('[QEFY] Sending seek to position:', position);
        chrome.runtime.sendMessage({
          type: MessageType.POPUP_PLAYER_CONTROL,
          payload: { cmd: 'seekto', value: position }
        }, () => void chrome.runtime.lastError);
        shouldSendImmediateUpdate = true;
        break;
      }
      case 'forward': {
        const seconds = parseInt(commandValue) || 30;
        console.log('[QEFY] Sending forward command:', seconds, 'seconds');
        chrome.runtime.sendMessage({
          type: MessageType.POPUP_PLAYER_CONTROL,
          payload: { cmd: 'seek_rel', value: seconds }
        }, () => void chrome.runtime.lastError);
        shouldSendImmediateUpdate = true;
        break;
      }
      case 'backward': {
        const seconds = parseInt(commandValue) || -30;
        console.log('[QEFY] Sending backward command:', seconds, 'seconds');
        chrome.runtime.sendMessage({
          type: MessageType.POPUP_PLAYER_CONTROL,
          payload: { cmd: 'seek_rel', value: seconds }
        }, () => void chrome.runtime.lastError);
        shouldSendImmediateUpdate = true;
        break;
      }
      case 'setspeed': {
        const speed = parseFloat(commandValue) || 1.0;
        console.log('[QEFY] Sending set speed command:', speed);
        chrome.runtime.sendMessage({
          type: MessageType.POPUP_PLAYER_CONTROL,
          payload: { cmd: 'set_rate', value: speed }
        }, () => void chrome.runtime.lastError);
        break;
      }
      case 'stop': {
        console.log('[QEFY] Received STOP command - closing hijacked tab');
        // Clear current playing media
        currentPlayingMediaId = null;
        currentPlayingUrl = null;
        
        // Update status to 'closed' in Real-time Database
        if (typeof globalThis.updateMediaMetadata === 'function') {
          globalThis.updateMediaMetadata(0, 0, 'closed', '')
            .then(() => {
              console.log('[QEFY] Status set to closed in Real-time DB');
            })
            .catch((e) => {
              console.error('[QEFY] Error setting status to closed:', e);
            });
        }
        
        // Clear both command and mediaStatus nodes from database for STOP command
        console.log('[QEFY] STOP command detected - clearing cross-device data...');
        console.log('[QEFY] Checking for clearCrossDeviceData function...');
        console.log('[QEFY] globalThis.clearCrossDeviceData type:', typeof globalThis.clearCrossDeviceData);
        console.log('[QEFY] Available globalThis methods:', Object.keys(globalThis).filter(k => k.includes('clear')));
        
        if (typeof globalThis.clearCrossDeviceData === 'function') {
          console.log('[QEFY] Calling clearCrossDeviceData...');
          globalThis.clearCrossDeviceData();
          console.log('[QEFY] Cleared command and mediaStatus nodes from database');
        } else {
          console.warn('[QEFY] clearCrossDeviceData function not available');
          console.log('[QEFY] Available methods:', Object.keys(globalThis).filter(k => k.includes('clear') || k.includes('Clear')));
        }
        
        // Send message to background to close the hijacked tab
        chrome.runtime.sendMessage({
          type: MessageType.EXECUTE_MEDIA_COMMAND,
          payload: { command: 'stop' }
        }, () => void chrome.runtime.lastError);
        break;
      }
      case 'close': {
        console.log('[QEFY] Received CLOSE command - stopping playback');
        // Clear current playing media
        currentPlayingMediaId = null;
        currentPlayingUrl = null;
        
        // Update status to 'closed' in Real-time Database
        if (typeof globalThis.updateMediaMetadata === 'function') {
          globalThis.updateMediaMetadata(0, 0, 'closed', '')
            .then(() => {
              console.log('[QEFY] Status set to closed in Real-time DB');
            })
            .catch((e) => {
              console.error('[QEFY] Error setting status to closed:', e);
            });
        }
        
        // Send message to background to close the hijacked tab
        chrome.runtime.sendMessage({
          type: MessageType.EXECUTE_MEDIA_COMMAND,
          payload: { command: 'stop' }
        }, () => void chrome.runtime.lastError);
        break;
      }
      default:
        console.log('[QEFY] Unknown command type:', commandType);
    }
    
    // Send immediate status update if command affects playback state
    if (shouldSendImmediateUpdate) {
      // Wait briefly for the video player to update (200ms)
      setTimeout(() => {
        sendImmediateMediaStatusUpdate();
      }, 200);
    }
  } catch (e) {
    console.error('[QEFY] Error executing media command:', e);
  }
}

// Send immediate media status update to Real-time Database
async function sendImmediateMediaStatusUpdate() {
  try {
    // Request current media status from the tab
    chrome.runtime.sendMessage({
      type: 'REQUEST_MEDIA_STATUS'
    }, () => void chrome.runtime.lastError);
    
    console.log('[QEFY] Requested immediate media status update');
  } catch (e) {
    console.error('[QEFY] Error requesting immediate media status:', e);
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'keep-alive') {
    port.onMessage.addListener(msg => {
      if (msg.type === 'ping') {
        port.postMessage({ type: 'pong' });
      }
    });
  }
});

/**
 * Extract video data via fetch (fallback method)
 */
async function extractVideoDataViaFetch({ url, videoId }) {
  try {
    console.log('[QEFY Offscreen] Fetching video data from:', url);
    
    // Fetch the YouTube page
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Parse the HTML to extract data
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extract title
    let title = 'Unknown Title';
    const titleMeta = doc.querySelector('meta[name="title"]');
    if (titleMeta && titleMeta.content) {
      title = titleMeta.content;
    } else {
      const titleTag = doc.querySelector('title');
      if (titleTag && titleTag.textContent) {
        title = titleTag.textContent.replace(' - YouTube', '').trim();
      }
    }
    
    // Extract description
    let description = 'No description available';
    const descMeta = doc.querySelector('meta[name="description"]');
    if (descMeta && descMeta.content) {
      description = descMeta.content;
    }
    
    // Extract duration and other data from script tags
    let duration = 0;
    let channelName = null;
    
    const scripts = doc.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent;
      if (content && content.includes('ytInitialPlayerResponse')) {
        try {
          const match = content.match(/var ytInitialPlayerResponse = ({.+?});/);
          if (match && match[1]) {
            const playerResponse = JSON.parse(match[1]);
            
            if (playerResponse.videoDetails) {
              if (playerResponse.videoDetails.lengthSeconds) {
                duration = parseInt(playerResponse.videoDetails.lengthSeconds);
              }
              if (playerResponse.videoDetails.author) {
                channelName = playerResponse.videoDetails.author;
              }
              if (playerResponse.videoDetails.title) {
                title = playerResponse.videoDetails.title;
              }
              if (playerResponse.videoDetails.shortDescription) {
                description = playerResponse.videoDetails.shortDescription;
              }
            }
            break;
          }
        } catch (e) {
          console.warn('[QEFY Offscreen] Failed to parse ytInitialPlayerResponse:', e);
        }
      }
    }
    
    // Construct thumbnail URL
    const thumbnail = videoId ? 
      `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null;
    
    console.log('[QEFY Offscreen] Extracted data:', { title, duration, channelName });
    
    return {
      url,
      videoId,
      title,
      description,
      duration,
      thumbnail,
      channelName
    };
  } catch (error) {
    console.error('[QEFY Offscreen] Error extracting video data:', error);
    throw error;
  }
}

