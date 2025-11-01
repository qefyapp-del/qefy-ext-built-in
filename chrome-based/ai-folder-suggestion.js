/**
 * AI Folder Suggestion Service
 * Uses Chrome's built-in AI APIs to suggest the best folder for a video
 */

class AIFolderSuggestionService {
  constructor() {
    this.isAvailable = false;
    this.checkAvailability();
  }

  async checkAvailability() {
    try {
      if (typeof LanguageModel !== 'undefined') {
        const availability = await LanguageModel.availability();
        this.isAvailable = availability === 'available';
      } else {
        this.isAvailable = false;
      }
    } catch (error) {
      this.isAvailable = false;
    }
  }

  async recheckAvailability() {
    await this.checkAvailability();
    return this.isAvailable;
  }

  async waitForDownload(maxWaitTime = 300000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      await this.checkAvailability();
      
      if (this.isAvailable) {
        return true;
      }
      
      if (typeof LanguageModel !== 'undefined') {
        const availability = await LanguageModel.availability();
        
        if (availability === 'downloading') {
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          break;
        }
      } else {
        break;
      }
    }
    
    return false;
  }

  async suggestFolderFromQueue(videoTitle, queueDocument, availableFolders, thumbnailUrl = null, duration = null, channelName = null) {
    if (!this.isAvailable || !videoTitle || !queueDocument) {
      return this.getFallbackFolder(availableFolders);
    }

    try {
      const prompt = await this.createPromptFromQueue(videoTitle, queueDocument, availableFolders, thumbnailUrl, duration, channelName);
      const suggestion = await this.getAISuggestion(prompt);
      return this.validateSuggestion(suggestion, availableFolders.map(name => ({ name })));
    } catch (error) {
      return this.getFallbackFolder(availableFolders);
    }
  }


  extractFolderContentsDetailed(queueDocument) {
    if (!queueDocument || !queueDocument.queue) {
      return 'No folders found';
    }
    
    const queue = queueDocument.queue;
    const folderNames = Object.keys(queue);
    
    return folderNames.map(folderName => {
      const items = queue[folderName];
      
      if (!Array.isArray(items) || items.length === 0) {
        return `📁_____FOLDER CONTENT___________
FolderName: ${folderName}

No media items in this folder.`;
      }
      
      const mediaItems = items
        .slice(0, 5)
        .map((item) => {
          let title = 'Unknown Title';
          if (item.metadata && item.metadata.title) {
            title = item.metadata.title;
          } else if (item.title) {
            title = item.title;
          } else if (item.url) {
            const videoId = item.url.match(/[?&]v=([^&]+)/)?.[1] || 
                           item.url.match(/youtu\.be\/([^?]+)/)?.[1];
            title = videoId ? `YouTube Video ${videoId}` : 'YouTube Video';
          }
          
          let description = 'No description available';
          if (item.metadata && item.metadata.description) {
            description = item.metadata.description;
          } else if (item.description) {
            description = item.description;
          }
          
          let duration = 'Unknown duration';
          if (item.metadata && item.metadata.duration) {
            duration = this.formatDuration(item.metadata.duration);
          } else if (item.duration) {
            duration = this.formatDuration(item.duration);
          }
          
          return `▶️ Media item: Title: ${title}
Description: ${description}
Duration: ${duration}`;
        });
      
      return `📁_____FOLDER CONTENT___________
FolderName: ${folderName}

${mediaItems.join('\n\n')}`;
    }).join('\n\n');
  }


  async extractThumbnailDescription(imageUrl) {
    try {
      const imageBlob = await this.convertImageUrlToBlob(imageUrl);
      
      const descriptionPrompt = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              value: 'Describe this YouTube video thumbnail in 1-2 sentences. Focus on the main subject, colors, text, and overall theme. Be concise and descriptive.'
            },
            {
              type: 'image',
              value: imageBlob
            }
          ]
        }
      ];
      
      const description = await this.getAISuggestion(descriptionPrompt);
      return description.trim() || 'No description available';
    } catch (error) {
      return 'No description available';
    }
  }

  /**
   * Convert image URL to Blob for Chrome Prompt API
   * @param {string} imageUrl - The image URL
   * @returns {Promise<Blob>} - The image as a Blob
   */
  async convertImageUrlToBlob(imageUrl) {
    try {
      let response;
      try {
        response = await fetch(imageUrl, {
          mode: 'cors',
          credentials: 'omit'
        });
      } catch (corsError) {
        response = await fetch(imageUrl, {
          mode: 'no-cors'
        });
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      
      if (blob.size === 0) {
        throw new Error('Received empty image blob');
      }
      
      return blob;
    } catch (error) {
      throw error;
    }
  }

  async createPromptFromQueue(videoTitle, queueDocument, availableFolders, thumbnailUrl = null, duration = null, channelName = null) {
    console.log('[QEFY AI] Duration received:', duration, 'Type:', typeof duration);
    const folderContents = this.extractFolderContentsDetailed(queueDocument);
    
    const basePrompt = `You are a helpful assistant that categorizes YouTube videos into appropriate folders.
The user contains several folders, and usually, within the folders, the title of the video is related to the contents of the folder, the user could have content in different languages, so you need to consider the language of the video title and the folder name. Do your best, translate to english before thinking.

So sort based mainly on the folder name, and the media items inside the folder, their durations and descriptions.

Rules:
1. Choose the best folder that we could save a video with the video title "${videoTitle}".${channelName ? ` From channel "${channelName}".` : ''}${thumbnailUrl ? ' And with the video thumbnail showing "{thumb image description}".' : ''} And the duration "${duration ? this.formatDuration(duration) : 'Unknown duration'}".
2. If the selected videos looks like a news or trending video, and the user don't have any folder releated with news or trending, respond with "recently_added"
3. Do not suggest "trash" or "done" folders
4. Only suggest from the available FolderName listed above
5. Respond with only the folder name, nothing else

This is the current user playlist and items:

${folderContents}

Available folders for suggestion: ${availableFolders.join(', ')}

Suggested folder:`;

    if (thumbnailUrl) {
      try {
        const thumbnailDescription = await this.extractThumbnailDescription(thumbnailUrl);
        const promptWithThumbnail = basePrompt.replace(
          'And with the video thumbnail showing "{thumb image description}".',
          `And with the video thumbnail showing "${thumbnailDescription}".`
        );
        console.log('[QEFY AI] 🤖 AI Prompt:', promptWithThumbnail);
        return promptWithThumbnail;
      } catch (error) {
        console.log('[QEFY AI] 🤖 AI Prompt:', basePrompt);
        return basePrompt;
      }
    }
    
    console.log('[QEFY AI] 🤖 AI Prompt:', basePrompt);
    return basePrompt;
  }


  async getAISuggestion(prompt) {
    try {
      if (typeof LanguageModel !== 'undefined') {
        const availability = await LanguageModel.availability();
        if (availability === 'unavailable') {
          throw new Error('Chrome Prompt API is unavailable');
        }

        const sessionConfig = {
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              console.log(`[QEFY AI] Model download progress: ${Math.round(e.loaded * 100)}%`);
            });
          }
        };

        if (Array.isArray(prompt)) {
          sessionConfig.expectedInputs = [{ type: 'text' }, { type: 'image' }];
        }

        const session = await LanguageModel.create(sessionConfig);

        const response = await Promise.race([
          session.prompt(prompt, {
            temperature: 0.3,
            topK: 3,
      
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('AI request timeout')), 15000)
          )
        ]);

        session.destroy();
        return response.trim() || '';
      } else {
        throw new Error('Chrome Prompt API not available');
      }
    } catch (error) {
      throw error;
    }
  }

  validateSuggestion(suggestion, availableFolders) {
    if (!suggestion) {
      return this.getFallbackFolder(availableFolders);
    }

    const cleanSuggestion = suggestion.toLowerCase().trim().replace(/['"]/g, '');

    const matchingFolder = availableFolders.find(folder => 
      folder.name.toLowerCase() === cleanSuggestion
    );

    if (matchingFolder) {
      return matchingFolder.name;
    }

    const partialMatch = availableFolders.find(folder => 
      folder.name.toLowerCase().includes(cleanSuggestion) ||
      cleanSuggestion.includes(folder.name.toLowerCase())
    );

    if (partialMatch) {
      return partialMatch.name;
    }

    return 'recently_added';
  }

  formatDuration(duration) {
    if (!duration) {
      return 'Unknown duration';
    }
    
    const seconds = parseInt(duration);
    if (isNaN(seconds)) {
      return 'Unknown duration';
    }
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    let formatted;
    if (hours > 0) {
      formatted = `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      formatted = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    return formatted;
  }

  getFallbackFolder(folders) {
    return 'recently_added';
  }

  isAIAvailable() {
    return this.isAvailable;
  }

  async testAIService() {
    if (!this.isAvailable) {
      return false;
    }

    try {
      const testPrompt = 'What is 2+2? Respond with just the number.';
      const response = await this.getAISuggestion(testPrompt);
      return response.includes('4');
    } catch (error) {
      return false;
    }
  }

  async forceModelDownload() {
    try {
      if (typeof LanguageModel !== 'undefined') {
        const availability = await LanguageModel.availability();
        if (availability === 'downloadable') {
          const session = await LanguageModel.create({
            monitor(m) {
              m.addEventListener('downloadprogress', (e) => {
                console.log(`[QEFY AI] Download progress: ${Math.round(e.loaded * 100)}%`);
              });
            },
          });
          
          await session.prompt('Hello');
          session.destroy();
          await this.checkAvailability();
          return true;
        } else if (availability === 'available') {
          return true;
        } else {
          return false;
        }
      } else {
        return false;
      }
    } catch (error) {
      return false;
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIFolderSuggestionService;
} else if (typeof window !== 'undefined') {
  window.AIFolderSuggestionService = AIFolderSuggestionService;
}
