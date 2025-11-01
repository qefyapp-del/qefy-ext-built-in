import { MessageType } from './messages.js';

const userLabel = document.getElementById('userLabel');
const signInBtn = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const folderSelect = document.getElementById('folderSelect');
const playNowBtn = document.getElementById('playNowBtn');
const togglePlayBtn = document.getElementById('togglePlayBtn');
const seekBackBtn = document.getElementById('seekBackBtn');
const seekFwdBtn = document.getElementById('seekFwdBtn');
const mediaStatus = document.getElementById('mediaStatus');
const mediaThumb = document.getElementById('mediaThumb');
const mediaTitle = document.getElementById('mediaTitle');
const notInQueue = document.getElementById('notInQueue');
const controllerSection = document.getElementById('controllerSection');
const playlistName = document.getElementById('playlistName');
const headerPlaylistName = document.getElementById('headerPlaylistName');
const headerPlaylistDropdown = document.getElementById('headerPlaylistDropdown');
const headerPlaylistOptions = document.getElementById('headerPlaylistOptions');
const addVideoBtn = document.getElementById('addVideoBtn');
const magicEmojiBtn = document.getElementById('magicEmojiBtn');
const configBtn = document.getElementById('configBtn');

// State tracking for UI management
let isRemoteControlMode = false;
let lastFolderSectionState = null;
let folderSectionUpdateTimeout = null;

// Helper function to manage folder section display with debouncing
function setFolderSectionDisplay(shouldShow, force = false) {
  const folderSection = document.getElementById('folderSection');
  if (!folderSection) return;
  
  const newState = shouldShow ? 'block' : 'none';
  
  // If state hasn't changed and not forced, don't update
  if (!force && lastFolderSectionState === newState) {
    return;
  }
  
  // Clear any pending timeout
  if (folderSectionUpdateTimeout) {
    clearTimeout(folderSectionUpdateTimeout);
    folderSectionUpdateTimeout = null;
  }
  
  // Debounce the update to prevent flickering
  folderSectionUpdateTimeout = setTimeout(() => {
    folderSection.style.display = newState;
    lastFolderSectionState = newState;
    folderSectionUpdateTimeout = null;
  }, 50); // 50ms debounce
}

// Config Page Elements
const configPage = document.getElementById('configPage');
const closeConfigBtn = document.getElementById('closeConfigBtn');
const languageSelect = document.getElementById('languageSelect');
const logoutBtn = document.getElementById('logoutBtn');
const aiToggleContainer = document.getElementById('aiToggleContainer');
const aiStatusMessage = document.getElementById('aiStatusMessage');
const aiNotAvailableMessage = document.getElementById('aiNotAvailableMessage');
const deviceIdDisplay = document.getElementById('deviceIdDisplay');
const deviceIdInfo = document.getElementById('deviceIdInfo');

// Add Video Page Elements
const addVideoPage = document.getElementById('addVideoPage');
const closeAddVideoBtn = document.getElementById('closeAddVideoBtn');
const selectedFolderName = document.getElementById('selectedFolderName');
const addVideoFolderDropdown = document.getElementById('addVideoFolderDropdown');
const addVideoFolderOptions = document.getElementById('addVideoFolderOptions');
const videoUrlInput = document.getElementById('videoUrlInput');
const pasteFromClipboardBtn = document.getElementById('pasteFromClipboardBtn');
const getCurrentTabBtn = document.getElementById('getCurrentTabBtn');
const saveVideoBtn = document.getElementById('saveVideoBtn');
const addVideoStatus = document.getElementById('addVideoStatus');

// Prevent duplicate event listeners
let eventListenersAttached = false;
let markDoneInProgress = false;
let saveVideoInProgress = false;
const markDoneNextBtn = document.getElementById('markDoneNextBtn');
const emptyFolder = document.getElementById('emptyFolder');
const folderSection = document.getElementById('folderSection');
const upNext = document.getElementById('upNext');
const up1Thumb = document.getElementById('up1Thumb');
const up1Title = document.getElementById('up1Title');
const up2Thumb = document.getElementById('up2Thumb');
const up2Title = document.getElementById('up2Title');
const seekSlider = document.getElementById('seekSlider');
const speedSelect = document.getElementById('speedSelect');
const manageQueueText = document.getElementById('manageQueueText');

let currentFoldersOrdering = [];
let selectedFolder = null;
let latestQueueDoc = null;
let lastListenerHealthCheck = 0;
const LISTENER_HEALTH_CHECK_COOLDOWN = 10000; // 10 seconds

async function checkAndReconnectListener() {
  const now = Date.now();
  if (now - lastListenerHealthCheck < LISTENER_HEALTH_CHECK_COOLDOWN) {
    return; // Skip if we checked recently
  }
  
  lastListenerHealthCheck = now;
  
  try {
    const health = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: MessageType.CHECK_LISTENER_HEALTH }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ healthy: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { healthy: false, error: 'No response' });
        }
      });
    });
    
    if (!health.healthy) {
      console.log('[QEFY Popup] Listener is unhealthy, attempting to reconnect...');
      const reconnectResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: MessageType.RECONNECT_LISTENER }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { ok: false, error: 'No response' });
          }
        });
      });
      
      if (reconnectResult.ok) {
        console.log('[QEFY Popup] Listener reconnected successfully');
        // Trigger a sync to get fresh data
        chrome.runtime.sendMessage({
          type: MessageType.SYNC_PENDING_ACTIONS,
          payload: {}
        });
      } else {
        console.error('[QEFY Popup] Failed to reconnect listener:', reconnectResult.error);
      }
    }
  } catch (e) {
    console.error('[QEFY Popup] Error checking listener health:', e);
  }
}

function renderAuth(_) {
  // Auth UI removed; no-op to avoid null access
  return;
}

function renderQueue(queue) {
  latestQueueDoc = queue || null;
  const folders = Array.isArray(queue?.foldersOrdering) ? queue.foldersOrdering : [];
  currentFoldersOrdering = folders;
  const prev = selectedFolder;
  folderSelect.innerHTML = '';
  for (const f of folders) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    folderSelect.appendChild(opt);
  }
  if (folders.length) {
    const toSelect = prev && folders.includes(prev) ? prev : folders[0];
    folderSelect.value = toSelect;
    selectedFolder = toSelect;
  }
  // Empty state
  try {
    const q = queue?.queue || {};
    const list = Array.isArray(q[selectedFolder]) ? q[selectedFolder] : [];
    if (emptyFolder) emptyFolder.style.display = list.length ? 'none' : 'block';
  } catch (_) {}

  computeAndRenderUpNext(lastProgress?.url || '');

  // Best-effort: set title/thumb from first item of selected folder
  try {
    const q = queue?.queue || {};
    const list = Array.isArray(q[selectedFolder]) ? q[selectedFolder] : [];
    const first = list[0] || null;
    const title = first?.metadata?.title || first?.url || '—';
    const thumb = first?.metadata?.thumb || '';
    mediaTitle.textContent = title;
    if (thumb) { mediaThumb.src = thumb; mediaThumb.style.display = 'block'; } else { mediaThumb.removeAttribute('src'); mediaThumb.style.display = 'none'; }
  } catch (_) {}
  
  // Update header playlist dropdown if it's visible
  if (headerPlaylistDropdown && headerPlaylistDropdown.style.display !== 'none') {
    populateHeaderPlaylistDropdown();
  }
  
  // Update add video folder dropdown if the page is visible
  if (addVideoPage && addVideoPage.style.display !== 'none' && addVideoFolderDropdown && addVideoFolderDropdown.style.display !== 'none') {
    populateAddVideoFolderDropdown();
  }
}

function canonicalYouTubeId(u) {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{5,})/);
      if (shorts) return shorts[1];
      const embed = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{5,})/);
      if (embed) return embed[1];
    }
    if (url.hostname === 'youtu.be') {
      const seg = url.pathname.split('/').filter(Boolean)[0];
      if (seg) return seg;
    }
  } catch (_) {}
  return null;
}

function findItemByUrlInQueue(url) {
  if (!latestQueueDoc) return null;
  const q = latestQueueDoc.queue || {};
  const targetId = canonicalYouTubeId(url);
  for (const folder of Object.keys(q)) {
    // Ignore done and trash folders
    if (folder === 'done' || folder === 'trash') continue;
    
    const list = q[folder] || [];
    for (const it of list) {
      if (!it || !it.url) continue;
      if (it.url === url) return { item: it, folder };
      if (targetId) {
        const itId = canonicalYouTubeId(it.url);
        if (itId && itId === targetId) return { item: it, folder };
      }
    }
  }
  return null;
}

function findItemByUrlInQueueIncludingDone(url) {
  if (!latestQueueDoc) return null;
  const q = latestQueueDoc.queue || {};
  const targetId = canonicalYouTubeId(url);
  for (const folder of Object.keys(q)) {
    // Include done folder to check if video was moved there
    if (folder === 'trash') continue;
    
    const list = q[folder] || [];
    for (const it of list) {
      if (!it || !it.url) continue;
      if (it.url === url) return { item: it, folder };
      if (targetId) {
        const itId = canonicalYouTubeId(it.url);
        if (itId && itId === targetId) return { item: it, folder };
      }
    }
  }
  return null;
}

function populateHeaderPlaylistDropdown() {
  if (!headerPlaylistOptions || !latestQueueDoc) return;
  
  // Clear existing options
  headerPlaylistOptions.innerHTML = '';
  
  // Use foldersOrdering from compiled queue, same as main folder selector
  const folders = Array.isArray(latestQueueDoc.foldersOrdering) ? latestQueueDoc.foldersOrdering : [];
  const q = latestQueueDoc.queue || {};
  
  // Filter to only include folders that have content and are not done/trash
  const validFolders = folders.filter(folder => 
    folder !== 'done' && folder !== 'trash' && 
    Array.isArray(q[folder]) && q[folder].length > 0
  );
  
  // Get current playlist name
  const currentPlaylist = headerPlaylistName?.textContent || '';
  
  validFolders.forEach(folder => {
    const option = document.createElement('div');
    option.className = 'dropdown-option';
    option.textContent = folder;
    
    // Highlight current playlist
    if (folder === currentPlaylist) {
      option.classList.add('current');
    }
    
    // Add click handler
    option.addEventListener('click', () => {
      // Hide dropdown
      if (headerPlaylistDropdown) {
        headerPlaylistDropdown.style.display = 'none';
      }
      
      // Start playing the selected playlist
      chrome.runtime.sendMessage({
        type: MessageType.POPUP_PLAY_NOW,
        payload: { folder: folder }
      }, (response) => {
        if (response && response.ok) {
          console.log('[QEFY] Successfully started playing playlist:', folder);
        } else {
          console.error('[QEFY] Failed to start playing playlist:', folder);
        }
      });
    });
    
    headerPlaylistOptions.appendChild(option);
  });
}

function toggleHeaderPlaylistDropdown() {
  if (!headerPlaylistDropdown) return;
  
  const isVisible = headerPlaylistDropdown.style.display !== 'none';
  
  if (isVisible) {
    // Hide dropdown
    headerPlaylistDropdown.style.display = 'none';
  } else {
    // Show dropdown and populate it
    populateHeaderPlaylistDropdown();
    headerPlaylistDropdown.style.display = 'block';
  }
}

// Add Video Page Functions
let selectedAddVideoFolder = 'recently_added';

function showAddVideoPage() {
  if (addVideoPage) {
    addVideoPage.style.display = 'block';
    document.getElementById('app').style.display = 'none';
    // Focus on the input
    if (videoUrlInput) {
      videoUrlInput.focus();
    }
  }
}

function hideAddVideoPage() {
  if (addVideoPage) {
    addVideoPage.style.display = 'none';
    document.getElementById('app').style.display = 'block';
    // Clear the input and status
    if (videoUrlInput) {
      videoUrlInput.value = '';
    }
    if (addVideoStatus) {
      addVideoStatus.style.display = 'none';
    }
  }
}

// Config Page Functions
async function showConfigPage() {
  if (configPage) {
    configPage.style.display = 'block';
  }
  if (app) {
    app.style.display = 'none';
  }
  if (addVideoPage) {
    addVideoPage.style.display = 'none';
  }
  
  // Wait a bit for DOM to be ready, then initialize i18n
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // Initialize i18n for config page
  await initializeI18n();
  
  // Initialize language selector
  await initializeLanguageSelector();
  
  // Initialize AI configuration
  initializeAIConfig();
  
  // Load device ID
  await loadDeviceId();
}

function hideConfigPage() {
  if (configPage) {
    configPage.style.display = 'none';
  }
  if (app) {
    app.style.display = 'block';
  }
}

// Device ID Functions
async function loadDeviceId() {
  try {
    if (!deviceIdDisplay || !deviceIdInfo) return;
    
    // Request device ID from offscreen
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_DEVICE_ID
    });
    
    if (response && response.ok) {
      const deviceId = response.deviceId;
      const deviceIdInfo = response.deviceIdInfo;
      
      if (deviceId) {
        deviceIdDisplay.textContent = deviceId;
        deviceIdDisplay.style.color = '#333';
      } else {
        deviceIdDisplay.textContent = 'No device ID found';
        deviceIdDisplay.style.color = '#666';
      }
      
      if (deviceIdInfo) {
        const infoText = `App Type: ${deviceIdInfo.appType}, Color: ${deviceIdInfo.color}, Animal: ${deviceIdInfo.animal}, Number: ${deviceIdInfo.number}`;
        deviceIdInfo.textContent = infoText;
      } else {
        deviceIdInfo.textContent = 'No device ID info available';
      }
    } else {
      deviceIdDisplay.textContent = 'Error loading device ID';
      deviceIdDisplay.style.color = '#d32f2f';
      deviceIdInfo.textContent = response?.error || 'Unknown error';
    }
  } catch (error) {
    console.error('Error loading device ID:', error);
    if (deviceIdDisplay) {
      deviceIdDisplay.textContent = 'Error loading device ID';
      deviceIdDisplay.style.color = '#d32f2f';
    }
    if (deviceIdInfo) {
      deviceIdInfo.textContent = error.message || 'Unknown error';
    }
  }
}

// Language Selector Functions
async function initializeLanguageSelector() {
  if (!languageSelect) return;
  
  try {
    // Get current language from i18n
    const currentLocale = window.i18n ? window.i18n.getCurrentLocale() : 'en';
    
    // Set select value to current language
    languageSelect.value = currentLocale;
    
    console.log('[QEFY Popup] Language selector initialized with:', currentLocale);
  } catch (error) {
    console.error('[QEFY Popup] Error initializing language selector:', error);
    languageSelect.value = 'en'; // Fallback to English
  }
}

async function handleLanguageChange(newLocale) {
  if (!window.i18n) {
    console.error('[QEFY Popup] ❌ i18n not available');
    return;
  }
  
  try {
    console.log('[QEFY Popup] 🌍 Starting language change to:', newLocale);
    
    // Save preference
    console.log('[QEFY Popup] Step 1: Saving preference...');
    const saved = await window.i18n.setUserLanguagePreference(newLocale);
    if (!saved) {
      console.error('[QEFY Popup] ❌ Failed to save language preference');
      return;
    }
    console.log('[QEFY Popup] ✅ Step 1 complete: Preference saved');
    
    // Update current locale
    console.log('[QEFY Popup] Step 2: Updating locale...');
    window.i18n.currentLocale = newLocale;
    console.log('[QEFY Popup] ✅ Step 2 complete: Locale updated to', window.i18n.currentLocale);
    
    // Reload messages for new locale
    console.log('[QEFY Popup] Step 3: Loading messages...');
    await window.i18n.loadMessages();
    console.log('[QEFY Popup] ✅ Step 3 complete: Messages loaded for', window.i18n.currentLocale);
    
    // Preserve the selected value before re-initializing
    const selectedValue = languageSelect?.value || newLocale;
    console.log('[QEFY Popup] Step 4: Re-initializing page (preserving dropdown value:', selectedValue, ')');
    
    // Re-initialize all pages (main app, config page, add video page)
    window.i18n.initializePage();
    
    // Restore the selected value after translation
    if (languageSelect) {
      languageSelect.value = selectedValue;
    }
    console.log('[QEFY Popup] ✅ Step 4 complete: Page re-initialized');
    
    console.log('[QEFY Popup] 🎉 Language changed successfully to:', newLocale);
  } catch (error) {
    console.error('[QEFY Popup] ❌ Error changing language:', error);
  }
}

// AI Configuration Functions
async function initializeAIConfig() {
  try {
    // Check AI model status
    const aiStatus = await getAIStatus();
    
    // Handle different availability states
    switch (aiStatus.status) {
      case 'available':
        showAIToggle(aiStatus);
        break;
      case 'downloading':
        showDownloadingStatus(aiStatus);
        break;
      case 'downloadable':
        showDownloadableStatus(aiStatus);
        break;
      case 'unavailable':
        showAINotAvailable('device_incompatible');
        break;
      default:
        showAINotAvailable('unknown_error');
    }
    
  } catch (error) {
    console.warn('Error initializing AI config:', error);
    showAINotAvailable('api_error');
  }
}

async function checkAIAvailability() {
  try {
    // Check if LanguageModel API is available
    if (typeof LanguageModel !== 'undefined') {
      const availability = await LanguageModel.availability();
      return availability !== 'unavailable';
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function getAIStatus() {
  try {
    if (typeof LanguageModel !== 'undefined') {
      const availability = await LanguageModel.availability();
      return {
        available: availability === 'available',
        downloading: availability === 'downloading',
        downloadable: availability === 'downloadable',
        status: availability
      };
    }
    return { available: false, downloading: false, downloadable: false, status: 'unavailable' };
  } catch (error) {
    console.warn('[QEFY Popup] Error checking AI availability:', error);
    // If there's an exception, it means the API is not available
    return { available: false, downloading: false, downloadable: false, status: 'api_error' };
  }
}

function showAINotAvailable(errorType = 'unknown_error') {
  if (aiNotAvailableMessage) {
    aiNotAvailableMessage.style.display = 'block';
    
    // Update message based on error type
    let message = '';
    let linkText = '';
    let linkUrl = '';
    
    switch (errorType) {
      case 'api_error':
        message = window.i18n ? window.i18n.getMessage('aiNotAvailable') : 'AI features not available';
        linkText = window.i18n ? window.i18n.getMessage('enableChromeAI') : 'If you\'re using Chrome, you can enable AI features here';
        linkUrl = 'chrome://flags/#prompt-api-for-gemini-nano-multimodal-input';
        break;
      case 'device_incompatible':
        message = window.i18n ? window.i18n.getMessage('aiDeviceIncompatible') : 'Your device may not meet the requirements or you need to enable Chrome AI flags';
        linkText = window.i18n ? window.i18n.getMessage('enableChromeAI') : 'Enable Chrome AI flags';
        linkUrl = 'chrome://flags/#prompt-api-for-gemini-nano-multimodal-input';
        break;
      default:
        message = window.i18n ? window.i18n.getMessage('aiNotAvailable') : 'AI features not available';
        linkText = window.i18n ? window.i18n.getMessage('enableChromeAI') : 'Enable Chrome AI flags';
        linkUrl = 'chrome://flags/#prompt-api-for-gemini-nano-multimodal-input';
    }
    
    aiNotAvailableMessage.innerHTML = `
      <div style="margin-bottom: 8px;">
        <strong>${message}</strong>
      </div>
      <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
        ${linkText}
      </div>
      <div style="font-size: 12px;">
        <a href="${linkUrl}" target="_blank" style="color: #1a73e8; text-decoration: none;">
          ${window.i18n ? window.i18n.getMessage('learnMore') : 'Learn more (beta) →'}
        </a>
      </div>
    `;
  }
  if (aiToggleContainer) {
    aiToggleContainer.innerHTML = '';
  }
  if (aiStatusMessage) {
    aiStatusMessage.style.display = 'none';
  }
}

function showDownloadingStatus(aiStatus) {
  if (aiNotAvailableMessage) {
    aiNotAvailableMessage.style.display = 'none';
  }
  if (aiToggleContainer) {
    aiToggleContainer.innerHTML = '';
  }
  if (aiStatusMessage) {
    const message = window.i18n ? window.i18n.getMessage('aiDownloading') : 'AI model is downloading... Please wait.';
    aiStatusMessage.textContent = message;
    aiStatusMessage.className = 'status-message info';
    aiStatusMessage.style.display = 'block';
  }
  
  // Start monitoring download progress
  startDownloadProgressMonitoring();
}

function showDownloadableStatus(aiStatus) {
  if (aiNotAvailableMessage) {
    aiNotAvailableMessage.style.display = 'none';
  }
  if (aiToggleContainer) {
    aiToggleContainer.innerHTML = '';
  }
  if (aiStatusMessage) {
    const message = window.i18n ? window.i18n.getMessage('aiDownloadable') : 'AI model is available for download. Click to start downloading.';
    aiStatusMessage.textContent = message;
    aiStatusMessage.className = 'status-message info';
    aiStatusMessage.style.display = 'block';
  }
  
  // Add download button
  if (aiToggleContainer) {
    const downloadButton = document.createElement('button');
    downloadButton.textContent = window.i18n ? window.i18n.getMessage('downloadModel') : 'Download AI Model';
    downloadButton.className = 'download-button';
    downloadButton.style.cssText = `
      background: #1a73e8;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;
    downloadButton.addEventListener('click', () => {
      attemptModelDownload();
    });
    aiToggleContainer.appendChild(downloadButton);
  }
}

function showAIToggle(aiStatus) {
  if (aiNotAvailableMessage) {
    aiNotAvailableMessage.style.display = 'none';
  }
  
  // Get current AI setting from storage
  chrome.storage.local.get(['aiEnabled'], (result) => {
    const isEnabled = result.aiEnabled !== false; // Default to true if not set
    
    // Create toggle switch
    const toggleHTML = `
      <label class="toggle-switch">
        <input type="checkbox" ${isEnabled ? 'checked' : ''} ${aiStatus.downloading ? 'disabled' : ''}>
        <span class="toggle-slider"></span>
      </label>
    `;
    
    if (aiToggleContainer) {
      aiToggleContainer.innerHTML = toggleHTML;
      
      // Add event listener
      const toggleInput = aiToggleContainer.querySelector('input[type="checkbox"]');
      if (toggleInput) {
        toggleInput.addEventListener('change', (e) => {
          const enabled = e.target.checked;
          chrome.storage.local.set({ aiEnabled: enabled });
          updateAIStatusMessage(aiStatus, enabled);
        });
      }
    }
    
    updateAIStatusMessage(aiStatus, isEnabled);
  });
}

// Function to monitor download progress
function startDownloadProgressMonitoring() {
  const checkInterval = setInterval(async () => {
    try {
      const aiStatus = await getAIStatus();
      
      if (aiStatus.downloading) {
        // Still downloading, update status message
        updateAIStatusMessage(aiStatus, true);
      } else if (aiStatus.available) {
        // Download completed
        clearInterval(checkInterval);
        showAIToggle(aiStatus);
      } else {
        // Download failed or stopped
        clearInterval(checkInterval);
        updateAIStatusMessage(aiStatus, true);
      }
    } catch (error) {
      console.warn('[QEFY Popup] Error monitoring download progress:', error);
      clearInterval(checkInterval);
    }
  }, 3000); // Check every 3 seconds
}

// Function to attempt model download
async function attemptModelDownload() {
  try {
    // Check if LanguageModel is available
    if (typeof LanguageModel === 'undefined') {
      console.warn('[QEFY Popup] LanguageModel API not available for download');
      return;
    }
    
    // Create a session to trigger download
    const sessionConfig = {
      expectedInputs: [{ type: 'text' }]
    };
    
    const session = await LanguageModel.create(sessionConfig);
    await session.prompt('test');
    session.destroy();
    
    // Update status after download attempt
    setTimeout(async () => {
      const newStatus = await getAIStatus();
      if (newStatus.downloading) {
        showDownloadingStatus(newStatus);
      } else if (newStatus.available) {
        showAIToggle(newStatus);
      } else {
        updateAIStatusMessage(newStatus, true);
      }
    }, 2000);
  } catch (error) {
    console.warn('[QEFY Popup] Error attempting model download:', error);
    // Show error message
    if (aiStatusMessage) {
      const message = window.i18n ? window.i18n.getMessage('aiDownloadError') : 'Error downloading AI model. Please try again.';
      aiStatusMessage.textContent = message;
      aiStatusMessage.className = 'status-message error';
      aiStatusMessage.style.display = 'block';
    }
  }
}

function updateAIStatusMessage(aiStatus, isEnabled) {
  if (!aiStatusMessage) return;
  
  let message = '';
  let messageClass = '';
  
  if (aiStatus.downloading) {
    message = window.i18n ? window.i18n.getMessage('aiDownloading') : 'AI model is downloading... Please wait.';
    messageClass = 'info';
  } else if (aiStatus.available) {
    if (isEnabled) {
      message = window.i18n ? window.i18n.getMessage('aiEnabled') : 'AI folder suggestions are enabled.';
      messageClass = 'success';
    } else {
      message = window.i18n ? window.i18n.getMessage('aiDisabled') : 'AI folder suggestions are disabled.';
      messageClass = 'warning';
    }
  } else if (aiStatus.downloadable) {
    message = window.i18n ? window.i18n.getMessage('aiDownloadable') : 'AI model is available for download. Enable the toggle to start downloading.';
    messageClass = 'info';
  } else {
    message = window.i18n ? window.i18n.getMessage('aiNotAvailable') : 'AI features are not available.';
    messageClass = 'warning';
  }
  
  aiStatusMessage.textContent = message;
  aiStatusMessage.className = `status-message ${messageClass}`;
  aiStatusMessage.style.display = 'block';
}

function populateAddVideoFolderDropdown() {
  if (!addVideoFolderOptions || !latestQueueDoc) return;
  
  // Clear existing options
  addVideoFolderOptions.innerHTML = '';
  
  // Use foldersOrdering from compiled queue
  const folders = Array.isArray(latestQueueDoc.foldersOrdering) ? latestQueueDoc.foldersOrdering : [];
  const q = latestQueueDoc.queue || {};
  
  // Add recently_added as first option
  const recentlyAddedOption = document.createElement('div');
  recentlyAddedOption.className = 'dropdown-option';
  recentlyAddedOption.textContent = 'recently_added';
  if (selectedAddVideoFolder === 'recently_added') {
    recentlyAddedOption.classList.add('current');
  }
  recentlyAddedOption.addEventListener('click', () => {
    selectedAddVideoFolder = 'recently_added';
    if (selectedFolderName) {
      selectedFolderName.textContent = 'recently_added';
    }
    if (addVideoFolderDropdown) {
      addVideoFolderDropdown.style.display = 'none';
    }
  });
  addVideoFolderOptions.appendChild(recentlyAddedOption);
  
  // Add other folders (excluding recently_added since it's added manually above)
  const validFolders = folders.filter(folder => 
    folder !== 'done' && folder !== 'trash' && folder !== 'recently_added' &&
    Array.isArray(q[folder]) && q[folder].length > 0
  );
  
  validFolders.forEach(folder => {
    const option = document.createElement('div');
    option.className = 'dropdown-option';
    option.textContent = folder;
    
    if (folder === selectedAddVideoFolder) {
      option.classList.add('current');
    }
    
    option.addEventListener('click', () => {
      selectedAddVideoFolder = folder;
      if (selectedFolderName) {
        selectedFolderName.textContent = folder;
      }
      if (addVideoFolderDropdown) {
        addVideoFolderDropdown.style.display = 'none';
      }
    });
    
    addVideoFolderOptions.appendChild(option);
  });
}

function toggleAddVideoFolderDropdown() {
  if (!addVideoFolderDropdown) return;
  
  const isVisible = addVideoFolderDropdown.style.display !== 'none';
  
  if (isVisible) {
    addVideoFolderDropdown.style.display = 'none';
  } else {
    populateAddVideoFolderDropdown();
    addVideoFolderDropdown.style.display = 'block';
  }
}

function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function showStatus(message, type = 'info') {
  if (addVideoStatus) {
    // Use i18n if available, otherwise use the message as-is
    const translatedMessage = (typeof i18n !== 'undefined' && i18n.getMessage) ? 
      i18n.getMessage(message) : message;
    addVideoStatus.textContent = translatedMessage;
    addVideoStatus.className = `status-message ${type}`;
    addVideoStatus.style.display = 'block';
  }
}

function hideStatus() {
  if (addVideoStatus) {
    addVideoStatus.style.display = 'none';
  }
}

async function saveVideo() {
  if (saveVideoInProgress) {
    return;
  }
  
  const url = videoUrlInput.value.trim();
  
  if (!url) {
    showStatus('pleaseEnterVideoUrl', 'error');
    return;
  }
  
  if (!validateUrl(url)) {
    showStatus('pleaseEnterValidUrl', 'error');
    return;
  }
  
  // Check listener health before important actions
  await checkAndReconnectListener();
  
  saveVideoInProgress = true;
  
  // Send ADD action to core app
  const addAction = {
    type: 'add',
    path: selectedAddVideoFolder,
    link: url,
    source: 'chrome_extension'
  };
  
  chrome.runtime.sendMessage({
    type: 'SEND_ACTION_TO_CORE',
    payload: { actionJson: JSON.stringify(addAction) }
  }, (response) => {
    saveVideoInProgress = false;
    
    if (response && response.ok) {
      showStatus('videoAddedSuccessfully', 'success');
      
      // Trigger sync after successfully adding the action
      chrome.runtime.sendMessage({
        type: 'SYNC_PENDING_ACTIONS',
        payload: {}
      });
      
      // Clear input and hide page after successful save
      setTimeout(() => {
        videoUrlInput.value = '';
        // Reset dropdown to recently_added
        selectedAddVideoFolder = 'recently_added';
        if (selectedFolderName) {
          selectedFolderName.textContent = 'recently_added';
        }
        hideStatus();
        hideAddVideoPage();
      }, 2000);
    } else {
      showStatus('failedToAddVideo', 'error');
    }
  });
}

chrome.runtime.sendMessage({ type: MessageType.POPUP_GET_STATE }, (state) => {
  renderAuth(state?.authState);
  renderQueue(state?.latestCompiledQueue);
});

chrome.runtime.onMessage.addListener((message) => {
  switch (message?.type) {
    case MessageType.AUTH_STATE_UPDATE:
      renderAuth(message.payload);
      break;
    case MessageType.COMPILED_QUEUE_UPDATE:
      console.log('[QEFY Popup] Received COMPILED_QUEUE_UPDATE');
      renderQueue(message.payload);
      break;
    case MessageType.REMOTE_MEDIA_METADATA:
      console.log('[QEFY Popup] Received REMOTE_MEDIA_METADATA');
      handleMediaMetadataUpdate(message.payload);
      break;
    case 'QEFY_MEDIA_PROGRESS': {
      const st = message.payload || {};
      lastProgress = st;
      const cur = Number(st.currentTime || 0);
      const dur = Number(st.duration || 0);
      mediaStatus.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      // Show/hide controller section based on presence of media element
      const hasMedia = Number.isFinite(dur) && dur > 0;
      if (controllerSection) controllerSection.style.display = hasMedia ? 'block' : 'none';
      
      // Only control folder section display if not in remote control mode
      if (!isRemoteControlMode) {
        setFolderSectionDisplay(!hasMedia);
      }
      // Update seek slider but do not cause loops; only on release we seek
      if (seekSlider) {
        seekSlider.max = String(dur || 0);
        // update thumb if user is not dragging: check dataset flag
        if (seekSlider.dataset.dragging !== '1') seekSlider.value = String(cur || 0);
      }
      // Recompute up next on progress updates in case of navigation
      computeAndRenderUpNext(st.url || '');
      // Prefer media session metadata if present
      if (st.title || st.thumb) {
        if (st.title) mediaTitle.textContent = st.title;
        if (st.thumb) { mediaThumb.src = st.thumb; mediaThumb.style.display = 'block'; } else { mediaThumb.removeAttribute('src'); mediaThumb.style.display = 'none'; }
      }
      if (latestQueueDoc && st.url) {
        const found = findItemByUrlInQueue(st.url);
        const foundIncludingDone = findItemByUrlInQueueIncludingDone(st.url);
        
        if (found && found.item) {
          // Video is in an active playlist
          const title = found.item?.metadata?.title || found.item?.url || '—';
          const thumb = found.item?.metadata?.thumb || '';
          mediaTitle.textContent = title;
          if (thumb) { mediaThumb.src = thumb; mediaThumb.style.display = 'block'; } else { mediaThumb.removeAttribute('src'); mediaThumb.style.display = 'none'; }
          if (notInQueue) notInQueue.style.display = 'none';
          if (playlistName) playlistName.textContent = found.folder || '—';
          if (headerPlaylistName) headerPlaylistName.textContent = found.folder || '—';
        } else if (foundIncludingDone && foundIncludingDone.folder === 'done') {
          // Video is in done folder - playlist has ended, show playlist selector
          const title = foundIncludingDone.item?.metadata?.title || foundIncludingDone.item?.url || '—';
          const thumb = foundIncludingDone.item?.metadata?.thumb || '';
          mediaTitle.textContent = title;
          if (thumb) { mediaThumb.src = thumb; mediaThumb.style.display = 'block'; } else { mediaThumb.removeAttribute('src'); mediaThumb.style.display = 'none'; }
          if (notInQueue) notInQueue.style.display = 'none';
          if (playlistName) playlistName.textContent = 'Playlist ended - Select new playlist';
          if (headerPlaylistName) headerPlaylistName.textContent = 'Playlist ended';
          // Show folder selector when playlist has ended
          if (folderSection) folderSection.style.display = 'block';
          if (controllerSection) controllerSection.style.display = 'none';
        } else {
          // Video is not in any queue
          if (notInQueue) notInQueue.style.display = 'block';
          if (playlistName) playlistName.textContent = '—';
          if (headerPlaylistName) headerPlaylistName.textContent = '—';
        }
      }
      break;
    }
    default: break;
  }
});

// Auth UI removed

folderSelect.addEventListener('change', () => {
  selectedFolder = folderSelect.value || null;
  chrome.runtime.sendMessage({ type: MessageType.POPUP_FOLDER_SELECTED, payload: { folder: selectedFolder } }, () => void chrome.runtime.lastError);
});

playNowBtn.addEventListener('click', async () => {
  if (!selectedFolder) return;
  
  // Check listener health before important actions
  await checkAndReconnectListener();
  
  chrome.runtime.sendMessage({ type: MessageType.POPUP_PLAY_NOW, payload: { folder: selectedFolder } }, () => void chrome.runtime.lastError);
});

// Header playlist dropdown event listeners
headerPlaylistName?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleHeaderPlaylistDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (headerPlaylistDropdown && headerPlaylistDropdown.style.display !== 'none') {
    const container = e.target.closest('.header-playlist-container');
    if (!container) {
      headerPlaylistDropdown.style.display = 'none';
    }
  }
  
  // Close add video folder dropdown when clicking outside
  if (addVideoFolderDropdown && addVideoFolderDropdown.style.display !== 'none') {
    const container = e.target.closest('.folder-selector-section');
    if (!container) {
      addVideoFolderDropdown.style.display = 'none';
    }
  }
});

function attachAddVideoEventListeners() {
  if (eventListenersAttached) {
    return;
  }
  eventListenersAttached = true;
  
  // Remove any existing event listeners first (safety measure)
  if (addVideoBtn) {
    addVideoBtn.removeEventListener('click', addVideoBtn._clickHandler);
    addVideoBtn._clickHandler = null;
  }
  if (videoUrlInput) {
    videoUrlInput.removeEventListener('keypress', videoUrlInput._keypressHandler);
    videoUrlInput._keypressHandler = null;
  }

  // Add Video Page Event Listeners
  addVideoBtn?.addEventListener('click', () => {
    showAddVideoPage();
  });

  closeAddVideoBtn?.addEventListener('click', () => {
    hideAddVideoPage();
  });

// Magic Emoji Button Event Listener
magicEmojiBtn?.addEventListener('click', async () => {
  const magicFeaturesUrl = chrome.runtime.getURL('magic_features.html');
  
  try {
    // Check if magic features tab is already open
    const tabs = await chrome.tabs.query({ url: magicFeaturesUrl });
    
    if (tabs.length > 0) {
      // Focus on existing tab
      const existingTab = tabs[0];
      await chrome.tabs.update(existingTab.id, { active: true });
      await chrome.windows.update(existingTab.windowId, { focused: true });
      console.log('[QEFY Popup] Focused on existing magic features tab');
    } else {
      // Create new tab
      chrome.tabs.create({ url: magicFeaturesUrl });
      console.log('[QEFY Popup] Created new magic features tab');
    }
  } catch (error) {
    console.error('[QEFY Popup] Error handling magic features tab:', error);
    // Fallback: create new tab
    chrome.tabs.create({ url: magicFeaturesUrl });
  }
});

  // Config Page Event Listeners
  configBtn?.addEventListener('click', async () => {
    await showConfigPage();
  });

  closeConfigBtn?.addEventListener('click', () => {
    hideConfigPage();
  });

  // Language selector change event
  languageSelect?.addEventListener('change', async (e) => {
    console.log('[QEFY Popup] Language selector changed to:', e.target.value);
    
    // Wait for i18n to be available if it's not ready yet
    if (!window.i18n) {
      console.log('[QEFY Popup] Waiting for i18n to initialize...');
      let attempts = 0;
      while (!window.i18n && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      if (!window.i18n) {
        console.error('[QEFY Popup] ❌ i18n failed to initialize after 5 seconds');
        return;
      }
      console.log('[QEFY Popup] ✅ i18n is now available');
    }
    
    await handleLanguageChange(e.target.value);
  });

  // Logout button event
  logoutBtn?.addEventListener('click', async () => {
    if (confirm(chrome.i18n.getMessage('confirmSignOut') || 'Are you sure you want to sign out?')) {
      console.log('[QEFY Popup] Signing out...');
      
      // Clean up local popup state
      try {
        // Clear any local state variables if needed
        selectedFolder = null;
        latestQueueDoc = null;
        console.log('[QEFY Popup] Local state cleared');
      } catch (e) {
        console.warn('[QEFY Popup] Error clearing local state:', e);
      }
      
      chrome.runtime.sendMessage(
        { type: MessageType.POPUP_SIGN_OUT },
        async (response) => {
          if (chrome.runtime.lastError) {
            console.error('[QEFY Popup] Error signing out:', chrome.runtime.lastError);
            alert(chrome.i18n.getMessage('signOutError') || 'Error signing out. Please try again.');
            return;
          }
          
          // Wait a bit for background to complete cleanup
          await new Promise(resolve => setTimeout(resolve, 300));
          
          console.log('[QEFY Popup] ✅ Signed out successfully, navigating to login...');
          
          // Navigate to login.html
          window.location.href = chrome.runtime.getURL('login.html');
        }
      );
    }
  });

  selectedFolderName?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAddVideoFolderDropdown();
  });

  // URL validation on input
  videoUrlInput?.addEventListener('input', () => {
    hideStatus();
    const url = videoUrlInput.value.trim();
    if (url && !validateUrl(url)) {
      showStatus('pleaseEnterValidUrl', 'error');
    }
  });

  // Paste from clipboard
  pasteFromClipboardBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && validateUrl(text)) {
        videoUrlInput.value = text;
        hideStatus();
      } else {
        showStatus('clipboardNoValidUrl', 'error');
      }
    } catch (err) {
      showStatus('failedToReadClipboard', 'error');
    }
  });

  // Get current tab URL
  getCurrentTabBtn?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const url = tabs[0].url;
        if (validateUrl(url)) {
          videoUrlInput.value = url;
          hideStatus();
        } else {
          showStatus('currentTabNoValidUrl', 'error');
        }
      } else {
        showStatus('couldNotGetCurrentTabUrl', 'error');
      }
    });
  });

  // Save video
  if (saveVideoBtn) {
    saveVideoBtn._clickHandler = () => {
      saveVideo();
    };
    saveVideoBtn.addEventListener('click', saveVideoBtn._clickHandler);
  }

  // Enter key to save
  if (videoUrlInput) {
    videoUrlInput._keypressHandler = (e) => {
      if (e.key === 'Enter') {
        saveVideo();
      }
    };
    videoUrlInput.addEventListener('keypress', videoUrlInput._keypressHandler);
  }
}

markDoneNextBtn?.addEventListener('click', () => {
  if (markDoneInProgress) return;
  markDoneInProgress = true;
  
  chrome.runtime.sendMessage({ type: MessageType.POPUP_MARK_DONE_NEXT }, () => {
    markDoneInProgress = false;
    void chrome.runtime.lastError;
  });
});

// Add hover effects for next button
markDoneNextBtn?.addEventListener('mouseenter', () => {
  const upNext = document.getElementById('upNext');
  const up1Tile = document.querySelector('#upNext .tile:first-of-type');
  if (upNext && upNext.style.display !== 'none' && up1Tile) {
    up1Tile.classList.add('upnext-item-highlight');
  }
});

markDoneNextBtn?.addEventListener('mouseleave', () => {
  const upNext = document.getElementById('upNext');
  const up1Tile = document.querySelector('#upNext .tile:first-of-type');
  if (upNext && upNext.style.display !== 'none' && up1Tile) {
    up1Tile.classList.remove('upnext-item-highlight');
  }
});

// Seek on release
seekSlider?.addEventListener('input', () => { seekSlider.dataset.dragging = '1'; });
seekSlider?.addEventListener('change', () => {
  const target = Number(seekSlider.value || 0);
  chrome.runtime.sendMessage({ type: MessageType.POPUP_PLAYER_CONTROL, payload: { cmd: 'seekto', value: target } }, () => void chrome.runtime.lastError);
  seekSlider.dataset.dragging = '0';
});

// Speed control
speedSelect?.addEventListener('change', () => {
  const valText = String(speedSelect.value || '1x');
  const rate = Number(valText.replace('x','')) || 1;
  chrome.runtime.sendMessage({ type: MessageType.POPUP_PLAYER_CONTROL, payload: { cmd: 'set_rate', value: rate } }, () => void chrome.runtime.lastError);
});

let lastProgress = null;

function computeAndRenderUpNext(currentUrl) {
  try {
    if (!latestQueueDoc || !upNext) return;
    const found = currentUrl ? findItemByUrlInQueue(currentUrl) : null;
    let next1 = null, next2 = null;
    if (found && found.item) {
      const q = latestQueueDoc.queue || {};
      const list = Array.isArray(q[found.folder]) ? q[found.folder] : [];
      const idx = list.findIndex(it => {
        if (!it) return false;
        if (found.item.uuid && it.uuid) return it.uuid === found.item.uuid;
        if (it.url === found.item.url) return true;
        const a = canonicalYouTubeId(it.url);
        const b = canonicalYouTubeId(found.item.url);
        return !!a && a === b;
      });
      if (idx >= 0) {
        next1 = list[idx + 1] || null;
        next2 = list[idx + 2] || null;
      }
    }
    const setTile = (tileThumb, tileTitle, item) => {
      if (!tileThumb || !tileTitle) return;
      if (!item) {
        tileThumb.classList.add('gray');
        tileThumb.style.backgroundImage = '';
        tileTitle.textContent = 'No media next';
        return;
      }
      const th = item?.metadata?.thumb || '';
      if (th) {
        tileThumb.classList.remove('gray');
        tileThumb.style.backgroundImage = `url(${th})`;
        tileThumb.style.backgroundSize = 'cover';
        tileThumb.style.backgroundPosition = 'center';
      } else {
        tileThumb.classList.add('gray');
        tileThumb.style.backgroundImage = '';
      }
      tileTitle.textContent = item?.metadata?.title || item?.url || '—';
    };
    
    // Check if we're at the end of the current folder
    const isAtEndOfFolder = found && found.item && found.folder && 
      latestQueueDoc.queue && latestQueueDoc.queue[found.folder] && 
      Array.isArray(latestQueueDoc.queue[found.folder]);
    
    if (next1 || next2) {
      upNext.style.display = 'grid';
      setTile(up1Thumb, up1Title, next1);
      setTile(up2Thumb, up2Title, next2);
    } else if (isAtEndOfFolder) {
      // Show queue ended message when at the end of current folder
      upNext.style.display = 'grid';
      up1Thumb.classList.add('gray');
      up1Thumb.style.backgroundImage = '';
      up1Title.textContent = 'Queue ended';
      up1Title.className = 'title queue-ended-message';
      
      up2Thumb.classList.add('gray');
      up2Thumb.style.backgroundImage = '';
      up2Title.textContent = 'Please select another';
      up2Title.className = 'title queue-ended-message';
    } else {
      upNext.style.display = 'none';
    }
  } catch (_) {
    try { if (upNext) upNext.style.display = 'none'; } catch (_) {}
  }
}

togglePlayBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MessageType.POPUP_PLAYER_CONTROL, payload: { cmd: 'toggle_play' } }, () => void chrome.runtime.lastError);
});

seekBackBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MessageType.POPUP_PLAYER_CONTROL, payload: { cmd: 'seek_rel', value: -10 } }, () => void chrome.runtime.lastError);
});

seekFwdBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MessageType.POPUP_PLAYER_CONTROL, payload: { cmd: 'seek_rel', value: 30 } }, () => void chrome.runtime.lastError);
});

manageQueueText?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MessageType.POPUP_OPEN_APP }, () => void chrome.runtime.lastError);
});

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--';
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const mTot = Math.floor(sec / 60);
  const m = (mTot % 60).toString().padStart(2, '0');
  const h = Math.floor(mTot / 60);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

// Initialize i18n system
async function initializeI18n() {
  // Wait for i18n to be available
  let attempts = 0;
  while (typeof i18n === 'undefined' && attempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  
  if (typeof i18n !== 'undefined') {
    try {
      console.log('[QEFY Popup] i18n available, loading messages...');
      await i18n.loadMessages();
      console.log('[QEFY Popup] i18n messages loaded for locale:', i18n.currentLocale);
      
      // Initialize page translations
      i18n.initializePage();
      console.log('[QEFY Popup] Page translations initialized');
      
      // Debug: Check if messages are loaded
      console.log('[QEFY Popup] Sample messages:', {
        configTitle: i18n.getMessage('configTitle'),
        languageEnglish: i18n.getMessage('languageEnglish'),
        languagePortuguese: i18n.getMessage('languagePortuguese'),
        languageSpanish: i18n.getMessage('languageSpanish')
      });
      console.log('[QEFY Popup] Available messages keys:', Object.keys(i18n.messages).slice(0, 10));
      
      // If messages are not loaded, try to force reload from hardcoded messages
      if (i18n.getMessage('configTitle') === 'configTitle') {
        console.log('[QEFY Popup] Messages not loaded properly, trying to reload from hardcoded messages...');
        i18n.messages = i18n.getHardcodedMessages();
        console.log('[QEFY Popup] Reloaded messages:', Object.keys(i18n.messages).slice(0, 10));
      }
      
      // Debug: Check if config page elements exist
      const configElements = document.querySelectorAll('#configPage [data-i18n]');
      console.log('[QEFY Popup] Found config elements with data-i18n:', configElements.length);
      
      i18n.initializePage();
      console.log('[QEFY Popup] i18n page initialized');
      
      // Debug: Check if elements were translated
      configElements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = el.textContent;
        console.log(`[QEFY Popup] Element ${key}: "${translated}"`);
      });
    } catch (error) {
      console.warn('[QEFY Popup] i18n initialization failed:', error);
    }
  } else {
    console.warn('[QEFY Popup] i18n not available after waiting');
  }
}

// Check if another device is controlling media and block playback if needed
async function checkMediaControlStatus() {
  try {
    console.log('[QEFY Popup] Checking media control status...');
    
    // Wait for Core App to be ready with retry mechanism
    let deviceId = null;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!deviceId && attempts < maxAttempts) {
      deviceId = await getCurrentDeviceId();
      if (!deviceId) {
        console.log(`[QEFY Popup] Device ID not ready, attempt ${attempts + 1}/${maxAttempts}`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
        attempts++;
      }
    }
    
    if (!deviceId) {
      console.log('[QEFY Popup] Device ID not available after retries, skipping media control check');
      return;
    }
    
    // Get media status from offscreen document
    const mediaStatus = await getMediaStatus();
    console.log('[QEFY Popup] Media status:', mediaStatus);
    
    if (mediaStatus && mediaStatus.currentStatus && 
        (mediaStatus.currentStatus === 'playing' || mediaStatus.currentStatus === 'paused')) {
      
      // Update play/pause button icon
      updatePlayPauseButtonIcon(mediaStatus.currentStatus === 'playing');
      
      // Check if this device is the executor
      if (mediaStatus.executorDeviceId && mediaStatus.executorDeviceId !== deviceId) {
        console.log('[QEFY Popup] Another device is controlling media:', mediaStatus.executorDeviceId);
        
        // Block playback and show warning
        blockPlaybackForRemoteControl(mediaStatus);
      } else {
        console.log('[QEFY Popup] This device is controlling media, allowing playback');
        // Allow playback - remove any existing blocks
        unblockPlayback();
      }
    } else {
      console.log('[QEFY Popup] No active media session, allowing playback');
      // No active media - allow playback
      unblockPlayback();
    }
    
  } catch (error) {
    console.error('[QEFY Popup] Error checking media control status:', error);
    // On error, allow playback to avoid blocking legitimate use
    unblockPlayback();
  }
}

// Block playback when another device is controlling media
function blockPlaybackForRemoteControl(mediaStatus) {
  console.log('[QEFY Popup] Blocking playback - another device is controlling media');
  
  // Disable play buttons
  if (playNowBtn) {
    playNowBtn.disabled = true;
    playNowBtn.style.opacity = '0.5';
    playNowBtn.title = 'Another device is controlling media. Send STOP command first.';
  }
  
  if (togglePlayBtn) {
    togglePlayBtn.disabled = true;
    togglePlayBtn.style.opacity = '0.5';
    togglePlayBtn.title = 'Another device is controlling media. Send STOP command first.';
  }
  
  // Show media control commands instead of warning
  showMediaControlCommands(mediaStatus);
}

// Unblock playback when this device can control media
function unblockPlayback() {
  console.log('[QEFY Popup] Unblocking playback - this device can control media');
  
  // Clear remote control mode flag
  isRemoteControlMode = false;
  
  // Enable play buttons
  if (playNowBtn) {
    playNowBtn.disabled = false;
    playNowBtn.style.opacity = '1';
    playNowBtn.title = '';
  }
  
  if (togglePlayBtn) {
    togglePlayBtn.disabled = false;
    togglePlayBtn.style.opacity = '1';
    togglePlayBtn.title = '';
  }
  
  // Hide media control commands
  hideMediaControlCommands();
}

// Show media control commands for remote control
function showMediaControlCommands(mediaStatus) {
  // Set remote control mode flag
  isRemoteControlMode = true;
  
  // Hide folder section when showing remote control
  setFolderSectionDisplay(false, true);
  
  // Show the "Now Playing" status section for remote control
  showMediaProgressUI(mediaStatus);
  
  // Create or update media control commands
  let commandsDiv = document.getElementById('mediaControlCommands');
  if (!commandsDiv) {
    commandsDiv = document.createElement('div');
    commandsDiv.id = 'mediaControlCommands';
    commandsDiv.className = 'bg-surface-container border border-outline p-3 my-2 rounded-lg text-xs';
    
    // Insert after the header
    const header = document.querySelector('.header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(commandsDiv, header.nextSibling);
    }
  }
  
  commandsDiv.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <span class="font-semibold text-on-surface text-sm" style="color: var(--color-on-surface);">Remote Media Control</span>
      <span class="text-xs" style="color: var(--color-on-surface-variant);">${mediaStatus.currentStatus} | ${mediaStatus.executorDeviceId}</span>
    </div>
    <div class="flex gap-2 justify-center">
      <button id="remotePlayBtn" class="remote-control-btn px-3 py-2 rounded-lg border border-outline bg-surface hover:bg-surface-container text-on-surface transition-colors duration-200 hover:border-primary flex items-center justify-center" title="Play">
        <span class="material-symbols-outlined text-sm">play_arrow</span>
      </button>
      <button id="remotePauseBtn" class="remote-control-btn px-3 py-2 rounded-lg border border-outline bg-surface hover:bg-surface-container text-on-surface transition-colors duration-200 hover:border-primary flex items-center justify-center" title="Pause">
        <span class="material-symbols-outlined text-sm">pause</span>
      </button>
      <button id="remoteStopBtn" class="remote-control-btn px-3 py-2 rounded-lg border border-outline bg-surface hover:bg-surface-container text-on-surface transition-colors duration-200 hover:border-primary flex items-center justify-center" title="Stop">
        <span class="material-symbols-outlined text-sm">stop</span>
      </button>
      <button id="remoteSkipBtn" class="remote-control-btn px-3 py-2 rounded-lg border border-outline bg-surface hover:bg-surface-container text-on-surface transition-colors duration-200 hover:border-primary flex items-center justify-center" title="Skip">
        <span class="material-symbols-outlined text-sm">skip_next</span>
      </button>
      <button id="remoteBackBtn" class="remote-control-btn px-3 py-2 rounded-lg border border-outline bg-surface hover:bg-surface-container text-on-surface transition-colors duration-200 hover:border-primary flex items-center justify-center" title="Back">
        <span class="material-symbols-outlined text-sm">skip_previous</span>
      </button>
    </div>
  `;
  commandsDiv.style.display = 'block';
  
  // Add event listeners for the remote control buttons
  setupRemoteControlButtons();
}

// Setup event listeners for remote control buttons
function setupRemoteControlButtons() {
  const remotePlayBtn = document.getElementById('remotePlayBtn');
  const remotePauseBtn = document.getElementById('remotePauseBtn');
  const remoteStopBtn = document.getElementById('remoteStopBtn');
  const remoteSkipBtn = document.getElementById('remoteSkipBtn');
  const remoteBackBtn = document.getElementById('remoteBackBtn');
  
  if (remotePlayBtn) {
    remotePlayBtn.addEventListener('click', () => {
      sendRemoteCommand('play');
    });
  }
  
  if (remotePauseBtn) {
    remotePauseBtn.addEventListener('click', () => {
      sendRemoteCommand('pause');
    });
  }
  
  if (remoteStopBtn) {
    remoteStopBtn.addEventListener('click', () => {
      sendRemoteCommand('stop');
    });
  }
  
  if (remoteSkipBtn) {
    remoteSkipBtn.addEventListener('click', () => {
      sendRemoteCommand('forward');
    });
  }
  
  if (remoteBackBtn) {
    remoteBackBtn.addEventListener('click', () => {
      sendRemoteCommand('backward');
    });
  }
}

// Send remote command to control media on another device
async function sendRemoteCommand(commandType) {
  console.log(`[QEFY Popup] Sending remote command: ${commandType}`);
  
  // Get current media info if available
  const mediaId = await getCurrentMediaId();
  const targetDeviceId = await getTargetDeviceIdFromStatus();
  
  console.log(`[QEFY Popup] Command details:`, {
    commandType,
    mediaId: mediaId || '',
    targetDeviceId: targetDeviceId || ''
  });
  
  chrome.runtime.sendMessage({
    type: 'SEND_MEDIA_COMMAND',
    payload: {
      commandType: commandType,
      commandValue: commandType === 'forward' ? '30' : commandType === 'backward' ? '-30' : '',
      mediaId: mediaId || '',
      targetDeviceId: targetDeviceId || ''
    }
  }, (response) => {
    if (response && response.ok) {
      console.log(`[QEFY Popup] Remote command ${commandType} sent successfully`);
    } else {
      console.error(`[QEFY Popup] Failed to send remote command ${commandType}:`, response);
    }
  });
}

// Get current media ID from current media session
async function getCurrentMediaId() {
  try {
    const mediaStatus = await getMediaStatus();
    if (mediaStatus && mediaStatus.mediaId) {
      console.log('[QEFY Popup] Using media ID from media status:', mediaStatus.mediaId);
      return mediaStatus.mediaId;
    }
  } catch (error) {
    console.error('[QEFY Popup] Error getting media ID from status:', error);
  }
  return '';
}

// Get target device ID from the media status or use default
function getTargetDeviceId() {
  // Try to get from media status or use empty string for default target
  // This could be enhanced to get from the current media status
  return '';
}

// Get target device ID from media status
async function getTargetDeviceIdFromStatus() {
  try {
    const mediaStatus = await getMediaStatus();
    if (mediaStatus && mediaStatus.executorDeviceId) {
      console.log('[QEFY Popup] Using executor device ID from media status:', mediaStatus.executorDeviceId);
      return mediaStatus.executorDeviceId;
    }
  } catch (error) {
    console.error('[QEFY Popup] Error getting target device ID from status:', error);
  }
  return '';
}

// Hide media control commands
function hideMediaControlCommands() {
  // Clear remote control mode flag
  isRemoteControlMode = false;
  
  const commandsDiv = document.getElementById('mediaControlCommands');
  if (commandsDiv) {
    commandsDiv.style.display = 'none';
  }
  
  // Show folder section again when hiding remote control
  setFolderSectionDisplay(true, true);
}

// Get current device ID from offscreen document
async function getCurrentDeviceId() {
  try {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'GET_DEVICE_ID'
      }, (response) => {
        if (response && response.deviceId) {
          console.log('[QEFY Popup] Retrieved device ID:', response.deviceId);
          resolve(response.deviceId);
        } else {
          console.log('[QEFY Popup] No device ID in response:', response);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error('[QEFY Popup] Error getting device ID:', error);
    return null;
  }
}

// Get media status from offscreen document
async function getMediaStatus() {
  try {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'GET_MEDIA_STATUS'
      }, (response) => {
        if (response && response.mediaStatus) {
          console.log('[QEFY Popup] Retrieved media status:', response.mediaStatus);
          resolve(response.mediaStatus);
        } else {
          console.log('[QEFY Popup] No media status in response:', response);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error('[QEFY Popup] Error getting media status:', error);
    return null;
  }
}

// Media status monitoring
let mediaStatusInterval = null;
let currentMediaStatus = null;

// Start monitoring media status in real-time
function startMediaStatusMonitoring() {
  console.log('[QEFY Popup] Starting media status monitoring...');
  
  // Check immediately
  checkMediaStatusAndUpdateUI();
  
  // Set up interval to check every 2 seconds
  mediaStatusInterval = setInterval(async () => {
    await checkMediaStatusAndUpdateUI();
  }, 2000);
}

// Stop monitoring media status
function stopMediaStatusMonitoring() {
  if (mediaStatusInterval) {
    clearInterval(mediaStatusInterval);
    mediaStatusInterval = null;
    console.log('[QEFY Popup] Stopped media status monitoring');
  }
}

// Check media status and update UI accordingly
async function checkMediaStatusAndUpdateUI() {
  try {
    const mediaStatus = await getMediaStatus();
    
    if (mediaStatus && mediaStatus.currentStatus && 
        (mediaStatus.currentStatus === 'playing' || mediaStatus.currentStatus === 'paused')) {
      
      // Update play/pause button icon
      updatePlayPauseButtonIcon(mediaStatus.currentStatus === 'playing');
      
      // Check if this device is controlling the media
      const deviceId = await getCurrentDeviceId();
      const isRemoteControl = deviceId && mediaStatus.executorDeviceId && mediaStatus.executorDeviceId !== deviceId;
      
      // Only update if the state has actually changed
      const stateChanged = !currentMediaStatus || 
                          currentMediaStatus.executorDeviceId !== mediaStatus.executorDeviceId ||
                          currentMediaStatus.currentStatus !== mediaStatus.currentStatus;
      
      if (stateChanged) {
        // Update current media status
        currentMediaStatus = mediaStatus;
        
        if (isRemoteControl) {
          // Another device is controlling - show remote control
          showMediaControlCommands(mediaStatus);
        } else {
          // This device is controlling - show normal controls but hide status section
          hideMediaControlCommands();
          hideMediaProgressUI(); // Hide the "Now Playing" status section when this device is executing
          unblockPlayback();
        }
      }
      
    } else {
      // Only update if we had active media before
      if (currentMediaStatus) {
        // No active media - show normal UI
        currentMediaStatus = null;
        hideMediaProgressUI();
        hideMediaControlCommands();
        unblockPlayback();
      }
    }
    
  } catch (error) {
    console.error('[QEFY Popup] Error checking media status:', error);
  }
}

// Show media progress UI
function showMediaProgressUI(mediaStatus) {
  // Create or update media progress display
  let progressDiv = document.getElementById('mediaProgressDisplay');
  if (!progressDiv) {
    progressDiv = document.createElement('div');
    progressDiv.id = 'mediaProgressDisplay';
    progressDiv.style.cssText = `
      background: #e3f2fd;
      border: 1px solid #2196f3;
      padding: 12px;
      margin: 8px 0;
      border-radius: 6px;
      font-size: 12px;
    `;
    
    // Insert after the header
    const header = document.querySelector('.header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(progressDiv, header.nextSibling);
    }
  }
  
  const progress = mediaStatus.mediaTotalSeconds > 0 ? 
    (mediaStatus.mediaCurrentSeconds / mediaStatus.mediaTotalSeconds) * 100 : 0;
  
  progressDiv.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
      <span style="font-weight: bold; color: #1976d2;">Now Playing</span>
      <span style="color: #666; font-size: 11px;">${mediaStatus.currentStatus}</span>
    </div>
    <div style="margin-bottom: 8px;">
      <div style="background: #ddd; height: 4px; border-radius: 2px; overflow: hidden;">
        <div style="background: #2196f3; height: 100%; width: ${progress}%; transition: width 0.3s;"></div>
      </div>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 11px; color: #666;">
      <span>${formatTime(mediaStatus.mediaCurrentSeconds)}</span>
      <span>${formatTime(mediaStatus.mediaTotalSeconds)}</span>
    </div>
  `;
  progressDiv.style.display = 'block';
}

// Hide media progress UI
function hideMediaProgressUI() {
  const progressDiv = document.getElementById('mediaProgressDisplay');
  if (progressDiv) {
    progressDiv.style.display = 'none';
  }
}


// Handle media metadata updates from real-time database
function handleMediaMetadataUpdate(metadata) {
  console.log('[QEFY Popup] Received media metadata update:', metadata);
  
  if (metadata && metadata.status && 
      (metadata.status === 'playing' || metadata.status === 'paused')) {
    
    // Check if executor device changed and close hijacked tab if needed
    if (metadata.deviceId && currentMediaStatus && currentMediaStatus.executorDeviceId) {
      if (metadata.deviceId !== currentMediaStatus.executorDeviceId) {
        console.log('[QEFY Popup] Executor device changed in metadata update:', metadata.deviceId, 'previous:', currentMediaStatus.executorDeviceId);
        console.log('[QEFY Popup] Another device took over as executor - closing hijacked tab');
        
        // Close the hijacked tab immediately
        chrome.runtime.sendMessage({
          type: 'EXECUTE_MEDIA_COMMAND',
          payload: { command: 'stop' }
        }, () => void chrome.runtime.lastError);
      }
    }
    
    // Update current media status with metadata
    currentMediaStatus = {
      currentStatus: metadata.status,
      mediaCurrentSeconds: metadata.currentSeconds || 0,
      mediaTotalSeconds: metadata.totalSeconds || 0,
      mediaId: metadata.mediaId || '',
      executorDeviceId: metadata.deviceId || ''
    };
    
    // Update progress UI if visible
    const progressDiv = document.getElementById('mediaProgressDisplay');
    if (progressDiv && progressDiv.style.display !== 'none') {
      showMediaProgressUI(currentMediaStatus);
    }
  }
}

// Initialize popup
async function initializePopup() {
  // Initialize i18n - wait for it to be available
  await initializeI18n();
  
  // Attach add video event listeners
  attachAddVideoEventListeners();
  
  // Check listener health when popup opens
  await checkAndReconnectListener();
  
  // Start monitoring media status
  startMediaStatusMonitoring();
  
  // Trigger sync when popup opens (now with cooldown protection)
  chrome.runtime.sendMessage({
    type: MessageType.SYNC_PENDING_ACTIONS,
    payload: {}
  });
}

// Update play/pause button icon based on media status
function updatePlayPauseButtonIcon(isPlaying) {
  const togglePlayBtn = document.getElementById('togglePlayBtn');
  if (!togglePlayBtn) return;
  
  const iconSpan = togglePlayBtn.querySelector('.material-symbols-outlined');
  if (iconSpan) {
    iconSpan.textContent = isPlaying ? 'pause' : 'play_arrow';
  }
}

// Theme Mode Management
function initializeThemeMode() {
  const themeModeSelect = document.getElementById('themeModeSelect');
  if (!themeModeSelect) return;

  // Load saved theme mode or default to 'system'
  chrome.storage.local.get(['themeMode'], (result) => {
    const savedThemeMode = result.themeMode || 'system';
    themeModeSelect.value = savedThemeMode;
    applyThemeMode(savedThemeMode);
  });

  // Listen for theme mode changes
  themeModeSelect.addEventListener('change', (e) => {
    const selectedMode = e.target.value;
    applyThemeMode(selectedMode);
    
    // Save to storage
    chrome.storage.local.set({ themeMode: selectedMode });
  });
}

function applyThemeMode(mode) {
  const root = document.documentElement;
  
  // Remove existing theme mode attributes
  root.removeAttribute('data-theme-mode');
  
  if (mode === 'light' || mode === 'dark') {
    root.setAttribute('data-theme-mode', mode);
  }
  // For 'system', we don't set any attribute, letting CSS media queries handle it
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializePopup();
    initializeThemeMode();
  });
} else {
  initializePopup();
  initializeThemeMode();
}

// Cleanup when popup is closed
window.addEventListener('beforeunload', () => {
  stopMediaStatusMonitoring();
});

