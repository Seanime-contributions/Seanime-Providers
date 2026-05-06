(function() {
    // Check if script is already loaded
    if (window.LocalEpubSource) {
        return;
    }

    // Check if JSZip is available
    if (typeof JSZip === 'undefined') {
        console.error('[novel-plugin] JSZip is not loaded. Cannot use Local EPUB source.');
        return;
    }

    // IndexedDB setup
    const DB_NAME = 'novel-plugin-epub-store';
    const DB_VERSION = 1;
    const STORE_NAME = 'epub-files';

    let db = null;

    // Initialize IndexedDB
    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                db = request.result;
                resolve(db);
            };
            
            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    objectStore.createIndex('title', 'title', { unique: false });
                }
            };
        });
    }

    // Store EPUB in IndexedDB
    function storeEpub(epubData) {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error('Database not initialized'));
                return;
            }
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(epubData);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Get EPUB from IndexedDB
    function getEpub(id) {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error('Database not initialized'));
                return;
            }
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Parse EPUB file
    async function parseEpub(fileData) {
        try {
            const zip = await JSZip.loadAsync(fileData);
            
            // Find and parse container.xml
            const containerXml = await zip.file('META-INF/container.xml')?.async('text');
            if (!containerXml) {
                throw new Error('Invalid EPUB: Missing META-INF/container.xml');
            }
            
            // Extract OPF file path from container.xml
            const parser = new DOMParser();
            const containerDoc = parser.parseFromString(containerXml, 'text/xml');
            const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
            if (!opfPath) {
                throw new Error('Invalid EPUB: Could not find OPF file path');
            }
            
            // Parse OPF file
            const opfXml = await zip.file(opfPath)?.async('text');
            if (!opfXml) {
                throw new Error('Invalid EPUB: Could not find OPF file');
            }
            
            const opfDoc = parser.parseFromString(opfXml, 'text/xml');
            
            // Extract metadata
            const metadata = opfDoc.querySelector('metadata');
            const title = metadata?.querySelector('title')?.textContent || 'Unknown Title';
            const author = metadata?.querySelector('creator')?.textContent || 'Unknown Author';
            
            // Extract spine (reading order)
            const spineItems = Array.from(opfDoc.querySelectorAll('spine itemref')).map(item => item.getAttribute('idref'));
            
            // Extract manifest (file paths)
            const manifest = {};
            opfDoc.querySelectorAll('manifest item').forEach(item => {
                manifest[item.getAttribute('id')] = {
                    href: item.getAttribute('href'),
                    mediaType: item.getAttribute('media-type')
                };
            });
            
            // Build chapter list from spine
            const chapters = [];
            for (let i = 0; i < spineItems.length; i++) {
                const itemId = spineItems[i];
                const item = manifest[itemId];
                if (item && item.mediaType === 'application/xhtml+xml') {
                    const href = item.href;
                    // Resolve relative path to OPF file
                    const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
                    const fullPath = opfDir + href;
                    
                    chapters.push({
                        title: `Chapter ${i + 1}`,
                        url: fullPath,
                        index: i
                    });
                }
            }
            
            return {
                title,
                author,
                chapters,
                zip,
                opfDir: opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
            };
        } catch (error) {
            console.error('[novel-plugin] EPUB parsing error:', error);
            throw error;
        }
    }

    // Get chapter content from EPUB
    async function getChapterContentFromEpub(epubData, chapterUrl) {
        try {
            const zip = await JSZip.loadAsync(epubData.fileData);
            const contentXml = await zip.file(chapterUrl)?.async('text');
            
            if (!contentXml) {
                throw new Error('Could not find chapter content');
            }
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(contentXml, 'text/html');
            const body = doc.querySelector('body');
            
            if (!body) {
                throw new Error('Could not find body content');
            }
            
            // Process images
            const images = body.querySelectorAll('img');
            for (const img of images) {
                const src = img.getAttribute('src');
                if (src && !src.startsWith('http')) {
                    // Resolve relative path
                    const chapterDir = chapterUrl.substring(0, chapterUrl.lastIndexOf('/') + 1);
                    const imagePath = chapterDir + src;
                    
                    try {
                        const imageData = await zip.file(imagePath)?.async('base64');
                        if (imageData) {
                            const mimeType = getMimeType(src);
                            img.setAttribute('src', `data:${mimeType};base64,${imageData}`);
                        }
                    } catch (e) {
                        console.warn('[novel-plugin] Could not load image:', imagePath);
                    }
                }
            }
            
            return body.innerHTML;
        } catch (error) {
            console.error('[novel-plugin] Chapter content extraction error:', error);
            throw error;
        }
    }

    function getMimeType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp'
        };
        return mimeTypes[ext] || 'image/jpeg';
    }

    // Current EPUB data (in memory)
    let currentEpubData = null;

    // Initialize database
    initDB().catch(err => console.error('[novel-plugin] IndexedDB initialization failed:', err));

    // --- Interface Implementation ---

    async function autoMatch(romajiTitle, englishTitle) {
        // Not applicable for local files
        return null;
    }

    async function manualSearch(query) {
        // Not applicable for local files
        return [];
    }

    async function getChapters(novelUrl) {
        try {
            // novelUrl is the EPUB ID
            if (currentEpubData && currentEpubData.id === novelUrl) {
                return currentEpubData.chapters;
            }
            
            // Try to load from IndexedDB
            const epubData = await getEpub(novelUrl);
            if (!epubData) {
                throw new Error('EPUB not found');
            }
            
            currentEpubData = epubData;
            return epubData.chapters;
        } catch (error) {
            console.error('[novel-plugin] Local EPUB getChapters error:', error);
            return [];
        }
    }

    async function getChapterContent(chapterUrl) {
        try {
            if (!currentEpubData) {
                throw new Error('No EPUB loaded');
            }
            
            return await getChapterContentFromEpub(currentEpubData, chapterUrl);
        } catch (error) {
            console.error('[novel-plugin] Local EPUB getChapterContent error:', error);
            return '<p>Error loading chapter content.</p>';
        }
    }

    // Public API for loading EPUB files
    window.LocalEpubAPI = {
        async loadEpub(file) {
            try {
                const fileData = await file.arrayBuffer();
                const epubData = await parseEpub(fileData);
                
                const id = 'local-' + Date.now();
                const epubRecord = {
                    id,
                    title: epubData.title,
                    author: epubData.author,
                    fileData: fileData,
                    chapters: epubData.chapters,
                    lastReadTime: Date.now()
                };
                
                await storeEpub(epubRecord);
                currentEpubData = epubRecord;
                
                return { id, title: epubData.title };
            } catch (error) {
                console.error('[novel-plugin] Local EPUB load error:', error);
                throw error;
            }
        },
        
        async loadFromLibrary(id) {
            try {
                const epubData = await getEpub(id);
                if (!epubData) {
                    throw new Error('EPUB not found in library');
                }
                currentEpubData = epubData;
                return { id, title: epubData.title };
            } catch (error) {
                console.error('[novel-plugin] Local EPUB library load error:', error);
                throw error;
            }
        },
        
        async getLibraryItems() {
            try {
                if (!db) {
                    await initDB();
                }
                
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction([STORE_NAME], 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.getAll();
                    
                    request.onsuccess = () => {
                        const items = request.result.map(item => ({
                            id: item.id,
                            title: item.title,
                            author: item.author,
                            cover: null,
                            latestChapter: item.chapters[item.chapters.length - 1]?.title || 'No chapters',
                            source: 'local-epub'
                        }));
                        resolve(items);
                    };
                    request.onerror = () => reject(request.error);
                });
            } catch (error) {
                console.error('[novel-plugin] Local EPUB get library error:', error);
                return [];
            }
        }
    };

    // --- Create and Register The Source ---

    const localEpubSource = {
        id: "local-epub",
        name: "Local Files",
        autoMatch,
        manualSearch,
        getChapters,
        getChapterContent
    };

    if (window.novelPluginRegistry) {
        window.novelPluginRegistry.registerSource(localEpubSource);
        console.log('[novel-plugin] LocalEpubSource registered.');
    } else {
        console.error('[novel-plugin] LocalEpubSource: Registry not found!');
    }

})();
