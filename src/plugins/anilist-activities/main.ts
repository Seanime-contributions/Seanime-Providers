
/// <reference path="./core.d.ts" />  

function init() {  
    $ui.register((ctx) => {  
        const INJECTED_BOX_ID = "activity-stories-feed";  
        const VIEWER_ID = "story-viewer-overlay";  
        const INPUT_MODAL_ID = "reply-input-modal";
        const STYLES_URI = "https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/main/src/plugins/anilist-activities/styles.css";
        const SCRIPT_DATA_ATTR = "data-injected-box-script";  

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
            bgStyle: "{{bgStyle}}" || 'glass',
            ringColor: "{{ringColor}}" || '#FF6F61',
            replyPosition: initialReplyPosition,
        };
          
        async function getSmartInjectedScript(prefilledToken: string = '', settings: typeof state): Promise<string> {
            const stylesResponse = await fetch(STYLES_URI);
            if (!stylesResponse.ok) throw new Error("Unable to load activity feed styles.");
            const styles = (await stylesResponse.text()).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
            const ringColor = settings.ringColor || '#FF6F61';
            const REPLY_POSITION = settings.replyPosition;
            const feedBgClass = 'feed-bg-' + settings.bgStyle;
            const targetSelector = JSON.stringify(settings.activeTargetSelector);

            const jsString = `
            (function() {
                const styles = \`${styles}\`; 
                const FEED_BG_CLASS = '${feedBgClass}';

                const BOX_ID = "${INJECTED_BOX_ID}";
                const VIEWER_ID = "${VIEWER_ID}";
                const INPUT_MODAL_ID = "${INPUT_MODAL_ID}";
                const TARGET_SEL = ${targetSelector};
                const INJECTED_TOKEN = "${prefilledToken.replace(/"/g, '\\"')}";
                const CACHE_KEY = "anilist-feed-cache-v5";
                const CURRENT_USER_KEY = "anilist-feed-current-user";
                const CURRENT_USER_AVATAR_KEY = "anilist-feed-current-user-avatar";
                const VIEWED_ACTIVITIES_KEY = "anilist-viewed-activity-ids";
                const CACHE_DURATION_MS = 300000;
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
                let startTime = 0;
                let currentActivityIdForReply = null; 
                let isInteractionActive = false;
                let isManuallyPaused = false;
                                let touchStartTime = 0;
                let touchHoldTimeout = null;
                let scrollLockState = null;
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
                function lockBackgroundScroll() {
                    if (scrollLockState) return;
                    const body = document.body;
                    const root = document.documentElement;
                    scrollLockState = {
                        bodyOverflow: body.style.overflow,
                        rootOverflow: root.style.overflow,
                        bodyOverscrollBehavior: body.style.overscrollBehavior,
                        rootOverscrollBehavior: root.style.overscrollBehavior,
                    };
                    body.style.overflow = 'hidden';
                    root.style.overflow = 'hidden';
                    body.style.overscrollBehavior = 'none';
                    root.style.overscrollBehavior = 'none';
                }
                function unlockBackgroundScroll() {
                    if (!scrollLockState) return;
                    const body = document.body;
                    const root = document.documentElement;
                    body.style.overflow = scrollLockState.bodyOverflow;
                    root.style.overflow = scrollLockState.rootOverflow;
                    body.style.overscrollBehavior = scrollLockState.bodyOverscrollBehavior;
                    root.style.overscrollBehavior = scrollLockState.rootOverscrollBehavior;
                    scrollLockState = null;
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

                function pauseViewerTimer() {
                    if (currentStoryTimer) clearTimeout(currentStoryTimer);
                    if (progressInterval) clearInterval(progressInterval);
                    
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

                    if (currentStoryTimer) clearTimeout(currentStoryTimer);
                    if (progressInterval) clearInterval(progressInterval);
                    startTime = Date.now();
                    
                    const activeBar = document.querySelector('.sv-progress-bar.active');
                    if (!activeBar) return;
                    
                    const fill = activeBar.querySelector('.sv-progress-fill');
                    if (fill) {
                        fill.style.transition = 'width 0.1s linear';
                        fill.style.width = '0%';
                    }
                    
                    currentStoryTimer = setTimeout(window.nextStory, STORY_DURATION);
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
                            replyList.innerHTML = replies.map(r => \`
                                <div class="reply-item">
                                    <img class="reply-avatar\${isGifUrl(r.user.avatar.large || r.user.avatar.medium) ? '" data-gif="true"' : ''}" src="\${r.user.avatar.large || r.user.avatar.medium}" onerror="this.src='https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png'">
                                    <div class="reply-body">
                                        <div class="reply-meta">
                                            <span>\${r.user.name}</span> \${timeAgo(r.createdAt)}
                                        </div>
                                        <div class="reply-text">\${r.text.replace(/\\n/g, '<br>')}</div>
                                    </div>
                                </div>
                            \`).join('');
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

                    currentStoryData = storyGroup;
                    currentStoryGroupIndex = storyGroupIndex;
                    const firstUnviewedIndex = storyGroup.activities.findIndex(activity => !isActivityViewed(activity));
                    currentStoryIndex = firstUnviewedIndex >= 0 ? firstUnviewedIndex : 0;
                    
                    renderStoryFrame(true);
                    document.getElementById(VIEWER_ID).classList.add('is-open');
                    lockBackgroundScroll();

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
                    document.getElementById(VIEWER_ID).classList.remove('is-open');
                    window.closeReplies(); 
                    window.closeReplyInputModal(); 
                    
                    if(currentStoryTimer) clearTimeout(currentStoryTimer);
                    if(progressInterval) clearInterval(progressInterval); 

                    currentStoryData = null;
                    currentStoryGroupIndex = -1;
                    isInteractionActive = false;
                                        isManuallyPaused = false;
                    unlockBackgroundScroll();
                    document.removeEventListener('keydown', handleKeyDown);
                }

                window.nextStory = () => {
                    if(!currentStoryData) return;
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
                    if (reloadBtn) reloadBtn.onclick = () => {
                        const tokenToUse = INJECTED_TOKEN;
                        if (tokenToUse) fetchActivities(tokenToUse, true);
                        else renderTokenUnavailable();
                    };
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
                    const spinner = \`<svg class="animate-spin loading-spinner" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>\`;
                    const headerHtml = '<div class="box-header">Friend Activity <button class="action-btn subtle-action" id="reload-btn">Reload</button></div>';
                    content.innerHTML = headerHtml + \`<div class="state-msg loading-state">\${spinner}\${msg}</div>\`;
                    attachReloadListener();
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
                                        <img src="\${s.profileImage}" class="story-image\${isGifUrl(s.profileImage) ? '" data-gif="true"' : ''}" onerror="this.src='https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png'">
                                    </div>
                                    <span class="story-name">\${s.isCurrentUser ? 'You' : s.name}</span>
                                </div>\`;
                            } else {
                                const ring = getSegmentedRingStyle(s.activities);
                                return \`
                                <div class="story-item\${s.isCurrentUser ? ' current-user' : ''}\${s.isCurrentUser && s.activities.length === 0 ? ' empty-self' : ''}\${s.isCurrentUser && index < allStoryGroups.length - 1 ? ' has-divider' : ''}" data-index="\${index}">
                                    <div class="story-ring" style="\${ring}">
                                        <img src="\${s.profileImage}" class="story-image\${isGifUrl(s.profileImage) ? '" data-gif="true"' : ''}" onerror="this.src='https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png'">
                                    </div>
                                    <span class="story-name">\${s.isCurrentUser ? 'You' : s.name}</span>
                                </div>\`;
                            }
                        }).join('');
                        
                        content.innerHTML = headerHtml + '<div class="stories-container">' + html + '</div><div class="stories-footer-spacer"></div>';
                        
                        content.querySelectorAll('.story-item').forEach(item => {
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
                
                async function fetchActivities(token, forceRefresh = false) { 
                    activeToken = token;
                    if (!token) return renderTokenUnavailable();
                    
                    renderLoading(!forceRefresh); 
                    
                    const cached = localStorage.getItem(CACHE_KEY);
                    if (!forceRefresh && cached) { 
                        try {
                            const data = JSON.parse(cached);
                            if (Date.now() < data.timestamp + CACHE_DURATION_MS) {
                                renderStories(data.stories, true);
                                return;
                            }
                        } catch (e) {
                            console.error("Failed to parse cache, proceeding with fetch.", e);
                            localStorage.removeItem(CACHE_KEY);
                        }
                    }
                    
                    // Updated query to include media id and type
                    const query = \`
                    query { 
                        Viewer { id name avatar { large medium } }
                        Page(page: 1, perPage: 50) { 
                            activities(type: MEDIA_LIST, sort: ID_DESC, isFollowing: true) { 
                                ... on ListActivity { 
                                    id 
                                    media { 
                                        id
                                        type
                                        title { romaji english } 
                                        coverImage { extraLarge } 
                                    } 
                                    status 
                                    progress 
                                    createdAt
                                    likeCount
                                    isLiked
                                    user { 
                                        name 
                                        avatar { large medium } 
                                    } 
                                } 
                            } 
                        } 
                    }
                    \`;

                    try {
                        const res = await fetch('https://graphql.anilist.co', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
                            body: JSON.stringify({ query: query })
                        });

                        const json = await res.json();
                        if (!res.ok || json.errors) throw new Error(json.errors ? json.errors[0].message : 'Invalid Token or Network Error');

                        const currentUser = json.data.Viewer;
                        const currentUserName = currentUser && currentUser.name;
                        const currentUserId = currentUser && currentUser.id;
                        const followedActs = json.data.Page.activities || [];
                        const recencyCutoff = followedActs.length > 0
                            ? Math.min(...followedActs.map(activity => activity.createdAt))
                            : Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
                        const currentUserAvatar = (currentUser.avatar && (currentUser.avatar.large || currentUser.avatar.medium)) || 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png';
                        localStorage.setItem(CURRENT_USER_KEY, currentUserName || '');
                        localStorage.setItem(CURRENT_USER_AVATAR_KEY, currentUserAvatar);
                        let ownActs = [];
                        if (currentUserId) {
                            const ownActivitiesQuery = \`
                            query ($userId: Int!, $createdAtGreater: Int!) {
                                Page(page: 1, perPage: 50) {
                                    activities(type: MEDIA_LIST, sort: ID_DESC, userId: $userId, createdAt_greater: $createdAtGreater) {
                                        ... on ListActivity {
                                            id
                                            media {
                                                id
                                                type
                                                title { romaji english }
                                                coverImage { extraLarge }
                                            }
                                            status
                                            progress
                                            createdAt
                                            likeCount
                                            isLiked
                                            user {
                                                name
                                                avatar { large medium }
                                            }
                                        }
                                    }
                                }
                            }
                            \`;
                            try {
                                const ownRes = await fetch('https://graphql.anilist.co', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
                                    body: JSON.stringify({ query: ownActivitiesQuery, variables: { userId: currentUserId, createdAtGreater: recencyCutoff } })
                                });
                                const ownJson = await ownRes.json();
                                if (!ownRes.ok || ownJson.errors) throw new Error(ownJson.errors ? ownJson.errors[0].message : 'Unable to fetch your activities');
                                ownActs = ownJson.data.Page.activities || [];
                            } catch (ownActivityError) {
                                console.warn('Unable to fetch your activities; showing followed-user activities only.', ownActivityError);
                            }
                        }
                        const rawActs = [...followedActs, ...ownActs]
                            .filter((activity, index, activities) => activities.findIndex(item => item.id === activity.id) === index);
                        const grouped = {};
                        
                        rawActs.forEach(act => {
                            const uName = act.user.name;
                            // Prioritize large avatar for better GIF support, fallback to medium
                            const profileImage = act.user.avatar.large || act.user.avatar.medium;
                            if (!grouped[uName]) grouped[uName] = { name: uName, profileImage: profileImage, status: 'new', isCurrentUser: uName === currentUserName, activities: [] };
                            
                            const title = act.media.title.english || act.media.title.romaji;
                            
                            // Use the new formatActivityStatus function for proper capitalization
                            const textMain = formatActivityStatus(act.status, act.progress);

                            grouped[uName].activities.push({
                                id: act.id,
                                mediaId: act.media.id,
                                mediaType: act.media.type,
                                textMain: textMain,
                                mediaTitle: title,
                                timestamp: timeAgo(act.createdAt),
                                coverImage: act.media.coverImage.extraLarge,
                                likeCount: act.likeCount,
                                isLiked: act.isLiked,
                            });
                        });

                        if (currentUserName && !grouped[currentUserName]) {
                            const viewerAvatar = (currentUser.avatar && (currentUser.avatar.large || currentUser.avatar.medium)) || 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png';
                            grouped[currentUserName] = { name: currentUserName, profileImage: viewerAvatar, status: 'new', isCurrentUser: true, activities: [] };
                        }
                        const finalStories = Object.values(grouped);
                        finalStories.forEach(g => g.activities.reverse());

                        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), stories: finalStories }));
                        renderStories(finalStories, false);

                    } catch (e) {
                        console.error("API Fetch Failed:", e);
                        let errMsg = "Error: " + e.message;
                        
                        if (cached) {
                            try { renderStories(JSON.parse(cached).stories, true); errMsg = "API Error: Showing stale cached data. Try refreshing later."; } 
                            catch (cacheError) {}
                        }
                        const content = document.getElementById('feed-content');
                        if (content) content.innerHTML = '<div class="box-header">AniList Friend Activity</div><div class="error-msg">' + errMsg + '</div>';
                        attachReloadListener();
                    }
                }
            
                function mainLoop() {
                    if (!ensureBox()) return setTimeout(mainLoop, 500);
                    if (INJECTED_TOKEN && INJECTED_TOKEN.trim() !== "") return fetchActivities(INJECTED_TOKEN, false);
                    renderTokenUnavailable();
                }
                mainLoop();
            })();
            `; 
            return jsString;
        }
  
        const handleContentBox = async (ctx: UiContext) => {  
            if (await ctx.dom.queryOne(`script[${SCRIPT_DATA_ATTR}]`)) return;

            let token = "";
            try {
                // @ts-ignore
                if (typeof $database !== 'undefined' && $database.anilist) {
                    // @ts-ignore
                    token = await $database.anilist.getToken();
                }
            } catch (e) {}

            const script = await ctx.dom.createElement("script");  
            script.setAttribute(SCRIPT_DATA_ATTR, "true");  
            
            const currentSettings = {
                activeTargetSelector: state.activeTargetSelector,
                bgStyle: state.bgStyle,
                ringColor: state.ringColor,
                replyPosition: state.replyPosition, 
            };

            script.setText(await getSmartInjectedScript(token, currentSettings));
            
            const body = await ctx.dom.queryOne("body");
            if (body) body.append(script);
        };  
  
        const cleanupContentBox = async (ctx: UiContext) => {  
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
