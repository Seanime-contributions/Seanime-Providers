/**
 * Seanime Snow effect Plugin
 */

function init() {
    $ui.register(async (ctx) => {
        ctx.dom.onReady(async () => {
            try {
                const snowScript = await ctx.dom.createElement("script");
                await snowScript.setText(`
(function() {
    let snowEnabled = true;
    let isHiddenMode = false; // Tracks if we are in Reader OR Video Player
    let activeSnowflakes = 0;
    const MAX_SNOWFLAKES = 50;
    const XMAS_LOGO = 'https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/refs/heads/main/public/seanime-xmas.png';
    const DEFAULT_LOGO = '/seanime-logo.png';

    try {
        const saved = localStorage.getItem('seanime-snow-enabled');
        if (saved !== null) snowEnabled = (saved === 'true');
    } catch(e) {}

    // 1. Create Snow Container
    const snowContainer = document.createElement('div');
    snowContainer.id = 'premium-snow-container';
    snowContainer.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9997; overflow: hidden; transition: opacity 0.5s; opacity: ' + (snowEnabled ? '1' : '0') + '; display: ' + (snowEnabled ? 'block' : 'none') + ';';
    document.body.appendChild(snowContainer);

    // 2. Logo Handling Logic
    function updateLogos() {
        const logos = document.querySelectorAll('img[src*="seanime-logo.png"], img[alt="Loading..."], img[alt="logo"]');
        
        logos.forEach(img => {
            // Skip tray icons
            if (img.hasAttribute('data-plugin-tray-icon-image')) return;

            if (snowEnabled) {
                if (!img.src.includes('seanime-xmas.png')) img.src = XMAS_LOGO;
            } else {
                if (img.src.includes('seanime-xmas.png')) img.src = DEFAULT_LOGO;
            }
        });
    }

    // 3. Snow Animation
    function createSnowflake() {
        // Stop spawning if disabled, full, or if in hidden mode (Reader/Video)
        if (!snowEnabled || isHiddenMode || activeSnowflakes >= MAX_SNOWFLAKES) return;
        
        activeSnowflakes++;
        const snowflake = document.createElement('div');
        const size = Math.random() * 4 + 2;
        snowflake.style.cssText = 'position: absolute; background: white; border-radius: 50%; width: ' + size + 'px; height: ' + size + 'px; left: ' + (Math.random() * 100) + 'vw; top: -10px; opacity: ' + (Math.random() * 0.7 + 0.3) + '; filter: blur(0.5px); pointer-events: none; z-index: 9998;';
        snowContainer.appendChild(snowflake);
        
        const duration = Math.random() * 10 + 10;
        snowflake.animate([
            { transform: 'translate(0, 0)' },
            { transform: 'translate(' + ((Math.random() - 0.5) * 150) + 'px, 105vh)' }
        ], { duration: duration * 1000, easing: 'linear' }).onfinish = () => {
            snowflake.remove();
            activeSnowflakes--;
            // Recursively create new flake only if conditions are still met
            if (snowEnabled && !isHiddenMode) createSnowflake();
        };
    }

    // 4. Toggle Button
    const statusSpan = document.createElement('div');
    statusSpan.id = 'snow-toggle-btn';
    statusSpan.style.cssText = 'position: fixed; bottom: 25px; right: 20px; background: rgba(0, 0, 0, 0.8); color: ' + (snowEnabled ? 'white' : '#888') + '; padding: 12px 20px; border-radius: 30px; font-size: 14px; z-index: 10001; backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.2); cursor: pointer; user-select: none; touch-action: manipulation;';
    statusSpan.innerHTML = '<span>❄️</span> <span id="snow-text">' + (snowEnabled ? 'Snow: ON' : 'Snow: OFF') + '</span>';
    document.body.appendChild(statusSpan);

    function toggle(e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        
        snowEnabled = !snowEnabled;
        localStorage.setItem('seanime-snow-enabled', snowEnabled);
        
        const txt = document.getElementById('snow-text');
        if (txt) txt.textContent = snowEnabled ? 'Snow: ON' : 'Snow: OFF';
        statusSpan.style.color = snowEnabled ? 'white' : '#888';
        
        if (snowEnabled) {
            snowContainer.style.display = 'block';
            setTimeout(() => { snowContainer.style.opacity = '1'; }, 10);
            // Spawn initial batch if not in hidden mode
            if (activeSnowflakes < 10 && !isHiddenMode) {
                for(let i=0; i<25; i++) setTimeout(createSnowflake, i * 100);
            }
        } else {
            snowContainer.style.opacity = '0';
            setTimeout(() => { 
                snowContainer.style.display = 'none'; 
                snowContainer.innerHTML = '';
                activeSnowflakes = 0;
            }, 500);
        }
        updateLogos();
    }

    statusSpan.addEventListener('click', toggle);

    // 5. Context Detection (Reader & Video)
    function checkMode() {
        // A. Reader Check
        const readerElement = document.querySelector('div[data-chapter-reader-drawer-content="true"]');
        const isReader = !!readerElement;

        // B. Video Player Check
        // Condition: URL contains "/entry" AND video element exists
        const isEntryPage = window.location.href.includes('/entry');
        const videoElement = document.querySelector('video[data-vc-element="video"]');
        const isVideo = isEntryPage && !!videoElement;

        const shouldHide = isReader || isVideo;

        // If state hasn't changed, do nothing
        if (shouldHide === isHiddenMode) return;
        
        isHiddenMode = shouldHide;

        if (isHiddenMode) {
            // HIDE everything when in Reader or Video
            statusSpan.style.display = 'none';
            snowContainer.style.opacity = '0';
            setTimeout(() => { snowContainer.style.display = 'none'; }, 500);
        } else {
            // SHOW everything when returning to normal view (if enabled)
            statusSpan.style.display = 'block';
            if (snowEnabled) {
                snowContainer.style.display = 'block';
                setTimeout(() => { snowContainer.style.opacity = '1'; }, 10);
                if (activeSnowflakes < 10) {
                    for(let i=0; i<25; i++) setTimeout(createSnowflake, i * 100);
                }
            }
        }
    }

    // 6. Observers
    const observer = new MutationObserver(() => {
        updateLogos();
        checkMode(); // Check for reader/video on DOM changes
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    // Initial Run
    updateLogos();
    checkMode(); 
    
    if (snowEnabled && !isHiddenMode) {
        for(let i=0; i<30; i++) setTimeout(createSnowflake, i * 150);
    }
})();
                `);

                const body = await ctx.dom.queryOne("body");
                if (body) {
                    await body.append(snowScript);
                    ctx.toast.success("Snow effect loaded!");
                }
            } catch (err) {
                console.error("Snow Plugin Error:", err);
            }
        });
    });
}
