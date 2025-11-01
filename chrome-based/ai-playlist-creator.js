/**
 * AI Playlist Creator Service
 * Uses Chrome's built-in AI APIs to create custom playlists based on user prompts
 * This service is specifically designed for playlist generation, not folder categorization
 */

class AIPlaylistCreatorService {
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

  /**
   * Create a custom playlist based on user's natural language prompt
   * @param {string} userPrompt - User's request (e.g., "Create a 50-minute lunch playlist with trivia videos")
   * @param {Array} videos - Array of video objects from user's queue
   * @returns {Object} { folderName: string, videos: Array }
   */
  async createPlaylist(userPrompt, videos, onBatchComplete = null) {
    if (!this.isAvailable || !userPrompt || !videos || videos.length === 0) {
      console.warn('[QEFY AI Playlist] Service not available or invalid input');
      return null;
    }

    try {
      // Use batches of 10 videos for better nano model performance
      const batchSize = 10;
      
      if (videos.length <= batchSize) {
        console.log('[QEFY AI Playlist] Processing', videos.length, 'videos in single batch');
        return await this.processSingleBatch(userPrompt, videos);
      }

      // Split into batches of 10 videos and process in parallel
      console.log('[QEFY AI Playlist] Processing', videos.length, 'videos in batches of', batchSize);
      return await this.processMultipleBatches(userPrompt, videos, onBatchComplete);
      
    } catch (error) {
      console.error('[QEFY AI Playlist] Error creating playlist:', error);
      return null;
    }
  }

  /**
   * Process a single batch of videos
   */
  async processSingleBatch(userPrompt, videos, skipOptimization = false) {
    let searchTopic = userPrompt;
    
    // Step 0: Optimize user prompt for better search accuracy (unless already optimized)
    if (!skipOptimization) {
      console.log('[QEFY AI Playlist] 🔧 Step 0: Optimizing user prompt...');
      searchTopic = await this.optimizeUserPrompt(userPrompt);
      console.log(`[QEFY AI Playlist] Using optimized topic: "${searchTopic}"`);
    }
    
    // Step 1: Content matching with optimized prompt
    const prompt = this.buildPlaylistPrompt(searchTopic, videos);
    
    // Print the full prompt to console
    console.log('[QEFY AI Playlist] 🎵 Step 1: Content Matching Prompt:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(prompt);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const response = await this.callAI(prompt);
    console.log('[QEFY AI Playlist] 🤖 Content Matching Response:', response);
    
    const result = this.parsePlaylistResponse(response, videos);
    
    if (!result || !result.videos || result.videos.length === 0) {
      return result;
    }
    
    // Return results directly without duration filtering
    return {
      folderName: result.folderName,
      videos: result.videos,
      reasoning: result.reasoning
    };
  }

  /**
   * Process multiple batches of videos and combine results
   */
  async processMultipleBatches(userPrompt, videos, onBatchComplete = null) {
    // Step 0: Optimize user prompt ONCE for all batches
    console.log('[QEFY AI Playlist] 🔧 Step 0: Optimizing user prompt for batch processing...');
    const optimizedPrompt = await this.optimizeUserPrompt(userPrompt);
    console.log(`[QEFY AI Playlist] Using optimized topic: "${optimizedPrompt}"`);
    
    const batchSize = 10; // Batches of 10 videos for better nano model performance
    const batches = [];
    
    // Split videos into batches
    for (let i = 0; i < videos.length; i += batchSize) {
      batches.push(videos.slice(i, i + batchSize));
    }
    
    console.log('[QEFY AI Playlist] Split into', batches.length, 'batches of', batchSize, 'videos each');
    console.log('[QEFY AI Playlist] 🚀 Processing all batches in parallel...');
    
    // Process all batches in parallel for maximum speed
    const batchPromises = batches.map(async (batch, i) => {
      const batchNum = i + 1;
      console.log(`[QEFY AI Playlist] Starting batch ${batchNum}/${batches.length} (${batch.length} videos)`);
      
      try {
        // Use optimized prompt for content matching
        const prompt = this.buildPlaylistPrompt(optimizedPrompt, batch);
        
        // Print prompt for each batch
        console.log(`[QEFY AI Playlist] 🎵 Batch ${batchNum} AI Prompt:`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(prompt);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        const response = await this.callAI(prompt);
        console.log(`[QEFY AI Playlist] 🤖 Batch ${batchNum} AI Response:`, response);
        
        const result = this.parsePlaylistResponse(response, batch);
        
        if (result && result.videos && result.videos.length > 0) {
          console.log(`[QEFY AI Playlist] ✅ Batch ${batchNum} selected ${result.videos.length} videos`);
          
          // Call callback to show incremental results as each batch completes
          if (onBatchComplete && typeof onBatchComplete === 'function') {
            onBatchComplete(batchNum, batches.length, result.videos, result.folderName);
          }
          
          return result;
        }
        
        return null;
      } catch (error) {
        console.warn(`[QEFY AI Playlist] ⚠️ Batch ${batchNum} failed:`, error);
        return null;
      }
    });
    
    // Wait for all batches to complete
    const allResults = await Promise.all(batchPromises);
    
    // Filter out null results (failed batches)
    const batchResults = allResults.filter(result => result !== null);
    
    // Combine results from all batches
    if (batchResults.length === 0) {
      console.warn('[QEFY AI Playlist] No results from any batch');
      return null;
    }
    
    return this.combineResults(batchResults, userPrompt);
  }

  /**
   * Combine results from multiple batches
   */
  async combineResults(batchResults, userPrompt) {
    // Use the folder name from the first successful batch
    const folderName = batchResults[0].folderName;
    
    // Combine all selected videos
    const allVideos = batchResults.flatMap(result => result.videos);
    
    // Remove duplicates by URL
    const uniqueVideos = [];
    const seenUrls = new Set();
    
    for (const video of allVideos) {
      if (!seenUrls.has(video.url)) {
        seenUrls.add(video.url);
        uniqueVideos.push(video);
      }
    }
    
    console.log('[QEFY AI Playlist] Combined results from batches:', {
      folderName: folderName,
      totalVideos: uniqueVideos.length,
      fromBatches: batchResults.length
    });
    
    // Return combined results directly without duration filtering
    return {
      folderName: folderName,
      videos: uniqueVideos,
      reasoning: `Selected ${uniqueVideos.length} videos from ${batchResults.length} batches`
    };
  }

  /**
   * Optimize user's prompt before searching
   * This helps the nano model better understand what to search for
   */
  async optimizeUserPrompt(userPrompt) {
    console.log('[QEFY AI Playlist] 🔧 Optimizing user prompt:', userPrompt);
    
    try {
      const optimizationPrompt = `You are a prompt optimizer. Your job is to convert a user's casual request into a clear, specific search topic.

USER REQUEST: "${userPrompt}"

TASK: Extract the MAIN TOPIC the user wants to find videos about.

RULES:
- Return ONLY the core topic (2-5 words maximum)
- Remove filler words like "create a playlist", "find me", "I want"
- Remove time/duration requirements
- Remove action words like "watch", "learn", "see"
- Keep it simple and searchable

EXAMPLES:

User: "Create a playlist for my 50-minute lunch break with trivia videos"
Optimized: "trivia"

User: "I want to learn about machine learning and AI"
Optimized: "machine learning"

User: "Find me cooking recipe videos for dinner"
Optimized: "cooking recipes"

User: "Videos about video game reviews and gameplay"
Optimized: "video games"

User: "Guitar tutorials for beginners to learn"
Optimized: "guitar tutorials"

User: "Philosophy and ethics discussion videos"
Optimized: "philosophy"

Now optimize this user request: "${userPrompt}"

Return ONLY the optimized search topic (2-5 words), nothing else.`;

      const response = await this.callAI(optimizationPrompt);
      const optimized = response.trim().replace(/['"]/g, ''); // Remove quotes if AI added them
      
      console.log('[QEFY AI Playlist] ✅ Optimized prompt:', {
        original: userPrompt,
        optimized: optimized
      });
      
      return optimized || userPrompt; // Fallback to original if optimization fails
      
    } catch (error) {
      console.warn('[QEFY AI Playlist] Prompt optimization failed, using original:', error);
      return userPrompt;
    }
  }

  /**
   * Build a specialized prompt for playlist creation
   */
  buildPlaylistPrompt(userPrompt, videos) {
    // Prepare video data with all metadata
    const videoData = videos.map((video, index) => ({
      index: index,
      title: video.title || 'Untitled',
      description: video.description || '',
      durationSeconds: parseInt(video.duration) || 0,
      durationMinutes: Math.round(parseInt(video.duration) / 60) || 0,
      channelName: video.channelName || 'Unknown',
      url: video.url
    }));

    const totalVideos = videoData.length;
    const totalDurationMinutes = Math.round(
      videoData.reduce((sum, v) => sum + v.durationSeconds, 0) / 60
    );

    return `You are a strict video classifier. Your job is to find videos that match a specific topic. Act as a search engine for the user.

TOPIC TO FIND: "${userPrompt}"

THE USER WANTS TO USE THIS AI AS A SEARCH ENGINE
Find content that is related to the topic (${userPrompt}) and return the videos that are primarily about the topic.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLASSIFICATION RULES - READ CAREFULLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ SELECT a video ONLY if:
  - The video's MAIN TOPIC matches what you're searching for
  - The title or description clearly indicates this is the PRIMARY subject
  - You are CONFIDENT the video is about this topic

DO NOT RETURN ANY VIDEOS THAT ARE NOT DIRECTLY RELATED TO THE TOPIC.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VIDEOS TO ANALYZE (${totalVideos} total):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${JSON.stringify(videoData, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH video in the list:
1. Read the title carefully, and check if ${userPrompt} make sense in the title
2. Read the description carefully, and check if ${userPrompt} make sense in the description
3. Determine: Is this video PRIMARILY about the topic (${userPrompt})?
4. If YES and you are CERTAIN → include it
5. If NO or UNSURE → skip it

Be STRICT. It's better to return 0 matches than include wrong videos.
THE USER WANTS TO USE THIS AI AS A SEARCH ENGINE

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE FORMAT (JSON only):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "folderName": "short descriptive name",
  "videoIndices": [array of matching video indices],
  "reasoning": "overall why these videos match",
  "videoReasons": {
    "0": "why this specific video was chosen",
    "4": "why this specific video was chosen"
  }
}

The "videoReasons" object maps video index to the reason that specific video was selected.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT EXAMPLE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If you found matching videos:
{
  "folderName": "Short Descriptive Name",
  "videoIndices": [2, 7, 15],
  "reasoning": "Found 3 videos that are primarily about the topic",
  "videoReasons": {
    "2": "Tutorial covering main topic",
    "7": "Detailed guide about main topic",
    "15": "Beginner introduction to main topic"
  }
}

If you found NO matching videos:
{
  "folderName": "Topic Name",
  "videoIndices": [],
  "reasoning": "No videos found that are primarily about this topic",
  "videoReasons": {}
}

⚠️ CRITICAL REQUIREMENTS:
- Return ONLY valid JSON, nothing else
- BE EXTREMELY STRICT - only include videos where you are CERTAIN
- videoIndices can be empty [] if nothing matches
- Each videoReason must explain WHY that specific video matches
- Focus only on content relevance

Now analyze the videos find videos that are primarily about the topic (${userPrompt}) and return your response as JSON.`;
  }

  /**
   * Call the AI language model
   */
  async callAI(prompt) {
    try {
      const session = await LanguageModel.create({
        temperature: 0.4, 
        topK: 1           
      });

      const response = await session.prompt(prompt);
      await session.destroy();
      
      return response;
    } catch (error) {
      console.error('[QEFY AI Playlist] AI call failed:', error);
      throw error;
    }
  }

  /**
   * Second step: Filter videos by duration constraints (programmatic)
   * @param {string} userPrompt - Original user prompt
   * @param {Array} selectedVideos - Videos selected by content matching
   * @returns {Array} - Filtered videos that match duration constraints
   */
  filterByDuration(userPrompt, selectedVideos) {
    if (selectedVideos.length === 0) {
      console.log('[QEFY AI Playlist] No videos to filter');
      return selectedVideos;
    }

    console.log('[QEFY AI Playlist] 🕒 Extracting duration constraints from prompt...');
    
    const durationFilter = this.extractDurationFilter(userPrompt);
    
    if (!durationFilter) {
      console.log('[QEFY AI Playlist] No duration constraints detected');
      return selectedVideos;
    }

    console.log('[QEFY AI Playlist] 📊 Duration filter:', durationFilter);
    
    // Apply programmatic filtering
    const filteredVideos = this.applyDurationFilter(selectedVideos, durationFilter);
    
    console.log('[QEFY AI Playlist] ✅ Duration filtering complete:', {
      before: selectedVideos.length,
      after: filteredVideos.length,
      filter: durationFilter
    });

    return filteredVideos.length > 0 ? filteredVideos : selectedVideos;
  }

  /**
   * Extract duration constraints from user prompt
   * @returns {Object|null} - { type, value, unit } or null if no constraint
   */
  extractDurationFilter(prompt) {
    const promptLower = prompt.toLowerCase();
    
    // Pattern 1: "less than X minutes/hours"
    const lessThanMatch = promptLower.match(/(?:less than|under|below|shorter than|max|maximum)\s+(\d+)\s*(minute|min|hour|hr)/i);
    if (lessThanMatch) {
      const value = parseInt(lessThanMatch[1]);
      const unit = lessThanMatch[2].includes('hour') || lessThanMatch[2].includes('hr') ? 'hours' : 'minutes';
      const seconds = unit === 'hours' ? value * 3600 : value * 60;
      return { type: 'less_than', value: seconds, originalValue: value, unit };
    }
    
    // Pattern 2: "more than X minutes/hours"
    const moreThanMatch = promptLower.match(/(?:more than|over|above|longer than|min|minimum|at least)\s+(\d+)\s*(minute|min|hour|hr)/i);
    if (moreThanMatch) {
      const value = parseInt(moreThanMatch[1]);
      const unit = moreThanMatch[2].includes('hour') || moreThanMatch[2].includes('hr') ? 'hours' : 'minutes';
      const seconds = unit === 'hours' ? value * 3600 : value * 60;
      return { type: 'more_than', value: seconds, originalValue: value, unit };
    }
    
    // Pattern 3: "between X and Y minutes"
    const betweenMatch = promptLower.match(/between\s+(\d+)\s*(?:and|to|-)\s*(\d+)\s*(minute|min|hour|hr)/i);
    if (betweenMatch) {
      const min = parseInt(betweenMatch[1]);
      const max = parseInt(betweenMatch[2]);
      const unit = betweenMatch[3].includes('hour') || betweenMatch[3].includes('hr') ? 'hours' : 'minutes';
      const minSeconds = unit === 'hours' ? min * 3600 : min * 60;
      const maxSeconds = unit === 'hours' ? max * 3600 : max * 60;
      return { type: 'between', min: minSeconds, max: maxSeconds, originalMin: min, originalMax: max, unit };
    }
    
    // Pattern 4: "X-minute playlist/videos" (total duration)
    const totalDurationMatch = promptLower.match(/(\d+)[\s-]*(minute|min|hour|hr)(?:\s+playlist|\s+lunch|\s+break|\s+of content)?/i);
    if (totalDurationMatch && !lessThanMatch && !moreThanMatch) {
      const value = parseInt(totalDurationMatch[1]);
      const unit = totalDurationMatch[2].includes('hour') || totalDurationMatch[2].includes('hr') ? 'hours' : 'minutes';
      const seconds = unit === 'hours' ? value * 3600 : value * 60;
      return { type: 'total_duration', value: seconds, originalValue: value, unit };
    }
    
    // Pattern 5: "quick" or "short" videos (less than 10 minutes)
    if (/\b(quick|short)\b/.test(promptLower)) {
      return { type: 'less_than', value: 600, originalValue: 10, unit: 'minutes' };
    }
    
    // Pattern 6: "long" videos (more than 20 minutes)
    if (/\blong\b/.test(promptLower)) {
      return { type: 'more_than', value: 1200, originalValue: 20, unit: 'minutes' };
    }
    
    return null;
  }

  /**
   * Apply duration filter to videos
   */
  applyDurationFilter(videos, filter) {
    switch (filter.type) {
      case 'less_than':
        console.log(`[QEFY AI Playlist] Filtering: Each video ≤ ${filter.originalValue} ${filter.unit}`);
        return videos.filter(video => {
          const duration = parseInt(video.duration) || 0;
          return duration <= filter.value;
        });
      
      case 'more_than':
        console.log(`[QEFY AI Playlist] Filtering: Each video ≥ ${filter.originalValue} ${filter.unit}`);
        return videos.filter(video => {
          const duration = parseInt(video.duration) || 0;
          return duration >= filter.value;
        });
      
      case 'between':
        console.log(`[QEFY AI Playlist] Filtering: Each video between ${filter.originalMin}-${filter.originalMax} ${filter.unit}`);
        return videos.filter(video => {
          const duration = parseInt(video.duration) || 0;
          return duration >= filter.min && duration <= filter.max;
        });
      
      case 'total_duration':
        console.log(`[QEFY AI Playlist] Filtering: Total playlist duration ≤ ${filter.originalValue} ${filter.unit}`);
        // Select videos until we reach the total duration limit
        const selected = [];
        let totalDuration = 0;
        
        for (const video of videos) {
          const videoDuration = parseInt(video.duration) || 0;
          if (totalDuration + videoDuration <= filter.value) {
            selected.push(video);
            totalDuration += videoDuration;
          }
        }
        
        console.log(`[QEFY AI Playlist] Selected ${selected.length} videos totaling ${Math.round(totalDuration / 60)} minutes`);
        return selected;
      
      default:
        return videos;
    }
  }


  /**
   * Parse the AI response and extract playlist data
   */
  parsePlaylistResponse(aiResponse, originalVideos) {
    try {
      // Extract JSON from response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[QEFY AI Playlist] No JSON found in response');
        return null;
      }

      const result = JSON.parse(jsonMatch[0]);
      
      // Validate response structure
      if (!result.folderName || !Array.isArray(result.videoIndices)) {
        console.warn('[QEFY AI Playlist] Invalid response structure');
        return null;
      }

      // Extract videos by indices and attach reasoning
      const videoReasons = result.videoReasons || {};
      const selectedVideos = result.videoIndices
        .filter(index => index >= 0 && index < originalVideos.length)
        .map(index => {
          const video = { ...originalVideos[index] };
          // Attach the AI's reasoning for this specific video
          video.aiReason = videoReasons[index] || 'Matches search criteria';
          return video;
        });

      if (selectedVideos.length === 0) {
        console.warn('[QEFY AI Playlist] No valid videos selected');
        return null;
      }

      console.log('[QEFY AI Playlist] ✅ Successfully parsed:', {
        folderName: result.folderName,
        videoCount: selectedVideos.length,
        reasoning: result.reasoning,
        hasVideoReasons: Object.keys(videoReasons).length > 0
      });

      return {
        folderName: result.folderName,
        videos: selectedVideos,
        reasoning: result.reasoning
      };
    } catch (error) {
      console.error('[QEFY AI Playlist] Failed to parse response:', error);
      return null;
    }
  }

  /**
   * Validate folder name
   */
  validateFolderName(name) {
    if (!name || typeof name !== 'string') {
      return false;
    }
    
    // Check length
    if (name.length > 30) {
      return false;
    }
    
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
      return false;
    }
    
    return true;
  }
}

// Make it available globally
window.AIPlaylistCreatorService = AIPlaylistCreatorService;

