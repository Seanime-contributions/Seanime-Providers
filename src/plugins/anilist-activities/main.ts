/// <reference path="./core.d.ts" />  

function init() {  
    $ui.register((ctx) => {  
        const INJECTED_BOX_ID = "activity-stories-feed";  
        const VIEWER_ID = "story-viewer-overlay";  
        const INPUT_MODAL_ID = "reply-input-modal";
        const SCRIPT_DATA_ATTR = "data-injected-box-script";  

        const SELECTOR_MAP = {
            'toolbar': 'div[data-home-toolbar-container="true"]',
            'bottom-page': 'div[data-home-screen-item-divider="true"]',
            'above-watching': 'div[data-library-collection-lists-container="true"]',
        };
        const DEFAULT_CHOICE = 'toolbar'; 

        const STORAGE_KEYS = {
            DROPDOWN_CHOICE: "anilist-feed.dropdownChoice",
            MANUAL_OVERRIDE_SELECTOR: "anilist-feed.manualOverrideSelector",
            BG_STYLE: "anilist-feed.bgStyle",
            RING_COLOR: "anilist-feed.ringColor",
            REPLY_POSITION: "anilist-feed.replyPosition",
        };

        const initialDropdownChoice = $storage.get(STORAGE_KEYS.DROPDOWN_CHOICE) ?? DEFAULT_CHOICE;
        const initialManualSelector = $storage.get(STORAGE_KEYS.MANUAL_OVERRIDE_SELECTOR) ?? '';
        const initialReplyPosition = $storage.get(STORAGE_KEYS.REPLY_POSITION) ?? 'right';
        
        const resolveTargetSelector = (dropdownChoice: string, manualOverride: string): string => {
            return (manualOverride && manualOverride.trim() !== "") 
                ? manualOverride.trim() 
                : SELECTOR_MAP[dropdownChoice] || SELECTOR_MAP[DEFAULT_CHOICE];
        };

        const state = {
            dropdownChoice: initialDropdownChoice,
            manualOverrideSelector: initialManualSelector,
            activeTargetSelector: resolveTargetSelector(initialDropdownChoice, initialManualSelector),
            bgStyle: $storage.get(STORAGE_KEYS.BG_STYLE) ?? 'glass',
            ringColor: $storage.get(STORAGE_KEYS.RING_COLOR) ?? '#FF6F61',
            replyPosition: initialReplyPosition,
        };

        const refs = {
            dropdownChoice: ctx.fieldRef(state.dropdownChoice),
            manualOverrideSelector: ctx.fieldRef(state.manualOverrideSelector),
            bgStyle: ctx.fieldRef(state.bgStyle),
            ringColor: ctx.fieldRef(state.ringColor),
            replyPosition: ctx.fieldRef(state.replyPosition),
        };
        
        ctx.registerEventHandler("save-feed-settings", () => {
            const newDropdownChoice = refs.dropdownChoice.current;
            const newManualSelector = refs.manualOverrideSelector.current;

            const finalSelector = resolveTargetSelector(newDropdownChoice, newManualSelector);

            $storage.set(STORAGE_KEYS.DROPDOWN_CHOICE, newDropdownChoice);
            $storage.set(STORAGE_KEYS.MANUAL_OVERRIDE_SELECTOR, newManualSelector);
            $storage.set(STORAGE_KEYS.BG_STYLE, refs.bgStyle.current);
            $storage.set(STORAGE_KEYS.RING_COLOR, refs.ringColor.current);
            $storage.set(STORAGE_KEYS.REPLY_POSITION, refs.replyPosition.current);
            
            state.dropdownChoice = newDropdownChoice;
            state.manualOverrideSelector = newManualSelector;
            state.activeTargetSelector = finalSelector;
            state.bgStyle = refs.bgStyle.current;
            state.ringColor = refs.ringColor.current;
            state.replyPosition = refs.replyPosition.current;

            ctx.toast.success("Settings saved! Refresh page to apply.");
        });

        const tray = ctx.newTray({
            tooltipText: "Friend Activity Settings",
            iconUrl: "https://anilist.co/img/icons/android-chrome-512x512.png",
            withContent: true,
        });

        tray.render(() => {
            const items = [
                tray.text("Activity Feed Settings", { style: { fontWeight: "bold", fontSize: "14px", marginBottom: "8px" } }),
                tray.select("Injection Point", {
                    fieldRef: refs.dropdownChoice,
                    options: [
                        { label: "Default (Toolbar)", value: 'toolbar' },
                        { label: "Above Currently Watching", value: 'above-watching' },
                        { label: "Bottom of Page", value: 'bottom-page' },
                    ],
                    help: "Choose a common location to inject the feed."
                }),
                tray.input("Manual Selector Override (CSS)", {
                    fieldRef: refs.manualOverrideSelector,
                    placeholder: "e.g., .my-custom-div",
                    help: "If provided, this CSS selector overrides the dropdown choice above."
                }),
                tray.select("Background Style", {
                    fieldRef: refs.bgStyle,
                    options: [
                        { label: "Glass (Blur)", value: "glass" },
                        { label: "Solid Dark", value: "dark" },
                        { label: "Solid Light", value: "light" },
                        { label: "Transparent", value: "transparent" }
                    ]
                }),
                tray.select("Ring Color", {
                    fieldRef: refs.ringColor,
                    options: [
                        { label: "Coral (Default)", value: "#FF6F61" },
                        { label: "AniList Blue", value: "#3DB4F2" },
                        { label: "Emerald Green", value: "#10B981" },
                        { label: "Violet", value: "#8B5CF6" },
                        { label: "Hot Pink", value: "#EC4899" },
                        { label: "Orange", value: "#F97316" },
                        { label: "Red", value: "#EF4444" },
                        { label: "White", value: "#FFFFFF" },
                        { label: "Seanime accent", value: "seanime" }
                    ]
                }),
                tray.select("Reply Modal Position", {
                    fieldRef: refs.replyPosition,
                    options: [
                        { label: "Right Side (Default)", value: "right" },
                        { label: "Left Side", value: "left" },
                    ],
                    help: "Choose where the 'View Replies' modal slides in from."
                }),
                tray.button("Save & Apply", {
                    onClick: "save-feed-settings",
                    intent: "primary-subtle"
                })
            ];
            return tray.stack({ items, style: { gap: "12px", padding: "8px" } });
        });
          
        function getSmartInjectedScript(prefilledToken: string = '', settings: typeof state): string {  
            let bgCss = "";
            switch (settings.bgStyle) {
                case "dark": bgCss = "background-color: #151f2e; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);"; break;
                case "light": bgCss = "background-color: #ffffff; color: #111; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);"; break;
                case "transparent": bgCss = "background-color: transparent; box-shadow: none;"; break;
                case "glass": default: 
                    bgCss = "background-color: rgba(255, 255, 255, 0.05); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);"; 
                    break;
            }

            const ringColor = settings.ringColor || '#FF6F61';
            const IS_LIGHT = settings.bgStyle === 'light';
            const MAIN_TEXT_COLOR = IS_LIGHT ? '#374151' : '#E5E7EB';
            const REPLY_POSITION = settings.replyPosition;

            const styles = `
                /* FEED STYLES */
                #${INJECTED_BOX_ID} { 
                    z-index: 20; 
                    position: relative; 
                    box-sizing: border-box; 
                    width: 100%; 
                    max-width: 1300px; 
                    margin: 16px auto 24px auto; 
                    ${bgCss} 
                    padding: 0; 
                    border-radius: 12px; 
                    font-family: "Inter", sans-serif; 
                    animation: slideInDown 0.4s ease-out; 
                    color: ${MAIN_TEXT_COLOR}; 
                    min-height: 120px; 
                    display: flex; 
                    flex-direction: column; 
                    justify-content: center; 
                }
                .box-header { margin-bottom: 12px; font-weight: 600; font-size: 1rem; display: flex; justify-content: space-between; align-items: center; padding: 16px 16px 0 16px; }
                .action-btn { font-size: 0.75rem; color: #9CA3AF; cursor: pointer; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 4px 10px; border-radius: 12px; transition: all 0.2s; }
                .action-btn:hover { background: rgba(255,255,255,0.15); color: white; border-color: rgba(255,255,255,0.3); }

                /* BASE STYLES - Mobile First */
                .stories-container { display: flex; overflow-x: auto; gap: 20px; padding: 0 16px 5px 16px; scrollbar-width: none; }
                .stories-container::-webkit-scrollbar { display: none; } 
                .story-item { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; text-align: center; max-width: 65px; transition: transform 0.2s; }
                .story-ring { width: 64px; height: 64px; padding: 3px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; transition: transform 0.2s; }
                .story-image { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; border: 3px solid #1F2937; }
                .story-name { font-size: 0.75rem; font-weight: 500; color: ${MAIN_TEXT_COLOR}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }

                /* SEANIME ACCENT STYLES */
                .story-ring.seanime-accent {
                    background: conic-gradient(from -90deg, 
                        rgb(var(--color-brand-500)) 0deg 88deg, 
                        #1F2937 88deg 90deg, 
                        rgb(var(--color-brand-500)) 90deg 178deg, 
                        #1F2937 178deg 180deg, 
                        rgb(var(--color-brand-500)) 180deg 268deg, 
                        #1F2937 268deg 270deg, 
                        rgb(var(--color-brand-500)) 270deg 358deg, 
                        #1F2937 358deg 360deg) !important;
                }
                .story-ring.seanime-accent.single-activity {
                    background: rgb(var(--color-brand-500)) !important;
                }

                /* DESKTOP / LARGE SCREEN ENHANCEMENTS */
                @media (min-width: 768px) {
                    .stories-container { 
                        gap: 30px; 
                        padding: 0 24px 5px 24px; 
                        scrollbar-width: thin; 
                        scrollbar-color: #6B7280 #1F2937; 
                    }
                    .stories-container::-webkit-scrollbar { 
                        height: 8px; 
                        display: block; 
                    }
                    .stories-container::-webkit-scrollbar-track {
                        background: rgba(31, 41, 55, 0.5); 
                        border-radius: 10px;
                    }
                    .stories-container::-webkit-scrollbar-thumb {
                        background-color = rgba(107, 114, 128, 0.7); 
                        border-radius: 10px;
                        border: 2px solid transparent; 
                    }
                    .story-item { max-width: 80px; } 
                    .story-ring { 
                        width: 80px; height: 80px; 
                        padding: 4px; 
                        margin-bottom: 10px; 
                    }
                    .story-name { font-size: 0.85rem; } 
                    
                    #${INJECTED_BOX_ID} { padding-top: 24px; padding-bottom: 24px; } 
                    .box-header { padding: 0 24px 0 24px; }
                }

                .token-form { display: flex; flex-direction: column; align-items: center; width: 100%; gap: 10px; padding: 0 16px 16px 16px;}
                .token-input { background: rgba(0,0,0,0.3); border: 1px solid #4B5563; color: white; padding: 8px 12px; border-radius: 6px; width: 80%; max-width: 300px; font-size: 0.9rem; }
                .token-btn { background: #6366F1; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
                .token-btn:hover { background: #4F46E5; }
                .token-help { font-size: 0.8rem; color: #9CA3AF; text-align: center; }
                .token-help a { color: #8B5CF6; text-decoration: underline; }
                .state-msg { text-align: center; color: #9CA3AF; width: 100%; padding: 0 16px 16px 16px; }
                .error-msg { color: #F87171; margin-bottom: 8px; font-size: 0.9rem; }

                /* VIEWER STYLES */
                #${VIEWER_ID} { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 9999; display: none; flex-direction: column; }
                #${VIEWER_ID}.is-open { display: flex; animation: fadeIn 0.2s; }
                .sv-background { position: absolute; top: 0; left: 0; width: 100%; height: 100%; filter: blur(40px) brightness(0.4); z-index: 0; background-size: cover; background-position: center; transition: background-image 0.5s ease; will-change: filter, background-image; }
                .sv-content { position: relative; z-index: 2; width: 100%; height: 100%; display: flex; flex-direction: column; }
                .sv-progress-container { display: flex; gap: 4px; padding: 12px 10px; width: 100%; box-sizing: border-box; }
                .sv-progress-bar { flex: 1; height: 3px; background: rgba(255,255,255,0.3); border-radius: 2px; overflow: hidden; }
                .sv-progress-fill { height: 100%; background: #fff; width: 0%; transition: width 0.1s linear; }
                .sv-progress-bar.completed .sv-progress-fill { width: 100%; }
                .sv-header { display: flex; align-items: center; padding: 0 16px; margin-top: 4px; height: 50px; }
                .sv-avatar { width: 32px; height: 32px; border-radius: 50%; margin-right: 10px; border: 1px solid rgba(255,255,255,0.2); }
                .sv-username { color: white; font-weight: 600; font-size: 0.9rem; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
                .sv-close { margin-left: auto; color: white; background: none; border: none; font-size: 1.5rem; cursor: pointer; padding: 5px; opacity: 0.8; }
                .sv-body { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; }
                .sv-card-img { width: 85%; max-height: 60vh; object-fit: cover; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                .sv-footer { padding: 20px; padding-bottom: 40px; color: white; text-align: center; }
                .sv-text-main { font-size: 1.1rem; font-weight: 600; margin-bottom: 4px; text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
                .sv-text-sub { font-size: 0.9rem; font-weight: 400; margin-bottom: 4px; text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
                .sv-nav-left, .sv-nav-right { position: absolute; top: 0; bottom: 0; z-index: 100; cursor: pointer; background: transparent; }
                .sv-nav-left:active, .sv-nav-right:active { background: rgba(255,255,255,0.05); }
                .sv-nav-left { left: 0; width: 30%; }
                .sv-nav-right { right: 0; width: 70%; }
                .sv-animate-enter { animation: fadeInScale 0.3s ease-out; }
                @keyframes fadeInScale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                .sv-actions { margin-top: 15px; display: flex; justify-content: center; gap: 15px; }
                .sv-action-btn { background: rgba(255, 255, 255, 0.15); border: none; padding: 8px 15px; border-radius: 8px; color: white; cursor: pointer; transition: background 0.2s; font-weight = 500; font-size: 0.9rem; }
                .sv-action-btn:hover { background: rgba(255, 255, 255, 0.25); }
                .pause-indicator { 
                    position: absolute; 
                    top: 50%; 
                    left: 50%; 
                    transform: translate(-50%, -50%); 
                    background: rgba(0, 0, 0, 0.7); 
                    color: white; 
                    padding: 10px 20px; 
                    border-radius: 10px; 
                    font-size: 1.2rem; 
                    font-weight: bold; 
                    z-index: 100; 
                    display: none; 
                }
                .pause-indicator.show { display: block; animation: fadeIn 0.3s; }

                /* VIEWER ENHANCEMENTS FOR PC */
                @media (min-width: 1024px) {
                    .sv-body { padding-top: 20px; }
                    .sv-card-img { 
                        width: auto; 
                        max-width: 600px; 
                        max-height: 70vh; 
                    }
                    .sv-nav-left { width: 15%; } 
                    .sv-nav-right { width: 15%; } 
                }

                /* --- REPLY MODAL ANIMATIONS --- */
                @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
                @keyframes slideOutRight { from { transform: translateX(0); } to { transform: translateX(100%); } }
                @keyframes slideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }
                @keyframes slideOutLeft { from { transform: translateX(0); } to { transform: translateX(-100%); } }

                .slide-in-right { animation: slideInRight 0.3s ease-out forwards; }
                .slide-out-right { animation: slideOutRight 0.3s ease-in forwards; }
                .slide-in-left { animation: slideInLeft 0.3s ease-out forwards; }
                .slide-out-left { animation: slideOutLeft 0.3s ease-in forwards; }

                /* REPLY MODAL STYLES */
                #reply-modal { 
                    position: absolute; 
                    top: 0; 
                    width: 100%; 
                    max-width: 400px;
                    height: 100%; 
                    background: rgba(0,0,0,0.95); 
                    z-index: 10; 
                    display: none; 
                    flex-direction: column; 
                    padding: 10px; 
                    box-sizing: border-box; 
                }
                
                #reply-modal.is-visible {
                    display: flex; 
                }

                /* Position Classes */
                #reply-modal.pos-right { right: 0; left: auto; }
                #reply-modal.pos-left { left: 0; right: auto; }

                /* Mobile Override: Always full width, but still use L/R animations for consistency */
                @media (max-width: 768px) {
                    #reply-modal { max-width: 100%; left: 0 !important; right: 0 !important; }
                }

                .reply-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
                .reply-header h3 { color: white; margin: 0; font-size: 1.1rem; }
                .reply-close { background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer; }
                .reply-list { flex-grow: 1; overflow-y: auto; padding: 10px 0; }
                .reply-item { display: flex; gap: 10px; margin-bottom: 15px; padding-bottom: 10px; border-bottom = 1px solid rgba(255,255,255,0.05); }
                .reply-avatar { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
                .reply-body { flex-grow: 1; text-align: left; }
                .reply-meta { font-size: 0.8rem; color: #9CA3AF; margin-bottom: 4px; }
                .reply-meta span { font-weight: 600; color: white; margin-right: 5px; }
                .reply-text { color: white; font-size: 0.9rem; line-height: 1.4; }
                .reply-none { color: #9CA3AF; text-align: center; padding: 20px; }

                /* REPLY INPUT MODAL STYLES */
                #${INPUT_MODAL_ID} {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 10000;
                    display: none; justify-content: center; align-items: center;
                    animation: fadeIn 0.2s;
                }
                #${INPUT_MODAL_ID}.is-open { display: flex; }
                .input-modal-card {
                    background: #151f2e;
                    border-radius: 12px;
                    width: 90%;
                    max-width: 450px;
                    padding: 20px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    color: white;
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                .input-modal-card h3 {
                    margin: 0;
                    font-size: 1.2rem;
                    font-weight: 700;
                    color: #3DB4F2;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    padding-bottom: 10px;
                }
                .reply-textarea {
                    width: 100%;
                    min-height: 100px;
                    padding: 10px;
                    border: 1px solid #4B5563;
                    border-radius: 8px;
                    background: #1F2937;
                    color: white;
                    font-size: 1rem;
                    resize: vertical;
                    box-sizing: border-box;
                }
                .reply-textarea:focus {
                    outline: none;
                    border-color: #3DB4F2;
                    box-shadow: 0 0 0 1px #3DB4F2;
                }
                .input-modal-footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .char-count {
                    font-size: 0.8rem;
                    color: #9CA3AF;
                }
                .char-count.error {
                    color: #EF4444;
                    font-weight: 600;
                }
                .input-modal-actions button {
                    padding: 8px 15px;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .input-modal-actions .cancel-btn {
                    background: transparent;
                    border: 1px solid #4B5563;
                    color: #9CA3AF;
                    margin-right: 10px;
                }
                .input-modal-actions .cancel-btn:hover {
                    background: rgba(75, 85, 99, 0.1);
                }
                .input-modal-actions .submit-btn {
                    background: #3DB4F2;
                    border: none;
                    color: white;
                }
                .input-modal-actions .submit-btn:hover {
                    background: #2A9DD8;
                }
                .input-modal-actions .submit-btn:disabled {
                    background: #374151;
                    cursor: not-allowed;
                }
            `;

            const jsString = `
            (function() {
                const styles = \`${styles}\`; 

                const BOX_ID = "${INJECTED_BOX_ID}";
                const VIEWER_ID = "${VIEWER_ID}";
                const INPUT_MODAL_ID = "${INPUT_MODAL_ID}";
                const TARGET_SEL = '${settings.activeTargetSelector}';
                const INJECTED_TOKEN = "${prefilledToken.replace(/"/g, '\\"')}";
                const CACHE_KEY = "anilist-feed-cache";
                const CACHE_DURATION_MS = 300000;
                const STORY_DURATION = 5000;
                const RING_COLOR = '${ringColor}';
                const IS_LIGHT = ${IS_LIGHT};
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
                            pauseIndicator.textContent = '⏸️ Paused';
                            pauseIndicator.classList.add('show');
                            pauseViewerTimer();
                        } else {
                            pauseIndicator.classList.remove('show');
                            setTimeout(() => {
                                if (pauseIndicator) pauseIndicator.textContent = '▶️ Playing';
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
                
                function getSegmentedRingStyle(count, isNew) {
                    if (RING_COLOR === 'seanime') {
                        // For Seanime accent, we'll handle it separately
                        return '';
                    }
                    
                    const cN = RING_COLOR; 
                    const cB = '#334155'; 
                    const sep = '#1F2937';
                    
                    // Show the exact number of segments based on activity count
                    // No longer limiting to 8 segments
                    const segments = count;
                    
                    if (segments <= 1) {
                        return \`background: \${isNew ? cN : cB}\`;
                    }
                    
                    const deg = 360 / segments;
                    let stops = [];
                    for (let i = 0; i < segments; i++) {
                        const start = i * deg;
                        const end = (i + 1) * deg;
                        // For many segments, make the gap smaller (1 degree instead of 2) for better visibility
                        const gapSize = segments > 12 ? 1 : 2;
                        const segmentEnd = end - gapSize;
                        stops.push(\`\${isNew ? cN : cB} \${start}deg \${segmentEnd}deg\`);
                        stops.push(\`\${sep} \${segmentEnd}deg \${end}deg\`);
                    }
                    return 'background: conic-gradient(from -90deg, ' + stops.join(', ') + ')';
                }

                // Function to generate Seanime gradient based on activity count
                function getSeanimeRingStyle(count, isNew) {
                    const activeColor = 'rgb(var(--color-brand-500))';
                    const baseColor = '#334155';
                    const separatorColor = '#1F2937';
                    
                    // Show the exact number of segments based on activity count
                    // No longer limiting to 8 segments
                    const segments = count;
                    
                    if (segments <= 1) {
                        return \`background: \${activeColor} !important\`;
                    }
                    
                    const deg = 360 / segments;
                    let stops = [];
                    for (let i = 0; i < segments; i++) {
                        const start = i * deg;
                        const end = (i + 1) * deg;
                        // For many segments, make the gap smaller (1 degree instead of 2) for better visibility
                        const gapSize = segments > 12 ? 1 : 2;
                        const segmentEnd = end - gapSize;
                        stops.push(\`\${activeColor} \${start}deg \${segmentEnd}deg\`);
                        stops.push(\`\${separatorColor} \${segmentEnd}deg \${end}deg\`);
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
                            msgBox.style.cssText = 'position:absolute; bottom:100px; left:50%; transform:translateX(-50%); background:rgba(255,0,0,0.8); color:white; padding:10px; border-radius:8px; z-index:10001; font-size:0.9rem;';
                            msgBox.innerText = 'Error: Please enter your AniList Access Token.';
                            viewer.appendChild(msgBox);
                            setTimeout(() => viewer.removeChild(msgBox), 3000);
                        } else {
                            const box = document.getElementById(BOX_ID);
                            if (box) {
                                const msg = document.createElement('div');
                                msg.innerText = 'Error: Please enter your AniList Access Token.';
                                msg.style.cssText = 'color: #F87171; text-align: center; padding: 10px; background: rgba(248, 113, 113, 0.1); border-radius: 8px; margin: 10px;';
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
                            msg.style.cssText = 'color: #F87171; text-align: center; padding: 10px; background: rgba(248, 113, 113, 0.1); border-radius: 8px; margin: 10px;';
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
                        successMsg.style.cssText = 'position:absolute; top:20px; left:50%; transform:translateX(-50%); background:#10B981; color:white; padding:8px 15px; border-radius:8px; font-weight:600; z-index: 10002;';
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
                
                window.showReplies = async (activityId) => {
                    const replyModal = document.getElementById('reply-modal');
                    const replyList = document.getElementById('reply-list');
                    if (!replyModal || !replyList) return;

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
                                  avatar { medium }
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
                                    <img class="reply-avatar" src="\${r.user.avatar.medium}" onerror="this.src='https://s4.anilist.co/file/anilistcdn/user/avatar/medium/default.png'">
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
                    } else if (e.key === ' ' || e.code === 'Space') {
                        // Spacebar to toggle pause
                        window.togglePause();
                        e.preventDefault();
                    } else if (isReplyModalVisible || isInputModalOpen) {
                         return; 
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
                    currentStoryIndex = 0;
                    
                    renderStoryFrame(true);
                    document.getElementById(VIEWER_ID).classList.add('is-open');

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
                    
                    document.removeEventListener('keydown', handleKeyDown);
                }

                window.nextStory = () => {
                    if(!currentStoryData) return;
                    if(currentStoryIndex < currentStoryData.activities.length - 1) {
                        currentStoryIndex++;
                        renderStoryFrame(true);
                    } else {
                        const nextUserIndex = currentStoryGroupIndex + 1;
                        if (nextUserIndex < allStoryGroups.length) {
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
                    
                    const act = currentStoryData.activities[currentStoryIndex];
                    const activityId = act.id;
                    const mediaId = act.mediaId;
                    const mediaType = act.mediaType;
                    
                    // Close replies instantly without animation when changing frames
                    const replyModal = document.getElementById('reply-modal');
                    if (replyModal) replyModal.classList.remove('is-visible', 'slide-in-right', 'slide-out-right', 'slide-in-left', 'slide-out-left');
                    window.closeReplyInputModal();

                    v.querySelector('.sv-background').style.backgroundImage = \`url(\${act.coverImage || currentStoryData.profileImage})\`;
                    v.querySelector('.sv-avatar').src = currentStoryData.profileImage;
                    
                    const svMeta = v.querySelector('.sv-meta');
                    svMeta.innerHTML = \`
                        <span class="sv-username">\${currentStoryData.name}</span>
                        <span style="opacity: 0.6; font-weight: 400; font-size: 0.8rem;"> • \${act.timestamp}</span>
                    \`;
                    
                    // Render progress bars
                    const progressContainer = v.querySelector('.sv-progress-container');
                    progressContainer.innerHTML = Array.from({length: currentStoryData.activities.length}).map((_, i) => 
                        \`<div class="sv-progress-bar \${i < currentStoryIndex ? 'completed' : ''} \${i === currentStoryIndex ? 'active' : ''}"><div class="sv-progress-fill"></div></div>\`
                    ).join('');

                    const img = v.querySelector('.sv-card-img');
                    const tMain = v.querySelector('.sv-text-main');
                    const tSub = v.querySelector('.sv-text-sub');
                    const viewRepliesBtn = v.querySelector('#sv-view-replies-btn');

                    img.src = act.coverImage || 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/default.jpg';
                    tMain.innerText = act.textMain;
                    tSub.innerText = act.mediaTitle;

                    const replyBtn = v.querySelector('#sv-reply-btn');
                    const entryBtn = v.querySelector('#sv-entry-btn');
                    
                    if (replyBtn) {
                        replyBtn.onclick = () => window.replyActivity(activityId);
                    }

                    if (entryBtn && mediaId) {
                        entryBtn.onclick = () => window.openEntryPage(mediaId, mediaType);
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
                                <img class="sv-avatar" src="">
                                <div class="sv-meta"></div>
                                <button class="sv-close" aria-label="Close" onclick="window.closeStoryViewer()">&times;</button>
                            </div>
                            <div class="sv-body">
                                <div class="pause-indicator" id="pause-indicator">⏸️ Paused</div>
                                <div class="sv-nav-left" onclick="window.prevStory()"></div> 
                                <img class="sv-card-img" src="">
                                <div class="sv-nav-right" onclick="window.nextStory()"></div>
                            </div>
                            <div class="sv-footer">
                                <div class="sv-text-main"></div>
                                <div class="sv-text-sub"></div>
                                <div class="sv-actions">
                                    <button class="sv-action-btn" id="sv-reply-btn">💬 Reply</button>
                                    <button class="sv-action-btn" id="sv-entry-btn">📖 Open page</button>
                                    <button class="sv-action-btn" id="sv-view-replies-btn">👁️ View Replies</button>
                                </div>
                            </div>
                            
                            <div id="reply-modal" class="pos-\${REPLY_POSITION}">
                                <div class="reply-header">
                                    <h3>Activity Replies</h3>
                                    <button class="reply-close" aria-label="Close" onclick="window.closeReplies()">&times;</button>
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
                        const tokenToUse = activeToken || INJECTED_TOKEN; 
                        if (tokenToUse) fetchActivities(tokenToUse, true);
                        else renderInputForm("Please enter your AniList Access Token.");
                    };
                }

                function ensureBox() {
                    const target = document.querySelector(TARGET_SEL);
                    if (!target) return false;
                    if (document.getElementById(BOX_ID)) return true;
                    
                    const box = document.createElement('div');
                    box.id = BOX_ID;
                    box.innerHTML = '<style>' + styles + '</style><div id="feed-content"></div>';
                    
                    if (TARGET_SEL.includes('toolbar') || TARGET_SEL.includes('container') || TARGET_SEL.includes('column-left') || TARGET_SEL.includes('lists-container')) {
                         target.prepend(box);
                    } else {
                         target.insertAdjacentElement('afterend', box);
                    }
                    
                    initStoryViewer();
                    return true;
                }

                function renderInputForm(error = null) {
                    const content = document.getElementById('feed-content');
                    if (!content) return;
                    content.innerHTML = \`
                        <div class="box-header">AniList Friend Activity</div>
                        <div class="token-form">
                            \${error ? \`<div class="error-msg">\${error}</div>\` : ''}
                            <input type="password" id="ani-token" class="token-input" placeholder="Paste AniList Access Token" />
                            <button id="ani-save-btn" class="token-btn">Load Activity Feed</button>
                            <div class="token-help">Create token at <a href="https://anilist.co/api/v2/oauth/authorize?client_id=13985&response_type=token" target="_blank">AniList API</a></div>
                        </div>
                    \`;

                    document.getElementById('ani-save-btn').onclick = () => {
                        const token = document.getElementById('ani-token').value.trim();
                        if (token) fetchActivities(token);
                    };
                }

                function renderLoading(fromCacheCheck = false) { 
                    const content = document.getElementById('feed-content');
                    if (!content) return;
                    const msg = fromCacheCheck ? 'Checking cache and fetching updates...' : 'Fetching updates...';
                    const spinner = \`<svg class="animate-spin" style="width:24px; height:24px; margin-right:10px;" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>\`;
                    const headerHtml = '<div class="box-header">Friend Activity <button class="action-btn" id="reload-btn" style="opacity:0.8">Reload</button></div>';
                    content.innerHTML = headerHtml + \`<div class="state-msg" style="display:flex; justify-content:center; align-items:center; flex-direction:column; padding-bottom: 16px;">\${spinner}\${msg}</div>\`;
                    attachReloadListener();
                }

                function renderStories(stories, fromCache = false) { 
                    const content = document.getElementById('feed-content');
                    if (!content) return;

                    allStoryGroups = stories;

                    const cacheIndicator = fromCache ? ' (Cached)' : '';
                    const reloadText = fromCache ? 'Refresh' : '↻ Reload';
                    const headerHtml = \`<div class="box-header">Friend Activity\${cacheIndicator} <button class="action-btn" id="reload-btn">\${reloadText}</button></div>\`;

                    if (stories.length === 0) {
                        content.innerHTML = headerHtml + '<div class="state-msg">No recent activity found.</div>';
                    } else {
                        const html = stories.map((s, index) => {
                            if (RING_COLOR === 'seanime') {
                                // For Seanime accent, use dynamic gradient based on activity count
                                const ringStyle = getSeanimeRingStyle(s.activities.length, s.status === 'new');
                                return \`
                                <div class="story-item" data-index="\${index}">
                                    <div class="story-ring" style="\${ringStyle}">
                                        <img src="\${s.profileImage}" class="story-image" onerror="this.src='https://s4.anilist.co/file/anilistcdn/user/avatar/medium/default.png'">
                                    </div>
                                    <span class="story-name">\${s.name}</span>
                                </div>\`;
                            } else {
                                const ring = getSegmentedRingStyle(s.activities.length, s.status === 'new');
                                return \`
                                <div class="story-item" data-index="\${index}">
                                    <div class="story-ring" style="\${ring}">
                                        <img src="\${s.profileImage}" class="story-image" onerror="this.src='https://s4.anilist.co/file/anilistcdn/user/avatar/medium/default.png'">
                                    </div>
                                    <span class="story-name">\${s.name}</span>
                                </div>\`;
                            }
                        }).join('');
                        
                        content.innerHTML = headerHtml + '<div class="stories-container">' + html + '</div><div style="padding: 0 16px 16px 16px; min-height: 1px;"></div>';
                        
                        content.querySelectorAll('.story-item').forEach(item => {
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
                    if (!token) return renderInputForm("Token not found. Please provide your AniList Access Token.");
                    
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
                                    user { 
                                        name 
                                        avatar { medium } 
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

                        const rawActs = json.data.Page.activities;
                        const grouped = {};
                        
                        rawActs.forEach(act => {
                            const uName = act.user.name;
                            if (!grouped[uName]) grouped[uName] = { name: uName, profileImage: act.user.avatar.medium, status: 'new', activities: [] };
                            
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
                            });
                        });

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
                        renderInputForm(errMsg);
                    }
                }
            
                function mainLoop() {
                    if (!ensureBox()) return setTimeout(mainLoop, 500);
                    if (INJECTED_TOKEN && INJECTED_TOKEN.trim() !== "") return fetchActivities(INJECTED_TOKEN, false);
                    renderInputForm();
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

            script.setText(getSmartInjectedScript(token, currentSettings));  
            
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
