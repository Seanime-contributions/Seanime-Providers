/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.base = "https://nontonanimeid.my.id";
  }

  getSettings() {
    return {
      episodeServers: ["Server 1", "Server 2", "Server 1080p", "Server 720p", "Server 480p", "Server 360p", "Hardsub English"],
      supportsDub: false,
    };
  }

  async search(query) {
    const res = await fetch(`${this.base}/?s=${encodeURIComponent(query.query)}`);
    const html = await res.text();

    const regex = /<article class="bs"[^>]*>[\s\S]*?<a href="(https?:\/\/[^"]+)"[^>]*title="([^"]+)"/g;
    const results = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2];
      
      const idMatch = url.match(/https?:\/\/[^\/]+\/anime\/([^\/]+)\/?/);
      const id = idMatch ? idMatch[1] : url;

      results.push({
        id,
        title,
        url,
        subOrDub: "sub",
      });
    }

    if (!results.length) throw new Error("No anime found");
    return results;
  }

  async findEpisodes(id) {
    const res = await fetch(`${this.base}/anime/${id}/`);
    const html = await res.text();

    // Updated regex to capture both numeric episodes and "Movie" text
    const regex = /<li[^>]*data-index="\d+"[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>\s*<div[^>]*class="epl-num"[^>]*>([^<]+)<\/div>\s*<div[^>]*class="epl-title"[^>]*>([^<]+)<\/div>/g;
    const episodes = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      const numberText = match[2].trim().toLowerCase();
      const title = match[3].trim();
      
      // Handle both numeric episodes and movies
      let number;
      let isMovie = false;
      
      if (numberText === "movie") {
        // For movies, use number 0 and mark as movie
        number = 0;
        isMovie = true;
      } else {
        // Try to parse as number, default to 0 if not parseable
        number = parseInt(numberText);
        if (isNaN(number)) {
          number = 0;
        }
      }
      
      // Create unique ID based on URL
      const urlParts = url.split('/').filter(part => part.length > 0);
      const episodeSlug = urlParts[urlParts.length - 1] || `${id}-episode-${number}`;

      episodes.push({
        id: episodeSlug,
        title: title || (isMovie ? "Movie" : `Episode ${number}`),
        number,
        url,
        isMovie,
      });
    }

    // Sort by number, movies (0) will appear first
    episodes.sort((a, b) => a.number - b.number);
    
    // If all episodes are movies (number 0), sort by title
    if (episodes.every(ep => ep.number === 0)) {
      episodes.sort((a, b) => a.title.localeCompare(b.title));
    }
    
    return episodes;
  }

  // Manual base64 decoder
  base64Decode(str) {
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let output = '';
    
    // Remove any characters that are not valid base64
    str = str.replace(/[^A-Za-z0-9+/=]/g, '');
    
    let i = 0;
    while (i < str.length) {
      const enc1 = base64Chars.indexOf(str.charAt(i++));
      const enc2 = base64Chars.indexOf(str.charAt(i++));
      const enc3 = base64Chars.indexOf(str.charAt(i++));
      const enc4 = base64Chars.indexOf(str.charAt(i++));
      
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;
      
      output += String.fromCharCode(chr1);
      if (enc3 !== 64) {
        output += String.fromCharCode(chr2);
      }
      if (enc4 !== 64) {
        output += String.fromCharCode(chr3);
      }
    }
    
    return output;
  }

  async findEpisodeServer(episode, server) {
    try {
      const res = await fetch(episode.url);
      const html = await res.text();

      // Find server list section
      const serverListMatch = html.match(/<div[^>]*class="server-list"[^>]*>([\s\S]*?)<\/div>/);
      
      if (!serverListMatch) {
        throw new Error("Server list section not found in HTML");
      }

      const serverListHtml = serverListMatch[1];
      
      // Extract server buttons with more flexible regex
      const serverButtonRegex = /<button[^>]*class="[^"]*server-btn[^"]*"[^>]*data-value="([^"]*)"[^>]*data-index="(\d+)"[^>]*>([\s\S]*?)<\/button>/g;
      const serverData = [];
      let match;

      while ((match = serverButtonRegex.exec(serverListHtml)) !== null) {
        const base64Data = match[1].trim();
        const dataIndex = parseInt(match[2]);
        let serverName = match[3].replace(/\s+/g, ' ').trim();
        
        // If server name is empty or just whitespace, use a default name
        if (!serverName || serverName.length === 0) {
          serverName = `Server ${dataIndex}`;
        }
        
        if (base64Data) {
          serverData.push({
            name: serverName,
            data: base64Data,
            index: dataIndex
          });
        }
      }

      if (serverData.length === 0) {
        // Try alternative regex pattern without data-index
        const altButtonRegex = /<button[^>]*class="[^"]*server-btn[^"]*"[^>]*data-value="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g;
        serverListHtml.replace(altButtonRegex, (match, base64Data, serverName) => {
          serverName = serverName.replace(/\s+/g, ' ').trim();
          if (!serverName || serverName.length === 0) {
            serverName = "Server 1";
          }
          
          if (base64Data) {
            serverData.push({
              name: serverName,
              data: base64Data,
              index: serverData.length + 1
            });
          }
        });
      }

      if (serverData.length === 0) {
        throw new Error("No server buttons found in server list");
      }

      // Filter out Btube server
      const availableServers = serverData.filter(s => 
        !s.name.toLowerCase().includes('btube') && 
        !s.name.toLowerCase().includes('iframe')
      );

      if (availableServers.length === 0) {
        // If all servers were filtered out, use the first server (even if it's Btube)
        if (serverData.length > 0) {
          availableServers.push(serverData[0]);
        } else {
          throw new Error("No video servers found");
        }
      }

      // Find the requested server - try multiple matching strategies
      let targetServer = null;
      
      // Strategy 1: Exact name match
      targetServer = availableServers.find(s => s.name === server);
      
      // Strategy 2: Case-insensitive exact match
      if (!targetServer) {
        targetServer = availableServers.find(s => 
          s.name.toLowerCase() === server.toLowerCase()
        );
      }
      
      // Strategy 3: Contains match
      if (!targetServer) {
        targetServer = availableServers.find(s => 
          s.name.toLowerCase().includes(server.toLowerCase()) ||
          server.toLowerCase().includes(s.name.toLowerCase())
        );
      }
      
      // Strategy 4: Match by quality number (e.g., "1080p" in "Server 1080p")
      if (!targetServer) {
        const qualityMatch = server.match(/(\d+p)/i);
        if (qualityMatch) {
          const targetQuality = qualityMatch[1];
          targetServer = availableServers.find(s => 
            s.name.toLowerCase().includes(targetQuality.toLowerCase())
          );
        }
      }
      
      // Strategy 5: Match by server number (e.g., "Server 1")
      if (!targetServer) {
        const serverNumberMatch = server.match(/Server\s*(\d+)/i);
        if (serverNumberMatch) {
          const targetNumber = serverNumberMatch[1];
          targetServer = availableServers.find(s => 
            s.name.toLowerCase().includes(`server ${targetNumber}`) ||
            s.name.toLowerCase().includes(`server${targetNumber}`)
          );
        }
      }
      
      // Strategy 6: Use the first active server
      if (!targetServer) {
        targetServer = availableServers.find(s => 
          s.name.toLowerCase().includes('active') ||
          serverListHtml.includes(`data-index="${s.index}"`) && 
          serverListHtml.includes(`class="server-btn active"`)
        );
      }
      
      // Strategy 7: Use the first available server as fallback
      if (!targetServer && availableServers.length > 0) {
        targetServer = availableServers[0];
      }

      if (!targetServer) {
        throw new Error(`Server "${server}" not found. Available: ${availableServers.map(s => s.name).join(', ')}`);
      }
      
      // Manual base64 decode
      let decodedHtml;
      try {
        decodedHtml = this.base64Decode(targetServer.data);
      } catch (decodeError) {
        throw new Error(`Failed to decode base64: ${decodeError.message}`);
      }

      // Extract video URL using multiple patterns
      let videoUrl = null;
      let videoType = "mp4";
      
      // Pattern 1: Look for iframe src (for HLS/m3u8)
      const iframeMatch = decodedHtml.match(/<iframe[^>]*src=["']([^"']+)["']/i);
      if (iframeMatch) {
        videoUrl = iframeMatch[1];
        if (videoUrl.includes('.m3u8')) {
          videoType = "hls";
        }
      }
      
      // Pattern 2: Look for source tag
      if (!videoUrl) {
        const sourceMatch = decodedHtml.match(/<source[^>]*src=["']([^"']+)["']/i);
        if (sourceMatch) {
          videoUrl = sourceMatch[1];
          if (videoUrl.includes('.m3u8')) {
            videoType = "hls";
          }
        }
      }
      
      // Pattern 3: Look for video tag with src attribute
      if (!videoUrl) {
        const videoMatch = decodedHtml.match(/<video[^>]*src=["']([^"']+)["']/i);
        if (videoMatch) {
          videoUrl = videoMatch[1];
          if (videoUrl.includes('.m3u8')) {
            videoType = "hls";
          }
        }
      }
      
      // Pattern 4: Look for any video URL (mp4 or m3u8)
      if (!videoUrl) {
        const urlMatch = decodedHtml.match(/(https?:\/\/[^\s"']+\.(?:mp4|m3u8)[^\s"']*)/i);
        if (urlMatch) {
          videoUrl = urlMatch[1];
          if (videoUrl.includes('.m3u8')) {
            videoType = "hls";
          }
        }
      }

      if (!videoUrl) {
        throw new Error("Could not extract video URL from decoded server data");
      }

      // Extract quality from server name, fallback to "auto"
      const qualityMatch = targetServer.name.match(/(\d+p)/i);
      const quality = qualityMatch ? qualityMatch[1] : "auto";

      return {
        server: targetServer.name,
        headers: {
          "Referer": episode.url,
        },
        videoSources: [
          {
            url: videoUrl,
            quality: quality,
            type: videoType,
            subtitles: [],
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get episode server: ${error.message}`);
    }
  }
}
