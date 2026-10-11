function init() {
    $ui.register((ctx) => {
        //const tray = ctx.newTray({
        //    tooltipText: "My plugin",
        //    iconUrl: "https://seanime.rahim.app/logo_2.png",
        //    withContent: true,
        //    isDrawer: false,
        //});
        //
        //// 🔥 Solo una función
        //async function setNekoSkin(url) {
        //    const neko = await ctx.dom.queryOne("#oneko")
        //    if (!neko) return
        //    await neko.setStyle("background-image", `url("${url}")`)
        //}
        //
        //function skinButton(label, url) {
        //    return tray.button(label, {
        //        onClick: ctx.eventHandler("skin-" + label, async () => {
        //            await setNekoSkin(url)
        //            await $storage.set("oneko.skin", url)
        //        })
        //    })
        //}
        //
        //ctx.registerEventHandler("skin-change", async ({ skin }) => {
        //    await setNekoSkin(skin);
        //});
        //
        //tray.render(() =>
        //    tray.stack({
        //        items: [
        //            tray.text("Cambiar skin:"),
        //
        //            skinButton(
        //                "Neko original",
        //                "https://raw.githubusercontent.com/adryd325/oneko.js/main/oneko.gif"
        //            ),
        //
        //            skinButton(
        //                "Ada (6×6)",
        //                "https://opengameart.org/sites/default/files/ada_0_0_0.png"
        //            ),
        //        ]
        //    })
        //)

        ctx.dom.onReady(async () => {
            const head = await ctx.dom.queryOne("head")
            //const savedSkin = await $storage.get("oneko.skin")
            const script = await ctx.dom.createElement("script");
            script.setText(`
                (function oneko() {
                    const isReducedMotion =
                        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    if (isReducedMotion) return;

                    const nekoEl = document.createElement("div");
                    let nekoPosX = 32;
                    let nekoPosY = 32;
                    let mousePosX = 0;
                    let mousePosY = 0;
                    let frameCount = 0;
                    let idleTime = 0;
                    let idleAnimation = null;
                    let idleAnimationFrame = 0;

                    const nekoSpeed = 10;

                    nekoEl.dataset.frameWidth = "32";
                    nekoEl.dataset.frameHeight = "32";

                    const spriteSets = {
                        idle: [[-3, -3]],
                        alert: [[-7, -3]],
                        scratchSelf: [
                            [-5, 0], [-6, 0], [-7, 0],
                        ],
                        scratchWallN: [[0, 0], [0, -1]],
                        scratchWallS: [[-7, -1], [-6, -2]],
                        scratchWallE: [[-2, -2], [-2, -3]],
                        scratchWallW: [[-4, 0], [-4, -1]],
                        tired: [[-3, -2]],
                        sleeping: [[-2, 0], [-2, -1]],
                        N: [[-1, -2], [-1, -3]],
                        NE: [[0, -2], [0, -3]],
                        E: [[-3, 0], [-3, -1]],
                        SE: [[-5, -1], [-5, -2]],
                        S: [[-6, -3], [-7, -2]],
                        SW: [[-5, -3], [-6, -1]],
                        W: [[-4, -2], [-4, -3]],
                        NW: [[-1, 0], [-1, -1]],
                    };
                    
                    function resetIdleAnimation() {
                        idleAnimation = null;
                        idleAnimationFrame = 0;
                      }

                    function init() {
                       let nekoFile = "https://raw.githubusercontent.com/adryd325/oneko.js/main/oneko.gif"

                        nekoEl.id = "oneko";
                        nekoEl.style.width = "32px";
                        nekoEl.style.height = "32px";
                        nekoEl.style.position = "fixed";
                        nekoEl.style.pointerEvents = "none";
                        nekoEl.style.imageRendering = "pixelated";
                        nekoEl.style.left = \`\${nekoPosX - 16}px\`;
                        nekoEl.style.top = \`\${nekoPosY - 16}px\`;
                        nekoEl.style.zIndex = 2147483647;
                        nekoEl.style.backgroundImage = \`url(\${nekoFile})\`;

                        document.body.appendChild(nekoEl);

                        document.addEventListener("mousemove", e => {
                            mousePosX = e.clientX;
                            mousePosY = e.clientY;
                        });

                        window.requestAnimationFrame(onAnimationFrame);
                    }

                    let lastFrameTimestamp;

                    function onAnimationFrame(timestamp) {
                        if (!nekoEl.isConnected) return;
                        if (!lastFrameTimestamp) lastFrameTimestamp = timestamp;
                        if (timestamp - lastFrameTimestamp > 100) {
                            lastFrameTimestamp = timestamp;
                            frame();
                        }
                        window.requestAnimationFrame(onAnimationFrame);
                    }

                    // 🟦 Frame-size aware
                    function setSprite(name, frame) {
                        const fw = parseInt(nekoEl.dataset.frameWidth);
                        const fh = parseInt(nekoEl.dataset.frameHeight);

                        const sprite = spriteSets[name][frame % spriteSets[name].length];
                        nekoEl.style.backgroundPosition = \`\${sprite[0] * fw}px \${sprite[1] * fh}px\`;
                    }
                    
                    function idle() {
                        idleTime += 1;
                    
                        // every ~ 20 seconds
                        if (
                          idleTime > 10 &&
                          Math.floor(Math.random() * 200) == 0 &&
                          idleAnimation == null
                        ) {
                          let avalibleIdleAnimations = ["sleeping", "scratchSelf"];
                          if (nekoPosX < 32) {
                            avalibleIdleAnimations.push("scratchWallW");
                          }
                          if (nekoPosY < 32) {
                            avalibleIdleAnimations.push("scratchWallN");
                          }
                          if (nekoPosX > window.innerWidth - 32) {
                            avalibleIdleAnimations.push("scratchWallE");
                          }
                          if (nekoPosY > window.innerHeight - 32) {
                            avalibleIdleAnimations.push("scratchWallS");
                          }
                          idleAnimation =
                            avalibleIdleAnimations[
                              Math.floor(Math.random() * avalibleIdleAnimations.length)
                            ];
                        }
                    
                        switch (idleAnimation) {
                          case "sleeping":
                            if (idleAnimationFrame < 8) {
                              setSprite("tired", 0);
                              break;
                            }
                            setSprite("sleeping", Math.floor(idleAnimationFrame / 4));
                            if (idleAnimationFrame > 192) {
                              resetIdleAnimation();
                            }
                            break;
                          case "scratchWallN":
                          case "scratchWallS":
                          case "scratchWallE":
                          case "scratchWallW":
                          case "scratchSelf":
                            setSprite(idleAnimation, idleAnimationFrame);
                            if (idleAnimationFrame > 9) {
                              resetIdleAnimation();
                            }
                            break;
                          default:
                            setSprite("idle", 0);
                            return;
                        }
                        idleAnimationFrame += 1;
                      }

                    function frame() {
                        frameCount += 1;

                        const diffX = nekoPosX - mousePosX;
                        const diffY = nekoPosY - mousePosY;
                        const distance = Math.sqrt(diffX ** 2 + diffY ** 2);

                        if (distance < nekoSpeed || distance < 48) {
                            idle();
                            return;
                        }

                        idleAnimation = null;
                        idleAnimationFrame = 0;

                        if (idleTime > 1) {
                            setSprite("alert", 0);
                            idleTime = Math.min(idleTime, 7);
                            idleTime -= 1;
                            return;
                        }

                        let direction = "";
                        direction += diffY / distance > 0.5 ? "N" : "";
                        direction += diffY / distance < -0.5 ? "S" : "";
                        direction += diffX / distance > 0.5 ? "W" : "";
                        direction += diffX / distance < -0.5 ? "E" : "";

                        setSprite(direction, frameCount);

                        nekoPosX -= (diffX / distance) * nekoSpeed;
                        nekoPosY -= (diffY / distance) * nekoSpeed;

                        nekoPosX = Math.min(Math.max(16, nekoPosX), window.innerWidth - 16);
                        nekoPosY = Math.min(Math.max(16, nekoPosY), window.innerHeight - 16);

                        nekoEl.style.left = \`\${nekoPosX - 16}px\`;
                        nekoEl.style.top = \`\${nekoPosY - 16}px\`;
                    }

                    init();

                    // 🟦 Será llamada desde tu plugin
                    window.onekoChangeSkin = function (url) {
                        const el = document.getElementById("oneko");
                        if (!el) return;

                        el.style.backgroundImage = \`url("\${url}")\`;
                    };
                })();
            `);

            head.append(script);
        });
    });
}
