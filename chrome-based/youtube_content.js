// QEFY YouTube Content Script
// Adds shortcut icons to YouTube videos for quick queue management

(function () {
  const SPLIT_CLASS = "qefy-shortcut-icon";
  const DEFAULT_FOLDER = "recently_added";

  let urlSet = new Set();
  let folders = ["recently_added", "done", "trash"]; // updated by background
  let authState = { status: 'signed_out' };

  function isSignedIn() {
    return (authState && authState.status) === 'signed_in';
  }

  // Debouncing for folder menu to prevent multiple calls
  let folderMenuTimeout = null;
  let isShowingFolderMenu = false;
  
  // AI Processing State Manager
  const aiProcessingState = {
    activeProcesses: new Map(), // videoUrl -> { startTime, metadata, notificationShown }
    
    startProcessing(videoUrl, metadata) {
      this.activeProcesses.set(videoUrl, {
        startTime: Date.now(),
        metadata: metadata,
        notificationShown: false
      });
      console.log('[QEFY YouTube] 🚀 AI processing started for:', videoUrl);
    },
    
    markNotificationShown(videoUrl) {
      const process = this.activeProcesses.get(videoUrl);
      if (process) {
        process.notificationShown = true;
        this.activeProcesses.set(videoUrl, process);
      }
    },
    
    completeProcessing(videoUrl, result) {
      const process = this.activeProcesses.get(videoUrl);
      if (process) {
        console.log('[QEFY YouTube] ✅ AI processing completed for:', videoUrl, 'result:', result, 'duration:', Date.now() - process.startTime + 'ms');
        console.log('[QEFY YouTube] 📊 Active processes before completion:', this.activeProcesses.size);
        
        // Update the button state to show success (check mark)
        const splitEl = document.querySelector(`[data-video-url="${videoUrl}"]`);
        if (splitEl) {
          setSplitState(splitEl, true, 'success'); // Show check mark
          setTimeout(() => splitEl.classList.remove('success'), 800);
        }
        
        // Notify the floating notification system
        if (process.notificationShown && window.qefyAINotificationManager && window.qefyAINotificationManager.processingItems.has(videoUrl)) {
          setTimeout(() => {
            window.qefyAINotificationManager.completeVideo(videoUrl, result || 'recently_added', []);
            console.log('[QEFY YouTube] 🎯 Notification completed for:', videoUrl);
          }, 500);
        }
        
        this.activeProcesses.delete(videoUrl);
        console.log('[QEFY YouTube] 📊 Active processes after completion:', this.activeProcesses.size);
        return true;
      }
      console.warn('[QEFY YouTube] ⚠️ Tried to complete processing for unknown video:', videoUrl);
      return false;
    },
    
    failProcessing(videoUrl, error) {
      const process = this.activeProcesses.get(videoUrl);
      if (process) {
        console.log('[QEFY YouTube] ❌ AI processing failed for:', videoUrl, 'error:', error, 'duration:', Date.now() - process.startTime + 'ms');
        console.log('[QEFY YouTube] 📊 Active processes before failure:', this.activeProcesses.size);
        
        // Update the button state to show error, then reset to plus
        const splitEl = document.querySelector(`[data-video-url="${videoUrl}"]`);
        if (splitEl) {
          setSplitState(splitEl, false, 'error'); // Show error state
          setTimeout(() => {
            splitEl.classList.remove('error');
            setSplitState(splitEl, false, ''); // Reset to plus button
          }, 1200);
        }
        
        // Notify the floating notification system
        if (process.notificationShown && window.qefyAINotificationManager && window.qefyAINotificationManager.processingItems.has(videoUrl)) {
          window.qefyAINotificationManager.removeVideo(videoUrl);
          console.log('[QEFY YouTube] 🗑️ Notification removed for failed processing:', videoUrl);
        }
        
        this.activeProcesses.delete(videoUrl);
        console.log('[QEFY YouTube] 📊 Active processes after failure:', this.activeProcesses.size);
        return true;
      }
      console.warn('[QEFY YouTube] ⚠️ Tried to fail processing for unknown video:', videoUrl);
      return false;
    },
    
    isProcessing(videoUrl) {
      return this.activeProcesses.has(videoUrl);
    },
    
    getAllProcessing() {
      return Array.from(this.activeProcesses.keys());
    }
  };

  // Initialize AI folder suggestion service
  let aiFolderSuggestionService = null;
  if (typeof AIFolderSuggestionService !== 'undefined') {
    aiFolderSuggestionService = new AIFolderSuggestionService();
    window.aiFolderSuggestionService = aiFolderSuggestionService;
    console.log('[QEFY YouTube] AI folder suggestion service initialized');
    
    // Make AI service globally accessible for debugging
    window.qefyAI = {
      service: aiFolderSuggestionService,
      state: aiProcessingState,
      test: () => aiFolderSuggestionService.testAIService(),
      download: () => aiFolderSuggestionService.forceModelDownload(),
      check: () => aiFolderSuggestionService.recheckAvailability(),
      suggest: (title, folders) => aiFolderSuggestionService.suggestFolder(title, folders),
      // Test with sample data
      testSuggestion: async () => {
        const sampleFolders = [
          {name: "programming", items: []},
          {name: "music", items: []},
          {name: "cooking", items: []}
        ];
        return await aiFolderSuggestionService.suggestFolder("Learn JavaScript Programming", sampleFolders);
      },
      // Debug methods
      getActiveProcesses: () => aiProcessingState.getAllProcessing(),
      simulateComplete: (url, folder) => aiProcessingState.completeProcessing(url, folder),
      simulateError: (url, error) => aiProcessingState.failProcessing(url, error || 'Test error')
    };
    
    // Test AI service and trigger download if needed
    setTimeout(async () => {
      if (aiFolderSuggestionService.isAIAvailable()) {
        const testResult = await aiFolderSuggestionService.testAIService();
        console.log('[QEFY YouTube] AI service test result:', testResult);
      } else {
        // Try to force download if model is downloadable
        console.log('[QEFY YouTube] Attempting to download AI model...');
        const downloadResult = await aiFolderSuggestionService.forceModelDownload();
        console.log('[QEFY YouTube] AI model download result:', downloadResult);
      }
    }, 1000);
  } else {
    console.log('[QEFY YouTube] AI folder suggestion service not available');
  }

  function absoluteYoutubeUrl(href) {
    if (!href) return null;
    if (href.startsWith("http")) return href;
    if (href.startsWith("/")) return `https://www.youtube.com${href}`;
    return `https://www.youtube.com/${href}`;
  }

  // Extract a canonical YouTube video id from many URL shapes
  function extractVideoIdFromUrl(url) {
    try {
      const u = new URL(url);
      // youtu.be/<id>
      if (u.hostname.endsWith('youtu.be')) {
        const p = (u.pathname || '').replace(/^\//, '');
        return p || null;
      }
      // watch?v=<id>
      if (u.pathname === '/watch') {
        const v = u.searchParams.get('v');
        return v || null;
      }
      // shorts/<id>
      if (u.pathname.startsWith('/shorts/')) {
        const parts = u.pathname.split('/');
        return parts[2] || parts[1] || null;
      }
      // embed/<id>
      if (u.pathname.startsWith('/embed/')) {
        const parts = u.pathname.split('/');
        return parts[2] || null;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function canonicalWatchUrlFromId(videoId) {
    if (!videoId) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
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

  async function findVideoItemInQueue(url) {
    try {
      // Get the latest compiled queue from background
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, resolve);
      });

      if (!response?.latestCompiledQueue) {
        console.warn('[QEFY YouTube] No compiled queue available');
        return null;
      }

      const queue = response.latestCompiledQueue.queue || response.latestCompiledQueue || {};
      const targetId = canonicalYouTubeId(url);
      
      for (const folder of Object.keys(queue)) {
        const list = queue[folder] || [];
        for (const item of list) {
          if (!item || !item.url) continue;
          
          // Direct URL match
          if (item.url === url || item.link === url) {
            return { item, folder };
          }
          
          // Video ID match
          if (targetId) {
            const itemId = canonicalYouTubeId(item.url || item.link);
            if (itemId && itemId === targetId) {
              return { item, folder };
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('[QEFY YouTube] Error finding video item in queue:', error);
      return null;
    }
  }

  function getVideoUrlFromContainer(container) {
    const anchor = container.querySelector(
      [
        'a#thumbnail',
        'a.ytd-thumbnail',
        'a.yt-lockup-view-model-wiz__content-image',
        'a[href^="/watch"]',
        'a[href^="https://www.youtube.com/watch"]'
      ].join(',')
    );
    if (anchor) {
      const href = anchor.getAttribute("href") || anchor.href;
      const abs = absoluteYoutubeUrl(href);
      const vid = abs ? extractVideoIdFromUrl(abs) : null;
      const canon = canonicalWatchUrlFromId(vid);
      if (canon) return canon;
    }
    return null;
  }

  // Extract best-effort metadata: thumb, duration seconds, title
  function extractMetadata(container) {
    try {
      // Thumbnail image
      const img = container.querySelector('img[src*="i.ytimg.com/vi/"] , img[src*="i.ytimg.com/vi_webp/"]');
      let thumb = null;
      if (img?.src) {
        try {
          const u = new URL(img.src);
          thumb = `${u.origin}${u.pathname}`; // strip query params
        } catch (_) {
          thumb = img.src.split('?')[0];
        }
        // Normalize webp path to jpg when possible
        if (thumb.includes('/vi_webp/')) thumb = thumb.replace('/vi_webp/', '/vi/');
        thumb = thumb.replace(/\.webp$/i, '.jpg');
      }

      // Duration text like 19:18 or 1:02:03 - try multiple selectors
        let duration = null;
        const durationSelectors = [
          // Target the specific nested structure you found
          'yt-thumbnail-overlay-badge-view-model .yt-badge-shape__text',
          'yt-thumbnail-overlay-badge-view-model div.yt-badge-shape__text',
          '.yt-badge-shape__text',
          // Modern YouTube selectors
          '.badge-shape-wiz__text',
          'yt-thumbnail-overlay-badge-view-model .badge-shape-wiz__text',
          '.ytd-thumbnail-overlay-time-status-renderer',
          '[aria-label*=":"]',
          '.ytd-thumbnail-overlay-time-status-renderer span',
          'ytd-thumbnail-overlay-time-status-renderer',
          '.ytd-thumbnail-overlay-time-status-renderer span',
          'span[aria-label*=":"]',
          'div[aria-label*=":"]'
        ];
      
        for (const selector of durationSelectors) {
          const durBadge = container.querySelector(selector) || 
                           container.closest('ytd-video-renderer')?.querySelector(selector) ||
                           container.closest('ytd-grid-video-renderer')?.querySelector(selector) ||
                           container.closest('ytd-compact-video-renderer')?.querySelector(selector);
          
          console.log('[QEFY YouTube] Trying duration selector:', selector, 'Found element:', durBadge);
          
          if (durBadge) {
          const txt = (durBadge.textContent || durBadge.getAttribute('aria-label') || '').trim();
          console.log('[QEFY YouTube] Duration text found:', txt, 'from selector:', selector);
          // Look for duration patterns like "15:30", "1:02:03", "2:45", etc.
          const durationMatch = txt.match(/(\d+):(\d+)(?::(\d+))?/);
          if (durationMatch) {
            console.log('[QEFY YouTube] Duration match found:', durationMatch);
            const parts = durationMatch.slice(1).filter(p => p !== undefined).map(p => parseInt(p, 10));
        if (parts.every((n) => Number.isFinite(n))) {
          if (parts.length === 3) duration = (parts[0] * 3600 + parts[1] * 60 + parts[2]).toString();
          if (parts.length === 2) duration = (parts[0] * 60 + parts[1]).toString();
          if (parts.length === 1) duration = parts[0].toString();
              console.log('[QEFY YouTube] Duration extracted:', duration);
              break;
            }
          }
        }
      }

      // Title - try multiple selectors for better compatibility
      let title = null;
      const titleSelectors = [
        // Modern YouTube selectors
        'a#video-title',
        'a#video-title-link', 
        '#video-title',
        'h3 a',
        'h3 span',
        // Legacy selectors
        '.yt-lockup-metadata-view-model-wiz__title',
        'a.yt-lockup-metadata-view-model-wiz__title',
        // Generic selectors
        '[aria-label]',
        'a[title]'
      ];
      
      // Try to find title in the container or its parents
      let titleElement = null;
      for (const selector of titleSelectors) {
        titleElement = container.querySelector(selector) || 
                      container.closest('ytd-video-renderer')?.querySelector(selector) ||
                      container.closest('ytd-grid-video-renderer')?.querySelector(selector) ||
                      container.closest('ytd-compact-video-renderer')?.querySelector(selector);
        if (titleElement) break;
      }
      
      if (titleElement) {
        title = titleElement.textContent?.trim() || 
                titleElement.getAttribute('title')?.trim() || 
                titleElement.getAttribute('aria-label')?.trim() || 
                null;
      }
      
      // Debug title extraction
      if (!title) {
        console.log('[QEFY YouTube] Title extraction failed. Container:', container);
        console.log('[QEFY YouTube] Available elements:', {
          videoTitle: container.querySelector('#video-title'),
          h3a: container.querySelector('h3 a'),
          h3span: container.querySelector('h3 span'),
          ariaLabel: container.querySelector('[aria-label]'),
          titleAttr: container.querySelector('[title]')
        });
        
        // Fallback: try to get title from video URL
        const videoUrl = getVideoUrlFromContainer(container);
        if (videoUrl) {
          console.log('[QEFY YouTube] Attempting to get title from video URL:', videoUrl);
          // For now, we'll use a generic title based on the video ID
          const videoId = extractVideoIdFromUrl(videoUrl);
          if (videoId) {
            title = `YouTube Video ${videoId}`;
            console.log('[QEFY YouTube] Using fallback title:', title);
          }
        }
      }

      // Channel name - try multiple selectors
      let channelName = null;
      const channelSelectors = [
        'a#channel-name',
        '#channel-name',
        'ytd-channel-name a',
        'ytd-channel-name',
        '.ytd-channel-name a',
        '.ytd-channel-name',
        'a[href*="/channel/"]',
        'a[href*="/@"]',
        '.ytd-video-meta-block a',
        '.ytd-video-meta-block'
      ];
      
      for (const selector of channelSelectors) {
        const channelElement = container.querySelector(selector) || 
                              container.closest('ytd-video-renderer')?.querySelector(selector) ||
                              container.closest('ytd-grid-video-renderer')?.querySelector(selector) ||
                              container.closest('ytd-compact-video-renderer')?.querySelector(selector);
        
        if (channelElement) {
          channelName = channelElement.textContent?.trim() || 
                       channelElement.getAttribute('title')?.trim() || 
                       channelElement.getAttribute('aria-label')?.trim() || 
                       null;
          if (channelName) break;
        }
      }

      const metadata = {};
      if (thumb) metadata.thumb = thumb;
      if (duration) metadata.duration = duration;
      if (title) metadata.title = title;
      if (channelName) metadata.channelName = channelName;
      
      console.log('[QEFY YouTube] Extracted metadata:', {
        title: metadata.title,
        duration: metadata.duration,
        channelName: metadata.channelName,
        thumb: metadata.thumb ? 'present' : 'missing'
      });
      
      return Object.keys(metadata).length ? metadata : null;
    } catch (_) {
      return null;
    }
  }

  function ensureRelativePosition(el) {
    const style = window.getComputedStyle(el);
    if (style.position === "static") {
      el.style.position = "relative";
    }
  }

  function currentVariant(el){
    if (el.classList.contains('success')) return 'success';
    if (el.classList.contains('error')) return 'error';
    return '';
  }

  function setSplitState(splitEl, isAdded, variant, isProcessing = false) {
    const add = splitEl.querySelector('.qefy-add');
    let desiredText = isAdded ? '✓' : '+';
    
    // Show spinner if AI is processing
    if (isProcessing) {
      desiredText = '⏳';
    }
    
    const url = splitEl.getAttribute('data-video-url');
    
    // Check if AI is currently processing this video and we're trying to reset it
    const aiIsProcessing = aiProcessingState.isProcessing(url);
    if (aiIsProcessing && !isProcessing && add?.textContent === '⏳') {
      console.warn('[QEFY YouTube] ⚠️ Attempt to reset spinner while AI is processing! Ignoring.', {
        url,
        aiIsProcessing,
        isProcessing,
        currentText: add?.textContent,
        callStack: new Error().stack
      });
      return; // Don't change the state if AI is processing
    }
    
    console.log('[QEFY YouTube] 🎯 setSplitState called for:', url, {
      isAdded,
      variant,
      isProcessing,
      desiredText,
      currentText: add?.textContent,
      aiIsProcessing
    });
    
    const prevVariant = currentVariant(splitEl);

    // Idempotent text/variant updates
    if (add && add.textContent !== desiredText) {
      console.log('[QEFY YouTube] 📝 Updating button text from', add.textContent, 'to', desiredText);
      add.textContent = desiredText;
    }
    if (prevVariant && prevVariant !== variant) splitEl.classList.remove(prevVariant);
    if (variant && prevVariant !== variant) splitEl.classList.add(variant);
    
    // Update background color based on state
    if (isAdded) {
      splitEl.style.background = '#4CAF50'; // Green for added (check mark)
      splitEl.style.color = 'white';
    } else if (isProcessing) {
      splitEl.style.background = '#FF9800'; // Orange for processing
      splitEl.style.color = 'white';
      console.log('[QEFY YouTube] 🟠 Set processing background for:', url);
    } else {
      splitEl.style.background = 'rgba(255, 255, 255, 0.9)'; // White for plus button
      splitEl.style.color = '#333';
      splitEl.style.border = '2px solid #ddd';
    }
    
    // Update classes for expanded state management
    if (isAdded) {
      splitEl.classList.add('qefy-in-queue');
      splitEl.classList.remove('qefy-not-in-queue', 'qefy-expanded');
    } else {
      splitEl.classList.add('qefy-not-in-queue');
      splitEl.classList.remove('qefy-in-queue');
    }

    // Ensure guest indicator is in correct state on every update
    applyGuestIndicator(splitEl);
  }

  function updateAllIconStates() {
    try {
      const allIcons = document.querySelectorAll(`.${SPLIT_CLASS}`);
      console.log('[QEFY YouTube] Updating', allIcons.length, 'icon states, urlSet size:', urlSet.size);
      
      allIcons.forEach(icon => {
        const url = icon.getAttribute('data-video-url');
        if (url) {
          // Don't update state if AI is currently processing this video
          if (aiProcessingState.isProcessing(url)) {
            console.log('[QEFY YouTube] ⏳ Skipping state update for', url, '- AI is processing');
            return;
          }
          
          const isInQueue = urlSet.has(url);
          console.log('[QEFY YouTube] 🔄 updateAllIconStates calling setSplitState for:', url, 'isInQueue:', isInQueue);
          setSplitState(icon, isInQueue);

          // Apply guest visuals (red dot) when not authenticated
          applyGuestIndicator(icon);
          
          // Update title attribute
          const addBtn = icon.querySelector('.qefy-add');
          if (addBtn) {
            if (!isSignedIn()) {
              addBtn.title = 'Login on queuefy to save your videos. Tap to login';
            } else {
              addBtn.title = isInQueue ? 'In queue - click to move/remove' : 'Click to add video';
            }
          }
          
          // Collapse any expanded options if video is now in queue
          if (isInQueue && icon.classList.contains('qefy-expanded')) {
            collapseOptions(icon);
          }
          
          console.log('[QEFY YouTube] Updated icon for', url, 'isInQueue:', isInQueue);
        }
      });
    } catch (error) {
      console.error('[QEFY YouTube] Failed to update icon states:', error);
    }
  }

  // Prefer mounting inside yt-thumbnail-view-model (same hierarchy as duration overlay)
  function findBestMount(container) {
    // First check if container itself is a thumbnail
    if (container.nodeName === 'YTD-THUMBNAIL') {
      return container;
    }
    
    // Look for thumbnail view model first (best mount point)
    const insideThumbVM = container.querySelector('yt-thumbnail-view-model');
    if (insideThumbVM) return insideThumbVM;
    
    // Check for ytd-thumbnail element
    const ytdThumb = container.querySelector('ytd-thumbnail');
    if (ytdThumb) return ytdThumb;
    
    // Legacy support
    const contentImage = container.querySelector('a.yt-lockup-view-model-wiz__content-image');
    if (contentImage) return contentImage;
    
    return container;
  }

  function requestAdd(url, folder, split, addBtn, metadata, isAISuggested = false) {
    console.log('[QEFY YouTube] 🚀 Starting requestAdd:', { url, folder, metadata, isAISuggested });
    
    if (!isSignedIn()) {
      // If not authenticated, open login popup instead of attempting to add
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_ACTION_POPUP' }, () => void chrome.runtime.lastError);
      } catch (_) {}
      return Promise.resolve({ ok: false, error: 'not_signed_in' });
    }

    if (urlSet.has(url)) {
      console.log('[QEFY YouTube] ⚠️ URL already added, skipping');
      return Promise.resolve({ ok: true });
    }
    
    addBtn.classList.add('busy');
    addBtn.textContent = '…';
    
    // Create action with metadata (like the working chrome-based extension)
    const addAction = {
      type: 'add',
      path: folder,
      link: url,
      metadata: metadata,
      source: isAISuggested ? 'chrome_extension_AI' : 'chrome_extension'
    };
    
    console.log('[QEFY YouTube] 📤 Sending ADD action to core app:', addAction);
    
    return chrome.runtime.sendMessage({
      type: 'SEND_ACTION_TO_CORE',
      payload: { actionJson: JSON.stringify(addAction) }
    }).then((res) => {
      console.log('[QEFY YouTube] 📥 ADD action response from core app:', res);
      if (res?.ok) {
        // Trigger sync after successful add
        console.log('[QEFY YouTube] 🔄 Triggering sync after successful add');
        chrome.runtime.sendMessage({ type: 'SYNC_PENDING_ACTIONS' });
      } else {
        console.error('[QEFY YouTube] ❌ ADD action failed:', res);
      }
      return res;
    }).catch((e) => {
      console.error('[QEFY YouTube] ❌ ADD action error:', e);
      return { ok: false, error: String(e) };
    }).finally(() => {
      addBtn.classList.remove('busy');
    });
  }

  /**
   * Get the entire queue document for AI analysis
   * @returns {Promise<Object>} - The complete queue document
   */
  async function getQueueDocumentForAI() {
    try {
      console.log('[QEFY YouTube] Getting entire queue document for AI analysis...');
      
      // Get compiled queue from background script (which gets it from offscreen/core_app)
      console.log('[QEFY YouTube] Getting compiled queue from background script...');
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, resolve);
      });

      console.log('[QEFY YouTube] Background script response:', response);

      if (!response) {
        console.warn('[QEFY YouTube] No response from background script');
        return null;
      }

      if (!response.latestCompiledQueue) {
        console.warn('[QEFY YouTube] No latestCompiledQueue in response');
        return null;
      }

      const queueDocument = response.latestCompiledQueue;
      console.log('[QEFY YouTube] Got queue document from background script:', queueDocument);

      return queueDocument;
    } catch (error) {
      console.warn('[QEFY YouTube] Error getting queue document for AI:', error);
      return null;
    }
  }

  /**
   * Prepare folder data for AI analysis from ALL folders in the queue
   * @returns {Promise<Array>} - Array of folder objects with items
   */
  async function prepareFolderDataForAIFromQueue() {
    try {
      console.log('[QEFY YouTube] Getting ALL folder data from queue for AI analysis...');
      
      // Get compiled queue from background script (which gets it from offscreen/core_app)
      console.log('[QEFY YouTube] Getting compiled queue from background script...');
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, resolve);
      });

      console.log('[QEFY YouTube] Background script response:', response);

      if (!response) {
        console.warn('[QEFY YouTube] No response from background script');
        return [];
      }

      if (!response.latestCompiledQueue) {
        console.warn('[QEFY YouTube] No latestCompiledQueue in response');
        return [];
      }

      const queue = response.latestCompiledQueue;
      console.log('[QEFY YouTube] Got compiled queue from background script:', queue);

      if (!queue) {
        console.warn('[QEFY YouTube] No queue data available');
        return [];
      }

      console.log('[QEFY YouTube] Raw queue data for AI:', queue);
      console.log('[QEFY YouTube] Queue keys:', Object.keys(queue));
      
      // Handle different queue structures
      let queueData = null;
      if (queue.queue && queue.queue.folders) {
        queueData = queue.queue.folders;
        console.log('[QEFY YouTube] Using queue.queue.folders structure');
      } else if (queue.folders) {
        queueData = queue.folders;
        console.log('[QEFY YouTube] Using queue.folders structure');
      } else {
        queueData = queue;
        console.log('[QEFY YouTube] Using queue as direct structure');
      }
      
      console.log('[QEFY YouTube] Queue data keys:', Object.keys(queueData));
      
      // Get ALL folder names from the queue data
      const allFolderNames = Object.keys(queueData);
      console.log('[QEFY YouTube] All folder names from queue:', allFolderNames);
      
      const folderData = allFolderNames.map(folderName => {
        const rawItems = queueData[folderName];
        console.log(`[QEFY YouTube] Folder "${folderName}" raw items:`, rawItems);
        console.log(`[QEFY YouTube] Folder "${folderName}" raw items type:`, typeof rawItems);
        console.log(`[QEFY YouTube] Folder "${folderName}" raw items is array:`, Array.isArray(rawItems));
        
        // Ensure items is an array
        let items = [];
        if (Array.isArray(rawItems)) {
          items = rawItems;
        } else if (rawItems && typeof rawItems === 'object') {
          // If it's an object, try to convert to array
          items = Object.values(rawItems);
        } else if (rawItems) {
          // If it's a single item, wrap it in an array
          items = [rawItems];
        }
        
        console.log(`[QEFY YouTube] Folder "${folderName}" processed items:`, items);
        console.log(`[QEFY YouTube] Folder "${folderName}" items count:`, items.length);
        
        if (items.length > 0) {
          console.log(`[QEFY YouTube] First item in "${folderName}":`, items[0]);
          console.log(`[QEFY YouTube] First item keys:`, items[0] ? Object.keys(items[0]) : 'no keys');
          console.log(`[QEFY YouTube] First item metadata:`, items[0]?.metadata);
          console.log(`[QEFY YouTube] First item title:`, items[0]?.metadata?.title);
          console.log(`[QEFY YouTube] First item url:`, items[0]?.url);
        }
        
        // Process items to ensure they have proper structure
        const processedItems = items.map((item, index) => {
          console.log(`[QEFY YouTube] Processing item ${index} in "${folderName}":`, item);
          
          if (typeof item === 'string') {
            // If item is just a string (URL), create a basic structure
            const processed = { url: item, metadata: { title: `Video from ${item}` } };
            console.log(`[QEFY YouTube] Processed string item:`, processed);
            return processed;
          } else if (item && typeof item === 'object') {
            // If item is an object, ensure it has metadata
            const processed = {
              ...item,
              metadata: item.metadata || { title: item.title || `Video ${item.url || 'unknown'}` }
            };
            console.log(`[QEFY YouTube] Processed object item:`, processed);
            return processed;
          }
          console.log(`[QEFY YouTube] Unprocessed item:`, item);
          return item;
        });
        
        return {
          name: folderName,
          items: processedItems
        };
      });
      
      console.log('[QEFY YouTube] Final processed folder data for AI:', folderData);
      return folderData;
    } catch (error) {
      console.warn('[QEFY YouTube] Error preparing folder data for AI:', error);
      return [];
    }
  }

  /**
   * Prepare folder data for AI analysis
   * @param {Array} availableFolders - Array of folder names
   * @returns {Promise<Array>} - Array of folder objects with items
   */
  async function prepareFolderDataForAI(availableFolders) {
    try {
      console.log('[QEFY YouTube] Requesting queue data for AI analysis...');
      console.log('[QEFY YouTube] Available folders:', availableFolders);
      
      // Get compiled queue from background script (which gets it from offscreen/core_app)
      console.log('[QEFY YouTube] Getting compiled queue from background script...');
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, resolve);
      });

      console.log('[QEFY YouTube] Background script response:', response);

      if (!response) {
        console.warn('[QEFY YouTube] No response from background script');
        return availableFolders.map(name => ({ name, items: [] }));
      }

      if (!response.latestCompiledQueue) {
        console.warn('[QEFY YouTube] No latestCompiledQueue in response');
        return availableFolders.map(name => ({ name, items: [] }));
      }

      const queue = response.latestCompiledQueue;
      console.log('[QEFY YouTube] Got compiled queue from background script:', queue);

      if (!queue) {
        console.warn('[QEFY YouTube] No queue data available');
        return availableFolders.map(name => ({ name, items: [] }));
      }

      console.log('[QEFY YouTube] Raw queue data for AI:', queue);
      console.log('[QEFY YouTube] Queue keys:', Object.keys(queue));
      
      // Handle different queue structures
      let queueData = null;
      if (queue.queue && queue.queue.folders) {
        queueData = queue.queue.folders;
        console.log('[QEFY YouTube] Using queue.queue.folders structure');
      } else if (queue.folders) {
        queueData = queue.folders;
        console.log('[QEFY YouTube] Using queue.folders structure');
      } else {
        queueData = queue;
        console.log('[QEFY YouTube] Using queue as direct structure');
      }
      
      console.log('[QEFY YouTube] Queue data keys:', Object.keys(queueData));
      
      const folderData = availableFolders.map(folderName => {
        const items = queueData[folderName] || [];
        console.log(`[QEFY YouTube] Folder "${folderName}" items:`, items);
        console.log(`[QEFY YouTube] Folder "${folderName}" items count:`, items.length);
        
        if (items.length > 0) {
          console.log(`[QEFY YouTube] First item in "${folderName}":`, items[0]);
          console.log(`[QEFY YouTube] First item keys:`, items[0] ? Object.keys(items[0]) : 'no keys');
          console.log(`[QEFY YouTube] First item metadata:`, items[0]?.metadata);
          console.log(`[QEFY YouTube] First item title:`, items[0]?.metadata?.title);
          console.log(`[QEFY YouTube] First item url:`, items[0]?.url);
        }
        
        // Process items to ensure they have proper structure
        const processedItems = items.map((item, index) => {
          console.log(`[QEFY YouTube] Processing item ${index} in "${folderName}":`, item);
          
          if (typeof item === 'string') {
            // If item is just a string (URL), create a basic structure
            const processed = { url: item, metadata: { title: `Video from ${item}` } };
            console.log(`[QEFY YouTube] Processed string item:`, processed);
            return processed;
          } else if (item && typeof item === 'object') {
            // If item is an object, ensure it has metadata
            const processed = {
              ...item,
              metadata: item.metadata || { title: item.title || `Video ${item.url || 'unknown'}` }
            };
            console.log(`[QEFY YouTube] Processed object item:`, processed);
            return processed;
          }
          console.log(`[QEFY YouTube] Unprocessed item:`, item);
          return item;
        });
        
        return {
          name: folderName,
          items: processedItems
        };
      });
      
      console.log('[QEFY YouTube] Final processed folder data for AI:', folderData);
      return folderData;
    } catch (error) {
      console.warn('[QEFY YouTube] Error preparing folder data for AI:', error);
      
      // Fallback: try to get data from the global folders variable
      console.log('[QEFY YouTube] Trying fallback method with global folders:', folders);
      try {
        // Try to get queue data from chrome storage as fallback
        const storageResult = await new Promise((resolve) => {
          chrome.storage.local.get(['qefy_compiled_queue'], resolve);
        });
        
        if (storageResult.qefy_compiled_queue) {
          console.log('[QEFY YouTube] Found compiled queue data in storage:', storageResult.qefy_compiled_queue);
          const queue = storageResult.qefy_compiled_queue;
          
          // Handle different queue structures in fallback
          let queueData = null;
          if (queue.queue && queue.queue.folders) {
            queueData = queue.queue.folders;
            console.log('[QEFY YouTube] Fallback - Using queue.queue.folders structure');
          } else if (queue.folders) {
            queueData = queue.folders;
            console.log('[QEFY YouTube] Fallback - Using queue.folders structure');
          } else {
            queueData = queue;
            console.log('[QEFY YouTube] Fallback - Using queue as direct structure');
          }
          
          const folderData = availableFolders.map(folderName => {
            const items = queueData[folderName] || [];
            console.log(`[QEFY YouTube] Fallback - Folder "${folderName}" items:`, items);
            
            const processedItems = items.map(item => {
              if (typeof item === 'string') {
                return { url: item, metadata: { title: `Video from ${item}` } };
              } else if (item && typeof item === 'object') {
                return {
                  ...item,
                  metadata: item.metadata || { title: item.title || `Video ${item.url || 'unknown'}` }
                };
              }
              return item;
            });
            
            return {
              name: folderName,
              items: processedItems
            };
          });
          
          console.log('[QEFY YouTube] Fallback processed folder data:', folderData);
          return folderData;
        }
      } catch (fallbackError) {
        console.warn('[QEFY YouTube] Fallback method also failed:', fallbackError);
      }
      
      return availableFolders.map(name => ({ name, items: [] }));
    }
  }

  /**
   * Show a toast with the folder name where the video is saved
   * @param {HTMLElement} split - The split control element
   * @param {string} url - The video URL
   * @param {number} duration - Optional duration in milliseconds to auto-hide the toast
   */
  async function showFolderNameToast(split, url, duration = null) {
    try {
      
      // Get folder name from core app
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'FIND_FOLDER_NAME',
          payload: { url: url }
        }, resolve);
      });


      if (response?.ok && response.folderName) {
        // Remove any existing toast
        hideFolderNameToast();
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'qefy-folder-toast';
        toast.textContent = `📁 ${response.folderName}`;
        toast.style.cssText = `
          position: fixed;
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          z-index: 10001;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          white-space: nowrap;
          animation: qefy-toast-fade-in 0.2s ease-out;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        `;

        // Add CSS animation if not already added
        if (!document.head.querySelector('style[data-qefy-toast]')) {
          const style = document.createElement('style');
          style.setAttribute('data-qefy-toast', 'true');
          style.textContent = `
            @keyframes qefy-toast-fade-in {
              from {
                opacity: 0;
                transform: translateY(-5px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            @keyframes qefy-toast-fade-out {
              from {
                opacity: 1;
                transform: translateY(0);
              }
              to {
                opacity: 0;
                transform: translateY(-5px);
              }
            }
          `;
          document.head.appendChild(style);
        }

        // Position the toast to the right of the split control
        const rect = split.getBoundingClientRect();
        toast.style.left = `${rect.right + 8}px`;
        toast.style.top = `${rect.top + rect.height / 2}px`;
        toast.style.transform = 'translateY(-50%)';

        document.body.appendChild(toast);
        
        // Auto-hide toast after specified duration
        if (duration && duration > 0) {
          setTimeout(() => {
            hideFolderNameToast();
          }, duration);
        }
      }
    } catch (error) {
      // Silently handle toast errors
    }
  }

  /**
   * Hide the folder name toast
   */
  function hideFolderNameToast() {
    const toast = document.querySelector('.qefy-folder-toast');
    if (toast) {
      toast.style.animation = 'qefy-toast-fade-out 0.2s ease-in';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 200);
    }
  }

  /**
   * Check if AI is enabled in extension settings
   * @returns {Promise<boolean>} - Whether AI is enabled
   */
  function checkAIEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['aiEnabled'], (result) => {
        // Default to true if not set (backward compatibility)
        const isEnabled = result.aiEnabled !== false;
        resolve(isEnabled);
      });
    });
  }

  /**
   * Check if AI is available in the browser (Chrome AI API)
   * @returns {Promise<boolean>} - Whether AI is available in the browser
   */
  async function checkAIAvailable() {
    try {
      if (typeof LanguageModel !== 'undefined') {
        const availability = await LanguageModel.availability();
        return availability === 'available';
      }
      return false;
    } catch (error) {
      console.warn('[QEFY YouTube] Error checking AI availability:', error);
      return false;
    }
  }

  /**
   * Check if AI is both enabled in settings AND available in the browser
   * @returns {Promise<boolean>} - Whether AI can be used
   */
  async function checkAIEnabledAndAvailable() {
    try {
      // First check if AI is enabled in settings
      const isEnabled = await checkAIEnabled();
      if (!isEnabled) {
        return false;
      }

      // Then check if AI is available in the browser
      const isAvailable = await checkAIAvailable();
      return isAvailable;
    } catch (error) {
      console.warn('[QEFY YouTube] Error checking AI enabled and available:', error);
      return false;
    }
  }

  /**
   * Create expanded option buttons for the quick button
   * @param {HTMLElement} splitEl - The split control element
   * @param {string} url - The video URL
   * @param {HTMLElement} container - The container element
   * @param {HTMLElement} addBtn - The add button element
   * @returns {HTMLElement} - The expanded options container
   */
  function createExpandedOptions(splitEl, url, container, addBtn) {
    // Remove any existing expanded options
    const existingExpanded = splitEl.querySelector('.qefy-expanded-options');
    if (existingExpanded) {
      existingExpanded.remove();
    }

    const expandedContainer = document.createElement('div');
    expandedContainer.className = 'qefy-expanded-options';
    expandedContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 32px;
      display: flex;
      gap: 4px;
      background: rgba(255, 255, 255, 0.95);
      border: 2px solid #ddd;
      border-radius: 20px;
      padding: 2px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 1001;
      backdrop-filter: blur(5px);
    `;

    // Option 1: Clock icon (recently added)
    const clockBtn = document.createElement('button');
    clockBtn.className = 'qefy-option-btn qefy-recently-added';
    clockBtn.innerHTML = '🕒';
    clockBtn.title = 'Add to recently added';
    clockBtn.style.cssText = `
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: background-color 0.2s;
    `;

    // Option 2: Folder icon
    const folderBtn = document.createElement('button');
    folderBtn.className = 'qefy-option-btn qefy-folder-select';
    folderBtn.innerHTML = '📁';
    folderBtn.title = 'Choose folder';
    folderBtn.style.cssText = clockBtn.style.cssText;

    // Option 3: AI icon
    const aiBtn = document.createElement('button');
    aiBtn.className = 'qefy-option-btn qefy-ai-suggest';
    aiBtn.innerHTML = '🤖';
    aiBtn.title = 'Let AI choose folder';
    aiBtn.style.cssText = clockBtn.style.cssText;

    // Add hover effects to clock and folder buttons
    [clockBtn, folderBtn].forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        btn.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.backgroundColor = 'transparent';
      });
    });
    
    // Add hover effects to AI button
    aiBtn.addEventListener('mouseenter', () => {
      aiBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
    });
    aiBtn.addEventListener('mouseleave', () => {
      aiBtn.style.backgroundColor = 'transparent';
    });

    // Clock button click handler (add to recently_added)
    clockBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      collapseOptions(splitEl);
      
      const metadata = extractMetadata(container) || undefined;
      const res = await requestAdd(url, DEFAULT_FOLDER, splitEl, addBtn, metadata);
      if (res?.ok) {
        urlSet.add(url);
        setSplitState(splitEl, true, 'success');
        setTimeout(() => splitEl.classList.remove('success'), 800);
      } else {
        setSplitState(splitEl, false, 'error');
        setTimeout(() => splitEl.classList.remove('error'), 1200);
      }
    });

    // Folder button click handler (show folder menu)
    folderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      collapseOptions(splitEl);
      showFolderMenu(splitEl, url, splitEl, addBtn, container);
    });

    // AI button click handler (AI suggestion)
    aiBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      console.log('[QEFY YouTube] 🤖 AI button clicked for:', url);
      
      // Start AI processing tracking FIRST
      const metadata = extractMetadata(container) || {};
      aiProcessingState.startProcessing(url, metadata);
      
      // Show processing state BEFORE collapsing options
      setSplitState(splitEl, false, '', true); // isProcessing = true
      console.log('[QEFY YouTube] ⏳ Set spinner state for:', url);
      
      // Now collapse the options WITH preserve flag
      collapseOptions(splitEl, true);
      
      // Check if AI is available
      const aiAvailable = await checkAIEnabledAndAvailable();
      if (!aiAvailable) {
        console.log('[QEFY YouTube] ❌ AI not available, using fallback');
        
        // Fallback to recently_added if AI not available
        const res = await requestAdd(url, DEFAULT_FOLDER, splitEl, addBtn, metadata);
        if (res?.ok) {
          urlSet.add(url);
          aiProcessingState.completeProcessing(url, DEFAULT_FOLDER);
        } else {
          aiProcessingState.failProcessing(url, 'Failed to add video - AI not available');
        }
        return;
      }
      
      // Show AI notification
      if (window.qefyAINotification) {
        const videoData = {
          title: metadata.title || 'Untitled Video',
          thumbnail: extractThumbnailUrl(container),
          url: url,
          channelName: metadata.channelName
        };
        
        chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, (response) => {
          const availableFolders = response?.latestCompiledQueue?.queue 
            ? Object.keys(response.latestCompiledQueue.queue).filter(f => f !== 'done' && f !== 'trash')
            : ['recently_added'];
          
          console.log('[QEFY YouTube] 🚀 Showing AI notification for direct AI button:', videoData);
          window.qefyAINotification.showProcessing(videoData, availableFolders);
          
          // Mark notification as shown
          aiProcessingState.markNotificationShown(url);
        });
      }
      
      try {
        // Get AI suggestion
        const queueDocument = await getQueueDocumentForAI();
        const availableFolders = folders.filter(f => f && f !== 'done' && f !== 'trash');
        const thumbnailUrl = extractThumbnailUrl(container);
        
        const suggestion = await processAISuggestion(
          metadata.title, 
          availableFolders, 
          null, 
          thumbnailUrl, 
          metadata.duration, 
          metadata.channelName
        );
        
        const targetFolder = suggestion || DEFAULT_FOLDER;
        const res = await requestAdd(url, targetFolder, splitEl, addBtn, metadata, !!suggestion);
        
        if (res?.ok) {
          urlSet.add(url);
          
          // Show folder name toast
          if (suggestion) {
            showFolderNameToast(splitEl, url, 3000);
          }
          
          // Complete AI processing tracking (this will handle button state)
          aiProcessingState.completeProcessing(url, targetFolder);
        } else {
          // Fail AI processing tracking (this will handle button state)
          aiProcessingState.failProcessing(url, 'Failed to add video to queue');
        }
        
      } catch (error) {
        console.error('[QEFY YouTube] AI suggestion failed:', error);
        
        // Fallback to recently_added
        const metadata = extractMetadata(container) || undefined;
        const res = await requestAdd(url, DEFAULT_FOLDER, splitEl, addBtn, metadata);
        if (res?.ok) {
          urlSet.add(url);
          // Complete with fallback folder (this will handle button state)
          aiProcessingState.completeProcessing(url, DEFAULT_FOLDER);
        } else {
          // Fail AI processing tracking (this will handle button state)
          aiProcessingState.failProcessing(url, error);
        }
      }
    });

    expandedContainer.appendChild(clockBtn);
    expandedContainer.appendChild(folderBtn);
    
    // Only add AI button if AI is enabled and available
    checkAIEnabledAndAvailable().then(aiEnabled => {
      if (aiEnabled) {
        expandedContainer.appendChild(aiBtn);
      }
    });

    return expandedContainer;
  }

  /**
   * Expand the quick button to show options
   * @param {HTMLElement} splitEl - The split control element
   * @param {string} url - The video URL
   * @param {HTMLElement} container - The container element
   * @param {HTMLElement} addBtn - The add button element
   */
  function expandOptions(splitEl, url, container, addBtn) {
    // Don't expand if already in queue
    if (splitEl.classList.contains('qefy-in-queue')) {
      return;
    }

    // Don't expand if already expanded
    if (splitEl.classList.contains('qefy-expanded')) {
      return;
    }

    splitEl.classList.add('qefy-expanded');
    
    const expandedOptions = createExpandedOptions(splitEl, url, container, addBtn);
    splitEl.appendChild(expandedOptions);

    // Add click outside handler to collapse
    const handleClickOutside = (e) => {
      if (!splitEl.contains(e.target)) {
        collapseOptions(splitEl);
        document.removeEventListener('click', handleClickOutside);
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
  }

  /**
   * Collapse the expanded options
   * @param {HTMLElement} splitEl - The split control element
   * @param {boolean} preserveProcessingState - Whether to preserve processing state
   */
  function collapseOptions(splitEl, preserveProcessingState = false) {
    console.log('[QEFY YouTube] 🔄 Collapsing options, preserveProcessingState:', preserveProcessingState);
    
    splitEl.classList.remove('qefy-expanded');
    
    const expandedOptions = splitEl.querySelector('.qefy-expanded-options');
    if (expandedOptions) {
      expandedOptions.remove();
    }
    
    // If we should preserve processing state or AI is processing, maintain spinner
    const url = splitEl.getAttribute('data-video-url');
    if (preserveProcessingState || (url && aiProcessingState.isProcessing(url))) {
      // Keep the processing state (spinner)
      setSplitState(splitEl, false, '', true); // isProcessing = true
      console.log('[QEFY YouTube] ⏳ Maintaining spinner state while AI processes:', url);
    }
  }

  /**
   * Handle folder selection and send request to core app
   * @param {string} folderName - The selected folder name
   * @param {string} url - The video URL
   * @param {HTMLElement} container - The video container element
   * @param {HTMLElement} split - The split control element
   * @param {HTMLElement} addBtn - The add button element
   */
  function handleFolderSelection(folderName, url, container, split, addBtn, isAISuggested = false) {
    
    document.querySelectorAll('.qefy-folder-menu').forEach(m => m.remove());
    
    // Loading state on split
    split.classList.remove('success', 'error');
    addBtn.classList.add('busy');
    addBtn.textContent = '…';
    
    const metadata = extractMetadata(container) || undefined;
    
    requestAdd(url, folderName, split, addBtn, metadata, isAISuggested).then(res => {
      if (res?.ok) {
        urlSet.add(url);
        setSplitState(split, true, 'success');
        setTimeout(() => split.classList.remove('success'), 800);
        
        // Show folder name toast for 3 seconds after successful add (only if not AI suggested)
        if (!isAISuggested) {
          showFolderNameToast(split, url, 3000);
        } else {
          // For AI suggested actions, don't call showSuccess here
          // The AI completion detection will handle it when AI actually finishes
        }
      } else {
        setSplitState(split, false, 'error');
        setTimeout(() => split.classList.remove('error'), 1200);
        
        // Hide AI notification on error
        if (isAISuggested && window.qefyAINotification) {
          window.qefyAINotification.remove();
        }
      }
    }).catch(error => {
      setSplitState(split, false, 'error');
      setTimeout(() => split.classList.remove('error'), 1200);
      
      // Hide AI notification on error
      if (isAISuggested && window.qefyAINotification) {
        window.qefyAINotification.remove();
      }
    });
  }

  /**
   * Create a folder button for the menu
   * @param {string} folderName - Name of the folder
   * @param {boolean} isAISuggested - Whether this is an AI suggestion
   * @param {boolean} showSpinner - Whether to show a spinner
   * @param {Object} aiState - AI processing state object
   * @param {string} url - The video URL
   * @param {HTMLElement} container - The video container element
   * @param {HTMLElement} split - The split control element
   * @param {HTMLElement} addBtn - The add button element
   * @returns {HTMLElement} - The button element
   */
  function createFolderButton(folderName, isAISuggested, showSpinner = false, aiState = null, url = null, container = null, split = null, addBtn = null) {
    const btn = document.createElement('button');
    btn.type = 'button';
    
    // Store the AI state object on the button for later access
    if (aiState) {
      btn.aiState = aiState;
    }
    
    if (showSpinner) {
      btn.innerHTML = `✨ <span class="spinner">⏳</span> ${folderName}`;
    } else {
      btn.textContent = isAISuggested ? `✨ ${folderName}` : folderName;
    }
    
    btn.style.cssText = `
      width: 100%;
      padding: 6px 10px;
      border: none;
      background: ${isAISuggested ? '#e8f5e8' : 'none'};
      text-align: left;
      cursor: pointer;
      font-size: 12px;
      transition: background-color 0.2s ease;
      ${isAISuggested ? 'border-left: 3px solid #4caf50;' : ''}
    `;
    
    // Add spinner animation CSS
    if (showSpinner) {
      const style = document.createElement('style');
      style.textContent = `
        .spinner {
          display: inline-block;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      if (!document.head.querySelector('style[data-qefy-spinner]')) {
        style.setAttribute('data-qefy-spinner', 'true');
        document.head.appendChild(style);
      }
    }

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      // Show AI notification only if AI is still processing (not if AI has already completed)
      if (isAISuggested && (!aiState || !aiState.suggestion)) {
        console.log('[QEFY YouTube] 🤖 AI button clicked but no suggestion yet - starting AI processing');
        
        const metadata = extractMetadata(container) || {};
        const videoData = {
          title: metadata.title || 'Untitled Video',
          thumbnail: extractThumbnailUrl(container),
          url: url,
          channelName: metadata.channelName
        };
        
        // Start AI processing tracking for folder menu
        aiProcessingState.startProcessing(url, metadata);
        
        // Use the notification system
        if (window.qefyAINotification) {
          // Get available folders for AI step messages
          chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, (response) => {
            const availableFolders = response?.latestCompiledQueue?.queue 
              ? Object.keys(response.latestCompiledQueue.queue).filter(f => f !== 'done' && f !== 'trash')
              : ['recently_added'];
            
            console.log('[QEFY YouTube] 🚀 Showing AI notification for folder menu AI button:', videoData);
            // Show processing with available folders for AI step messages
            window.qefyAINotification.showProcessing(videoData, availableFolders);
            
            // Mark notification as shown
            aiProcessingState.markNotificationShown(url);
          });
        }
      } else if (isAISuggested && aiState && aiState.suggestion) {
        console.log('[QEFY YouTube] 🤖 AI button clicked with existing suggestion - adding directly to:', aiState.suggestion);
      }
      
      // If this is an AI button and AI is still processing, wait for it to complete
      if (isAISuggested && aiState && aiState.isProcessing) {
        // Show ⌛ spinner in the thumbnail and disable the button
        btn.innerHTML = `✨ <span class="spinner">⏳</span> Waiting for AI...`;
        btn.disabled = true;
        
        // Show ⌛ in the thumbnail split control
        if (split) {
          split.innerHTML = '⌛';
          split.style.pointerEvents = 'none';
        }
        
        // Wait for AI processing to complete
        const waitForAI = setInterval(() => {
          if (!aiState.isProcessing) {
            clearInterval(waitForAI);
            btn.disabled = false;
            
            // Restore the split control
            if (split) {
              split.innerHTML = '✓';
              split.style.pointerEvents = 'auto';
            }
            
            if (aiState.suggestion) {
              // Use the AI suggestion
              handleFolderSelection(aiState.suggestion, url, container, split, addBtn, true);
            } else {
              // AI failed, use fallback
              handleFolderSelection('recently_added', url, container, split, addBtn, false);
            }
          }
        }, 100);
        
        return;
      }
      
      // Use the AI suggestion if this is an AI button and AI is complete
      const targetFolder = isAISuggested && aiState && aiState.suggestion ? aiState.suggestion : folderName;
      const isActuallyAISuggested = isAISuggested && aiState && aiState.suggestion;
      
      console.log('[QEFY YouTube] 🤖 AI button clicked:', {
        isAISuggested,
        aiState: aiState ? { suggestion: aiState.suggestion, isProcessing: aiState.isProcessing } : null,
        targetFolder,
        isActuallyAISuggested,
        originalFolderName: folderName
      });
      
      handleFolderSelection(targetFolder, url, container, split, addBtn, isActuallyAISuggested);
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = isAISuggested ? '#d4edda' : '#f0f0f0';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = isAISuggested ? '#e8f5e8' : 'transparent';
    });

    return btn;
  }

  /**
   * Extract thumbnail URL from YouTube video element
   * @param {HTMLElement} container - The video container element
   * @returns {string|null} - The thumbnail URL or null if not found
   */
  function extractThumbnailUrl(container) {
    try {
      // Try to find thumbnail in various places
      const thumbnailSelectors = [
        'img[src*="ytimg.com"]', // YouTube thumbnail images
        'img[src*="i.ytimg.com"]', // YouTube thumbnail images (alternative)
        'img[alt*="thumbnail"]', // Images with thumbnail in alt text
        'img[class*="thumbnail"]', // Images with thumbnail in class
        'img[class*="ytd-thumbnail"]', // YouTube thumbnail class
        'img[class*="yt-core-image"]', // YouTube core image class
        'img' // Fallback to any image
      ];

      for (const selector of thumbnailSelectors) {
        const img = container.querySelector(selector);
        if (img && img.src && img.src.includes('ytimg.com')) {
          console.log('[QEFY YouTube] Found thumbnail URL:', img.src);
          return img.src;
        }
      }

      // Try to extract from video ID if we can find it
      const videoId = extractVideoId(container);
      if (videoId) {
        const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        console.log('[QEFY YouTube] Generated thumbnail URL from video ID:', thumbnailUrl);
        return thumbnailUrl;
      }

      console.log('[QEFY YouTube] No thumbnail URL found');
      return null;
    } catch (error) {
      console.warn('[QEFY YouTube] Error extracting thumbnail URL:', error);
      return null;
    }
  }

  /**
   * Extract video ID from YouTube URL or element
   * @param {HTMLElement} container - The video container element
   * @returns {string|null} - The video ID or null if not found
   */
  function extractVideoId(container) {
    try {
      // Try to find video ID in href attributes
      const links = container.querySelectorAll('a[href*="watch?v="], a[href*="youtu.be/"]');
      for (const link of links) {
        const href = link.href;
        const videoId = href.match(/[?&]v=([^&]+)/)?.[1] || href.match(/youtu\.be\/([^?]+)/)?.[1];
        if (videoId) {
          console.log('[QEFY YouTube] Found video ID:', videoId);
          return videoId;
        }
      }
      return null;
    } catch (error) {
      console.warn('[QEFY YouTube] Error extracting video ID:', error);
      return null;
    }
  }

  /**
   * Extract full video URL from container
   * @param {HTMLElement} container - The video container element
   * @returns {string|null} - The video URL or null if not found
   */
  function extractVideoUrl(container) {
    try {
      const selectors = [
        'a#thumbnail',
        'a.ytd-thumbnail',
        'a.yt-lockup-view-model-wiz__content-image',
        'a[href^="/watch"]',
        'a[href^="https://www.youtube.com/watch"]'
      ];
      
      const anchor = container.querySelector(selectors.join(','));
      if (!anchor) return null;
      
      const href = anchor.getAttribute('href') || anchor.href;
      if (!href) return null;
      
      // Convert to absolute URL
      let absoluteUrl = href;
      if (href.startsWith('/')) {
        absoluteUrl = `https://www.youtube.com${href}`;
      } else if (!href.startsWith('http')) {
        absoluteUrl = `https://www.youtube.com/${href}`;
      }
      
      if (absoluteUrl && absoluteUrl.includes('/watch')) {
        console.log('[QEFY YouTube] Found video URL:', absoluteUrl);
        return absoluteUrl;
      }
      
      return null;
    } catch (error) {
      console.warn('[QEFY YouTube] Error extracting video URL:', error);
      return null;
    }
  }

  /**
   * Process AI suggestion asynchronously
   * @param {string} videoTitle - The video title
   * @param {Array} availableFolders - Available folders
   * @param {HTMLElement} menu - The menu element
   * @param {string} thumbnailUrl - Optional thumbnail URL
   * @param {string} duration - Optional video duration
   * @param {string} channelName - Optional channel name
   * @returns {Promise<string>} - The AI suggestion
   */
  async function processAISuggestion(videoTitle, availableFolders, menu, thumbnailUrl = null, duration = null, channelName = null) {
    try {
      // Get the entire queue document for AI analysis
      const queueDocument = await getQueueDocumentForAI();
      
      // Check if AI is actually available
      const isAIAvailable = await window.aiFolderSuggestionService.recheckAvailability();
      
      if (isAIAvailable) {
        const suggestion = await window.aiFolderSuggestionService.suggestFolderFromQueue(videoTitle, queueDocument, availableFolders, thumbnailUrl, duration, channelName);
        
        return suggestion;
      } else {
        // Check if model is downloading and wait for it
        const availability = await LanguageModel.availability();
        
        if (availability === 'downloading') {
          
          // Wait for download to complete (with timeout)
          const downloadComplete = await window.aiFolderSuggestionService.waitForDownload(60000); // 1 minute timeout
          
          if (downloadComplete) {
            
            const suggestion = await window.aiFolderSuggestionService.suggestFolderFromQueue(videoTitle, queueDocument, availableFolders, thumbnailUrl, duration, channelName);
            
            return suggestion;
          } else {
            return null;
          }
        } else {
          return null;
        }
      }
    } catch (error) {
      return null;
    }
  }

  async function showFolderMenu(anchorEl, url, split, addBtn, container) {
    // Prevent multiple simultaneous calls
    if (isShowingFolderMenu) {
      console.log('[QEFY YouTube] Folder menu already showing, skipping duplicate call');
      return;
    }
    
    isShowingFolderMenu = true;
    document.querySelectorAll('.qefy-folder-menu').forEach((m) => m.remove());

    // Filter out 'done' and 'trash' folders for UI display
    let availableFolders = folders.filter(f => f && f !== 'done' && f !== 'trash');
    
    // Fallback: if no folders available, use default
    if (availableFolders.length === 0) {
      availableFolders = ['recently_added'];
      console.log('[QEFY YouTube] No folders available, using default:', availableFolders);
    }
    
    // For AI analysis, we need ALL folders including 'done' and 'trash' to get the full context
    // But we'll exclude them from the AI suggestion itself
    let allFoldersForAI = [...folders];
    if (allFoldersForAI.length === 0) {
      allFoldersForAI = ['recently_added', 'done', 'trash'];
    }
    

    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'qefy-folder-menu';
    menu.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      z-index: 10000;
      width: 300px;
      max-height: 160px;
      overflow-y: auto;
    `;
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.max(8, rect.left))}px`;

    const metadata = extractMetadata(container) || undefined;
    
    // Get AI suggestion for the video (async, will update menu after)
    let aiSuggestedFolder = null;
    let aiButton = null;
    
    
    // Start AI processing in background (check if AI is enabled and available)
    checkAIEnabledAndAvailable().then(aiEnabled => {
      if (aiEnabled && window.aiFolderSuggestionService && metadata && metadata.title) {
      // Extract thumbnail URL for multimodal AI analysis
      const thumbnailUrl = extractThumbnailUrl(container);
      
      // Process AI suggestion asynchronously with folder data, thumbnail, duration, and channel name
      console.log('[QEFY YouTube] Passing to AI suggestion:', {
        title: metadata.title,
        duration: metadata.duration,
        channelName: metadata.channelName,
        thumbnailUrl: thumbnailUrl
      });
      
      // AI processing will be tracked by the centralized state manager
      
      processAISuggestion(metadata.title, availableFolders, menu, thumbnailUrl, metadata.duration, metadata.channelName).then(suggestion => {
        if (suggestion && aiButton) {
          // Update the AI button with the actual suggestion
          aiButton.innerHTML = `🤖 Add to "${suggestion}"`;
          aiButton.setAttribute('data-ai-suggested', 'true');
          aiButton.title = `AI suggests: ${suggestion}`;
          aiSuggestion = suggestion; // Store the AI suggestion
          isAIProcessing = false; // Mark AI processing as complete
          
          // Update the AI state object if it exists
          if (aiButton.aiState) {
            aiButton.aiState.suggestion = suggestion;
            aiButton.aiState.isProcessing = false;
          }
          
          // Complete AI processing tracking for folder menu
          aiProcessingState.completeProcessing(url, suggestion);
          
          console.log('[QEFY YouTube] 🤖 AI button updated with suggestion:', suggestion);
        }
      }).catch(error => {
        console.warn('[QEFY YouTube] AI processing failed:', error);
        if (aiButton) {
          aiButton.innerHTML = `🤖 Try again (AI failed)`;
          aiButton.style.background = '#f8d7da';
          aiButton.style.color = '#721c24';
          aiButton.title = 'AI failed to suggest folder - click to add to recently_added';
          isAIProcessing = false; // Mark AI processing as complete (failed)
          
          // Update the AI state object if it exists
          if (aiButton.aiState) {
            aiButton.aiState.suggestion = null;
            aiButton.aiState.isProcessing = false;
          }
          
          // Fail AI processing tracking for folder menu
          aiProcessingState.failProcessing(url, error);
        }
      });
      }
    });

    // If no available folders, show a message
    if (availableFolders.length === 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'No folders available';
      btn.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: none;
        text-align: left;
        cursor: not-allowed;
        font-size: 14px;
        color: #999;
      `;
      btn.disabled = true;
      menu.appendChild(btn);
    } else {
      // Create folder buttons instantly
      const folderButtons = [];
      
      // Add remaining folders first
      availableFolders.forEach((f) => {
        const btn = createFolderButton(f, false, false, null, url, container, split, addBtn);
        folderButtons.push(btn);
      });
      
      // Append regular folder buttons to menu first
      folderButtons.forEach(btn => menu.appendChild(btn));
      
      // Add AI suggested folder first if available, with spinner (only if AI is enabled and available)
      checkAIEnabledAndAvailable().then(aiEnabled => {
        if (aiEnabled && window.aiFolderSuggestionService && metadata && metadata.title) {
          // Create AI button with spinner (will be updated when AI completes)
          aiButton = createFolderButton('Let AI choose', true, true, { isProcessing: true, suggestion: null }, url, container, split, addBtn); // true = isAISuggested, true = showSpinner
          
          // Insert AI button at the beginning of the menu
          menu.insertBefore(aiButton, menu.firstChild);
        }
      });
    }

    document.body.appendChild(menu);
    
    // Track AI processing state
    let isAIProcessing = true;
    let aiSuggestion = null;
    
    const close = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorEl) {
        menu.remove();
        window.removeEventListener('click', close, true);
        window.removeEventListener('scroll', close, true);
        // Reset the flag when menu is closed
        isShowingFolderMenu = false;
      }
    };
    window.addEventListener('click', close, true);
    window.addEventListener('scroll', close, true);
    
    // Reset flag after a timeout as backup
    setTimeout(() => {
      isShowingFolderMenu = false;
    }, 10000); // 10 seconds timeout
  }

  async function showMoveRemoveMenu(anchorEl, url, split, addBtn, container) {
    // Prevent multiple simultaneous calls
    if (isShowingFolderMenu) {
      console.log('[QEFY YouTube] Move/Remove menu already showing, skipping duplicate call');
      return;
    }
    
    isShowingFolderMenu = true;
    document.querySelectorAll('.qefy-folder-menu').forEach((m) => m.remove());

    // Get current folder for this video
    let currentFolder = null;
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'FIND_FOLDER_NAME',
          payload: { url: url }
        }, resolve);
      });
      
      if (response?.ok && response.folderName) {
        currentFolder = response.folderName;
        console.log('[QEFY YouTube] Current folder for video:', currentFolder);
      } else {
        console.warn('[QEFY YouTube] Could not find current folder for video');
        isShowingFolderMenu = false;
        return;
      }
    } catch (error) {
      console.error('[QEFY YouTube] Error finding current folder:', error);
      isShowingFolderMenu = false;
      return;
    }

    // Get all available folders (including done and trash for move operations)
    let availableFolders = [...folders, 'done', 'trash'];
    
    // Remove duplicates
    availableFolders = [...new Set(availableFolders)];
    
    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'qefy-folder-menu';
    menu.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      z-index: 10000;
      width: 300px;
      max-height: 200px;
      overflow-y: auto;
    `;
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.max(8, rect.left))}px`;

    // Add header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 8px 12px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      font-size: 12px;
      font-weight: 600;
      color: #333;
    `;
    header.textContent = 'Move video to:';
    menu.appendChild(header);

    // Create folder buttons
    availableFolders.forEach((folderName) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      
      const isCurrentFolder = folderName === currentFolder;
      
      // Show checkmark for current folder
      btn.innerHTML = isCurrentFolder ? `✓ ${folderName}` : folderName;
      
      btn.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: ${isCurrentFolder ? '#fff3cd' : 'none'};
        text-align: left;
        cursor: pointer;
        font-size: 12px;
        transition: background-color 0.2s ease;
        ${isCurrentFolder ? 'border-left: 3px solid #ffc107; font-weight: 600;' : ''}
      `;

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        // Close menu
        menu.remove();
        isShowingFolderMenu = false;
        
        if (isCurrentFolder) {
          // If clicking current folder, move to trash (remove)
          await handleMoveToTrash(url, currentFolder, split, addBtn);
        } else {
          // Move to selected folder
          await handleMoveToFolder(url, currentFolder, folderName, split, addBtn);
        }
      });

      btn.addEventListener('mouseenter', () => {
        if (!isCurrentFolder) {
          btn.style.backgroundColor = '#f0f0f0';
        }
      });
      
      btn.addEventListener('mouseleave', () => {
        if (!isCurrentFolder) {
          btn.style.backgroundColor = 'transparent';
        }
      });

      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    
    const close = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorEl) {
        menu.remove();
        window.removeEventListener('click', close, true);
        window.removeEventListener('scroll', close, true);
        // Reset the flag when menu is closed
        isShowingFolderMenu = false;
      }
    };
    window.addEventListener('click', close, true);
    window.addEventListener('scroll', close, true);
    
    // Reset flag after a timeout as backup
    setTimeout(() => {
      isShowingFolderMenu = false;
    }, 10000); // 10 seconds timeout
  }

  async function handleMoveToTrash(url, currentPath, split, addBtn) {
    console.log('[QEFY YouTube] Removing video (moving to trash):', { url, currentPath });
    
    // Show loading state
    split.classList.remove('success', 'error');
    addBtn.classList.add('busy');
    addBtn.textContent = '…';
    
    try {
      // Find video item in the queue
      const foundItem = await findVideoItemInQueue(url);
      
      let videoItem = null;
      let sourcePath = currentPath;
      
      if (foundItem?.item) {
        videoItem = foundItem.item;
        sourcePath = foundItem.folder;
        console.log('[QEFY YouTube] Found video item for removal:', { uuid: videoItem.uuid, folder: sourcePath });
      } else {
        console.warn('[QEFY YouTube] Could not find video item in queue, using fallback');
        // Fallback: create a minimal item structure
        videoItem = { uuid: url, url: url };
      }
      
      // Create RMV action to remove the item completely
      const removeAction = {
        type: 'rmv',
        uuid: videoItem.uuid,
        path: sourcePath
      };
      
      console.log('[QEFY YouTube] Sending RMV action:', removeAction);
      
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_ACTION_TO_CORE',
        payload: { actionJson: JSON.stringify(removeAction) }
      });
      
      if (response?.ok) {
        // Remove from URL set since it's deleted
        urlSet.delete(url);
        setSplitState(split, false, 'success');
        setTimeout(() => split.classList.remove('success'), 800);
        
        // Trigger sync
        chrome.runtime.sendMessage({ type: 'SYNC_PENDING_ACTIONS' });
        console.log('[QEFY YouTube] Video removed successfully');
      } else {
        console.error('[QEFY YouTube] Failed to remove video:', response);
        setSplitState(split, true, 'error');
        setTimeout(() => split.classList.remove('error'), 1200);
      }
    } catch (error) {
      console.error('[QEFY YouTube] Error removing video:', error);
      setSplitState(split, true, 'error');
      setTimeout(() => split.classList.remove('error'), 1200);
    } finally {
      addBtn.classList.remove('busy');
    }
  }

  async function handleMoveToFolder(url, currentPath, targetPath, split, addBtn) {
    console.log('[QEFY YouTube] Moving video to folder:', { url, currentPath, targetPath });
    
    // Show loading state
    split.classList.remove('success', 'error');
    addBtn.classList.add('busy');
    addBtn.textContent = '…';
    
    try {
      // Find video item in the queue
      const foundItem = await findVideoItemInQueue(url);
      
      let videoItem = null;
      let sourcePath = currentPath;
      
      if (foundItem?.item) {
        videoItem = foundItem.item;
        sourcePath = foundItem.folder;
        console.log('[QEFY YouTube] Found video item for move:', { uuid: videoItem.uuid, from: sourcePath, to: targetPath });
      } else {
        console.warn('[QEFY YouTube] Could not find video item in queue, using fallback');
        // Fallback: create a minimal item structure
        videoItem = { uuid: url, url: url };
      }
      
      // Create MV action to move from current folder to target folder
      const moveAction = {
        type: 'mv',
        uuid: videoItem.uuid,
        path: sourcePath,
        targetPath: targetPath
      };
      
      console.log('[QEFY YouTube] Sending MV action:', moveAction);
      
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_ACTION_TO_CORE',
        payload: { actionJson: JSON.stringify(moveAction) }
      });
      
      if (response?.ok) {
        setSplitState(split, true, 'success');
        setTimeout(() => split.classList.remove('success'), 800);
        
        // Trigger sync
        chrome.runtime.sendMessage({ type: 'SYNC_PENDING_ACTIONS' });
        console.log('[QEFY YouTube] Video moved to folder successfully:', targetPath);
        
        // Show toast with new folder name
        showFolderNameToast(split, url, 3000);
      } else {
        console.error('[QEFY YouTube] Failed to move video to folder:', response);
        setSplitState(split, true, 'error');
        setTimeout(() => split.classList.remove('error'), 1200);
      }
    } catch (error) {
      console.error('[QEFY YouTube] Error moving video to folder:', error);
      setSplitState(split, true, 'error');
      setTimeout(() => split.classList.remove('error'), 1200);
    } finally {
      addBtn.classList.remove('busy');
    }
  }

  function createSplitControl(url, container) {
    const mount = findBestMount(container);
    if (!mount) return null;

    let existing = mount.querySelector(`:scope > .${SPLIT_CLASS}`) || mount.querySelector(`.${SPLIT_CLASS}`) || container.querySelector(`.${SPLIT_CLASS}`);
    if (existing) return existing;

    ensureRelativePosition(mount);

    const split = document.createElement('div');
    split.className = SPLIT_CLASS;
    split.setAttribute('data-video-url', url);
    // Base styles for the split control
    const isInQueue = urlSet.has(url);
    split.style.cssText = `
      position: absolute;
      top: 8px;
      left: 8px;
      width: 24px;
      height: 24px;
      background: ${isInQueue ? '#4CAF50' : 'rgba(255, 255, 255, 0.9)'};
      color: ${isInQueue ? 'white' : '#333'};
      border: ${isInQueue ? 'none' : '2px solid #ddd'};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      transition: all 0.2s ease;
      user-select: none;
    `;

    const addBtn = document.createElement('div');
    addBtn.className = 'qefy-add';
    // Decide state using canonical URL
    const videoInQueue = urlSet.has(url);
    addBtn.textContent = videoInQueue ? '✓' : '+';
    addBtn.title = videoInQueue ? 'In queue - click to move/remove' : 'Click to add video';
    // Background reflect state immediately
    setSplitState(split, videoInQueue);

    // Add hover effect and folder name toast or login tooltip
    split.addEventListener('mouseenter', () => {
      split.style.transform = 'scale(1.1)';
      split.style.boxShadow = '0 4px 8px rgba(0,0,0,0.4)';
      
      if (!isSignedIn()) {
        // Add a small delay to prevent rapid flashing
        if (loginTooltipTimeout) {
          clearTimeout(loginTooltipTimeout);
        }
        loginTooltipTimeout = setTimeout(() => {
          showLoginTooltip(split, container);
        }, 50);
        return;
      }
      // Show folder name toast if video is in queue
      if (urlSet.has(url)) {
        showFolderNameToast(split, url);
      }
    });

    split.addEventListener('mouseleave', () => {
      split.style.transform = 'scale(1)';
      split.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
      
      // Clear any pending tooltip show
      if (loginTooltipTimeout) {
        clearTimeout(loginTooltipTimeout);
        loginTooltipTimeout = null;
      }
      
      // Hide login or folder toast
      hideLoginTooltip();
      hideFolderNameToast();
    });

    // Left click - if guest open popup, else expand or show move/remove
    split.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      if (!isSignedIn()) {
        try { chrome.runtime.sendMessage({ type: 'OPEN_ACTION_POPUP' }, () => void chrome.runtime.lastError); } catch (_) {}
        return;
      }

      // Re-canonicalize URL to ensure consistency
      const canonUrl = canonicalWatchUrlFromId(extractVideoIdFromUrl(url)) || url;
      
      if (urlSet.has(canonUrl)) {
        // Video is already in queue - show folder selection for move/remove
        showMoveRemoveMenu(split, canonUrl, split, addBtn, container);
        return;
      }
      
      // Check if AI is currently processing for this video
      if (aiProcessingState.isProcessing(canonUrl)) {
        console.log('[QEFY YouTube] ⏳ Video is currently being processed by AI:', canonUrl);
        return; // Don't allow expansion while AI is processing
      }
      
      // Video not in queue - expand to show options
      expandOptions(split, canonUrl, container, addBtn);
    });

    // Right click - if guest open popup, else show folder menu OR move/remove menu
    split.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!isSignedIn()) {
        try { chrome.runtime.sendMessage({ type: 'OPEN_ACTION_POPUP' }, () => void chrome.runtime.lastError); } catch (_) {}
        return;
      }

      // Collapse any expanded options first
      collapseOptions(split);
      
      // Debounce rapid clicks
      if (folderMenuTimeout) {
        clearTimeout(folderMenuTimeout);
      }
      
      folderMenuTimeout = setTimeout(() => {
        const canonUrl = canonicalWatchUrlFromId(extractVideoIdFromUrl(url)) || url;
        
        if (urlSet.has(canonUrl)) {
          // Video is already in queue - show move/remove menu
          showMoveRemoveMenu(split, canonUrl, split, addBtn, container);
        } else {
          // Video not in queue - show folder selection for adding (preserves current behavior)
          showFolderMenu(split, canonUrl, split, addBtn, container);
        }
        folderMenuTimeout = null;
      }, 100); // 100ms debounce
    });

    split.appendChild(addBtn);
    // Guest indicator container lives on split element; ensure it sits on top-left
    applyGuestIndicator(split);

    // Initial state based on existing queue - but don't override AI processing state
    if (aiProcessingState.isProcessing(url)) {
      console.log('[QEFY YouTube] ⏳ Preserving AI processing state during createSplitControl for:', url);
      setSplitState(split, false, '', true); // Keep processing state
    } else {
      setSplitState(split, urlSet.has(url));
    }

    // Apply guest indicator initially
    applyGuestIndicator(split);

    // Mount as a direct child (same hierarchy as overlays) inside yt-thumbnail-view-model when possible
    mount.appendChild(split);
    return split;
  }

  function scan() {
    const candidates = new Set();
    document.querySelectorAll([
      'ytd-rich-grid-media',
      'ytd-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-grid-video-renderer',
      'ytd-playlist-video-renderer',
      'ytd-reel-item-renderer',
      'ytd-watch-card-compact-video-renderer',
      'ytd-shorts-video-renderer',
      'ytd-thumbnail',
      'a#thumbnail',
      'a.ytd-thumbnail',
      'yt-lockup-view-model',
      '.yt-lockup-view-model-wiz__content-image',
      'yt-thumbnail-view-model',
      '.yt-thumbnail-view-model__image',
      "a[href^='/watch']",
      "a[href^='https://www.youtube.com/watch']"
    ].join(",")).forEach((el) => candidates.add(el));

    candidates.forEach((container) => {
      const url = getVideoUrlFromContainer(container);
      if (!url) return;
      const split = createSplitControl(url, container);
      if (!split) return;
      
      // Don't update state if AI is currently processing this video
      if (aiProcessingState.isProcessing(url)) {
        console.log('[QEFY YouTube] ⏳ Skipping scan state update for', url, '- AI is processing');
        return;
      }
      
      setSplitState(split, urlSet.has(url));
    });
  }

  // Debounced observer scheduling
  let scanScheduled=false, scanTimer=null; let lastRun=0;
  function scheduleScan() {
    const now = Date.now();
    if (scanScheduled && now - lastRun < 2000) return;
    scanScheduled = true;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanScheduled = false;
      lastRun = Date.now();
      scan();
      initWatchPage();
    }, 450);
  }

  function observe() {
    const root = document.body;
    if (!root) return;
    const mo = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => {
        // Watch for added nodes
        if (m.addedNodes && m.addedNodes.length > 0) return true;
        // Watch for attribute changes on ytd-thumbnail elements (especially use-hovered-property)
        if (m.type === 'attributes') {
          const target = m.target;
          // Check if it's a thumbnail element or inside one
          const thumbnail = target.nodeName === 'YTD-THUMBNAIL' ? target : target.closest('ytd-thumbnail');
          if (thumbnail) {
            // Trigger scan when thumbnail hover state changes or when overlay elements are added/modified
            return true;
          }
        }
        return false;
      });
      if (relevant) scheduleScan();
    });
    // Watch for both childList changes (new elements) and attribute changes (hover state)
    mo.observe(root, { 
      childList: true, 
      subtree: true,
      attributes: true,
      attributeFilter: ['use-hovered-property', 'hovered'] // Specifically watch for hover-related attributes
    });
  }

  function initWatchPage() {
    if (!location.pathname.startsWith("/watch")) return;
    const player = document.getElementById("movie_player") || document.getElementById("player-container") || document.querySelector("#player, ytd-player");
    if (player && !player.querySelector(`.${SPLIT_CLASS}`)) {
      const url = location.href;
      const split = createSplitControl(url, player);
      if (split) setSplitState(split, urlSet.has(url));
    }
  }

  function attachYtNavListeners() {
    document.addEventListener("yt-navigate-finish", () => {
      scheduleScan();
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[QEFY YouTube] Received message:', msg);
    console.log('[QEFY YouTube] Message type:', msg?.type);
    console.log('[QEFY YouTube] Sender:', sender);
    
    if (msg?.type === 'COMPILED_QUEUE_UPDATE') {
      lastQueueUpdate = Date.now(); // Update timestamp
      console.log('[QEFY YouTube] Processing COMPILED_QUEUE_UPDATE:', msg.payload);
      
      if (msg.payload) {
        // Extract canonical URLs from the compiled queue regardless of shape
        const urls = [];
        const pushItemUrl = (it) => {
          if (!it) return;
          const raw = it.link || it.url || it.href || null;
          const vid = raw ? extractVideoIdFromUrl(raw) : null;
          const canon = canonicalWatchUrlFromId(vid);
          if (canon) urls.push(canon);
        };
        const q = msg.payload.queue || msg.payload; // tolerate payloads with queue inside or as root
        if (q?.folders && typeof q.folders === 'object') {
          Object.values(q.folders).forEach(arr => {
            if (Array.isArray(arr)) arr.forEach(pushItemUrl);
          });
        } else {
          // Some docs might be { recently_added: [...], ... }
          Object.values(q || {}).forEach(val => {
            if (Array.isArray(val)) val.forEach(pushItemUrl);
          });
        }
        urlSet = new Set(urls);
        console.log('[QEFY YouTube] Updated URL set:', urlSet.size, 'URLs');
        
        // Update all existing icons to reflect new queue state
        updateAllIconStates();
      }
      
      if (msg.payload?.queue?.foldersOrdering || msg.payload?.foldersOrdering) {
        // Update folders from folderOrdering, filtering out done and trash
        const ord = msg.payload.queue?.foldersOrdering || msg.payload.foldersOrdering || [];
        const newFolders = ord.filter(f => f && f !== 'done' && f !== 'trash');
        console.log('[QEFY YouTube] Original folderOrdering:', msg.payload.queue.foldersOrdering);
        console.log('[QEFY YouTube] Filtered folders:', newFolders);
        if (newFolders.length > 0) {
          folders = newFolders;
          console.log('[QEFY YouTube] Updated folders variable:', folders);
        } else {
          console.log('[QEFY YouTube] No valid folders found, keeping current:', folders);
        }
      }
      scheduleScan();
    }
  });

  // Listen for updates from background (queue and auth state)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'AUTH_STATE_UPDATE') {
      authState = msg.payload || { status: 'signed_out' };
      // Update all icons to reflect guest vs signed-in state
      updateAllIconStates();
    }
  });

  // Request current state from background
  chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, (response) => {
    console.log('[QEFY YouTube] POPUP_GET_STATE response:', response);
    if (response && response.authState) {
      authState = response.authState;
    }
    if (response && response.latestCompiledQueue) {
      // Update folders and URLs from the response
      if (response.latestCompiledQueue.queue?.foldersOrdering || response.latestCompiledQueue.foldersOrdering) {
        const ord = response.latestCompiledQueue.queue?.foldersOrdering || response.latestCompiledQueue.foldersOrdering || [];
        const newFolders = ord.filter(f => f && f !== 'done' && f !== 'trash');
        if (newFolders.length > 0) {
          folders = newFolders;
          console.log('[QEFY YouTube] Initial folders from POPUP_GET_STATE:', folders);
        } else {
          console.log('[QEFY YouTube] No valid folders found, keeping defaults:', folders);
        }
      }
      
      const q = response.latestCompiledQueue.queue || response.latestCompiledQueue;
      if (q) {
        const urls = [];
        const pushItemUrl = (it) => {
          if (!it) return;
          const raw = it.link || it.url || it.href || null;
          const vid = raw ? extractVideoIdFromUrl(raw) : null;
          const canon = canonicalWatchUrlFromId(vid);
          if (canon) urls.push(canon);
        };
        if (q.folders && typeof q.folders === 'object') {
          Object.values(q.folders).forEach(arr => {
            if (Array.isArray(arr)) arr.forEach(pushItemUrl);
          });
        } else {
          Object.values(q).forEach(val => {
            if (Array.isArray(val)) val.forEach(pushItemUrl);
          });
        }
        urlSet = new Set(urls);
        console.log('[QEFY YouTube] Initial URL set from POPUP_GET_STATE:', urlSet.size, 'URLs');
        
        // Update all existing icons to reflect initial queue state
        setTimeout(() => updateAllIconStates(), 100);
      }
    } else {
      console.log('[QEFY YouTube] No response from POPUP_GET_STATE, using default folders:', folders);
    }
  });

  // Also request folders directly from background after a delay
  setTimeout(() => {
    console.log('[QEFY YouTube] Requesting folders from background...');
    chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, (response) => {
      if (response && response.latestCompiledQueue?.queue?.foldersOrdering) {
        const newFolders = response.latestCompiledQueue.queue.foldersOrdering.filter(f => f && f !== 'done' && f !== 'trash');
        if (newFolders.length > 0) {
          folders = newFolders;
          console.log('[QEFY YouTube] Updated folders from delayed request:', folders);
        }
        // Only update icons if we have a valid URL set to avoid overriding correct state
        if (urlSet.size > 0) {
          updateAllIconStates();
        }
      }
    });
  }, 1000);

  // Additional folder request after 3 seconds to ensure we have the latest data
  setTimeout(() => {
    console.log('[QEFY YouTube] Second folder request...');
    chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, (response) => {
      if (response && response.latestCompiledQueue?.queue?.foldersOrdering) {
        const newFolders = response.latestCompiledQueue.queue.foldersOrdering.filter(f => f && f !== 'done' && f !== 'trash');
        if (newFolders.length > 0) {
          folders = newFolders;
          console.log('[QEFY YouTube] Updated folders from second request:', folders);
        }
      }
    });
  }, 3000);

  // Request a fresh queue update after a short delay
  setTimeout(() => {
    console.log('[QEFY YouTube] Requesting fresh queue update...');
    chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, (response) => {
      if (response && response.latestCompiledQueue) {
        // Manually trigger the COMPILED_QUEUE_UPDATE handler
        const msg = { type: 'COMPILED_QUEUE_UPDATE', payload: response.latestCompiledQueue };
        console.log('[QEFY YouTube] Manually triggering queue update:', msg);
        
        if (msg.payload) {
          // Extract URLs from the compiled queue using the same logic as the main handler
          const urls = [];
          const pushItemUrl = (it) => {
            if (!it) return;
            const raw = it.link || it.url || it.href || null;
            const vid = raw ? extractVideoIdFromUrl(raw) : null;
            const canon = canonicalWatchUrlFromId(vid);
            if (canon) urls.push(canon);
          };
          
          const q = msg.payload.queue || msg.payload;
          console.log('[QEFY YouTube] Queue structure for manual update:', {
            hasQueue: !!msg.payload.queue,
            hasFolders: !!q?.folders,
            foldersType: typeof q?.folders,
            foldersKeys: q?.folders ? Object.keys(q.folders) : [],
            directKeys: Object.keys(q || {})
          });
          
          if (q?.folders && typeof q.folders === 'object') {
            Object.values(q.folders).forEach(arr => {
              if (Array.isArray(arr)) arr.forEach(pushItemUrl);
            });
          } else {
            // Some docs might be { recently_added: [...], ... }
            Object.values(q || {}).forEach(val => {
              if (Array.isArray(val)) val.forEach(pushItemUrl);
            });
          }
          
          const newUrlSet = new Set(urls);
          console.log('[QEFY YouTube] Manual URL set update:', newUrlSet.size, 'URLs');
          
          // Only update if we have a different URL set to avoid unnecessary state changes
          // Also prevent clearing the URL set if we had URLs before and the new set is empty
          if (newUrlSet.size > 0 || urlSet.size === 0) {
            if (newUrlSet.size !== urlSet.size || ![...newUrlSet].every(url => urlSet.has(url))) {
              urlSet = newUrlSet;
              // Update all existing icons to reflect new queue state
              updateAllIconStates();
            } else {
              console.log('[QEFY YouTube] URL set unchanged, skipping icon update');
            }
          } else {
            console.log('[QEFY YouTube] Preventing URL set from being cleared (had', urlSet.size, 'URLs, new set is empty)');
          }
        }
        
        if (msg.payload?.queue?.foldersOrdering) {
          // Update folders from folderOrdering, filtering out done and trash
          const newFolders = msg.payload.queue.foldersOrdering.filter(f => f && f !== 'done' && f !== 'trash');
          console.log('[QEFY YouTube] Manual folder update:', newFolders);
          if (newFolders.length > 0) {
            folders = newFolders;
            console.log('[QEFY YouTube] Manual folders updated:', folders);
          }
        }
      }
    });
  }, 2000);

  try {
    console.log('[QEFY YouTube] Content script loaded on:', window.location.href);
    
    // Add a visible test indicator
    const testElement = document.createElement('div');
    testElement.innerHTML = 'QEFY LOADED';
    testElement.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: red;
      color: white;
      padding: 5px 10px;
      z-index: 999999;
      font-size: 12px;
      border-radius: 3px;
    `;
    document.body.appendChild(testElement);

    // Remove test element after 3 seconds
    setTimeout(() => {
      if (testElement.parentNode) {
        testElement.parentNode.removeChild(testElement);
      }
    }, 3000);
    
    // Test message to background
    chrome.runtime.sendMessage({ type: 'TEST_MESSAGE', payload: 'YouTube content script is ready' }, (response) => {
      console.log('[QEFY YouTube] Test message response:', response);
    });
    
    scan();
    initWatchPage();
    observe();
    attachYtNavListeners();
  } catch (e) {
    console.error("QEFY YouTube content script init error:\n", e);
  }
})();

  // -------- Guest UX helpers --------
  function applyGuestIndicator(splitEl) {
    try {
      const existingDot = splitEl.querySelector('.qefy-red-dot');
      if (!isSignedIn()) {
        if (!existingDot) {
          const dot = document.createElement('div');
          dot.className = 'qefy-red-dot';
          dot.style.cssText = `
            position: absolute;
            top: -4px;
            right: -4px;
            width: 12px;
            height: 12px;
            background: #ff3b30;
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 0 0 1px rgba(0,0,0,0.2);
            pointer-events: none;
          `;
          splitEl.appendChild(dot);
        }
      } else if (existingDot) {
        existingDot.remove();
      }
    } catch (_) {}
  }

  // Global state to track tooltip
  let loginTooltipTimeout = null;
  let isLoginTooltipVisible = false;

  function showLoginTooltip(splitEl, container) {
    try {
      // Clear any existing timeout
      if (loginTooltipTimeout) {
        clearTimeout(loginTooltipTimeout);
        loginTooltipTimeout = null;
      }

      // If tooltip is already visible, don't create another one
      if (isLoginTooltipVisible) {
        return;
      }

      hideLoginTooltip();
      const rect = splitEl.getBoundingClientRect();
      const tip = document.createElement('div');
      tip.className = 'qefy-login-tooltip';
      tip.textContent = 'Login on queuefy to save your videos. Tap to login';
      tip.style.cssText = `
        position: fixed;
        left: ${Math.round(rect.left + rect.width / 2)}px;
        top: ${Math.round(rect.bottom + 8)}px;
        transform: translate(-50%, 0);
        background: #ff4757;
        color: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.2s ease;
      `;
      document.body.appendChild(tip);
      
      // Mark as visible
      isLoginTooltipVisible = true;
      
      // Fade in the tooltip
      requestAnimationFrame(() => {
        tip.style.opacity = '1';
      });
    } catch (_) {}
  }

  function hideLoginTooltip() {
    try {
      // Clear any pending timeout
      if (loginTooltipTimeout) {
        clearTimeout(loginTooltipTimeout);
        loginTooltipTimeout = null;
      }

      const el = document.querySelector('.qefy-login-tooltip');
      if (el) {
        // Mark as not visible
        isLoginTooltipVisible = false;
        
        // Fade out the tooltip
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.2s ease';
        
        // Remove after fade out completes
        setTimeout(() => {
          if (el.parentNode) {
            el.remove();
          }
        }, 200);
      }
    } catch (_) {}
  }