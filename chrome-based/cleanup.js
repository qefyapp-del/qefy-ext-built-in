/**
 * Cleanup Page - Bulk Tab Organizer
 * Scans YouTube tabs, extracts metadata, uses AI to suggest folders, and saves to Qefy
 */

import { MessageType } from './messages.js';

// State management
const state = {
  items: [], // Array of video items to process
  compiledQueue: null,
  processing: false,
  currentStep: 'scanning', // scanning, extracting, processing, ready, saving, complete
  aiStopped: false // Flag to stop AI processing
};

// DOM elements
let progressFill, progressText, itemsContainer, actions, actionInfo;
let saveAndCloseTabsBtn, saveKeepTabsBtn, cancelBtn, closeBtn;
let syncStatus, successMessage, closeTabBtn;
let successCount, errorCount, stopAI;

/**
 * Initialize the cleanup page
 */
async function init() {
  console.log('[QEFY Cleanup] Initializing cleanup page');
  
  // Initialize theme mode
  initializeThemeMode();
  
  // Get DOM elements
  progressFill = document.getElementById('progressFill');
  progressText = document.getElementById('progressText');
  itemsContainer = document.getElementById('itemsContainer');
  actions = document.getElementById('actions');
  actionInfo = document.getElementById('actionInfo');
  saveAndCloseTabsBtn = document.getElementById('saveAndCloseTabs');
  saveKeepTabsBtn = document.getElementById('saveKeepTabs');
  cancelBtn = document.getElementById('cancel');
  closeBtn = document.getElementById('closeBtn');
  syncStatus = document.getElementById('syncStatus');
  successMessage = document.getElementById('successMessage');
  closeTabBtn = document.getElementById('closeTab');
  successCount = document.getElementById('successCount');
  errorCount = document.getElementById('errorCount');
  stopAI = document.getElementById('stopAI');

  // Initialize i18n
  await initializeI18n();

  // Add event listeners
  saveAndCloseTabsBtn?.addEventListener('click', () => handleSave(true));
  saveKeepTabsBtn?.addEventListener('click', () => handleSave(false));
  cancelBtn?.addEventListener('click', handleCancel);
  closeBtn?.addEventListener('click', () => window.close());
  closeTabBtn?.addEventListener('click', () => window.close());
  stopAI?.addEventListener('click', handleStopAI);

  // Start the cleanup process
  await startCleanupProcess();
}

/**
 * Initialize theme mode
 */
function initializeThemeMode() {
  // Load saved theme mode
  chrome.storage.local.get(['themeMode'], (result) => {
    const savedThemeMode = result.themeMode || 'system';
    applyThemeMode(savedThemeMode);
  });
  
  // Listen for theme mode changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.themeMode) {
      applyThemeMode(changes.themeMode.newValue);
    }
  });
}

/**
 * Apply theme mode
 */
function applyThemeMode(mode) {
  const root = document.documentElement;
  root.removeAttribute('data-theme-mode');
  if (mode === 'light' || mode === 'dark') {
    root.setAttribute('data-theme-mode', mode);
  }
}

/**
 * Initialize i18n
 */
async function initializeI18n() {
  let attempts = 0;
  while (typeof i18n === 'undefined' && attempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  
  if (typeof i18n !== 'undefined') {
    try {
      await i18n.loadMessages();
      i18n.initializePage();
    } catch (error) {
      console.warn('[QEFY Cleanup] i18n initialization failed:', error);
    }
  }
}

/**
 * Start the cleanup process
 */
async function startCleanupProcess() {
  try {
    state.processing = true;
    
    // Step 1: Get compiled queue
    updateProgress(10, chrome.i18n.getMessage('gettingQueue'));
    state.compiledQueue = await getCompiledQueue();
    
    if (!state.compiledQueue) {
      showError(chrome.i18n.getMessage('couldNotLoadQueue'));
      return;
    }

    // Step 2: Scan YouTube tabs
    updateProgress(20, chrome.i18n.getMessage('scanningTabs'));
    const youtubeTabs = await scanYouTubeTabs();
    
    if (!youtubeTabs || youtubeTabs.length === 0) {
      showEmptyState(chrome.i18n.getMessage('noYouTubeTabsFound'), chrome.i18n.getMessage('openYouTubeTabs'));
      return;
    }

    console.log('[QEFY Cleanup] Found', youtubeTabs.length, 'YouTube tabs');

    // Initialize items
    state.items = youtubeTabs.map(tab => ({
      tabId: tab.id,
      url: tab.url,
      videoId: extractVideoIdFromUrl(tab.url),
      status: 'pending',
      title: null,
      description: null,
      duration: null,
      thumbnail: null,
      channelName: null,
      suggestedFolder: null,
      error: null
    }));

    renderItems();

    // Step 3: Extract metadata from each tab
    state.currentStep = 'extracting';
    updateProgress(30, `Extracting data from ${state.items.length} videos...`);
    
    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      item.status = 'extracting';
      updateItemInUI(i);
      
      const extracted = await extractVideoData(item.tabId, item.url, item.videoId);
      
      if (extracted.ok) {
        Object.assign(item, extracted.data);
        item.status = 'extracted';
      } else {
        item.error = extracted.error || 'Failed to extract data';
        item.status = 'error';
        // Set fallback values
        item.title = item.url;
        item.thumbnail = item.videoId ? 
          `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg` : null;
      }
      
      updateItemInUI(i);
      
      const extractProgress = 30 + (20 * (i + 1) / state.items.length);
      updateProgress(extractProgress, `Extracted ${i + 1} of ${state.items.length} videos...`);
    }

    // Step 4: Process with AI
    state.currentStep = 'processing';
    updateProgress(50, 'Processing with AI...');
    
    await processWithAI();

    // Step 5: Ready to save
    state.currentStep = 'ready';
    updateProgress(100, 'Ready to save!');
    
    updateActionInfo();
    actions.style.display = 'block';
    
  } catch (error) {
    console.error('[QEFY Cleanup] Error in cleanup process:', error);
    showError(chrome.i18n.getMessage('errorOccurred'));
  }
}

/**
 * Get compiled queue from background
 */
async function getCompiledQueue() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: MessageType.POPUP_GET_STATE }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[QEFY Cleanup] Error getting state:', chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(response?.latestCompiledQueue || null);
      }
    });
  });
}

/**
 * Scan YouTube tabs
 */
async function scanYouTubeTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('[QEFY Cleanup] Error querying tabs:', chrome.runtime.lastError);
        resolve([]);
      } else {
        // Filter out the current cleanup tab
        const currentTabId = chrome.devtools?.inspectedWindow?.tabId;
        const youtubeTabs = tabs.filter(tab => {
          // Filter out non-video pages
          return tab.url && (
            tab.url.includes('/watch?v=') ||
            tab.url.includes('/shorts/') ||
            tab.url.includes('youtu.be/')
          );
        });
        resolve(youtubeTabs);
      }
    });
  });
}

/**
 * Extract video ID from URL
 */
function extractVideoIdFromUrl(url) {
  try {
    const urlObj = new URL(url);
    
    if (urlObj.pathname === '/watch') {
      return urlObj.searchParams.get('v');
    }
    
    const shortsMatch = urlObj.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
    
    const embedMatch = urlObj.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
    
    if (urlObj.hostname === 'youtu.be') {
      return urlObj.pathname.slice(1).split('?')[0];
    }
  } catch (e) {
    console.error('[QEFY Cleanup] Error extracting video ID:', e);
  }
  
  return null;
}

/**
 * Extract video data from tab
 */
async function extractVideoData(tabId, url, videoId) {
  // Try method B: Content script injection
  try {
    const result = await injectAndExtract(tabId);
    if (result.ok) {
      return result;
    }
  } catch (error) {
    console.log('[QEFY Cleanup] Content script extraction failed:', error);
  }

  // Fallback to method A: Offscreen document
  try {
    const result = await extractViaOffscreen(url, videoId);
    return result;
  } catch (error) {
    console.error('[QEFY Cleanup] Offscreen extraction failed:', error);
    return {
      ok: false,
      error: 'Failed to extract video data'
    };
  }
}

/**
 * Inject content script and extract data
 */
async function injectAndExtract(tabId) {
  try {
    // Inject the extractor script
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['tab_data_extractor.js']
    });

    // Wait a bit for script to load
    await new Promise(resolve => setTimeout(resolve, 100));

    // Request data extraction
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'EXTRACT_VIDEO_DATA_FROM_TAB' },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else if (response && response.ok) {
            resolve(response);
          } else {
            resolve({ ok: false, error: 'No response from content script' });
          }
        }
      );
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Extract data via offscreen document (fallback)
 */
async function extractViaOffscreen(url, videoId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: MessageType.EXTRACT_VIDEO_DATA,
        payload: { url, videoId }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else if (response && response.ok) {
          resolve(response);
        } else {
          resolve({ ok: false, error: response?.error || 'Unknown error' });
        }
      }
    );
  });
}

/**
 * Process items with AI to suggest folders
 */
async function processWithAI() {
  // Load AI service
  const aiService = new window.AIFolderSuggestionService();
  await aiService.checkAvailability();

  if (!aiService.isAvailable) {
    console.warn('[QEFY Cleanup] AI not available, using fallback');
  }

  const availableFolders = getAvailableFolders();
  const successfulItems = state.items.filter(item => item.status === 'extracted');

  for (let i = 0; i < successfulItems.length; i++) {
    // Check if AI processing was stopped
    if (state.aiStopped) {
      console.log('[QEFY Cleanup] AI processing stopped by user, breaking loop');
      break;
    }
    
    const item = successfulItems[i];
    const globalIndex = state.items.indexOf(item);
    
    item.status = 'processing';
    updateItemInUI(globalIndex);

    try {
      if (aiService.isAvailable && !state.aiStopped) {
        const suggestion = await aiService.suggestFolderFromQueue(
          item.title,
          state.compiledQueue,
          availableFolders,
          item.thumbnail,
          item.duration,
          item.channelName
        );
        
        item.suggestedFolder = suggestion || 'recently_added';
      } else {
        item.suggestedFolder = 'recently_added';
      }
      
      item.status = 'ready';
    } catch (error) {
      console.error('[QEFY Cleanup] AI processing failed for item:', error);
      item.suggestedFolder = 'recently_added';
      item.status = 'ready';
    }

    updateItemInUI(globalIndex);
    
    // Only update progress if AI wasn't stopped
    if (!state.aiStopped) {
      const aiProgress = 50 + (50 * (i + 1) / successfulItems.length);
      updateProgress(aiProgress, `Processing ${i + 1} of ${successfulItems.length} with AI...`);
    }
  }
}

/**
 * Get available folders from compiled queue
 */
function getAvailableFolders() {
  if (!state.compiledQueue || !state.compiledQueue.foldersOrdering) {
    return ['recently_added'];
  }

  return state.compiledQueue.foldersOrdering.filter(
    folder => folder !== 'done' && folder !== 'trash'
  );
}

/**
 * Handle save action
 */
async function handleSave(closeTabs) {
  try {
    // Disable buttons
    saveAndCloseTabsBtn.disabled = true;
    saveKeepTabsBtn.disabled = true;
    cancelBtn.disabled = true;

    // Hide actions, show sync status
    actions.style.display = 'none';
    syncStatus.style.display = 'block';

    // Get ready items (skip errors)
    const readyItems = state.items.filter(item => item.status === 'ready' && item.suggestedFolder);

    if (readyItems.length === 0) {
      showError(chrome.i18n.getMessage('noVideosReadyToSave'));
      return;
    }

    console.log('[QEFY Cleanup] Saving', readyItems.length, 'videos');

    // Check if user is authenticated
    if (!state.compiledQueue) {
      throw new Error('User not authenticated or queue not loaded');
    }

    // Check if Core App is ready
    console.log('[QEFY Cleanup] Checking Core App status...');
    const coreAppStatus = await checkCoreAppStatus();
    if (!coreAppStatus.ready) {
      throw new Error('Core App not ready: ' + coreAppStatus.error);
    }
    console.log('[QEFY Cleanup] Core App is ready');

    // Create batch actions
    const batchActions = readyItems.map(item => ({
      type: 'add',
      path: item.suggestedFolder,
      link: item.url,
      metadata: {
        title: item.title,
        description: item.description,
        duration: String(item.duration), // Convert duration to string
        thumb: item.thumbnail
      },
      source: 'chrome_extension_cleanup'
    }));

    // Send each action individually to Core App
    console.log('[QEFY Cleanup] Sending', batchActions.length, 'individual actions to Core App');
    
    for (let i = 0; i < batchActions.length; i++) {
      const action = batchActions[i];
      console.log('[QEFY Cleanup] Sending action', i + 1, 'of', batchActions.length, ':', action);
      
      const result = await sendActionToCore(action);
      console.log('[QEFY Cleanup] Action', i + 1, 'result:', result);
      
      if (!result.ok) {
        console.error('[QEFY Cleanup] Failed to send action:', action, 'Error:', result.error);
        throw new Error(`Failed to save action ${i + 1}: ${result.error}`);
      }
      
      console.log('[QEFY Cleanup] Action', i + 1, 'sent successfully');
      
      // Small delay between actions to ensure proper processing
      if (i < batchActions.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log('[QEFY Cleanup] All actions sent successfully');

    // Trigger sync
    console.log('[QEFY Cleanup] Triggering sync...');
    const syncResult = await triggerSync();
    console.log('[QEFY Cleanup] Sync triggered:', syncResult);

    // Wait for sync to process (Core App syncs to backend)
    console.log('[QEFY Cleanup] Waiting 5 seconds for sync to complete...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('[QEFY Cleanup] Videos saved successfully! Check your queue in the popup or web app.');

    // Close tabs if requested
    if (closeTabs) {
      const tabIds = readyItems.map(item => item.tabId);
      await closeTabsById(tabIds);
      console.log('[QEFY Cleanup] Closed', tabIds.length, 'tabs');
    }

    // Show success
    syncStatus.style.display = 'none';
    successMessage.style.display = 'block';
    
    console.log('[QEFY Cleanup] ✅ SUCCESS! All videos saved. Open your Qefy popup or web app to see them.');

  } catch (error) {
    console.error('[QEFY Cleanup] Error saving:', error);
    syncStatus.style.display = 'none';
    actions.style.display = 'block';
    saveAndCloseTabsBtn.disabled = false;
    saveKeepTabsBtn.disabled = false;
    cancelBtn.disabled = false;
    showError(chrome.i18n.getMessage('failedToSaveVideos'));
  }
}

/**
 * Check if Core App is ready
 */
async function checkCoreAppStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: MessageType.POPUP_GET_STATE },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ready: false, error: chrome.runtime.lastError.message });
        } else if (response && response.authState && response.authState.status === 'signed_in') {
          resolve({ ready: true });
        } else {
          resolve({ ready: false, error: 'User not authenticated' });
        }
      }
    );
  });
}

/**
 * Send individual action to Core App via background script
 */
async function sendActionToCore(action) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: MessageType.SEND_ACTION_TO_CORE,
        payload: { actionJson: JSON.stringify(action) }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[QEFY Cleanup] Action send error:', chrome.runtime.lastError);
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[QEFY Cleanup] Action response:', response);
          resolve(response || { ok: true });
        }
      }
    );
  });
}

/**
 * Trigger sync
 */
async function triggerSync() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: MessageType.SYNC_PENDING_ACTIONS, payload: {} },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[QEFY Cleanup] Sync error:', chrome.runtime.lastError);
        } else {
          console.log('[QEFY Cleanup] Sync response:', response);
        }
        resolve();
      }
    );
  });
}


/**
 * Close tabs
 */
async function closeTabsById(tabIds) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: MessageType.CLOSE_TABS,
        payload: { tabIds }
      },
      () => {
        resolve();
      }
    );
  });
}

/**
 * Handle stop AI - skip AI processing and show manual selection
 */
function handleStopAI() {
  console.log('[QEFY Cleanup] User stopped AI processing, switching to manual selection');
  
  // Set the flag to stop AI processing
  state.aiStopped = true;
  
  // Set all items to 'ready' status with 'recently_added' as default folder
  state.items.forEach((item, index) => {
    if (item.status === 'extracted' || item.status === 'processing') {
      item.suggestedFolder = 'recently_added';
      item.status = 'ready';
      updateItemInUI(index);
    }
  });
  
  // Update progress to show manual selection
  state.currentStep = 'ready';
  updateProgress(100, 'Manual selection ready!');
  
  // Hide stop AI button
  if (stopAI) {
    stopAI.style.display = 'none';
  }
  
  // Show action buttons
  updateActionInfo();
  if (actions) {
    actions.style.display = 'block';
  }
  
  console.log('[QEFY Cleanup] Manual selection mode activated - AI processing stopped');
}

/**
 * Handle cancel
 */
function handleCancel() {
  if (confirm('Are you sure you want to cancel? No videos will be saved.')) {
    window.close();
  }
}

/**
 * Update progress bar and text
 */
function updateProgress(percent, text) {
  if (progressFill) {
    progressFill.style.width = `${percent}%`;
  }
  if (progressText && text) {
    progressText.textContent = text;
  }
  
  // Show stop AI button during AI processing
  if (state.currentStep === 'processing' && stopAI) {
    stopAI.style.display = 'block';
  } else if (stopAI) {
    stopAI.style.display = 'none';
  }
}

/**
 * Render all items
 */
function renderItems() {
  if (!itemsContainer) return;

  itemsContainer.innerHTML = '';

  state.items.forEach((item, index) => {
    const itemEl = createItemElement(item, index);
    itemsContainer.appendChild(itemEl);
  });

  // Add event listeners to dropdowns
  const dropdowns = document.querySelectorAll('.folder-dropdown');
  dropdowns.forEach(dropdown => {
    dropdown.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const newFolder = e.target.value;
      if (state.items[index]) {
        state.items[index].suggestedFolder = newFolder;
        console.log(`[QEFY Cleanup] Folder changed for item ${index}: ${newFolder}`);
      }
    });
  });
}

/**
 * Update item in UI
 */
function updateItemInUI(index) {
  const item = state.items[index];
  const itemEl = itemsContainer?.querySelector(`[data-index="${index}"]`);
  
  if (!itemEl) return;

  // Update status attribute
  itemEl.setAttribute('data-status', item.status);

  // Update thumbnail
  const thumbnail = itemEl.querySelector('.item-thumbnail');
  if (thumbnail && item.thumbnail) {
    thumbnail.src = item.thumbnail;
    thumbnail.alt = item.title || 'Video thumbnail';
  }

  // Update title
  const title = itemEl.querySelector('.item-title');
  if (title) {
    title.textContent = item.title || item.url || 'Loading...';
  }

  // Update duration
  const duration = itemEl.querySelector('.item-duration');
  if (duration) {
    if (item.duration) {
      duration.textContent = formatDuration(item.duration);
      duration.style.display = 'inline-flex';
    } else {
      duration.style.display = 'none';
    }
  }

  // Update folder dropdown
  const folderSelection = itemEl.querySelector('.folder-selection');
  const folderDropdown = itemEl.querySelector('.folder-dropdown');
  
  if (folderSelection && folderDropdown) {
    if (item.suggestedFolder) {
      // Show the dropdown and set the value
      folderSelection.style.display = 'block';
      folderDropdown.value = item.suggestedFolder;
      
      // Regenerate options with the new suggested folder
      const currentValue = folderDropdown.value;
      folderDropdown.innerHTML = `
        <option value="${currentValue}" selected>${currentValue}</option>
        ${generateFolderOptions(currentValue)}
      `;
    } else {
      // Hide the dropdown if no folder suggested yet
      folderSelection.style.display = 'none';
    }
  }

  // Update status indicator
  const statusIndicator = itemEl.querySelector('.status-indicator');
  if (statusIndicator) {
    statusIndicator.innerHTML = getStatusIndicatorHTML(item.status);
  }
}

/**
 * Create item element
 */
function createItemElement(item, index) {
  const div = document.createElement('div');
  div.className = 'item';
  div.setAttribute('data-index', index);
  div.setAttribute('data-status', item.status);

  const thumbnailUrl = item.thumbnail || (item.videoId ? 
    `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg` : '');

  div.innerHTML = `
    <img class="item-thumbnail" src="${thumbnailUrl}" alt="${item.title || 'Video'}" />
    <div class="item-info">
      <h3 class="item-title">${item.title || item.url || 'Loading...'}</h3>
      <div class="item-metadata">
        <span class="item-duration" style="${item.duration ? '' : 'display:none;'}">${formatDuration(item.duration)}</span>
        <div class="folder-selection" style="${item.suggestedFolder ? '' : 'display:none;'}">
          <select class="folder-dropdown" data-index="${index}">
            <option value="${item.suggestedFolder || 'recently_added'}" selected>${item.suggestedFolder || 'Select folder...'}</option>
            ${generateFolderOptions(item.suggestedFolder)}
          </select>
        </div>
      </div>
      <div class="item-url">${truncateUrl(item.url)}</div>
    </div>
    <div class="status-indicator">
      ${getStatusIndicatorHTML(item.status)}
    </div>
  `;

  return div;
}

/**
 * Generate folder options for dropdown
 */
function generateFolderOptions(currentFolder) {
  console.log('[QEFY Cleanup] Generating folder options for:', currentFolder);
  console.log('[QEFY Cleanup] Compiled queue:', state.compiledQueue);
  
  if (!state.compiledQueue) {
    console.log('[QEFY Cleanup] No compiled queue available');
    return '<option value="recently_added">recently_added</option>';
  }

  const options = [];
  
  // Add recently_added as first option if not already selected
  if (currentFolder !== 'recently_added') {
    options.push('<option value="recently_added">recently_added</option>');
  }
  
  // Get folders from foldersOrdering (which contains the folder names)
  if (state.compiledQueue.foldersOrdering) {
    console.log('[QEFY Cleanup] Folders ordering:', state.compiledQueue.foldersOrdering);
    state.compiledQueue.foldersOrdering.forEach(folderName => {
      if (folderName && folderName !== 'done' && folderName !== 'trash' && folderName !== currentFolder) {
        options.push(`<option value="${folderName}">${folderName}</option>`);
      }
    });
  }
  
  // Also check if there are folders in the folders object
  if (state.compiledQueue.folders) {
    console.log('[QEFY Cleanup] Folders object:', state.compiledQueue.folders);
    state.compiledQueue.folders.forEach(folder => {
      if (folder.name && folder.name !== 'done' && folder.name !== 'trash' && folder.name !== currentFolder) {
        // Check if we already added this folder
        if (!options.some(opt => opt.includes(`value="${folder.name}"`))) {
          options.push(`<option value="${folder.name}">${folder.name}</option>`);
        }
      }
    });
  }
  
  console.log('[QEFY Cleanup] Generated options:', options);
  return options.join('');
}

/**
 * Get status indicator HTML
 */
function getStatusIndicatorHTML(status) {
  switch (status) {
    case 'pending':
    case 'extracting':
    case 'processing':
      return '<div class="status-spinner"></div>';
    case 'ready':
      return '<span class="status-icon success">✓</span>';
    case 'error':
      return '<span class="status-icon error">✕</span>';
    default:
      return '';
  }
}

/**
 * Format duration in seconds to readable string
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

/**
 * Truncate URL for display
 */
function truncateUrl(url) {
  if (!url) return '';
  if (url.length <= 60) return url;
  return url.substring(0, 60) + '...';
}

/**
 * Update action info
 */
function updateActionInfo() {
  const ready = state.items.filter(item => item.status === 'ready').length;
  const errors = state.items.filter(item => item.status === 'error').length;

  if (successCount) successCount.textContent = ready;
  if (errorCount) errorCount.textContent = errors;
}

/**
 * Show error message
 */
function showError(message) {
  if (itemsContainer) {
    itemsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <h3>Error</h3>
        <p>${message}</p>
      </div>
    `;
  }
}

/**
 * Show empty state
 */
function showEmptyState(title, message) {
  if (itemsContainer) {
    itemsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <h3>${title}</h3>
        <p>${message}</p>
      </div>
    `;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

