/**
 * Tab Data Extractor
 * Extracts video metadata from YouTube pages via DOM inspection
 */

(function() {
  'use strict';

  // Listen for extraction requests
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_VIDEO_DATA_FROM_TAB') {
      console.log('[QEFY Tab Extractor] Extracting video data from current tab');
      
      try {
        const videoData = extractVideoData();
        console.log('[QEFY Tab Extractor] Successfully extracted data:', videoData);
        sendResponse({ ok: true, data: videoData });
      } catch (error) {
        console.error('[QEFY Tab Extractor] Error extracting data:', error);
        sendResponse({ ok: false, error: error.message });
      }
      
      return true; // Keep message channel open for async response
    }
  });

  /**
   * Extract video data from the current YouTube page
   */
  function extractVideoData() {
    const url = window.location.href;
    const videoId = extractVideoId(url);
    
    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }

    // Try multiple methods to extract data
    const data = {
      url: url,
      videoId: videoId,
      title: extractTitle(),
      description: extractDescription(),
      duration: extractDuration(),
      thumbnail: constructThumbnailUrl(videoId),
      channelName: extractChannelName()
    };

    return data;
  }

  /**
   * Extract video ID from URL
   */
  function extractVideoId(url) {
    try {
      const urlObj = new URL(url);
      
      // Standard watch URL
      if (urlObj.pathname === '/watch') {
        return urlObj.searchParams.get('v');
      }
      
      // Shorts URL
      const shortsMatch = urlObj.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) {
        return shortsMatch[1];
      }
      
      // Embed URL
      const embedMatch = urlObj.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch) {
        return embedMatch[1];
      }
      
      // youtu.be short URL
      if (urlObj.hostname === 'youtu.be') {
        return urlObj.pathname.slice(1).split('?')[0];
      }
    } catch (e) {
      console.error('[QEFY Tab Extractor] Error extracting video ID:', e);
    }
    
    return null;
  }

  /**
   * Extract video title
   */
  function extractTitle() {
    // Try ytInitialPlayerResponse first
    try {
      const playerResponse = getYtInitialPlayerResponse();
      if (playerResponse?.videoDetails?.title) {
        return playerResponse.videoDetails.title;
      }
    } catch (e) {
      console.log('[QEFY Tab Extractor] Could not get title from ytInitialPlayerResponse');
    }

    // Try DOM elements
    const selectors = [
      'h1.ytd-watch-metadata yt-formatted-string',
      'h1.ytd-video-primary-info-renderer',
      'ytd-watch-metadata h1',
      'h1.title',
      'meta[name="title"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const title = element.getAttribute('content') || element.textContent;
        if (title && title.trim()) {
          return title.trim();
        }
      }
    }

    // Fallback to document title
    const docTitle = document.title;
    if (docTitle && docTitle !== 'YouTube') {
      return docTitle.replace(' - YouTube', '').trim();
    }

    return 'Unknown Title';
  }

  /**
   * Extract video description
   */
  function extractDescription() {
    // Try ytInitialData first
    try {
      const playerResponse = getYtInitialPlayerResponse();
      if (playerResponse?.videoDetails?.shortDescription) {
        return playerResponse.videoDetails.shortDescription;
      }
    } catch (e) {
      console.log('[QEFY Tab Extractor] Could not get description from ytInitialPlayerResponse');
    }

    // Try meta tag
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && metaDesc.content) {
      return metaDesc.content;
    }

    // Try description element
    const descElement = document.querySelector('ytd-text-inline-expander#description-inline-expander');
    if (descElement) {
      const text = descElement.textContent;
      if (text && text.trim()) {
        return text.trim();
      }
    }

    return 'No description available';
  }

  /**
   * Extract video duration in seconds
   */
  function extractDuration() {
    // Try ytInitialPlayerResponse first
    try {
      const playerResponse = getYtInitialPlayerResponse();
      if (playerResponse?.videoDetails?.lengthSeconds) {
        return parseInt(playerResponse.videoDetails.lengthSeconds);
      }
    } catch (e) {
      console.log('[QEFY Tab Extractor] Could not get duration from ytInitialPlayerResponse');
    }

    // Try video element
    const video = document.querySelector('video');
    if (video && video.duration && Number.isFinite(video.duration)) {
      return Math.floor(video.duration);
    }

    // Try time display elements
    const timeSelectors = [
      '.ytp-time-duration',
      '.video-time .ytp-time-duration'
    ];

    for (const selector of timeSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        const duration = parseTimeString(element.textContent);
        if (duration > 0) {
          return duration;
        }
      }
    }

    return 0;
  }

  /**
   * Extract channel name
   */
  function extractChannelName() {
    // Try ytInitialPlayerResponse first
    try {
      const playerResponse = getYtInitialPlayerResponse();
      if (playerResponse?.videoDetails?.author) {
        return playerResponse.videoDetails.author;
      }
    } catch (e) {
      console.log('[QEFY Tab Extractor] Could not get channel name from ytInitialPlayerResponse');
    }

    // Try DOM elements
    const selectors = [
      'ytd-channel-name a',
      'ytd-video-owner-renderer .ytd-channel-name a',
      '#owner-name a',
      '#channel-name a'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }

    return null;
  }

  /**
   * Get ytInitialPlayerResponse from page scripts
   */
  function getYtInitialPlayerResponse() {
    // Check if it's already in window
    if (window.ytInitialPlayerResponse) {
      return window.ytInitialPlayerResponse;
    }

    // Try to extract from script tags
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent;
      if (content && content.includes('ytInitialPlayerResponse')) {
        try {
          const match = content.match(/var ytInitialPlayerResponse = ({.+?});/);
          if (match && match[1]) {
            return JSON.parse(match[1]);
          }
        } catch (e) {
          console.log('[QEFY Tab Extractor] Failed to parse ytInitialPlayerResponse');
        }
      }
    }

    return null;
  }

  /**
   * Parse time string (e.g., "10:30" or "1:05:30") to seconds
   */
  function parseTimeString(timeStr) {
    if (!timeStr) return 0;
    
    const parts = timeStr.trim().split(':').map(p => parseInt(p) || 0);
    
    if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    
    return 0;
  }

  /**
   * Construct thumbnail URL from video ID
   */
  function constructThumbnailUrl(videoId) {
    if (!videoId) return null;
    
    // Try maxresdefault first (highest quality)
    return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  }

  console.log('[QEFY Tab Extractor] Content script loaded and ready');
})();







