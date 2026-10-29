
/// <reference path="../../core.d.ts" />

function init() {  
    $ui.register((ctx) => {  
        const INJECTED_BOX_ID = "activity-stories-feed";  
        const VIEWER_ID = "story-viewer-overlay";
        const INPUT_MODAL_ID = "reply-input-modal";
        const STYLES_URI = "https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/main/src/plugins/anilist-activities/styles.css";
        const SCRIPT_DATA_ATTR = "data-injected-box-script";  
        const LOADING_SCRIPT_ATTR = "data-anilist-activity-loading-script";
        const LOADING_BOX_ID = "anilist-activity-loading";
        const LOADING_STATE_KEY = "__anilistActivityLoadingState";

        const SELECTOR_MAP = {
            'toolbar': 'div[data-home-toolbar-container="true"]',
            'bottom-page': 'div[data-home-screen-item-divider="true"]',
            'above-watching': 'div[data-library-collection-lists-container="true"]',
        };
        const DEFAULT_CHOICE = 'toolbar'; 

        const initialDropdownChoice = "{{injectionPoint}}" || DEFAULT_CHOICE;
        const initialManualSelector = String.raw`{{manualOverrideSelector}}`;
        const initialReplyPosition = "{{replyPosition}}" || 'right';
        
        const resolveTargetSelector = (dropdownChoice: string, manualOverride: string): string => {
            const candidate = (manualOverride && manualOverride.trim() !== "")
                ? manualOverride.trim()
                : SELECTOR_MAP[dropdownChoice] || SELECTOR_MAP[DEFAULT_CHOICE];
            if (typeof document === 'undefined') return candidate;
            try {
                document.querySelector(candidate);
                return candidate;
            } catch (error) {
                console.warn('Invalid Anilist activity injection selector. Falling back to the default selector.', error);
                return SELECTOR_MAP[DEFAULT_CHOICE];
            }
        };

        const state = {
            activeTargetSelector: resolveTargetSelector(initialDropdownChoice, initialManualSelector),
            activityHistoryDays: "{{activityHistoryDays}}" || '7',
            cacheRefreshMinutes: "{{cacheRefreshMinutes}}" || '5',
            bgStyle: "{{bgStyle}}" || 'glass',
            ringColor: "{{ringColor}}" || '#FF6F61',
            replyPosition: initialReplyPosition,
        };

        const ACTIVITY_STORE_KEY = 'anilist-activity-cache-v1';
        const DEFAULT_AVATAR = 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png';

        function formatActivityStatusForPlugin(status: string = '', progress: number | null = null): string {
            const statusLower = status.toLowerCase();
            if (statusLower.includes('watched episode')) return (statusLower.includes('rewatched') ? 'Rewatched Episode ' : 'Watched Episode ') + (progress || '');
            if (statusLower.includes('read chapter')) return (statusLower.includes('reread') ? 'Reread Chapter ' : 'Read Chapter ') + (progress || '');
            if (statusLower === 'completed') return 'Completed';
            if (statusLower === 'rewatched') return 'Rewatched';
            if (statusLower === 'reread') return 'Reread';
            if (statusLower === 'dropped') return 'Dropped';
            if (statusLower === 'plans to watch') return 'Plans to Watch';
            if (statusLower === 'plans to read') return 'Plans to Read';
            if (statusLower === 'paused') return 'Paused';
            if (statusLower === 'planning') return 'Planning';
            if (statusLower === 'current') return 'Currently Watching';
            if (statusLower === 'repeating') return 'Repeating';
            return status.replace(/\b\w/g, char => char.toUpperCase());
        }

        function timeAgoForPlugin(timestamp: number): string {
            const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
            let value = seconds / 31536000;
            if (value > 1) return Math.floor(value) + 'y ago';
            value = seconds / 2592000;
            if (value > 1) return Math.floor(value) + 'mo ago';
            value = seconds / 86400;
            if (value > 1) return Math.floor(value) + 'd ago';
            value = seconds / 3600;
            if (value > 1) return Math.floor(value) + 'h ago';
            value = seconds / 60;
            if (value > 1) return Math.floor(value) + 'm ago';
            return 'Just now';
        }

        async function fetchActivitiesForPlugin(token: string, settings: typeof state, forceRefresh = false): Promise<any> {
            const historyDays = Math.min(365, Math.max(1, Number(settings.activityHistoryDays) || 7));
            const cacheMinutes = Math.min(1440, Math.max(1, Number(settings.cacheRefreshMinutes) || 5));
            const cached = $store.get<any>(ACTIVITY_STORE_KEY);
            if (!forceRefresh && cached && cached.historyDays === historyDays && Date.now() < cached.timestamp + cacheMinutes * 60 * 1000) {
                return { ...cached, fromCache: true };
            }

            const createdAtGreater = Math.floor(Date.now() / 1000) - historyDays * 24 * 60 * 60;
            const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + token };
            const followedQuery = `
                query ($createdAtGreater: Int!) {
                    Viewer { id name avatar { large medium } }
                    Page(page: 1, perPage: 50) {
                        activities(type: MEDIA_LIST, sort: ID_DESC, isFollowing: true, createdAt_greater: $createdAtGreater) {
                            ... on ListActivity {
                                id media { id type title { romaji english } coverImage { extraLarge } }
                                status progress createdAt likeCount isLiked
                                user { name avatar { large medium } }
                            }
                        }
                    }
                }`;
            const response = await fetch('https://graphql.anilist.co', {
                method: 'POST', headers,
                body: JSON.stringify({ query: followedQuery, variables: { createdAtGreater } })
            });
            const json = await response.json();
            if (!response.ok || json.errors) throw new Error(json.errors ? json.errors[0].message : 'Invalid Token or Network Error');

            const currentUser = json.data.Viewer;
            const currentUserName = currentUser?.name || '';
            const currentUserId = currentUser?.id;
            const followedActivities = json.data.Page?.activities || [];
            let ownActivities: any[] = [];
            if (currentUserId) {
                const ownQuery = `
                    query ($userId: Int!, $createdAtGreater: Int!) {
                        Page(page: 1, perPage: 50) {
                            activities(type: MEDIA_LIST, sort: ID_DESC, userId: $userId, createdAt_greater: $createdAtGreater) {
                                ... on ListActivity {
                                    id media { id type title { romaji english } coverImage { extraLarge } }
                                    status progress createdAt likeCount isLiked
                                    user { name avatar { large medium } }
                                }
                            }
                        }
                    }`;
                try {
                    const ownResponse = await fetch('https://graphql.anilist.co', {
                        method: 'POST', headers,
                        body: JSON.stringify({ query: ownQuery, variables: { userId: currentUserId, createdAtGreater } })
                    });
                    const ownJson = await ownResponse.json();
                    if (!ownResponse.ok || ownJson.errors) throw new Error(ownJson.errors ? ownJson.errors[0].message : 'Unable to fetch your activities');
                    ownActivities = ownJson.data.Page?.activities || [];
                } catch (error) {
                    console.warn('Unable to fetch your activities; showing followed-user activities only.', error);
                }
            }

            const grouped: Record<string, any> = {};
            [...followedActivities, ...ownActivities]
                .filter((activity, index, activities) => activities.findIndex(item => item.id === activity.id) === index)
                .forEach(activity => {
                    if (!activity?.user?.name || !activity.media) return;
                    const name = activity.user.name;
                    const profileImage = activity.user.avatar?.large || activity.user.avatar?.medium || DEFAULT_AVATAR;
                    if (!grouped[name]) grouped[name] = { name, profileImage, status: 'new', isCurrentUser: name === currentUserName, activities: [] };
                    grouped[name].activities.push({
                        id: activity.id,
                        mediaId: activity.media.id,
                        mediaType: activity.media.type,
                        textMain: formatActivityStatusForPlugin(activity.status, activity.progress),
                        mediaTitle: activity.media.title?.english || activity.media.title?.romaji || '',
                        timestamp: timeAgoForPlugin(activity.createdAt),
                        coverImage: activity.media.coverImage?.extraLarge || '',
                        likeCount: activity.likeCount || 0,
                        isLiked: Boolean(activity.isLiked),
                    });
                });

            if (currentUserName && !grouped[currentUserName]) {
                const avatar = currentUser?.avatar?.large || currentUser?.avatar?.medium || DEFAULT_AVATAR;
                grouped[currentUserName] = { name: currentUserName, profileImage: avatar, status: 'new', isCurrentUser: true, activities: [] };
            }
            const result = {
                timestamp: Date.now(),
                historyDays,
                currentUserName,
                currentUserAvatar: currentUser?.avatar?.large || currentUser?.avatar?.medium || DEFAULT_AVATAR,
                stories: Object.values(grouped).map((story: any) => ({ ...story, activities: story.activities.reverse() })),
            };
            $store.set(ACTIVITY_STORE_KEY, result);
            return { ...result, fromCache: false };
        }
          
        async function getSmartInjectedScript(prefilledToken: string = '', settings: typeof state, prefetchedData: any = null): Promise<string> {
            const stylesResponse = await fetch(STYLES_URI);
            if (!stylesResponse.ok) throw new Error("Unable to load activity feed styles.");
            const styles = (await stylesResponse.text()).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
            const ringColor = settings.ringColor || '#FF6F61';
            const REPLY_POSITION = settings.replyPosition;
            const feedBgClass = 'feed-bg-' + settings.bgStyle;
            const targetSelector = JSON.stringify(settings.activeTargetSelector);
            const injectedToken = JSON.stringify(prefilledToken).replace(/<\/script/gi, match => '<\\/' + match.slice(2));
            const injectedData = JSON.stringify(prefetchedData || { stories: [], currentUserName: '', currentUserAvatar: DEFAULT_AVATAR, error: 'No activity data was available.' })
                .replace(/<\/script/gi, match => '<\\/' + match.slice(2));

            const jsString = `
            (function() {
                const loadingState = window['${LOADING_STATE_KEY}'];
                if (loadingState && typeof loadingState.stop === 'function') loadingState.stop();
                const styles = \`${styles}\`; 
                const FEED_BG_CLASS = '${feedBgClass}';

                const BOX_ID = "${INJECTED_BOX_ID}";
                const VIEWER_ID = "${VIEWER_ID}";
                const INPUT_MODAL_ID = "${INPUT_MODAL_ID}";
                const TARGET_SEL = ${targetSelector};
                const INJECTED_TOKEN = ${injectedToken};
                const PREFETCHED_DATA = ${injectedData};
                const CURRENT_USER_KEY = "anilist-feed-current-user";
                const CURRENT_USER_AVATAR_KEY = "anilist-feed-current-user-avatar";
                const VIEWED_ACTIVITIES_KEY = "anilist-viewed-activity-ids";
                const STORY_DURATION = 5000;
                const RING_COLOR = '${ringColor}';
                const MAX_REPLY_CHARS = 140;
                const REPLY_POSITION = '${REPLY_POSITION}';

                let activeToken = null;
                let allStoryGroups = [];
                let currentStoryGroupIndex = -1;
                let currentStoryData = null; 
                let currentStoryIndex = 0;
                let currentStoryTimer = null;
                let progressInterval = null;
                let viewerSessionId = 0;
                let startTime = 0;
                let currentActivityIdForReply = null; 
                let isInteractionActive = false;
                let isManuallyPaused = false;
                let touchStartTime = 0;
                let touchHoldTimeout = null;
                let viewedActivityIds = new Set();
                try {
                    viewedActivityIds = new Set(JSON.parse(localStorage.getItem(VIEWED_ACTIVITIES_KEY) || '[]').map(String));
                } catch (e) {
                    console.warn('Failed to load viewed activity state.', e);
                }
                function isActivityViewed(activity) {
                    return Boolean(activity) && viewedActivityIds.has(String(activity.id));
                }
                function isStoryFullyViewed(story) {
                    return !story.isCurrentUser && story.activities.length > 0 && story.activities.every(isActivityViewed);
                }
                function hasUnviewedActivities(story) {
                    return story && story.activities.length > 0 && story.activities.some(activity => !isActivityViewed(activity));
                }
                function orderStoryGroups(stories, currentUserName) {
                    return [...stories]
                        .map(s => ({ ...s, isCurrentUser: Boolean(s.isCurrentUser || (currentUserName && s.name === currentUserName)) }))
                        .sort((a, b) => {
                            if (a.isCurrentUser !== b.isCurrentUser) return a.isCurrentUser ? -1 : 1;
                            return Number(isStoryFullyViewed(a)) - Number(isStoryFullyViewed(b));
                        });
                }
                function getStoryRingStyle(story) {
                    return RING_COLOR === 'seanime'
                        ? getSeanimeRingStyle(story.activities)
                        : getSegmentedRingStyle(story.activities);
                }
                function updateStoryRing(storyGroupIndex) {
                    const story = allStoryGroups[storyGroupIndex];
                    const ring = document.querySelector('.story-item[data-index="' + storyGroupIndex + '"] .story-ring');
                    if (story && ring) ring.setAttribute('style', getStoryRingStyle(story));
                }
                function markActivityViewed(activityId) {
                    const id = String(activityId);
                    if (viewedActivityIds.has(id)) return;
                    viewedActivityIds.add(id);
                    try {
                        localStorage.setItem(VIEWED_ACTIVITIES_KEY, JSON.stringify(Array.from(viewedActivityIds)));
                    } catch (e) {
                        console.warn('Failed to save viewed activity state.', e);
                    }
                    const activeStory = allStoryGroups[currentStoryGroupIndex];
                    if (activeStory && isStoryFullyViewed(activeStory)) {
                        const activeStoryName = activeStory.name;
                        renderStories(allStoryGroups);
                        currentStoryGroupIndex = allStoryGroups.findIndex(story => story.name === activeStoryName);
                    } else {
                        updateStoryRing(currentStoryGroupIndex);
                    }
                }
                // --- TIMER CONTROL LOGIC ---

                function stopViewerTimer() {
                    if (currentStoryTimer) clearTimeout(currentStoryTimer);
                    if (progressInterval) clearInterval(progressInterval);
                    currentStoryTimer = null;
                    progressInterval = null;
                }

                function pauseViewerTimer() {
                    stopViewerTimer();
                    
                    const activeBar = document.querySelector('.sv-progress-bar.active');
                    if (activeBar) {
                         const fill = activeBar.querySelector('.sv-progress-fill');
                         if (fill) fill.style.transition = 'none'; 
                    }
                }

                function resumeViewerTimer() {
                    const viewerOpen = document.getElementById(VIEWER_ID)?.classList.contains('is-open');
                    const replyModalVisible = document.getElementById('reply-modal')?.classList.contains('is-visible');
                    const inputModalOpen = document.getElementById(INPUT_MODAL_ID)?.classList.contains('is-open');

                    if (replyModalVisible || inputModalOpen || isManuallyPaused) {
                        isInteractionActive = true;
                        return;
                    }

                    isInteractionActive = false;
                    
                    if (viewerOpen && currentStoryData) {
                        const activeBar = document.querySelector('.sv-progress-bar.active');
                        if (activeBar) {
                            const fill = activeBar.querySelector('.sv-progress-fill');
                            if (fill) fill.style.transition = 'width 0.1s linear';
                        }
                        
                        restartStoryTimer();
                    }
                }

                function restartStoryTimer() {
                    if (isInteractionActive || isManuallyPaused) return;
                    const viewerOpen = document.getElementById(VIEWER_ID)?.classList.contains('is-open');
                    if (!viewerOpen) return;

                    stopViewerTimer();
                    startTime = Date.now();
                    
                    const activeBar = document.querySelector('.sv-progress-bar.active');
                    if (!activeBar) return;
                    
                    const fill = activeBar.querySelector('.sv-progress-fill');
                    if (fill) {
                        fill.style.transition = 'width 0.1s linear';
                        fill.style.width = '0%';
                    }
                    
                    const timerSessionId = viewerSessionId;
                    currentStoryTimer = setTimeout(() => {
                        const viewer = document.getElementById(VIEWER_ID);
                        if (timerSessionId !== viewerSessionId || !currentStoryData || !viewer?.classList.contains('is-open')) {
                            return;
                        }
                        window.nextStory();
                    }, STORY_DURATION);
                    progressInterval = setInterval(() => {
                        const percent = Math.min(100, ((Date.now() - startTime) / STORY_DURATION) * 100);
                        if (fill) fill.style.width = percent + '%';
                        if (percent >= 100) clearInterval(progressInterval);
                    }, 100);
                }
                
                // --- PAUSE/UNPAUSE FUNCTIONALITY ---
                window.togglePause = () => {
                    const viewer = document.getElementById(VIEWER_ID);
                    if (!viewer || !viewer.classList.contains('is-open')) return;
                    
                    isManuallyPaused = !isManuallyPaused;
                    
                    const pauseIndicator = document.getElementById('pause-indicator');
                    if (pauseIndicator) {
                        if (isManuallyPaused) {
                            pauseIndicator.textContent = 'Paused';
                            pauseIndicator.classList.add('show');
                            pauseViewerTimer();
                        } else {
                            pauseIndicator.classList.remove('show');
                            setTimeout(() => {
                                if (pauseIndicator) pauseIndicator.textContent = 'Resumed';
                                pauseIndicator.classList.add('show');
                                setTimeout(() => {
                                    if (pauseIndicator) pauseIndicator.classList.remove('show');
                                }, 800);
                            }, 10);
                            resumeViewerTimer();
                        }
                    }
                    
                    console.log('Story viewer ' + (isManuallyPaused ? 'paused' : 'resumed'));
                };
                
                // --- TOUCH HANDLING FOR MOBILE ---
                function setupTouchHandling() {
                    const viewer = document.getElementById(VIEWER_ID);
                    if (!viewer) return;
                    
                    // Remove any existing touch listeners
                    viewer.removeEventListener('touchstart', handleTouchStart);
                    viewer.removeEventListener('touchend', handleTouchEnd);
                    
                    viewer.addEventListener('touchstart', handleTouchStart);
                    viewer.addEventListener('touchend', handleTouchEnd);
                }
                
                function handleTouchStart(e) {
                    touchStartTime = Date.now();
                    // Set a timeout to show pause on long press
                    touchHoldTimeout = setTimeout(() => {
                        if (Date.now() - touchStartTime > 500) { // 500ms long press
                            window.togglePause();
                        }
                    }, 600); // Slightly longer to ensure it's a deliberate hold
                }
                
                function handleTouchEnd(e) {
                    if (touchHoldTimeout) clearTimeout(touchHoldTimeout);
                    // If touch was less than 300ms, it's a tap, not a hold
                    if (Date.now() - touchStartTime < 300) {
                        // Check if tap is in the middle area (not navigation)
                        const tapX = e.changedTouches[0].clientX;
                        const screenWidth = window.innerWidth;
                        const isMiddleTap = tapX > screenWidth * 0.3 && tapX < screenWidth * 0.7;
                        
                        if (isMiddleTap) {
                            window.togglePause();
                        }
                    }
                }
                
                // --- END TIMER CONTROL LOGIC ---

                // --- UTILITIES ---
                function isGifUrl(url) {
                    return url && url.toLowerCase().includes('.gif');
                }
                
                function createOptimizedImageElement(src, className, fallbackSrc) {
                    const img = document.createElement('img');
                    img.className = className;
                    
                    // Add cache-busting for GIFs to ensure they animate
                    if (isGifUrl(src)) {
                        const timestamp = Date.now();
                        const separator = src.includes('?') ? '&' : '?';
                        img.src = src + separator + 't=' + timestamp;
                        img.loading = 'lazy';
                        img.style.imageRendering = 'auto';
                        img.setAttribute('data-gif', 'true');
                    } else {
                        img.src = src;
                    }
                    
                    img.onerror = function() {
                        if (fallbackSrc && this.src !== fallbackSrc) {
                            this.src = fallbackSrc;
                        }
                    };
                    
                    return img;
                }
                
                function timeAgo(t) {
                    const s = Math.floor((new Date() - new Date(t * 1000)) / 1000);
                    let i = s / 31536000;
                    if (i > 1) return Math.floor(i) + "y ago";
                    i = s / 2592000;
                    if (i > 1) return Math.floor(i) + "mo ago";
                    i = s / 86400;
                    if (i > 1) return Math.floor(i) + "d ago";
                    i = s / 3600;
                    if (i > 1) return Math.floor(i) + "h ago";
                    i = s / 60;
                    if (i > 1) return Math.floor(i) + "m ago";
                    return "Just now";
                }
                
                function getSegmentedRingStyle(activities) {
                    if (RING_COLOR === 'seanime') return '';
                    const activeColor = RING_COLOR;
                    const viewedColor = '#64748B';
                    const separatorColor = '#1F2937';
                    const segments = activities.length;
                    if (segments === 0) return 'background: transparent';
                    if (segments <= 1) {
                        return 'background: ' + (isActivityViewed(activities[0]) ? viewedColor : activeColor);
                    }
                    const deg = 360 / segments;
                    const stops = [];
                    for (let i = 0; i < segments; i++) {
                        const start = i * deg;
                        const end = (i + 1) * deg;
                        const gapSize = Math.max(0.25, Math.min(0.75, deg * 0.18));
                        const segmentEnd = Math.max(start, end - gapSize);
                        const color = isActivityViewed(activities[i]) ? viewedColor : activeColor;
                        stops.push(color + ' ' + start + 'deg ' + segmentEnd + 'deg');
                        stops.push(separatorColor + ' ' + segmentEnd + 'deg ' + end + 'deg');
                    }
                    return 'background: conic-gradient(from -90deg, ' + stops.join(', ') + ')';
                }

                // Function to generate Seanime gradient based on activity count
                function getSeanimeRingStyle(activities) {
                    const activeColor = 'rgb(var(--color-brand-500))';
                    const viewedColor = '#64748B';
                    const separatorColor = '#1F2937';
                    const segments = activities.length;
                    if (segments === 0) return 'background: transparent';
                    if (segments <= 1) {
                        const color = isActivityViewed(activities[0]) ? viewedColor : activeColor;
                        return 'background: ' + color + ' !important';
                    }
                    const deg = 360 / segments;
                    const stops = [];
                    for (let i = 0; i < segments; i++) {
                        const start = i * deg;
                        const end = (i + 1) * deg;
                        const gapSize = Math.max(0.25, Math.min(0.75, deg * 0.18));
                        const segmentEnd = Math.max(start, end - gapSize);
                        const color = isActivityViewed(activities[i]) ? viewedColor : activeColor;
                        stops.push(color + ' ' + start + 'deg ' + segmentEnd + 'deg');
                        stops.push(separatorColor + ' ' + segmentEnd + 'deg ' + end + 'deg');
                    }
                    return 'background: conic-gradient(from -90deg, ' + stops.join(', ') + ') !important';
                }
                // Helper function to capitalize activity status
                function formatActivityStatus(status, progress) {
                    const statusLower = status.toLowerCase();
                    
                    if (statusLower.includes('watched episode')) {
                        if (statusLower.includes('rewatched')) {
                            return 'Rewatched Episode ' + (progress || '');
                        } else {
                            return 'Watched Episode ' + (progress || '');
                        }
                    } else if (statusLower.includes('read chapter')) {
                        if (statusLower.includes('reread')) {
                            return 'Reread Chapter ' + (progress || '');
                        } else {
                            return 'Read Chapter ' + (progress || '');
                        }
                    } else if (statusLower === 'completed') {
                        return 'Completed';
                    } else if (statusLower === 'rewatched') {
                        return 'Rewatched';
                    } else if (statusLower === 'reread') {
                        return 'Reread';
                    } else if (statusLower === 'dropped') {
                        return 'Dropped';
                    } else if (statusLower === 'plans to watch') {
                        return 'Plans to Watch';
                    } else if (statusLower === 'plans to read') {
                        return 'Plans to Read';
                    } else if (statusLower === 'paused') {
                        return 'Paused';
                    } else if (statusLower === 'planning') {
                        return 'Planning';
                    } else if (statusLower === 'current') {
                        return 'Currently Watching';
                    } else if (statusLower === 'repeating') {
                        return 'Repeating';
                    } else {
                        // Capitalize first letter of each word for other statuses
                        return status.replace(/\\b\\w/g, char => char.toUpperCase());
                    }
                }

                // --- API INTERACTION LOGIC ---
                async function apiCall(query, variables) {
                    if (!activeToken) {
                        console.error("API call failed: No active token.");
                        const viewer = document.getElementById(VIEWER_ID);
                        if (viewer) {
                            const msgBox = document.createElement('div');
                            msgBox.className = 'activity-error-overlay';
                            msgBox.innerText = 'Error: AniList token unavailable.';
                            viewer.appendChild(msgBox);
                            setTimeout(() => viewer.removeChild(msgBox), 3000);
                        } else {
                            const box = document.getElementById(BOX_ID);
                            if (box) {
                                const msg = document.createElement('div');
                                msg.innerText = 'Error: AniList token unavailable.';
                                msg.className = 'activity-error-box';
                                box.prepend(msg);
                                setTimeout(() => msg.remove(), 3000);
                            }
                        }
                        return null;
                    }
                    try {
                        const res = await fetch('https://graphql.anilist.co', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + activeToken },
                            body: JSON.stringify({ query, variables })
                        });
                        const json = await res.json();
                        if (!res.ok || json.errors) throw new Error(json.errors ? json.errors[0].message : 'Network Error');
                        return json;
                    } catch (e) {
                        console.error('AniList API Error:', e.message);
                        const box = document.getElementById(BOX_ID);
                        if (box) {
                            const msg = document.createElement('div');
                            msg.innerText = 'API Error: ' + e.message;
                            msg.className = 'activity-error-box';
                            box.prepend(msg);
                            setTimeout(() => msg.remove(), 5000);
                        }
                        return null;
                    }
                }
                
                window.openReplyInputModal = (activityId) => {
                    currentActivityIdForReply = activityId;
                    const modal = document.getElementById(INPUT_MODAL_ID);
                    const textarea = document.getElementById('reply-textarea');
                    const countSpan = document.getElementById('char-count-span');
                    const submitBtn = document.getElementById('reply-submit-btn');

                    if (!modal || !textarea || !countSpan || !submitBtn) return;
                    
                    isInteractionActive = true; 
                    pauseViewerTimer(); 

                    textarea.value = '';
                    countSpan.innerText = \`0/\${MAX_REPLY_CHARS}\`;
                    countSpan.classList.remove('error');
                    submitBtn.disabled = true;
                    
                    modal.classList.add('is-open');
                    textarea.focus();
                }

                window.closeReplyInputModal = () => {
                    document.getElementById(INPUT_MODAL_ID)?.classList.remove('is-open');
                    currentActivityIdForReply = null;

                    resumeViewerTimer(); 
                }

                window.handleReplyInput = (textarea) => {
                    const countSpan = document.getElementById('char-count-span');
                    const submitBtn = document.getElementById('reply-submit-btn');
                    const charCount = textarea.value.length;
                    
                    if (!countSpan || !submitBtn) return;

                    countSpan.innerText = \`\${charCount}/\${MAX_REPLY_CHARS}\`;
                    
                    if (charCount > MAX_REPLY_CHARS || charCount === 0) {
                        countSpan.classList.add('error');
                        submitBtn.disabled = true;
                    } else {
                        countSpan.classList.remove('error');
                        submitBtn.disabled = false;
                    }
                }

                window.submitReply = async () => {
                    const activityId = currentActivityIdForReply;
                    const textarea = document.getElementById('reply-textarea');
                    const replyText = textarea?.value?.trim();
                    
                    if (!replyText || replyText.length === 0 || replyText.length > MAX_REPLY_CHARS || !activityId) return;

                    const REPLY_MUTATION = 'mutation ($activityId: Int, $text: String) { SaveActivityReply(activityId: $activityId, text: $text) { id } }';
                    const submitBtn = document.getElementById('reply-submit-btn');
                    
                    if (submitBtn) submitBtn.disabled = true;
                    
                    const result = await apiCall(REPLY_MUTATION, { activityId: activityId, text: replyText });
                    
                    if (result) {
                        window.closeReplyInputModal();
                        
                        const successMsg = document.createElement('div');
                        successMsg.innerText = "Reply posted successfully!";
                        successMsg.className = 'reply-success-toast';
                        document.getElementById(INPUT_MODAL_ID).appendChild(successMsg);
                        setTimeout(() => {
                            successMsg.remove();
                            resumeViewerTimer();
                        }, 1500);

                    } else {
                        if (submitBtn) submitBtn.disabled = false;
                    }
                }

                    window.replyActivity = (id) => {
                        window.openReplyInputModal(id);
                    }
                    window.updateLikeButton = (button, activity) => {
                        const likeCount = Number(activity.likeCount || 0);
                        const count = button.querySelector('.sv-like-count');
                        if (count) count.textContent = likeCount > 0 ? String(likeCount) : '';
                        button.classList.toggle('is-liked', Boolean(activity.isLiked));
                        button.setAttribute('aria-pressed', String(Boolean(activity.isLiked)));
                        button.setAttribute('aria-label', activity.isLiked ? 'Unlike activity' : 'Like activity');
                        button.title = activity.isLiked ? 'Unlike activity' : 'Like activity';
                    };
                    window.toggleActivityLike = async (activityId) => {
                        const activity = currentStoryData && currentStoryData.activities.find(item => item.id === activityId);
                        const likeButton = document.getElementById('sv-like-btn');
                        if (!activity || !likeButton || likeButton.disabled) return;
                        const TOGGLE_LIKE_MUTATION = \`
                            mutation ($activityId: Int!) {
                                ToggleLikeV2(id: $activityId, type: ACTIVITY) {
                                    ... on ListActivity { id likeCount isLiked }
                                }
                            }
                        \`;
                        likeButton.disabled = true;
                        const result = await apiCall(TOGGLE_LIKE_MUTATION, { activityId: activityId });
                        const updatedActivity = result && result.data && result.data.ToggleLikeV2;
                        if (updatedActivity) {
                            activity.likeCount = updatedActivity.likeCount;
                            activity.isLiked = updatedActivity.isLiked;
                            window.updateLikeButton(likeButton, activity);
                        }
                        likeButton.disabled = false;
                    };
                    window.submitInlineReply = async (activityId) => {
                        const composerInput = document.getElementById('reply-composer-input');
                        const composerSubmit = document.getElementById('reply-composer-submit');
                        const replyText = composerInput?.value?.trim();
                        if (!replyText || replyText.length > MAX_REPLY_CHARS || !activityId || !composerSubmit) return;
                        const REPLY_MUTATION = 'mutation ($activityId: Int, $text: String) { SaveActivityReply(activityId: $activityId, text: $text) { id } }';
                        composerSubmit.disabled = true;
                        const result = await apiCall(REPLY_MUTATION, { activityId: activityId, text: replyText });
                        if (result) {
                            window.showReplies(activityId);
                        } else {
                            composerSubmit.disabled = false;
                        }
                    }
                    window.showReplies = async (activityId) => {
                    const replyModal = document.getElementById('reply-modal');
                    const replyList = document.getElementById('reply-list');
                    const replyComposerAvatar = document.getElementById('reply-composer-avatar');
                    const replyComposerInput = document.getElementById('reply-composer-input');
                    const replyComposerSubmit = document.getElementById('reply-composer-submit');
                    if (!replyModal || !replyList || !replyComposerAvatar || !replyComposerInput || !replyComposerSubmit) return;
                    replyComposerAvatar.src = localStorage.getItem(CURRENT_USER_AVATAR_KEY) || 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png';
                    replyComposerInput.value = '';
                    const updateInlineReplyState = () => {
                        const length = replyComposerInput.value.trim().length;
                        replyComposerSubmit.disabled = length === 0 || length > MAX_REPLY_CHARS;
                    };
                    replyComposerInput.oninput = updateInlineReplyState;
                    replyComposerInput.onkeydown = (event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !replyComposerSubmit.disabled) {
                            event.preventDefault();
                            window.submitInlineReply(activityId);
                        }
                    };
                    replyComposerSubmit.onclick = () => window.submitInlineReply(activityId);
                    updateInlineReplyState();

                    isInteractionActive = true; 
                    pauseViewerTimer(); 

                    // 1. Ensure modal is visible for layout
                    replyModal.classList.add('is-visible');
                    
                    // 2. Clean previous animation classes
                    replyModal.classList.remove('slide-out-right', 'slide-out-left');
                    
                    // 3. Add specific Enter animation based on position
                    const animClass = (REPLY_POSITION === 'right') ? 'slide-in-right' : 'slide-in-left';
                    replyModal.classList.add(animClass);
                    
                    replyList.innerHTML = '<div class="reply-none">Loading replies...</div>';
                    
                    const REPLIES_QUERY = \`
                        query ($activityId: Int) {
                          Activity(id: $activityId) {
                            ... on ListActivity {
                              replies {
                                id
                                text
                                createdAt
                                user {
                                  name
                                  avatar { large medium }
                                }
                              }
                            }
                          }
                        }\`;

                    const result = await apiCall(REPLIES_QUERY, { activityId: activityId });
                    
                    if (result && result.data.Activity && result.data.Activity.replies) {
                        const replies = result.data.Activity.replies;
                        if (replies.length === 0) {
                            replyList.innerHTML = '<div class="reply-none">No replies yet. Be the first!</div>';
                        } else {
                            const defaultAvatar = 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png';
                            const fragment = document.createDocumentFragment();
                            replies.forEach(reply => {
                                const item = document.createElement('div');
                                item.className = 'reply-item';

                                const avatar = document.createElement('img');
                                avatar.className = 'reply-avatar';
                                avatar.alt = '';
                                const rawAvatarUrl = reply?.user?.avatar?.large || reply?.user?.avatar?.medium || defaultAvatar;
                                let avatarUrl = defaultAvatar;
                                try {
                                    const parsedAvatarUrl = new URL(rawAvatarUrl, window.location.origin);
                                    if (parsedAvatarUrl.protocol === 'https:' || parsedAvatarUrl.protocol === 'http:') {
                                        avatarUrl = parsedAvatarUrl.toString();
                                    }
                                } catch (_) {}
                                avatar.src = avatarUrl;
                                avatar.onerror = () => {
                                    avatar.onerror = null;
                                    avatar.src = defaultAvatar;
                                };
                                if (isGifUrl(avatarUrl)) avatar.setAttribute('data-gif', 'true');

                                const body = document.createElement('div');
                                body.className = 'reply-body';
                                const meta = document.createElement('div');
                                meta.className = 'reply-meta';
                                const userName = document.createElement('span');
                                userName.textContent = String(reply?.user?.name ?? 'Unknown');
                                meta.appendChild(userName);
                                meta.appendChild(document.createTextNode(' ' + timeAgo(reply?.createdAt)));

                                const text = document.createElement('div');
                                text.className = 'reply-text';
                                const lines = String(reply?.text ?? '').split('\\n');
                                lines.forEach((line, index) => {
                                    if (index > 0) text.appendChild(document.createElement('br'));
                                    text.appendChild(document.createTextNode(line));
                                });

                                body.appendChild(meta);
                                body.appendChild(text);
                                item.appendChild(avatar);
                                item.appendChild(body);
                                fragment.appendChild(item);
                            });
                            replyList.replaceChildren(fragment);
                        }
                    } else {
                        replyList.innerHTML = '<div class="reply-none">Failed to load replies.</div>';
                    }
                }

                window.closeReplies = () => {
                    const replyModal = document.getElementById('reply-modal');
                    if (!replyModal) return;

                    // 1. Remove Enter animations
                    replyModal.classList.remove('slide-in-right', 'slide-in-left');
                    
                    // 2. Add Exit animation
                    const animClass = (REPLY_POSITION === 'right') ? 'slide-out-right' : 'slide-out-left';
                    replyModal.classList.add(animClass);

                    // 3. Wait for animation to finish, then hide
                    setTimeout(() => {
                        replyModal.classList.remove('is-visible', 'slide-out-right', 'slide-out-left');
                        resumeViewerTimer();
                    }, 280); 
                }

                // --- OPEN ENTRY PAGE FUNCTION ---
                window.openEntryPage = (mediaId, mediaType) => {
                    // Determine URL based on media type
                    let url;
                    if (mediaType === 'ANIME') {
                        url = \`/entry?id=\${mediaId}\`;
                    } else if (mediaType === 'MANGA') {
                        url = \`/manga/entry?id=\${mediaId}\`;
                    } else {
                        // Fallback to anime
                        url = \`/entry?id=\${mediaId}\`;
                    }
                    
                    // Navigate within the same tab (works in app context)
                    window.location.href = url;
                };

                // --- KEYBOARD NAVIGATION ---
                function handleKeyDown(e) {
                    const viewer = document.getElementById(VIEWER_ID);
                    const replyModal = document.getElementById('reply-modal');
                    const inputModal = document.getElementById(INPUT_MODAL_ID);
                    
                    const isViewerOpen = viewer && viewer.classList.contains('is-open');
                    const isReplyModalVisible = replyModal && replyModal.classList.contains('is-visible');
                    const isInputModalOpen = inputModal && inputModal.classList.contains('is-open');

                    if (!isViewerOpen) {
                        return; 
                    }

                    if (e.key === 'Escape') {
                        if (isInputModalOpen) {
                            window.closeReplyInputModal();
                        } else if (isReplyModalVisible) {
                            window.closeReplies();
                        } else {
                            window.closeStoryViewer();
                        }
                        e.preventDefault();
                    } else if (isReplyModalVisible || isInputModalOpen) {
                        // Keep Space available for typing while a reply modal is active.
                        return;
                    } else if (e.key === ' ' || e.code === 'Space') {
                        // Spacebar to toggle pause when no reply modal is active.
                        window.togglePause();
                        e.preventDefault();
                    } else if (e.key === 'ArrowRight') {
                        window.nextStory();
                        e.preventDefault();
                    } else if (e.key === 'ArrowLeft') {
                        window.prevStory();
                        e.preventDefault();
                    }
                }
                // --- END KEYBOARD NAVIGATION ---

                // --- STORY VIEWER LOGIC ---
                window.openStoryViewer = (storyGroupIndex) => {
                    const storyGroup = allStoryGroups[storyGroupIndex];
                    if (!storyGroup) return;

                    viewerSessionId++;
                    currentStoryData = storyGroup;
                    currentStoryGroupIndex = storyGroupIndex;
                    const firstUnviewedIndex = storyGroup.activities.findIndex(activity => !isActivityViewed(activity));
                    currentStoryIndex = firstUnviewedIndex >= 0 ? firstUnviewedIndex : 0;

                    const viewer = document.getElementById(VIEWER_ID);
                    if (!viewer) return;
                    viewer.classList.add('is-open');

                    renderStoryFrame(true);

                    document.addEventListener('keydown', handleKeyDown);
                    setupTouchHandling();
                    
                    // Reset pause state when opening new viewer
                    isManuallyPaused = false;
                    const pauseIndicator = document.getElementById('pause-indicator');
                    if (pauseIndicator) {
                        pauseIndicator.classList.remove('show');
                    }
                }

                window.closeStoryViewer = () => {
                    // Stop all timer work before closing child modals. Their
                    // delayed cleanup must not keep the closed viewer's state alive.
                    viewerSessionId++;
                    stopViewerTimer();

                    document.getElementById(VIEWER_ID)?.classList.remove('is-open');

                    currentStoryData = null;
                    currentStoryGroupIndex = -1;
                    isInteractionActive = false;
                    isManuallyPaused = false;
                    window.closeReplies();
                    window.closeReplyInputModal();
                    document.removeEventListener('keydown', handleKeyDown);
                }

                window.nextStory = () => {
                    const viewer = document.getElementById(VIEWER_ID);
                    if (!currentStoryData || !viewer?.classList.contains('is-open')) return;
                    if(currentStoryIndex < currentStoryData.activities.length - 1) {
                        currentStoryIndex++;
                        renderStoryFrame(true);
                    } else {
                        let nextUserIndex = -1;
                        for (let offset = 1; offset <= allStoryGroups.length; offset++) {
                            const candidateIndex = (currentStoryGroupIndex + offset) % allStoryGroups.length;
                            if (hasUnviewedActivities(allStoryGroups[candidateIndex])) {
                                nextUserIndex = candidateIndex;
                                break;
                            }
                        }
                        if (nextUserIndex >= 0) {
                            window.openStoryViewer(nextUserIndex);
                        } else {
                            window.closeStoryViewer();
                        }
                    }
                }

                window.prevStory = () => {
                    if(!currentStoryData) return;
                    if(currentStoryIndex > 0) {
                        currentStoryIndex--;
                        renderStoryFrame(true);
                    } else {
                        const prevUserIndex = currentStoryGroupIndex - 1;
                        if (prevUserIndex >= 0) {
                            document.getElementById(VIEWER_ID).classList.remove('is-open');
                            
                            currentStoryGroupIndex = prevUserIndex;
                            currentStoryData = allStoryGroups[prevUserIndex];
                            currentStoryIndex = currentStoryData.activities.length - 1;

                            document.getElementById(VIEWER_ID).classList.add('is-open');
                            renderStoryFrame(true);
                        } else {
                            currentStoryIndex = 0;
                            renderStoryFrame(true);
                        }
                    }
                }

                function renderStoryFrame(shouldAnimate) {
                                        const v = document.getElementById(VIEWER_ID);
                    if(!v || !currentStoryData) return;
                    if (currentStoryData.activities.length === 0) {
                        if(currentStoryTimer) clearTimeout(currentStoryTimer);
                        if(progressInterval) clearInterval(progressInterval);
                        v.querySelector('.sv-background').style.backgroundImage = \`url(\${currentStoryData.profileImage})\`;
                        const profileUrl = 'https://anilist.co/user/' + encodeURIComponent(currentStoryData.name || '');
                        const emptyAvatar = v.querySelector('.sv-avatar');
                        emptyAvatar.src = currentStoryData.profileImage;
                        const avatarLink = v.querySelector('#sv-profile-avatar-link');
                        if (avatarLink) avatarLink.href = profileUrl;
                        const emptyMeta = v.querySelector('.sv-meta');
                        emptyMeta.innerHTML = '<a class="sv-profile-link sv-profile-name-link" href="' + profileUrl + '" aria-label="Open AniList profile"><span class="sv-username">' + (currentStoryData.isCurrentUser ? 'You' : currentStoryData.name) + '</span></a>';
                        v.querySelector('.sv-progress-container').innerHTML = '';
                        const emptyImage = v.querySelector('.sv-card-img');
                        emptyImage.style.display = 'none';
                        v.querySelector('.sv-text-main').innerText = 'Nothing here';
                        v.querySelector('.sv-text-sub').innerText = 'No recent activity.';
                        ['#sv-open-entry', '#sv-like-btn', '#sv-view-replies-btn'].forEach(selector => {
                            const button = v.querySelector(selector);
                            if (button) button.style.display = 'none';
                        });
                        return;
                    }
                    const act = currentStoryData.activities[currentStoryIndex];
                    const activityId = act.id;
                    markActivityViewed(activityId);
                    const mediaId = act.mediaId;
                    const mediaType = act.mediaType;
                    
                    // Close replies instantly without animation when changing frames
                    const replyModal = document.getElementById('reply-modal');
                    if (replyModal) replyModal.classList.remove('is-visible', 'slide-in-right', 'slide-out-right', 'slide-in-left', 'slide-out-left');
                    window.closeReplyInputModal();

                    // Handle background image - use static image for GIFs to avoid animation issues
                    const backgroundImage = act.coverImage || currentStoryData.profileImage;
                    if (isGifUrl(backgroundImage)) {
                        // For GIF backgrounds, use a placeholder or the first frame
                        v.querySelector('.sv-background').style.backgroundImage = 'url(https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png)';
                    } else {
                        v.querySelector('.sv-background').style.backgroundImage = \`url(\${backgroundImage})\`;
                    }
                    const profileUrl = 'https://anilist.co/user/' + encodeURIComponent(currentStoryData.name || '');
                    const avatarElement = v.querySelector('.sv-avatar');
                    avatarElement.src = currentStoryData.profileImage;
                    if (isGifUrl(currentStoryData.profileImage)) {
                        avatarElement.setAttribute('data-gif', 'true');
                    } else {
                        avatarElement.removeAttribute('data-gif');
                    }
                    const avatarLink = v.querySelector('#sv-profile-avatar-link');
                    if (avatarLink) avatarLink.href = profileUrl;
                    const svMeta = v.querySelector('.sv-meta');
                    svMeta.innerHTML = \`
                        <a class="sv-profile-link sv-profile-name-link" href="\${profileUrl}" aria-label="Open AniList profile"><span class="sv-username">\${currentStoryData.isCurrentUser ? 'You' : currentStoryData.name}</span></a>
                        <span class="activity-timestamp"> • \${act.timestamp}</span>
                    \`;
                    
                    // Render progress bars
                    const progressContainer = v.querySelector('.sv-progress-container');
                    progressContainer.innerHTML = Array.from({length: currentStoryData.activities.length}).map((_, i) => 
                        \`<div class="sv-progress-bar \${i < currentStoryIndex ? 'completed' : ''} \${i === currentStoryIndex ? 'active' : ''}"><div class="sv-progress-fill"></div></div>\`
                    ).join('');

                    const img = v.querySelector('.sv-card-img');
                    const tMain = v.querySelector('.sv-text-main');
                    const tSub = v.querySelector('.sv-text-sub');
                    const entryBtn = v.querySelector('#sv-open-entry');
                    const likeBtn = v.querySelector('#sv-like-btn');
                    const viewRepliesBtn = v.querySelector('#sv-view-replies-btn');
                    img.style.display = '';
                    [entryBtn, likeBtn, viewRepliesBtn].forEach(button => {
                        if (button) button.style.display = '';
                    });
                    img.src = act.coverImage || 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/default.jpg';
                    tMain.innerText = act.textMain;
                    tSub.innerText = act.mediaTitle;

                                        if (entryBtn) {
                        entryBtn.style.display = mediaId ? '' : 'none';
                        entryBtn.onclick = mediaId ? () => window.openEntryPage(mediaId, mediaType) : null;
                    }
                    if (likeBtn) {
                        window.updateLikeButton(likeBtn, act);
                        likeBtn.onclick = () => window.toggleActivityLike(activityId);
                    }

                    if (viewRepliesBtn) {
                        viewRepliesBtn.onclick = () => window.showReplies(activityId);
                    }
                    
                    if (shouldAnimate) {
                        [img, tMain, tSub].forEach(el => {
                            el.classList.remove('sv-animate-enter');
                            void el.offsetWidth;
                            el.classList.add('sv-animate-enter');
                        });
                        
                        // Only restart timer if not manually paused
                        if (!isManuallyPaused) {
                            restartStoryTimer();
                        }
                    }
                }

                function initStoryViewer() {
                    if (document.getElementById(VIEWER_ID)) return;
                    
                    const v = document.createElement('div');
                    v.id = VIEWER_ID;
                    v.innerHTML = \`
                        <div class="sv-background"></div>
                        <div class="sv-content">
                            <div class="sv-progress-container"></div>
                            <div class="sv-header">
                                <a class="sv-profile-link sv-profile-avatar-link" id="sv-profile-avatar-link" href="#" aria-label="Open AniList profile"><img class="sv-avatar" src="" alt=""></a>
                                <div class="sv-meta"></div>
                                <button class="sv-close" aria-label="Close" onclick="window.closeStoryViewer()">&times;</button>
                            </div>
                            <div class="sv-body">
                                <div class="pause-indicator" id="pause-indicator">Paused</div>
                                <div class="sv-nav-left" onclick="window.prevStory()"></div>
                                <div class="sv-activity-layout">
                                    <div class="sv-card-wrapper">
                                        <img class="sv-card-img" src="">
                                        <button class="sv-entry-icon" id="sv-open-entry" aria-label="Open media page" title="Open media page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"></path><path d="M10 14 21 3"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path></svg></button>
                                    </div>
                                    <div class="sv-footer">
                                        <div class="sv-text-main"></div>
                                        <div class="sv-text-sub"></div>
                                        <div class="sv-actions">
                                            <button class="sv-action-btn sv-like-btn" id="sv-like-btn" type="button" aria-label="Like activity" title="Like activity" aria-pressed="false"><svg class="sv-like-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"></path></svg><span class="sv-like-count"></span></button>
                                            <button class="sv-action-btn" id="sv-view-replies-btn">View Replies</button>
                                        </div>
                                    </div>
                                </div>
                                <div class="sv-nav-right" onclick="window.nextStory()"></div>
                            </div>
                            
                            <div id="reply-modal" class="pos-\${REPLY_POSITION}">
                                <div class="reply-header">
                                    <h3>Activity Replies</h3>
                                    <button class="reply-close" aria-label="Close" onclick="window.closeReplies()">&times;</button>
                                </div>
                                <div class="reply-composer" id="reply-composer">
                                    <img class="reply-composer-avatar" id="reply-composer-avatar" src="" alt="Your profile image">
                                    <textarea class="reply-composer-input" id="reply-composer-input" placeholder="Write something..." aria-label="Write a reply"></textarea>
                                    <button class="reply-composer-submit" id="reply-composer-submit" type="button" disabled>Post</button>
                                </div>
                                <div class="reply-list" id="reply-list">
                                    <div class="reply-none">Loading replies...</div>
                                </div>
                            </div>
                        </div>
                    \`;
                    
                    const inputModal = document.createElement('div');
                    inputModal.id = INPUT_MODAL_ID;
                    inputModal.innerHTML = \`
                        <div class="input-modal-card">
                            <h3>Post a Reply</h3>
                            <textarea id="reply-textarea" class="reply-textarea" placeholder="Type your reply here..." oninput="window.handleReplyInput(this)"></textarea>
                            <div class="input-modal-footer">
                                <span class="char-count" id="char-count-span">0/\${MAX_REPLY_CHARS}</span>
                                <div class="input-modal-actions">
                                    <button class="cancel-btn" onclick="window.closeReplyInputModal()">Cancel</button>
                                    <button class="submit-btn" id="reply-submit-btn" onclick="window.submitReply()" disabled>Post</button>
                                </div>
                            </div>
                        </div>
                    \`;

                    document.body.appendChild(v);
                    document.body.appendChild(inputModal);
                    v.querySelector('.sv-close').onclick = window.closeStoryViewer;
                }

                // --- RENDER LOGIC ---
                function attachReloadListener() {
                    const reloadBtn = document.getElementById('reload-btn');
                    if (reloadBtn) reloadBtn.onclick = () => window.location.reload();
                }

                function ensureBox() {
                    let target;
                    try {
                        target = document.querySelector(TARGET_SEL);
                    } catch (error) {
                        console.warn('Invalid Anilist activity injection selector.', error);
                        target = null;
                    }
                    if (!target) return false;
                    if (document.getElementById(BOX_ID)) return true;
                    
                    const box = document.createElement('div');
                    box.id = BOX_ID;
                    box.className = FEED_BG_CLASS;
                    box.innerHTML = '<style>' + styles + '</style><div id="feed-content"></div>';
                    
                    if (TARGET_SEL.includes('toolbar') || TARGET_SEL.includes('container') || TARGET_SEL.includes('column-left') || TARGET_SEL.includes('lists-container')) {
                         target.prepend(box);
                    } else {
                         target.insertAdjacentElement('afterend', box);
                    }
                    
                    initStoryViewer();
                    return true;
                }

                function renderTokenUnavailable() {
                    const content = document.getElementById('feed-content');
                    if (!content) return;
                    content.innerHTML = '<div class="box-header">AniList Friend Activity</div><div class="state-msg">AniList token unavailable. Connect your AniList account to load activities.</div>';
                }

                function renderLoading(fromCacheCheck = false) { 
                    const content = document.getElementById('feed-content');
                    if (!content) return;
                    const msg = fromCacheCheck ? 'Checking cache and fetching updates...' : 'Fetching updates...';
                    const spinner = \`<svg class="animate-spin loading-spinner" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 8.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>\`;
                    const headerHtml = '<div class="box-header">Friend Activity <button class="action-btn subtle-action" id="reload-btn">Reload</button></div>';
                    content.innerHTML = headerHtml + \`<div class="state-msg loading-state">\${spinner}\${msg}</div>\`;
                    attachReloadListener();
                }

                function clearLegacyActivityCaches() {
                    const legacyKeys = [];
                    for (let index = 0; index < localStorage.length; index++) {
                        const key = localStorage.key(index);
                        if (key && key.startsWith('anilist-feed-cache')) legacyKeys.push(key);
                    }
                    legacyKeys.forEach(key => localStorage.removeItem(key));
                }

                function renderPrefetchedActivities(data) {
                    clearLegacyActivityCaches();
                    if (!data || data.error) {
                        const content = document.getElementById('feed-content');
                        if (content) content.innerHTML = '<div class="box-header">AniList Friend Activity</div><div class="error-msg">' + (data?.error || 'Unable to load activities.') + '</div>';
                        attachReloadListener();
                        return;
                    }
                    localStorage.setItem(CURRENT_USER_KEY, data.currentUserName || '');
                    localStorage.setItem(CURRENT_USER_AVATAR_KEY, data.currentUserAvatar || '');
                    renderStories(data.stories || [], Boolean(data.fromCache));
                }

                function renderStories(stories, fromCache = false) {
                    const content = document.getElementById('feed-content');
                    if (!content) return;

                    const currentUserName = localStorage.getItem(CURRENT_USER_KEY) || '';
                    allStoryGroups = orderStoryGroups(stories, currentUserName);

                    const cacheIndicator = fromCache ? ' (Cached)' : '';
                    const reloadText = fromCache ? 'Refresh' : '↻ Reload';
                    const headerHtml = \`<div class="box-header">Friend Activity\${cacheIndicator} <button class="action-btn" id="reload-btn">\${reloadText}</button></div>\`;

                    if (stories.length === 0) {
                        content.innerHTML = headerHtml + '<div class="state-msg">No recent activity found.</div>';
                    } else {
                        const html = allStoryGroups.map((s, index) => {
                            if (RING_COLOR === 'seanime') {
                                // For Seanime accent, use dynamic gradient based on activity count
                                const ringStyle = getSeanimeRingStyle(s.activities);
                                return \`
                                <div class="story-item\${s.isCurrentUser ? ' current-user' : ''}\${s.isCurrentUser && s.activities.length === 0 ? ' empty-self' : ''}\${s.isCurrentUser && index < allStoryGroups.length - 1 ? ' has-divider' : ''}" data-index="\${index}">
                                    <div class="story-ring" style="\${ringStyle}">
                                        <img class="story-image">
                                    </div>
                                    <span class="story-name"></span>
                                </div>\`;
                            } else {
                                const ring = getSegmentedRingStyle(s.activities);
                                return \`
                                <div class="story-item\${s.isCurrentUser ? ' current-user' : ''}\${s.isCurrentUser && s.activities.length === 0 ? ' empty-self' : ''}\${s.isCurrentUser && index < allStoryGroups.length - 1 ? ' has-divider' : ''}" data-index="\${index}">
                                    <div class="story-ring" style="\${ring}">
                                        <img class="story-image">
                                    </div>
                                    <span class="story-name"></span>
                                </div>\`;
                            }
                        }).join('');
                        
                        content.innerHTML = headerHtml + '<div class="stories-container">' + html + '</div><div class="stories-footer-spacer"></div>';
                        
                        content.querySelectorAll('.story-item').forEach((item, index) => {
                            const story = allStoryGroups[index];
                            const storyName = item.querySelector('.story-name');
                            if (storyName) storyName.textContent = story.isCurrentUser ? 'You' : String(story.name ?? '');

                            const storyImage = item.querySelector('.story-image');
                            if (storyImage) {
                                const defaultAvatar = 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png';
                                const rawAvatarUrl = typeof story.profileImage === 'string' ? story.profileImage : '';
                                let avatarUrl = defaultAvatar;
                                if (rawAvatarUrl) {
                                    try {
                                        const parsedAvatarUrl = new URL(rawAvatarUrl, window.location.origin);
                                        if (parsedAvatarUrl.protocol === 'https:' || parsedAvatarUrl.protocol === 'http:') {
                                            avatarUrl = parsedAvatarUrl.toString();
                                        }
                                    } catch (_) {}
                                }
                                if (isGifUrl(avatarUrl)) storyImage.setAttribute('data-gif', 'true');
                                storyImage.addEventListener('error', () => {
                                    storyImage.removeAttribute('data-gif');
                                    storyImage.src = defaultAvatar;
                                }, { once: true });
                                storyImage.src = avatarUrl;
                            }

                            if (item.classList.contains('empty-self')) {
                                item.setAttribute('aria-disabled', 'true');
                                item.setAttribute('aria-label', 'You have no recent activity');
                                return;
                            }
                            item.onclick = () => {
                                const index = parseInt(item.getAttribute('data-index'));
                                window.openStoryViewer(index); 
                            };
                        });
                    }
                    attachReloadListener();
                }
                
                function mainLoop() {
                    if (!ensureBox()) return setTimeout(mainLoop, 500);
                    activeToken = INJECTED_TOKEN;
                    if (!INJECTED_TOKEN || !INJECTED_TOKEN.trim()) return renderTokenUnavailable();
                    renderPrefetchedActivities(PREFETCHED_DATA);
                }
                mainLoop();
            })();
            `; 
            return jsString;
        }

        async function injectLoadingState(ctx: UiContext): Promise<void> {
            const targetSelector = JSON.stringify(state.activeTargetSelector).replace(/<\/script/gi, '<\\/script');
            const loadingScript = await ctx.dom.createElement("script");
            loadingScript.setAttribute(LOADING_SCRIPT_ATTR, "true");
            loadingScript.setText(`
                (() => {
                    const previousState = window['${LOADING_STATE_KEY}'];
                    if (previousState && typeof previousState.stop === 'function') previousState.stop();
                    const loadingState = { cancelled: false, timer: null, stop: null };
                    loadingState.stop = () => {
                        loadingState.cancelled = true;
                        if (loadingState.timer) clearInterval(loadingState.timer);
                        document.getElementById('${LOADING_BOX_ID}')?.remove();
                        if (window['${LOADING_STATE_KEY}'] === loadingState) delete window['${LOADING_STATE_KEY}'];
                    };
                    window['${LOADING_STATE_KEY}'] = loadingState;
                    const selector = ${targetSelector};
                    const findTarget = () => {
                        let target;
                        try { target = document.querySelector(selector); } catch (_) { return; }
                        if (loadingState.cancelled || !target || document.getElementById('${LOADING_BOX_ID}')) return;
                        const loading = document.createElement('div');
                        loading.id = '${LOADING_BOX_ID}';
                        loading.style.cssText = 'box-sizing:border-box;width:100%;max-width:1300px;margin:16px auto 24px;padding:24px 16px;border-radius:12px;color:#9CA3AF;text-align:center;font-family:Inter,sans-serif;background:rgba(31,41,55,0.35);';
                        loading.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:10px"><span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(156,163,175,.35);border-top-color:#9CA3AF;border-radius:50%;animation:anilistActivitySpin .8s linear infinite"></span><span>Loading AniList activities…</span></div><style>@keyframes anilistActivitySpin{to{transform:rotate(360deg)}}</style>';
                        if (selector.includes('toolbar') || selector.includes('container') || selector.includes('column-left') || selector.includes('lists-container')) target.prepend(loading);
                        else target.insertAdjacentElement('afterend', loading);
                    };
                    findTarget();
                    let attempts = 0;
                    loadingState.timer = setInterval(() => {
                        findTarget();
                        attempts++;
                        if (document.getElementById('${LOADING_BOX_ID}')) {
                            clearInterval(loadingState.timer);
                            loadingState.timer = null;
                        } else if (attempts >= 120) {
                            loadingState.stop();
                        }
                    }, 250);
                })();
            `);
            const body = await ctx.dom.queryOne("body");
            if (body) body.append(loadingScript);
        }

        async function removeLoadingState(ctx: UiContext): Promise<void> {
            const body = await ctx.dom.queryOne("body");
            if (body) {
                const cleanupScript = await ctx.dom.createElement("script");
                cleanupScript.setText(`window['${LOADING_STATE_KEY}']?.stop?.();`);
                body.append(cleanupScript);
                await cleanupScript.remove();
            }
            const loading = await ctx.dom.queryOne(`#${LOADING_BOX_ID}`);
            if (loading) await loading.remove();
            const loadingScripts = await ctx.dom.query(`script[${LOADING_SCRIPT_ATTR}]`);
            for (const script of loadingScripts) await script.remove();
        }
  
        const handleContentBox = async (ctx: UiContext) => {  
            if (await ctx.dom.queryOne(`script[${SCRIPT_DATA_ATTR}]`)) return;
            await injectLoadingState(ctx);

            let token = "";
            try {
                // @ts-ignore
                if (typeof $database !== 'undefined' && $database.anilist) {
                    // @ts-ignore
                    token = await $database.anilist.getToken();
                }
            } catch (e) {}

            const currentSettings = {
                activeTargetSelector: state.activeTargetSelector,
                activityHistoryDays: state.activityHistoryDays,
                cacheRefreshMinutes: state.cacheRefreshMinutes,
                bgStyle: state.bgStyle,
                ringColor: state.ringColor,
                replyPosition: state.replyPosition, 
            };

            let prefetchedData: any = null;
            if (token) {
                try {
                    prefetchedData = await fetchActivitiesForPlugin(token, currentSettings);
                } catch (error) {
                    console.error('AniList activity fetch failed in plugin runtime:', error);
                    prefetchedData = { stories: [], currentUserName: '', currentUserAvatar: DEFAULT_AVATAR, error: 'Unable to load AniList activities: ' + (error instanceof Error ? error.message : String(error)) };
                }
            }

            await removeLoadingState(ctx);

            const script = await ctx.dom.createElement("script");
            script.setAttribute(SCRIPT_DATA_ATTR, "true");

            script.setText(await getSmartInjectedScript(token, currentSettings, prefetchedData));
            
            const body = await ctx.dom.queryOne("body");
            if (body) body.append(script);
        };  
  
        const cleanupContentBox = async (ctx: UiContext) => {  
            await removeLoadingState(ctx);
            const existingBox = await ctx.dom.queryOne('#' + INJECTED_BOX_ID);  
            if (existingBox) await existingBox.remove();  
              
            const existingViewer = await ctx.dom.queryOne(`#${VIEWER_ID}`);  
            if (existingViewer) await existingViewer.remove();  

            const existingInputModal = await ctx.dom.queryOne(`#${INPUT_MODAL_ID}`);
            if (existingInputModal) await existingInputModal.remove();
  
            const existingScripts = await ctx.dom.query(`script[${SCRIPT_DATA_ATTR}]`);  
            for (const script of existingScripts) await script.remove();  
        };  
  
        ctx.dom.onReady(async () => {  
            ctx.screen.onNavigate(async (e) => {  
                const isRoot = e.pathname === "/";  
                if (isRoot) {
                    await handleContentBox(ctx);
                } else {
                    await cleanupContentBox(ctx);
                }
            });  
            ctx.screen.loadCurrent();   
        });  
    });
}
