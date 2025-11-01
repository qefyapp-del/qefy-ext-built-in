/**
 * AI Notification Manager
 * Global manager that decides between individual and batch notifications
 */

class AINotificationManager {
  constructor() {
    this.processingItems = new Map(); // Track all processing items globally
  }

  /**
   * Add a video to processing
   */
  addProcessingVideo(videoData, availableFolders = []) {
    if (!videoData.url) {
      return null;
    }
    
    // Store video data
    this.processingItems.set(videoData.url, { videoData, availableFolders });
    
    // Always use batch notification style (even for single items)
    if (!window.qefyAISimpleBatch) {
      return null;
    }
    
    // Always use batch mode
    window.qefyAISimpleBatch.addItem(videoData, availableFolders);
    
    // Return a wrapper for this specific video
    return new VideoNotificationWrapper(videoData.url, this);
  }

  /**
   * Use batch notification mode (always)
   */
  useBatchMode(videoData, availableFolders) {
    console.log('[AI Notification Manager] Using batch mode');
    
    // Clear any individual notifications
    if (window.qefyAINotificationStack) {
      window.qefyAINotificationStack.removeAll();
    }
    
    // Add this specific item to batch
    window.qefyAIBatchNotification.addProcessingItem(videoData, availableFolders);
  }

  /**
   * Complete processing for a video
   */
  completeVideo(videoUrl, folderName, availableFolders = []) {
    if (!this.processingItems.has(videoUrl)) {
      return;
    }

    // Check if the item is still in processing status in the batch
    if (window.qefyAISimpleBatch && window.qefyAISimpleBatch.hasItem(videoUrl)) {
      const batchItems = window.qefyAISimpleBatch.getProcessingItems();
      const batchItem = batchItems.get(videoUrl);
      
      if (batchItem && batchItem.status === 'success') {
        return;
      }
    }
    
    // Remove from processing
    this.processingItems.delete(videoUrl);
    
    // Update appropriate notification system
    if (window.qefyAISimpleBatch && window.qefyAISimpleBatch.hasItem(videoUrl)) {
      window.qefyAISimpleBatch.updateToSuccess(videoUrl, folderName, availableFolders);
    }
  }

  /**
   * Remove a video from processing
   */
  removeVideo(videoUrl) {
    this.processingItems.delete(videoUrl);
    
    // Remove from appropriate notification system
    if (window.qefyAISimpleBatch) {
      window.qefyAISimpleBatch.removeItem(videoUrl);
    }
  }

  startAIStepAnimation(notification, availableFolders) {
    // Use wrapper's AI step animation method
    if (window.qefyAINotificationWrapper) {
      window.qefyAINotificationWrapper.startAIStepAnimation(notification, availableFolders);
    }
  }
}

/**
 * Individual video notification wrapper
 */
class VideoNotificationWrapper {
  constructor(videoUrl, manager) {
    this.videoUrl = videoUrl;
    this.manager = manager;
  }

  showSuccess(folderName, availableFolders = []) {
    this.manager.completeVideo(this.videoUrl, folderName, availableFolders);
  }

  remove() {
    this.manager.removeVideo(this.videoUrl);
  }

  dismiss() {
    this.remove();
  }
}

/**
 * Simple API wrapper that maintains the original interface
 */
class AINotificationWrapper {
  constructor() {
    this.currentVideoUrl = null;
  }

  /**
   * Show processing notification
   */
  showProcessing(videoData, availableFolders = []) {
    if (!window.qefyAINotificationManager) {
      window.qefyAINotificationManager = new AINotificationManager();
    }
    
    // Add to global manager and get wrapper for this video
    const videoWrapper = window.qefyAINotificationManager.addProcessingVideo(videoData, availableFolders);
    
    // Store reference for this wrapper instance
    this.currentVideoUrl = videoData.url;
    this.videoWrapper = videoWrapper;
  }

  /**
   * Show success notification
   */
  showSuccess(folderName, availableFolders = []) {
    if (this.videoWrapper) {
      this.videoWrapper.showSuccess(folderName, availableFolders);
    }
  }

  /**
   * Remove current notification
   */
  remove() {
    if (this.videoWrapper) {
      this.videoWrapper.remove();
    }
    this.currentVideoUrl = null;
    this.videoWrapper = null;
  }

  /**
   * Dismiss current notification with animation
   */
  dismiss() {
    this.remove();
  }

  /**
   * Get AI processing steps with proper folder messages
   */
  getAIProcessingSteps(availableFolders = []) {
    const baseSteps = [
      "extracting the thumbnail",
      "checking the title", 
      "analyzing the content",
      "thinking",
      "searching for a folder that matches"
    ];
    
    // Add folder suggestions with proper formatting
    const folderSteps = [];
    if (availableFolders.length > 0) {
      // Filter out system folders and get user folders
      const userFolders = availableFolders.filter(f => f !== 'done' && f !== 'trash' && f !== 'recently_added');
      
      if (userFolders.length > 0) {
        // Pick 2-3 random folders
        const shuffled = [...userFolders].sort(() => 0.5 - Math.random());
        const selectedFolders = shuffled.slice(0, Math.min(3, userFolders.length));
        
        selectedFolders.forEach(folder => {
          folderSteps.push(`Maybe ${folder}`);
          if (Math.random() > 0.5) {
            folderSteps.push(`Looks like ${folder} is a good fit`);
          }
        });
      }
      
      // Always add recently_added as a fallback option
      folderSteps.push('Maybe recently_added');
    }
    
    return [...baseSteps, ...folderSteps];
  }

  /**
   * Start AI processing step animation
   */
  startAIStepAnimation(notification, availableFolders = []) {
    if (!notification || !notification.container) return;

    const steps = this.getAIProcessingSteps(availableFolders);
    notification.currentStep = 0;
    
    // Update initial step
    this.updateAIStepDisplay(notification, steps);
    
    // Start step cycling every 2300ms
    notification.aiStepInterval = setInterval(() => {
      if (!notification.container || !notification.container.parentNode) {
        this.stopAIStepAnimation(notification);
        return;
      }
      
      notification.currentStep = (notification.currentStep + 1) % steps.length;
      this.updateAIStepDisplay(notification, steps);
    }, 2300);
    
    console.log('[AI Notification Wrapper] Started AI step animation with', steps.length, 'steps');
  }

  /**
   * Stop AI processing step animation
   */
  stopAIStepAnimation(notification) {
    if (notification && notification.aiStepInterval) {
      clearInterval(notification.aiStepInterval);
      notification.aiStepInterval = null;
    }
  }

  /**
   * Update AI step display
   */
  updateAIStepDisplay(notification, steps) {
    if (!notification || !notification.container) return;
    
    const statusElement = notification.container.querySelector('.ai-status-text');
    if (statusElement && steps[notification.currentStep]) {
      statusElement.textContent = steps[notification.currentStep];
    }
  }
}

// Create global instance
if (typeof window !== 'undefined') {
  window.qefyAINotificationWrapper = new AINotificationWrapper();
  
  // Also provide it as the original name for compatibility
  window.qefyAINotification = window.qefyAINotificationWrapper;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AINotificationWrapper;
}