/**
 * Simple AI Batch Notification
 * Simplified version to fix the empty container issue
 */

class AISimpleBatch {
  constructor() {
    this.container = null;
    this.items = new Map();
    this.dismissTimer = null;
    this.isHovered = false;
  }

  addItem(videoData, availableFolders = []) {
    if (!videoData.url) {
      return;
    }

    // Store item
    const itemData = {
      ...videoData,
      status: 'processing',
      availableFolders: availableFolders,
      stepInterval: null,
      currentStep: 0
    };
    
    this.items.set(videoData.url, itemData);
    this.createOrUpdateContainer();
    this.startStepAnimation(videoData.url, availableFolders);
  }

  updateToSuccess(videoUrl, folderName, availableFolders = []) {
    const item = this.items.get(videoUrl);
    if (!item) {
      return;
    }

    // Stop step animation
    this.stopStepAnimation(videoUrl);

    // Update item
    const updatedItem = {
      ...item,
      status: 'success',
      folderName: folderName,
      availableFolders: availableFolders
    };
    
    this.items.set(videoUrl, updatedItem);
    this.createOrUpdateContainer();
    
    // Start dismiss timer if all complete
    if (this.allComplete()) {
      this.startDismissTimer();
    }
  }

  createOrUpdateContainer() {
    if (this.items.size === 0) {
      this.remove();
      return;
    }

    if (!this.container) {
      this.createContainer();
    }

    this.updateContent();
    
    if (this.container.style.opacity === '0') {
      this.show();
    }
  }

  createContainer() {
    // Remove only the DOM container, not the items data
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;

    this.container = document.createElement('div');
    this.container.id = 'ai-simple-batch';
    
    Object.assign(this.container.style, {
      position: 'fixed',
      bottom: '20px',
      left: '20px',
      zIndex: '2147483647',
      background: 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(10px)',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
      padding: '16px',
      minWidth: '380px',
      maxWidth: '480px',
      opacity: '0',
      transform: 'translateY(100px)',
      transition: 'all 0.3s ease',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#111827',
      border: '1px solid rgba(0, 0, 0, 0.1)',
      borderLeft: '4px solid #C51D10'
    });

    this.container.addEventListener('mouseenter', () => {
      this.isHovered = true;
      this.clearDismissTimer();
    });

    this.container.addEventListener('mouseleave', () => {
      this.isHovered = false;
      if (this.allComplete()) {
        this.startDismissTimer();
      }
    });

    document.body.appendChild(this.container);
  }

  updateContent() {
    if (!this.container) return;


    // Clear
    this.container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '12px',
      paddingBottom: '8px',
      borderBottom: '1px solid rgba(0, 0, 0, 0.1)'
    });

    const allItems = Array.from(this.items.values());
    const processingCount = allItems.filter(item => item.status === 'processing').length;
    const completedCount = allItems.filter(item => item.status === 'success').length;
    const totalCount = this.items.size;

    // Icon
    const icon = document.createElement('div');
    icon.style.fontSize = '16px';
    icon.textContent = processingCount > 0 ? '✨' : '✅';

    // Text
    const text = document.createElement('div');
    text.style.flex = '1';
    text.style.fontWeight = '600';
    text.style.fontSize = '14px';
    text.style.color = processingCount > 0 ? '#C51D10' : '#10b981';
    
    if (processingCount > 0) {
      // Show processing count, not total count
      text.textContent = `AI Processing ${processingCount} video${processingCount > 1 ? 's' : ''}...`;
    } else {
      text.textContent = `AI completed ${totalCount} video${totalCount > 1 ? 's' : ''}`;
    }
    

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      fontSize: '18px',
      cursor: 'pointer',
      color: '#666',
      width: '24px',
      height: '24px'
    });
    closeBtn.onclick = () => this.remove();

    header.appendChild(icon);
    header.appendChild(text);
    header.appendChild(closeBtn);
    this.container.appendChild(header);

    // Items
    const itemsContainer = document.createElement('div');
    Object.assign(itemsContainer.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });

    const itemValues = Array.from(this.items.values());
    
    itemValues.forEach((item, index) => {
      const itemElement = this.createSimpleItem(item);
      if (itemElement) {
        itemsContainer.appendChild(itemElement);
      }
    });

    this.container.appendChild(itemsContainer);
  }

  createSimpleItem(item) {
    const itemDiv = document.createElement('div');
    itemDiv.setAttribute('data-video-url', item.url);
    
    Object.assign(itemDiv.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px',
      borderRadius: '8px',
      background: item.status === 'processing' ? 'rgba(197, 29, 16, 0.05)' : 'rgba(16, 185, 129, 0.05)',
      border: `1px solid ${item.status === 'processing' ? 'rgba(197, 29, 16, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`
    });

    // Thumbnail
    const thumb = document.createElement('div');
    Object.assign(thumb.style, {
      width: '48px',
      height: '36px',
      borderRadius: '6px',
      background: '#f3f4f6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '16px',
      color: '#6b7280',
      flexShrink: '0'
    });

    if (item.thumbnail) {
      const img = document.createElement('img');
      img.src = item.thumbnail;
      img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
      img.onerror = () => { thumb.textContent = '📺'; };
      thumb.appendChild(img);
    } else {
      thumb.textContent = '📺';
    }

    // Content
    const content = document.createElement('div');
    content.style.flex = '1';
    content.style.minWidth = '0';

    // Title
    const title = document.createElement('div');
    title.textContent = item.title || 'Untitled Video';
    Object.assign(title.style, {
      fontWeight: '500',
      fontSize: '13px',
      marginBottom: '2px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    });

    // Channel
    if (item.channelName) {
      const channel = document.createElement('div');
      channel.textContent = item.channelName;
      Object.assign(channel.style, {
        fontSize: '11px',
        color: '#6b7280',
        marginBottom: '4px'
      });
      content.appendChild(channel);
    }

    content.appendChild(title);

    // Status
    const status = document.createElement('div');
    status.className = 'item-status';
    Object.assign(status.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '12px'
    });

    if (item.status === 'processing') {
      // Spinner
      const spinner = document.createElement('div');
      Object.assign(spinner.style, {
        width: '12px',
        height: '12px',
        border: '2px solid #C51D10',
        borderTop: '2px solid transparent',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      });

      const text = document.createElement('span');
      text.textContent = 'processing...';
      text.style.color = '#C51D10';

      status.appendChild(spinner);
      status.appendChild(text);
    } else {
      // Success
      const check = document.createElement('div');
      check.textContent = '✓';
      Object.assign(check.style, {
        width: '12px',
        height: '12px',
        background: '#10b981',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: '8px'
      });

      const text = document.createElement('span');
      text.textContent = `AI chose to add your video to the folder: ${item.folderName}`;
      text.style.color = '#10b981';

      status.appendChild(check);
      status.appendChild(text);
    }

    content.appendChild(status);

    itemDiv.appendChild(thumb);
    itemDiv.appendChild(content);

    return itemDiv;
  }

  startStepAnimation(videoUrl, availableFolders) {
    const item = this.items.get(videoUrl);
    if (!item || item.status !== 'processing') return;

    const steps = this.getSteps(availableFolders);
    
    item.stepInterval = setInterval(() => {
      const currentItem = this.items.get(videoUrl);
      if (!currentItem || currentItem.status !== 'processing') {
        this.stopStepAnimation(videoUrl);
        return;
      }

      currentItem.currentStep = (currentItem.currentStep + 1) % steps.length;
      this.items.set(videoUrl, currentItem);
      
      // Update display
      this.updateItemStatus(videoUrl, steps[currentItem.currentStep]);
    }, 2300);

    this.items.set(videoUrl, item);
  }

  stopStepAnimation(videoUrl) {
    const item = this.items.get(videoUrl);
    if (item && item.stepInterval) {
      clearInterval(item.stepInterval);
      item.stepInterval = null;
      this.items.set(videoUrl, item);
    }
  }

  updateItemStatus(videoUrl, stepText) {
    if (!this.container) return;

    const itemElement = this.container.querySelector(`[data-video-url="${videoUrl}"]`);
    if (!itemElement) return;

    const statusElement = itemElement.querySelector('.item-status span');
    if (statusElement) {
      statusElement.textContent = stepText;
    }
  }

  getSteps(availableFolders = []) {
    const baseSteps = [
      "extracting the thumbnail",
      "checking the title", 
      "analyzing the content",
      "thinking",
      "searching for a folder that matches"
    ];
    
    const folderSteps = [];
    if (availableFolders.length > 0) {
      const userFolders = availableFolders.filter(f => f !== 'done' && f !== 'trash');
      
      if (userFolders.length > 0) {
        const shuffled = [...userFolders].sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, Math.min(3, userFolders.length));
        
        selected.forEach(folder => {
          folderSteps.push(`Maybe ${folder}`);
          if (Math.random() > 0.5) {
            folderSteps.push(`Looks like ${folder} is a good fit`);
          }
        });
      }
      
      folderSteps.push('Maybe recently_added');
    }
    
    return [...baseSteps, ...folderSteps];
  }

  show() {
    if (!this.container) return;

    // Add spinner CSS
    if (!document.head.querySelector('#simple-batch-styles')) {
      const style = document.createElement('style');
      style.id = 'simple-batch-styles';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    this.container.offsetHeight;
    
    requestAnimationFrame(() => {
      this.container.style.opacity = '1';
      this.container.style.transform = 'translateY(0)';
    });
  }

  allComplete() {
    return Array.from(this.items.values()).every(item => item.status === 'success');
  }

  startDismissTimer() {
    if (this.isHovered) return;
    
    this.clearDismissTimer();
    this.dismissTimer = setTimeout(() => {
      this.dismiss();
    }, 5000);
  }

  clearDismissTimer() {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  dismiss() {
    if (!this.container) return;

    this.clearDismissTimer();
    
    this.container.style.opacity = '0';
    this.container.style.transform = 'translateY(100px)';
    
    setTimeout(() => {
      this.remove();
    }, 300);
  }

  remove() {
    this.clearDismissTimer();
    
    // Stop all animations
    this.items.forEach((item, url) => {
      this.stopStepAnimation(url);
    });
    
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    
    this.container = null;
    this.items.clear();
    this.isHovered = false;
  }

  removeItem(videoUrl) {
    this.stopStepAnimation(videoUrl);
    this.items.delete(videoUrl);
    
    if (this.items.size === 0) {
      this.remove();
    } else {
      this.createOrUpdateContainer();
    }
  }

  // Utility methods
  getItemCount() {
    return this.items.size;
  }

  hasItem(videoUrl) {
    return this.items.has(videoUrl);
  }

  getProcessingItems() {
    return new Map(this.items);
  }
}

// Create global instance
if (typeof window !== 'undefined') {
  window.qefyAISimpleBatch = new AISimpleBatch();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AISimpleBatch;
}