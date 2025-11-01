/**
 * Create Playlist Page
 * AI-powered custom playlist creator that analyzes queue videos and creates folders
 */

import { MessageType } from './messages.js';

// State management
const state = {
  compiledQueue: null,
  prompt: '',
  processing: false,
  suggestedFolderName: '',
  selectedVideos: [], // Array of full video items with metadata
  currentStep: 'input' // input, processing, results, creating, success
};

// DOM elements
let closeBtn, promptInput, generateBtn;
let inputSection, progressSection, resultsSection, syncStatus, successMessage;
let folderNameInput, videosList, videoCount, createFolderBtn, backBtn, closeSuccessBtn;
let progressText;

/**
 * Initialize the create playlist page
 */
async function init() {
  console.log('[QEFY Playlist] Initializing create playlist page');
  
  // Initialize theme mode
  initializeThemeMode();
  
  // Get DOM elements
  closeBtn = document.getElementById('closeBtn');
  promptInput = document.getElementById('promptInput');
  generateBtn = document.getElementById('generateBtn');
  inputSection = document.getElementById('inputSection');
  progressSection = document.getElementById('progressSection');
  progressText = progressSection.querySelector('.progress-text');
  resultsSection = document.getElementById('resultsSection');
  syncStatus = document.getElementById('syncStatus');
  successMessage = document.getElementById('successMessage');
  folderNameInput = document.getElementById('folderNameInput');
  videosList = document.getElementById('videosList');
  videoCount = document.getElementById('videoCount');
  createFolderBtn = document.getElementById('createFolderBtn');
  backBtn = document.getElementById('backBtn');
  closeSuccessBtn = document.getElementById('closeSuccessBtn');

  // Initialize i18n
  await initializeI18n();

  // Get compiled queue
  await loadCompiledQueue();

  // Add event listeners
  closeBtn?.addEventListener('click', () => window.close());
  closeSuccessBtn?.addEventListener('click', () => window.close());
  generateBtn?.addEventListener('click', handleGenerate);
  createFolderBtn?.addEventListener('click', handleCreateFolder);
  backBtn?.addEventListener('click', handleBack);
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
      console.warn('[QEFY Playlist] i18n initialization failed:', error);
    }
  }
}

/**
 * Load compiled queue from background
 */
async function loadCompiledQueue() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: MessageType.POPUP_GET_STATE },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[QEFY Playlist] Error loading queue:', chrome.runtime.lastError);
          resolve();
          return;
        }
        
        console.log('[QEFY Playlist] Received response:', response);
        
        if (response) {
          // Try different response structures
          if (response.compiledQueue) {
            state.compiledQueue = response.compiledQueue;
          } else if (response.latestCompiledQueue) {
            state.compiledQueue = response.latestCompiledQueue;
          } else if (response.queue) {
            state.compiledQueue = response.queue;
          }
          
          if (state.compiledQueue) {
            console.log('[QEFY Playlist] Loaded compiled queue:', state.compiledQueue);
          } else {
            console.warn('[QEFY Playlist] No queue found in response');
          }
        } else {
          console.error('[QEFY Playlist] Empty response from background');
        }
        resolve();
      }
    );
  });
}

/**
 * Handle generate playlist
 */
async function handleGenerate() {
  const prompt = promptInput.value.trim();
  
  if (!prompt) {
    alert(chrome.i18n.getMessage('pleaseEnterPlaylistIdea'));
    return;
  }

  if (!state.compiledQueue) {
    console.warn('[QEFY Playlist] Queue not loaded, attempting to reload...');
    await loadCompiledQueue();
    
    if (!state.compiledQueue) {
      alert(chrome.i18n.getMessage('queueNotLoaded'));
      return;
    }
  }

  state.prompt = prompt;
  state.processing = true;
  state.currentStep = 'processing';
  state.selectedVideos = []; // Clear previous results
  state.suggestedFolderName = ''; // Clear previous folder name

  // Show progress and disable button
  inputSection.style.display = 'none';
  progressSection.style.display = 'block';
  generateBtn.disabled = true;
  
  // Update progress text
  if (progressText) {
    progressText.textContent = 'Analyzing your videos with AI...';
  }

  try {
    // Get active folder videos (exclude done, trash)
    const videos = getActiveFolderVideos();
    console.log('[QEFY Playlist] Found', videos.length, 'videos to analyze');

    if (videos.length === 0) {
      throw new Error('No videos found in your queue');
    }

    // Show batch info if needed
    if (videos.length > 40) {
      const batchCount = Math.ceil(videos.length / 40);
      console.log(`[QEFY Playlist] Will process ${videos.length} videos in ${batchCount} batches`);
    }

    // Analyze with AI
    const result = await analyzeWithAI(prompt, videos);
    
    if (!result || !result.videos || result.videos.length === 0) {
      throw new Error('AI could not find matching videos. Try a different prompt.');
    }

    // Update state - only update if not already populated by incremental results
    if (!state.suggestedFolderName) {
      state.suggestedFolderName = result.folderName || 'Custom Playlist';
    }
    if (state.selectedVideos.length === 0) {
      state.selectedVideos = result.videos;
    }
    state.currentStep = 'results';

    // Show results
    renderResults();

  } catch (error) {
    console.error('[QEFY Playlist] Error generating playlist:', error);
    alert(error.message || 'Failed to generate playlist. Please try again.');
    
    // Reset to input
    progressSection.style.display = 'none';
    inputSection.style.display = 'block';
    generateBtn.disabled = false;
    state.processing = false;
  }
}

/**
 * Get videos from active folders (exclude done, trash)
 */
function getActiveFolderVideos() {
  if (!state.compiledQueue || !state.compiledQueue.queue) {
    console.warn('[QEFY Playlist] No queue object found in compiledQueue');
    return [];
  }

  const videos = [];
  const queue = state.compiledQueue.queue;

  // Iterate through each folder in the queue
  for (const [folderName, items] of Object.entries(queue)) {
    // Skip done and trash folders
    if (folderName === 'done' || folderName === 'trash') {
      continue;
    }

    // Check if items is an array
    if (!Array.isArray(items)) {
      console.warn('[QEFY Playlist] Items is not an array for folder:', folderName);
      continue;
    }

    // Process each item in the folder
    items.forEach((item, index) => {
      // Use 'url' property instead of 'link'
      const videoUrl = item.url || item.link;
      
      if (videoUrl) {
        videos.push({
          url: videoUrl,
          title: item.metadata?.title || 'Untitled',
          description: item.metadata?.description || '',
          duration: item.metadata?.duration || '0',
          thumbnail: item.metadata?.thumb || '',
          channelName: item.metadata?.channelName || '',
          folder: folderName
        });
      } else {
        console.warn('[QEFY Playlist] Item has no url:', item);
      }
    });
  }

  console.log('[QEFY Playlist] Extracted videos from queue:', videos.length);
  console.log('[QEFY Playlist] Sample videos:', videos.slice(0, 3));
  return videos;
}

/**
 * Analyze videos with AI using dedicated playlist creator service
 */
async function analyzeWithAI(prompt, videos) {
  console.log('[QEFY Playlist] Analyzing', videos.length, 'videos with AI');
  console.log('[QEFY Playlist] User prompt:', prompt);

  try {
    // Load dedicated AI Playlist Creator Service
    const aiPlaylistService = new window.AIPlaylistCreatorService();
    await aiPlaylistService.checkAvailability();
    
    if (!aiPlaylistService.isAvailable) {
      console.warn('[QEFY Playlist] AI Playlist Creator not available, using fallback');
      return useFallbackPlaylistCreation(prompt, videos);
    }
    
    console.log('[QEFY Playlist] ✨ Using AI Playlist Creator Service...');
    
    // Calculate expected batches
    const batchSize = 10;
    const expectedBatches = Math.ceil(videos.length / batchSize);
    console.log(`[QEFY Playlist] Expecting ${expectedBatches} batches`);
    
    // Show initial thinking message
    showThinkingMessage();
    
    // Call the dedicated AI Playlist Creator with incremental callback
    const aiResult = await aiPlaylistService.createPlaylist(prompt, videos, (batchNum, totalBatches, newVideos, folderName) => {
      console.log(`[QEFY Playlist] 📦 Batch ${batchNum}/${totalBatches} complete with ${newVideos.length} videos`);
      
      // Set folder name from first batch
      if (!state.suggestedFolderName && folderName) {
        state.suggestedFolderName = folderName;
      }
      
      // Add new videos to state
      state.selectedVideos.push(...newVideos);
      
      // Show results section if not already visible
      if (resultsSection.style.display === 'none') {
        progressSection.style.display = 'none';
        resultsSection.style.display = 'block';
        folderNameInput.value = state.suggestedFolderName;
      }
      
      // Update video count and render
      videoCount.textContent = state.selectedVideos.length;
      renderVideosList();
      
      // Update thinking message
      updateThinkingMessage(batchNum, totalBatches);
    });
    
    if (aiResult && aiResult.videos && aiResult.videos.length > 0) {
      console.log('[QEFY Playlist] ✅ AI successfully created playlist:', {
        folderName: aiResult.folderName,
        videoCount: aiResult.videos.length,
        reasoning: aiResult.reasoning
      });
      
      return {
        folderName: aiResult.folderName,
        videos: aiResult.videos
      };
    }
    
    // If AI failed, use fallback
    console.warn('[QEFY Playlist] AI did not return valid result, using fallback');
    return useFallbackPlaylistCreation(prompt, videos);
    
  } catch (error) {
    console.error('[QEFY Playlist] AI analysis failed:', error);
    return useFallbackPlaylistCreation(prompt, videos);
  }
}

/**
 * Fallback playlist creation using intelligent keyword matching
 */
function useFallbackPlaylistCreation(prompt, videos) {
  console.log('[QEFY Playlist] 🔄 Using intelligent fallback playlist creation...');
  
  const promptLower = prompt.toLowerCase();
  const keywords = promptLower.split(' ').filter(word => word.length > 3);
  
  // Extract duration requirements from prompt
  const durationMatch = promptLower.match(/(\d+)[\s-]*(minute|min|hour|hr)/);
  const maxDuration = durationMatch ? parseInt(durationMatch[1]) * (durationMatch[2].includes('hour') ? 3600 : 60) : null;
  
  console.log('[QEFY Playlist] Extracted keywords:', keywords);
  console.log('[QEFY Playlist] Duration filter:', maxDuration ? `${maxDuration}s max` : 'none');
  
  const matchingVideos = videos.filter(video => {
    const titleLower = video.title.toLowerCase();
    const descLower = (video.description || '').toLowerCase();
    const channelLower = (video.channelName || '').toLowerCase();
    
    // Check keyword matches
    const keywordMatch = keywords.some(keyword => 
      titleLower.includes(keyword) || 
      descLower.includes(keyword) ||
      channelLower.includes(keyword)
    );
    
    // Check duration filter
    const durationMatch = !maxDuration || parseInt(video.duration) <= maxDuration;
    
    // Check for specific content types
    const contentMatch = checkContentType(promptLower, video);
    
    return (keywordMatch || contentMatch) && durationMatch;
  });
  
  // Sort by relevance (keyword matches first, then by duration)
  matchingVideos.sort((a, b) => {
    const aScore = getRelevanceScore(promptLower, a);
    const bScore = getRelevanceScore(promptLower, b);
    return bScore - aScore;
  });
  
  // If no matches, return first few videos
  const selectedVideos = matchingVideos.length > 0 ? matchingVideos.slice(0, 10) : videos.slice(0, 5);
  
  // Generate folder name based on prompt
  const folderName = generateFolderName(prompt);
  
  console.log('[QEFY Playlist] Enhanced matching found', matchingVideos.length, 'potential videos');
  console.log('[QEFY Playlist] Selected', selectedVideos.length, 'videos for folder:', folderName);
  console.log('[QEFY Playlist] Selected videos:', selectedVideos.map(v => ({ 
    title: v.title, 
    duration: `${Math.round(parseInt(v.duration)/60)}min`,
    score: getRelevanceScore(promptLower, v)
  })));
  
  return {
    folderName: folderName,
    videos: selectedVideos
  };
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
 * Generate folder name from prompt
 */
function generateFolderName(prompt) {
  // Extract key words from prompt
  const words = prompt.toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .split(' ')
    .filter(word => word.length > 3) // Only meaningful words
    .slice(0, 3); // Take first 3 words
  
  if (words.length === 0) {
    return 'Custom Playlist';
  }
  
  // Capitalize first letter of each word
  const capitalized = words.map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  );
  
  return capitalized.join(' ');
}

/**
 * Check if video matches specific content types
 */
function checkContentType(prompt, video) {
  const titleLower = video.title.toLowerCase();
  const descLower = (video.description || '').toLowerCase();
  
  // Check for content type keywords
  if (prompt.includes('trivia') || prompt.includes('quiz')) {
    return titleLower.includes('trivia') || titleLower.includes('quiz') || 
           descLower.includes('trivia') || descLower.includes('quiz');
  }
  
  if (prompt.includes('podcast') || prompt.includes('interview')) {
    return titleLower.includes('podcast') || titleLower.includes('interview') ||
           descLower.includes('podcast') || descLower.includes('interview');
  }
  
  if (prompt.includes('tutorial') || prompt.includes('learn')) {
    return titleLower.includes('tutorial') || titleLower.includes('learn') ||
           titleLower.includes('how to') || descLower.includes('tutorial');
  }
  
  if (prompt.includes('tech') || prompt.includes('programming')) {
    return titleLower.includes('tech') || titleLower.includes('programming') ||
           titleLower.includes('code') || descLower.includes('programming');
  }
  
  if (prompt.includes('short') || prompt.includes('quick')) {
    return parseInt(video.duration) < 600; // Less than 10 minutes
  }
  
  return false;
}

/**
 * Calculate relevance score for video
 */
function getRelevanceScore(prompt, video) {
  let score = 0;
  const titleLower = video.title.toLowerCase();
  const descLower = (video.description || '').toLowerCase();
  const channelLower = (video.channelName || '').toLowerCase();
  
  const keywords = prompt.split(' ').filter(word => word.length > 3);
  
  // Title matches are worth more
  keywords.forEach(keyword => {
    if (titleLower.includes(keyword)) score += 3;
    if (descLower.includes(keyword)) score += 2;
    if (channelLower.includes(keyword)) score += 1;
  });
  
  // Bonus for content type matches
  if (checkContentType(prompt, video)) score += 5;
  
  // Bonus for shorter videos if user wants quick content
  if (prompt.includes('quick') || prompt.includes('short')) {
    const duration = parseInt(video.duration);
    if (duration < 300) score += 3; // Less than 5 minutes
    else if (duration < 600) score += 1; // Less than 10 minutes
  }
  
  return score;
}

/**
 * Render results
 */
function renderResults() {
  // Hide progress
  progressSection.style.display = 'none';
  
  // Show results
  resultsSection.style.display = 'block';
  
  // Set folder name
  folderNameInput.value = state.suggestedFolderName;
  
  // Update video count
  videoCount.textContent = state.selectedVideos.length;
  
  // Render videos
  renderVideosList();
  
  // Re-enable generate button
  state.processing = false;
  generateBtn.disabled = false;
}

/**
 * Show thinking message for pending batches
 */
function showThinkingMessage() {
  if (!videosList) return;
  
  videosList.innerHTML = '';
  
  // Show "AI is thinking" message
  const thinkingMessage = document.createElement('div');
  thinkingMessage.className = 'ai-thinking-message';
  thinkingMessage.innerHTML = `
    <div class="thinking-icon">🤔</div>
    <p class="thinking-text">AI is analyzing your videos...</p>
  `;
  videosList.appendChild(thinkingMessage);
}

/**
 * Update thinking message as batches complete
 */
function updateThinkingMessage(completedBatches, totalBatches) {
  const remaining = totalBatches - completedBatches;
  
  if (remaining === 0) {
    // Remove thinking message when all batches complete
    const thinkingMessage = videosList.querySelector('.ai-thinking-message');
    if (thinkingMessage) thinkingMessage.remove();
  } else {
    // Update thinking message
    const thinkingMessage = videosList.querySelector('.ai-thinking-message');
    if (thinkingMessage) {
      const thinkingText = thinkingMessage.querySelector('.thinking-text');
      if (thinkingText) {
        thinkingText.textContent = `AI is thinking... (${remaining} batches remaining)`;
      }
    }
  }
}

/**
 * Render videos list
 */
function renderVideosList() {
  // Don't clear the list, just append/update
  // Remove old video items (not thinking message)
  const oldVideos = videosList.querySelectorAll('.video-item:not(.ai-thinking-message)');
  oldVideos.forEach(item => item.remove());
  
  if (state.selectedVideos.length === 0 && !videosList.querySelector('.ai-thinking-message')) {
    videosList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p class="empty-state-text" data-i18n="noVideosSelected">No videos selected. Please try a different prompt.</p>
      </div>
    `;
    return;
  }
  
  // Insert videos before thinking message
  const thinkingMessage = videosList.querySelector('.ai-thinking-message');
  const insertBefore = thinkingMessage || videosList.firstChild;
  
  state.selectedVideos.forEach((video, index) => {
    const videoItem = document.createElement('div');
    videoItem.className = 'video-item';
    videoItem.innerHTML = `
      <img class="video-thumbnail" src="${video.thumbnail || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'90\'%3E%3Crect fill=\'%23ddd\'/%3E%3C/svg%3E'}" alt="${video.title}" />
      <div class="video-info">
        <h3 class="video-title">${video.title}</h3>
        <div class="video-meta">
          <span class="video-duration">${formatDuration(video.duration)}</span>
          ${video.channelName ? `<span class="video-channel">${video.channelName}</span>` : ''}
        </div>
        ${video.aiReason ? `<div class="video-ai-reason">
          <span class="ai-reason-label">✨ AI: </span>
          <span class="ai-reason-text">${escapeHtml(video.aiReason)}</span>
        </div>` : ''}
      </div>
      <button class="remove-btn" data-index="${index}" data-i18n="removeVideo">Remove</button>
    `;
    
    // Add remove button listener
    const removeBtn = videoItem.querySelector('.remove-btn');
    removeBtn.addEventListener('click', () => handleRemoveVideo(index));
    
    // Insert before thinking message/skeletons
    if (insertBefore) {
      videosList.insertBefore(videoItem, insertBefore);
    } else {
      videosList.appendChild(videoItem);
    }
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format duration in seconds to readable string
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  
  const duration = parseInt(seconds);
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const secs = duration % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Handle remove video
 */
function handleRemoveVideo(index) {
  console.log('[QEFY Playlist] Removing video at index:', index);
  state.selectedVideos.splice(index, 1);
  videoCount.textContent = state.selectedVideos.length;
  renderVideosList();
}

/**
 * Handle back
 */
function handleBack() {
  resultsSection.style.display = 'none';
  inputSection.style.display = 'block';
  generateBtn.disabled = false;
  state.currentStep = 'input';
}

/**
 * Handle create folder
 */
async function handleCreateFolder() {
  const folderName = folderNameInput.value.trim();
  
  if (!folderName) {
    alert(chrome.i18n.getMessage('pleaseEnterFolderName'));
    return;
  }
  
  if (state.selectedVideos.length === 0) {
    alert(chrome.i18n.getMessage('noVideosSelectedError'));
    return;
  }
  
  state.currentStep = 'creating';
  
  // Hide results, show sync status
  resultsSection.style.display = 'none';
  syncStatus.style.display = 'block';
  
  try {
    console.log('[QEFY Playlist] Creating folder:', folderName);
    
    // Step 1: Create folder (FADD action)
    await sendFolderAction(folderName);
    console.log('[QEFY Playlist] Folder created');
    
    // Step 2: Add videos to folder
    console.log('[QEFY Playlist] Adding', state.selectedVideos.length, 'videos to folder');
    for (let i = 0; i < state.selectedVideos.length; i++) {
      const video = state.selectedVideos[i];
      await sendAddAction(folderName, video);
      console.log('[QEFY Playlist] Added video', i + 1, 'of', state.selectedVideos.length);
      
      // Small delay between actions
      if (i < state.selectedVideos.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Step 3: Trigger sync
    console.log('[QEFY Playlist] Triggering sync...');
    await triggerSync();
    
    // Step 4: Wait for sync
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Show success
    syncStatus.style.display = 'none';
    successMessage.style.display = 'block';
    state.currentStep = 'success';
    
    console.log('[QEFY Playlist] ✅ Playlist created successfully!');
    
  } catch (error) {
    console.error('[QEFY Playlist] Error creating playlist:', error);
    alert(chrome.i18n.getMessage('failedToCreatePlaylist') + ': ' + error.message);
    
    // Reset to results
    syncStatus.style.display = 'none';
    resultsSection.style.display = 'block';
    state.currentStep = 'results';
  }
}

/**
 * Send folder action (FADD)
 */
async function sendFolderAction(folderName) {
  return new Promise((resolve, reject) => {
    const action = {
      type: 'add_folder',
      path: folderName,
      source: 'chrome_extension_playlist'
    };
    
    chrome.runtime.sendMessage(
      {
        type: MessageType.SEND_ACTION_TO_CORE,
        payload: { actionJson: JSON.stringify(action) }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.ok) {
          resolve();
        } else {
          reject(new Error('Failed to create folder'));
        }
      }
    );
  });
}

/**
 * Send add action for video
 */
async function sendAddAction(folderName, video) {
  return new Promise((resolve, reject) => {
    const action = {
      type: 'add',
      path: folderName,
      link: video.url,
      metadata: {
        title: video.title,
        description: video.description,
        duration: String(video.duration),
        thumb: video.thumbnail
      },
      source: 'chrome_extension_playlist'
    };
    
    chrome.runtime.sendMessage(
      {
        type: MessageType.SEND_ACTION_TO_CORE,
        payload: { actionJson: JSON.stringify(action) }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.ok) {
          resolve();
        } else {
          reject(new Error('Failed to add video'));
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
          console.error('[QEFY Playlist] Sync error:', chrome.runtime.lastError);
        } else {
          console.log('[QEFY Playlist] Sync response:', response);
        }
        resolve();
      }
    );
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

