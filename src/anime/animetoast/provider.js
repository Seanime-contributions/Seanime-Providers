class Provider {
  constructor() {
    this.base = "https://www.animetoast.cc";
  }

  getSettings() {
    return {
      episodeServers: ["mp4upload", "voe", "dood", "fmoon"],
      supportsDub: true,
    };
  }

  async search(query) {
    const url = `${this.base}/?s=${encodeURIComponent(query.query)}`;
    const res = await fetch(url);
    const html = await res.text();
    
    const results = [];
    
    // Use a more specific regex to match anime items
    const regex = /<div id="post-\d+"[^>]*>[\s\S]*?<h3><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    
    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      const rawTitle = match[2];
      
      // Clean title by removing "Ger Sub" or "Ger Dub"
      const cleanedTitle = rawTitle.replace(/\s*Ger\s*(Sub|Dub)\s*/gi, '').trim();
      
      // Extract ID from URL (slug)
      const id = url.replace(this.base, '').replace(/^\//, '').replace(/\/$/, '');
      
      // Determine if it's sub or dub
      const isDub = rawTitle.toLowerCase().includes('dub');
      
      results.push({
        id: id,
        title: cleanedTitle,
        url: url,
        subOrDub: isDub ? "dub" : "sub",
      });
    }
    
    if (!results.length) {
      throw new Error("No anime found");
    }
    
    // If dub is requested, prioritize dub results
    if (query.dub) {
      results.sort((a, b) => {
        if (a.subOrDub === "dub" && b.subOrDub !== "dub") return -1;
        if (a.subOrDub !== "dub" && b.subOrDub === "dub") return 1;
        return 0;
      });
    }
    
    return results;
  }

  async findEpisodes(id) {
    try {
      const res = await fetch(`${this.base}/${id}/`);
      const html = await res.text();
      
      const episodes = [];
      
      // First, parse the tab list to understand server structure
      const serverMap = await this.parseServerTabs(html);
      
      // Use any available tab to get episode list (Voe is usually first if available)
      let tabContent = null;
      
      // Try Voe tab first
      if (serverMap.voe !== undefined) {
        const voeTabRegex = new RegExp(`<div[^>]*id="multi_link_tab${serverMap.voe}"[^>]*>([\\s\\S]*?)<\\/div>`, 'i');
        const voeMatch = html.match(voeTabRegex);
        if (voeMatch) tabContent = voeMatch[1];
      }
      
      // If no Voe tab, try any tab
      if (!tabContent) {
        const firstTabRegex = /<div[^>]*id="multi_link_tab\d+"[^>]*>([\s\S]*?)<\/div>/i;
        const firstMatch = html.match(firstTabRegex);
        if (firstMatch) tabContent = firstMatch[1];
      }
      
      if (tabContent) {
        // Extract episode numbers
        const epRegex = /Ep\.?\s*(\d+)/gi;
        let epMatch;
        const episodeNumbers = new Set();
        
        while ((epMatch = epRegex.exec(tabContent)) !== null) {
          episodeNumbers.add(parseInt(epMatch[1]));
        }
        
        // Create episode entries
        for (const epNum of Array.from(episodeNumbers).sort((a, b) => a - b)) {
          episodes.push({
            id: `${id}-${epNum}`,
            title: `Episode ${epNum}`,
            number: epNum,
            url: `${this.base}/${id}/`,
          });
        }
      }
      
      if (episodes.length === 0) {
        throw new Error("No episodes found");
      }
      
      console.log(`Found ${episodes.length} episodes`);
      return episodes;
      
    } catch (error) {
      console.error("Error in findEpisodes:", error);
      throw new Error(`Failed to fetch episodes: ${error.message}`);
    }
  }

  async parseServerTabs(html) {
    // Parse the tab list to map server names to tab IDs
    const serverMap = {};
    
    // Extract all tab headers
    const tabHeaderRegex = /<a[^>]*data-toggle="tab"[^>]*href="#multi_link_tab(\d+)"[^>]*>([^<]+)<\/a>/gi;
    let tabMatch;
    
    while ((tabMatch = tabHeaderRegex.exec(html)) !== null) {
      const tabId = parseInt(tabMatch[1]);
      const tabName = tabMatch[2].toLowerCase().trim();
      
      // Map server names to their tab IDs
      if (tabName.includes('voe')) {
        serverMap.voe = tabId;
      } else if (tabName.includes('dood') || tabName.includes('doodstream') || tabName.includes('toastp')) {
        serverMap.dood = tabId;
      } else if (tabName.includes('fmoon')) {
        serverMap.fmoon = tabId;
      } else if (tabName.includes('mp4upload')) {
        serverMap.mp4upload = tabId;
      } else if (tabName.includes('playn')) {
        // PlayN might be another server we don't support
        // We can ignore or map if needed
      }
    }
    
    console.log("Server tab mapping:", serverMap);
    return serverMap;
  }

  async findEpisodeServer(episode, server) {
    // Extract base anime ID from episode ID
    const animeId = episode.id.split('-').slice(0, -1).join('-');
    const animeUrl = `${this.base}/${animeId}/`;
    
    // Fetch the anime page to parse server tabs
    const res = await fetch(animeUrl);
    const html = await res.text();
    
    // Parse server tabs to get the correct tab ID
    const serverMap = await this.parseServerTabs(html);
    
    // Check if server is available
    if (!serverMap[server]) {
      throw new Error(`Server ${server} not available for this anime`);
    }
    
    const tabId = serverMap[server];
    
    // Find the correct link parameter for this episode on this server
    const tabRegex = new RegExp(`<div[^>]*id="multi_link_tab${tabId}"[^>]*>([\\s\\S]*?)<\\/div>`, 'i');
    const tabMatch = html.match(tabRegex);
    
    if (!tabMatch) {
      throw new Error(`Tab for server ${server} not found`);
    }
    
    const tabContent = tabMatch[1];
    
    // Find the link parameter for this episode number
    let linkParam = null;
    
    // Method 1: Look for exact episode number match
    const exactRegex = new RegExp(`href="[^"]*\\?link=(\\d+)"[^>]*>[^<]*Ep\\.?\\s*${episode.number}\\b`, 'i');
    const exactMatch = tabContent.match(exactRegex);
    
    if (exactMatch) {
      linkParam = exactMatch[1];
    } else {
      // Method 2: Get all links and find by position
      const allLinks = tabContent.match(/href="[^"]*\?link=(\d+)"/gi);
      if (allLinks && allLinks.length >= episode.number) {
        const epLink = allLinks[episode.number - 1];
        const linkMatch = epLink.match(/\?link=(\d+)/);
        if (linkMatch) {
          linkParam = linkMatch[1];
        }
      }
    }
    
    if (!linkParam) {
      throw new Error(`Could not find link parameter for episode ${episode.number} on server ${server}`);
    }
    
    const episodeUrl = `${animeUrl}?link=${linkParam}`;
    console.log(`Fetching ${server} episode ${episode.number} from: ${episodeUrl}`);
    
    // Route to appropriate server handler
    switch (server) {
      case "mp4upload":
        return await this.handleMp4Upload(episodeUrl);
      case "voe":
        return await this.handleVoe(episodeUrl);
      case "dood":
        return await this.handleDood(episodeUrl);
      case "fmoon":
        return await this.handleFmoon(episodeUrl);
      default:
        throw new Error(`Server ${server} not implemented`);
    }
  }

  async handleMp4Upload(episodeUrl) {
    try {
      // Fetch the episode page
      const res = await fetch(episodeUrl);
      const html = await res.text();
      
      // Look for mp4upload iframe
      let embedUrl = null;
      
      // Pattern 1: Standard iframe with mp4upload.com
      const iframeRegex1 = /<iframe[^>]*src="(https:\/\/www\.mp4upload\.com\/[^"]+)"[^>]*/i;
      const iframeMatch1 = html.match(iframeRegex1);
      if (iframeMatch1) embedUrl = iframeMatch1[1];
      
      // Pattern 2: Iframe with any src containing mp4upload
      if (!embedUrl) {
        const iframeRegex2 = /<iframe[^>]*src="([^"]*mp4upload[^"]*)"[^>]*/i;
        const iframeMatch2 = html.match(iframeRegex2);
        if (iframeMatch2) embedUrl = iframeMatch2[1];
      }
      
      if (!embedUrl) {
        throw new Error("mp4upload iframe not found");
      }
      
      console.log(`Found mp4upload embed URL: ${embedUrl}`);
      
      // Fetch the embed page
      const embedRes = await fetch(embedUrl, {
        headers: {
          'Referer': 'https://www.animetoast.cc/'
        }
      });
      const embedHtml = await embedRes.text();
      
      // Extract the mp4 URL
      let mp4Url = null;
      
      // Pattern 1: src: "url.mp4"
      const mp4Regex1 = /src:\s*"([^"]*\.mp4)"/i;
      const mp4Match1 = embedHtml.match(mp4Regex1);
      if (mp4Match1) mp4Url = mp4Match1[1];
      
      // Pattern 2: "src":"url.mp4"
      if (!mp4Url) {
        const mp4Regex2 = /"src":"([^"]*\.mp4)"/i;
        const mp4Match2 = embedHtml.match(mp4Regex2);
        if (mp4Match2) mp4Url = mp4Match2[1].replace(/\\\//g, '/');
      }
      
      if (!mp4Url) {
        throw new Error("MP4 URL not found in embed page");
      }
      
      return {
        server: "mp4upload",
        headers: {
          'Referer': 'https://www.mp4upload.com/'
        },
        videoSources: [
          {
            url: mp4Url,
            quality: "auto",
            type: "mp4",
          },
        ],
      };
    } catch (error) {
      console.error("Error in handleMp4Upload:", error);
      throw error;
    }
  }

  async handleVoe(episodeUrl) {
    try {
      const res = await fetch(episodeUrl);
      const html = await res.text();
      
      // Extract voe.sx URL from the embed
      const voeRegex = /<a[^>]*href="(https:\/\/voe\.sx\/[^"]+)"[^>]*>/i;
      const voeMatch = html.match(voeRegex);
      
      if (!voeMatch) {
        throw new Error("Voe.sx URL not found");
      }
      
      const voeUrl = voeMatch[1];
      console.log(`Found voe.sx URL: ${voeUrl}`);
      
      // Use browser automation as specified
      const browser = await ChromeDP.newBrowser();
      
      try {
        // Navigate to voe.sx URL
        await browser.navigate(voeUrl);
        
        // Wait for download button to appear
        await browser.waitVisible(".download-user-file");
        
        // Extract download page URL
        const pageContent = await browser.pageContent();
        const downloadBtnRegex = /<a[^>]*class="[^"]*download-user-file[^"]*"[^>]*href="([^"]+)"/i;
        const downloadBtnMatch = pageContent.match(downloadBtnRegex);
        
        if (!downloadBtnMatch) {
          throw new Error("Download button not found");
        }
        
        let downloadPageUrl = downloadBtnMatch[1];
        
        // Close current browser
        await browser.close();
        
        // Open new browser for download page
        const browser2 = await ChromeDP.newBrowser();
        await browser2.navigate(downloadPageUrl);
        
        // Wait for download links to appear
        await browser2.waitVisible('[href*=".mp4"]');
        
        const downloadPageContent = await browser2.pageContent();
        await browser2.close();
        
        // Extract mp4 URL
        const mp4Regex = /<a[^>]*href="(https?:\/\/[^"]*\.mp4[^"]*)"[^>]*>[\s\S]*?Quality\s*720p/i;
        const mp4Match = downloadPageContent.match(mp4Regex);
        
        if (!mp4Match) {
          // Try alternative pattern
          const altMp4Regex = /<a[^>]*href="(https?:\/\/[^"]*\.mp4[^"]*)"[^>]*class="[^"]*btn-secondary[^"]*"/i;
          const altMp4Match = downloadPageContent.match(altMp4Regex);
          
          if (!altMp4Match) {
            throw new Error("MP4 URL not found on download page");
          }
          
          return {
            server: "voe",
            headers: {
              'Referer': 'https://voe.sx/'
            },
            videoSources: [
              {
                url: altMp4Match[1],
                quality: "720p",
                type: "mp4",
              },
            ],
          };
        }
        
        return {
          server: "voe",
          headers: {
            'Referer': 'https://voe.sx/'
          },
          videoSources: [
            {
              url: mp4Match[1],
              quality: "720p",
              type: "mp4",
            },
          ],
        };
        
      } catch (error) {
        await browser.close();
        throw error;
      }
    } catch (error) {
      console.error("Error in handleVoe:", error);
      throw error;
    }
  }

  async handleDood(episodeUrl) {
    try {
      const res = await fetch(episodeUrl);
      const html = await res.text();
      
      // Extract dooodster embed URL - FIXED REGEX
      // Looking for iframe with dooodster.com domain
      const doodRegex = /<iframe[^>]*src="(https:\/\/dooodster\.com\/e\/[^"]+)"[^>]*>/i;
      const doodMatch = html.match(doodRegex);
      
      if (!doodMatch) {
        // Try more flexible regex that matches any domain with 'dood'
        const altDoodRegex = /<iframe[^>]*src="([^"]*dood[^"]*\/e\/[^"]+)"[^>]*>/i;
        const altDoodMatch = html.match(altDoodRegex);
        
        if (!altDoodMatch) {
          // Last resort: look for any iframe and check if it contains 'dood'
          const iframeRegex = /<iframe[^>]*src="([^"]+)"[^>]*>/i;
          const iframeMatch = html.match(iframeRegex);
          
          if (iframeMatch && iframeMatch[1].includes('dood')) {
            var embedUrl = iframeMatch[1];
          } else {
            console.error("Dood embed URL not found. HTML snippet:", html.substring(0, 2000));
            throw new Error("Dood embed URL not found");
          }
        } else {
          var embedUrl = altDoodMatch[1];
        }
      } else {
        var embedUrl = doodMatch[1];
      }
      
      console.log(`Found dooodster embed URL: ${embedUrl}`);
      
      // Convert to download page URL
      const downloadPageUrl = embedUrl.replace('/e/', '/d/');
      console.log(`Download page URL: ${downloadPageUrl}`);
      
      // Use browser automation to get the download link
      const browser = await ChromeDP.newBrowser();
      
      try {
        // Navigate to the download page
        await browser.navigate(downloadPageUrl);
        
        // Wait for the download-content element to appear
        await browser.waitVisible(".download-content");
        
        // Extract page content
        const pageContent = await browser.pageContent();
        await browser.close();
        
        // Extract the next page URL from the download-content
        const nextPageRegex = /<a[^>]*href="(\/download\/[^"]+)"[^>]*class="[^"]*btn-primary[^"]*"/i;
        const nextPageMatch = pageContent.match(nextPageRegex);
        
        if (!nextPageMatch) {
          throw new Error("Next page URL not found");
        }
        
        const nextPagePath = nextPageMatch[1];
        const baseDomain = new URL(embedUrl).origin;
        const nextPageUrl = `${baseDomain}${nextPagePath}`;
        console.log(`Next page URL: ${nextPageUrl}`);
        
        // Fetch the final page without browser
        const finalRes = await fetch(nextPageUrl);
        const finalHtml = await finalRes.text();
        
        // Extract mp4 URL
        const mp4Regex = /<a[^>]*href="(https?:\/\/[^"]*\.mp4[^"]*)"[^>]*class="[^"]*btn-primary[^"]*"/i;
        const mp4Match = finalHtml.match(mp4Regex);
        
        if (!mp4Match) {
          // Try alternative pattern
          const altMp4Regex = /<a[^>]*href="(https?:\/\/[^"]*\.mp4[^"]*)"[^>]*>[\s\S]*?Direct Download Link/i;
          const altMp4Match = finalHtml.match(altMp4Regex);
          
          if (!altMp4Match) {
            throw new Error("MP4 URL not found on final page");
          }
          var mp4Url = altMp4Match[1];
        } else {
          var mp4Url = mp4Match[1];
        }
        
        // Proxy the URL as specified
        const encodedUrl = encodeURIComponent(mp4Url);
        const encodedHeaders = encodeURIComponent(JSON.stringify({
          "Referer": "https://myvidplay.com/"
        }));
        
        const proxiedUrl = `http://localhost:43211/api/v1/proxy?url=${encodedUrl}&headers=${encodedHeaders}`;
        
        return {
          server: "dood",
          headers: {
            'Referer': 'https://myvidplay.com/'
          },
          videoSources: [
            {
              url: proxiedUrl,
              quality: "auto",
              type: "mp4",
            },
          ],
        };
        
      } catch (error) {
        await browser.close();
        throw error;
      }
    } catch (error) {
      console.error("Error in handleDood:", error);
      throw error;
    }
  }

  async handleFmoon(episodeUrl) {
    try {
      const res = await fetch(episodeUrl);
      const html = await res.text();
      
      // Extract fmoon embed URL
      const fmoonRegex = /<iframe[^>]*src="(https:\/\/bysesukior\.com\/e\/[^"]+)"[^>]*>/i;
      const fmoonMatch = html.match(fmoonRegex);
      
      if (!fmoonMatch) {
        throw new Error("Fmoon embed URL not found");
      }
      
      const embedUrl = fmoonMatch[1];
      console.log(`Found fmoon embed URL: ${embedUrl}`);
      
      // Extract video ID
      const videoIdMatch = embedUrl.match(/\/e\/([^\/]+)/);
      if (!videoIdMatch) {
        throw new Error("Video ID not found in embed URL");
      }
      
      const videoId = videoIdMatch[1];
      console.log(`Video ID: ${videoId}`);
      
      // Call the API
      const apiUrl = `https://bysesukior.com/api/videos/${videoId}/embed/playback`;
      const apiRes = await fetch(apiUrl);
      const data = await apiRes.json();
      
      if (!data.playback) {
        throw new Error("No playback data returned from API");
      }
      
      // Decrypt the payload using the JavaScript equivalent of the Python code
      const playback = data.playback;
      const decrypted = await this.decryptFmoonPayload(playback);
      
      if (!decrypted) {
        throw new Error("Failed to decrypt Fmoon payload");
      }
      
      // Parse the decrypted JSON
      let playbackData;
      try {
        playbackData = JSON.parse(decrypted);
      } catch (e) {
        console.error("Failed to parse decrypted JSON:", e);
        throw new Error("Failed to parse decrypted playback data");
      }
      
      // Extract the m3u8 URL
      if (!playbackData.sources || playbackData.sources.length === 0) {
        throw new Error("No video sources found in decrypted data");
      }
      
      // Get the highest quality source
      const sources = playbackData.sources.sort((a, b) => {
        const qualityOrder = { "1080p": 3, "720p": 2, "480p": 1, "360p": 0 };
        return (qualityOrder[b.label] || 0) - (qualityOrder[a.label] || 0);
      });
      
      const bestSource = sources[0];
      
      // Clean up the URL (remove any unwanted parameters)
      let cleanUrl = bestSource.url;
      // Remove the \u0026 encoding
      cleanUrl = cleanUrl.replace(/\\u0026/g, '&');
      
      return {
        server: "fmoon",
        headers: {
          'Referer': 'https://bysesukior.com/'
        },
        videoSources: [
          {
            url: cleanUrl,
            quality: bestSource.label || "auto",
            type: "hls", // m3u8 is HLS format
          },
        ],
      };
    } catch (error) {
      console.error("Error in handleFmoon:", error);
      throw error;
    }
  }

  async decryptFmoonPayload(playback) {
    try {
      // Use browser-compatible decryption
      
      // Combine key parts
      const keyPart1 = this.base64UrlDecode(playback.key_parts[0]);
      const keyPart2 = this.base64UrlDecode(playback.key_parts[1]);
      const combinedKey = new Uint8Array([...keyPart1, ...keyPart2]);
      
      // Try decrypting with combined key first
      const iv = this.base64UrlDecode(playback.iv);
      const payload = this.base64UrlDecode(playback.payload);
      
      const decrypted = await this.aesGcmDecrypt(payload, combinedKey, iv);
      if (decrypted) return decrypted;
      
      // Try with fallback key
      const fallbackKey = this.base64UrlDecode(playback.decrypt_keys.legacy_fallback);
      return await this.aesGcmDecrypt(payload, fallbackKey, iv);
      
    } catch (error) {
      console.error("Error decrypting Fmoon payload:", error);
      return null;
    }
  }

  base64UrlDecode(base64Url) {
    // Add padding if needed
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    
    // Manual base64 decoding without atob
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const result = new Uint8Array(Math.floor(base64.length * 3 / 4));
    
    let i = 0;
    let j = 0;
    
    while (i < base64.length) {
      const enc1 = chars.indexOf(base64.charAt(i++));
      const enc2 = chars.indexOf(base64.charAt(i++));
      const enc3 = chars.indexOf(base64.charAt(i++));
      const enc4 = chars.indexOf(base64.charAt(i++));
      
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;
      
      result[j++] = chr1;
      if (enc3 !== 64) result[j++] = chr2;
      if (enc4 !== 64) result[j++] = chr3;
    }
    
    return result.slice(0, j);
  }

  async aesGcmDecrypt(encryptedData, key, iv) {
    try {
      // In GCM mode, the last 16 bytes are the authentication tag
      const tag = encryptedData.slice(-16);
      const ciphertext = encryptedData.slice(0, -16);
      
      // Check if crypto.subtle is available
      if (!crypto.subtle) {
        throw new Error("Web Crypto API not available");
      }
      
      // Import the key
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );
      
      // Combine ciphertext and tag
      const combined = new Uint8Array(ciphertext.length + tag.length);
      combined.set(ciphertext);
      combined.set(tag, ciphertext.length);
      
      // Decrypt
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
          tagLength: 128
        },
        cryptoKey,
        combined
      );
      
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error("AES-GCM decryption error:", error);
      return null;
    }
  }
}
