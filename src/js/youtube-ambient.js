/*******************************************************************************

    Ambient Lite for YouTube
    A local-only, low-resolution canvas glow behind the YouTube player.

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
*/
(() => {
    const STORAGE_KEY = 'youtubeFocusAmbientSettings';
    const defaults = {
        enabled: true,
        intensity: 0.55,
        blur: 48,
        saturation: 1.25,
        fps: 20
    };
    let settings = { ...defaults };
    let video = null;
    let player = null;
    let host = null;
    let shadow = null;
    let canvas = null;
    let layer = null;
    let panel = null;
    let renderTimer = 0;
    let resizeObserver = null;
    let navigationObserver = null;
    let syncQueued = false;
    const extensionStorage = globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local;

    const loadSettings = async () => {
        let stored;
        if ( extensionStorage ) {
            stored = (await extensionStorage.get(STORAGE_KEY))[STORAGE_KEY];
        } else {
            try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* defaults */ }
        }
        if ( stored instanceof Object ) { settings = { ...defaults, ...stored }; }
    };

    const saveSettings = async () => {
        if ( extensionStorage ) {
            await extensionStorage.set({ [STORAGE_KEY]: settings });
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        }
    };

    const findVideo = () => document.querySelector('video.html5-main-video, video');

    const isVideoPage = () => location.pathname === '/watch' ||
        location.pathname.startsWith('/shorts/') ||
        location.pathname.startsWith('/embed/') ||
        location.hostname === 'youtu.be';

    const findPlayer = target => target?.closest('#movie_player, .html5-video-player') || target?.parentElement;

    const updateLayer = () => {
        if ( !video || !layer ) { return; }
        const rect = video.getBoundingClientRect();
        if ( rect.width === 0 || rect.height === 0 ) { return; }
        layer.style.left = `${rect.left - 64}px`;
        layer.style.top = `${rect.top - 64}px`;
        layer.style.width = `${rect.width + 128}px`;
        layer.style.height = `${rect.height + 128}px`;
    };

    const applySettings = () => {
        if ( !layer || !shadow ) { return; }
        layer.hidden = settings.enabled !== true;
        layer.style.opacity = String(Math.max(0, Math.min(1, settings.intensity)));
        layer.style.filter = `blur(${Math.max(0, settings.blur)}px) saturate(${Math.max(0.5, settings.saturation)})`;
        shadow.querySelector('.enabled').textContent = `環境光：${settings.enabled ? '開啟' : '關閉'}`;
        shadow.querySelector('.intensity').value = settings.intensity;
        shadow.querySelector('.blur').value = settings.blur;
        shadow.querySelector('.saturation').value = settings.saturation;
        shadow.querySelector('.fps').value = settings.fps;
        shadow.querySelector('.intensity-value').textContent = `${Math.round(settings.intensity * 100)}%`;
        shadow.querySelector('.blur-value').textContent = `${settings.blur}px`;
        shadow.querySelector('.saturation-value').textContent = `${settings.saturation.toFixed(2)}x`;
        shadow.querySelector('.fps-value').textContent = `${settings.fps} FPS`;
    };

    const render = () => {
        renderTimer = 0;
        if ( !video || !canvas || settings.enabled !== true || document.hidden || video.paused ) { return; }
        try {
            // Drawing is intentionally low-resolution. We never read pixels or send frames anywhere.
            const width = 160;
            const height = Math.max(90, Math.round(width * video.videoHeight / (video.videoWidth || 16 / 9)));
            if ( canvas.width !== width || canvas.height !== height ) {
                canvas.width = width;
                canvas.height = height;
            }
            canvas.getContext('2d', { alpha: false })?.drawImage(video, 0, 0, width, height);
        } catch { /* The player may be changing sources during navigation. */ }
    };

    const scheduleRender = () => {
        if ( renderTimer || settings.enabled !== true || document.hidden || video?.paused ) { return; }
        renderTimer = requestAnimationFrame(render);
    };

    const createUI = () => {
        if ( host ) { return; }
        host = document.createElement('div');
        host.id = 'youtube-focus-ambient-ui';
        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                .root { position: fixed; right: 20px; bottom: 18px; z-index: 2147483647;
                    color: #fff; font: 14px Arial, sans-serif; }
                button, input { font: inherit; }
                button { border: 0; cursor: pointer; color: #fff; }
                .toggle { padding: 9px 13px; border-radius: 999px; background: #292929eF;
                    box-shadow: 0 2px 10px #0008; }
                .toggle.on { background: #8b3dff; }
                .panel { width: min(320px, calc(100vw - 28px)); margin-bottom: 8px; padding: 14px;
                    border-radius: 12px; background: #242424f2; box-shadow: 0 3px 18px #0009;
                    backdrop-filter: blur(8px); }
                .title { display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 10px; font-size: 17px; font-weight: 700; }
                .close { background: transparent; font-size: 20px; }
                .enabled { width: 100%; padding: 9px; border-radius: 7px; background: #4b3a61;
                    text-align: left; }
                label { display: grid; grid-template-columns: 1fr auto; gap: 5px; margin-top: 11px; }
                input[type=range] { grid-column: 1 / -1; width: 100%; accent-color: #b77cff; }
                .value { opacity: .75; font-size: 12px; }
                .note { margin-top: 12px; opacity: .68; font-size: 12px; line-height: 1.4; }
                @media (max-width: 600px) {
                    .root { left: 10px; right: auto; bottom: max(10px, env(safe-area-inset-bottom)); }
                }
            </style>
            <div class="root">
                <div class="panel" hidden>
                    <div class="title"><span>Ambient Lite</span><button class="close" type="button">×</button></div>
                    <button class="enabled" type="button"></button>
                    <label>光暈強度 <span class="value intensity-value"></span>
                        <input class="intensity" type="range" min="0" max="1" step="0.05"></label>
                    <label>模糊程度 <span class="value blur-value"></span>
                        <input class="blur" type="range" min="0" max="100" step="1"></label>
                    <label>色彩飽和度 <span class="value saturation-value"></span>
                        <input class="saturation" type="range" min="0.5" max="2" step="0.05"></label>
                    <label>更新頻率 <span class="value fps-value"></span>
                        <input class="fps" type="range" min="10" max="30" step="5"></label>
                    <div class="note">只在本機取樣影片畫面，不上傳影像。影片暫停或分頁隱藏時會停止渲染。</div>
                </div>
                <button class="toggle" type="button">環境光</button>
            </div>`;
        document.documentElement.append(host);
        panel = shadow.querySelector('.panel');
        shadow.querySelector('.toggle').addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            shadow.querySelector('.toggle').classList.toggle('on', !panel.hidden || settings.enabled);
        });
        shadow.querySelector('.close').addEventListener('click', () => { panel.hidden = true; });
        shadow.querySelector('.enabled').addEventListener('click', () => {
            settings.enabled = !settings.enabled;
            applySettings();
            void saveSettings();
        });
        for ( const name of [ 'intensity', 'blur', 'saturation', 'fps' ] ) {
            shadow.querySelector(`.${name}`).addEventListener('input', event => {
                settings[name] = Number(event.target.value);
                applySettings();
                void saveSettings();
            });
        }
        applySettings();
    };

    const bindVideo = () => {
        const nextVideo = findVideo();
        if ( nextVideo === video ) { updateLayer(); return; }
        video?.removeEventListener('play', scheduleRender);
        video?.removeEventListener('playing', scheduleRender);
        video?.removeEventListener('timeupdate', scheduleRender);
        video?.removeEventListener('pause', updateLayer);
        video = nextVideo;
        player?.querySelector('#youtube-focus-ambient-layer')?.remove();
        player = findPlayer(video);
        if ( !video || !player ) { return; }
        layer = document.createElement('canvas');
        layer.id = 'youtube-focus-ambient-layer';
        layer.setAttribute('aria-hidden', 'true');
        layer.style.cssText = 'position:fixed;pointer-events:none;z-index:0;transform:scale(1.05);transform-origin:center;';
        player.insertBefore(layer, player.firstChild);
        canvas = layer;
        video.addEventListener('play', scheduleRender);
        video.addEventListener('playing', scheduleRender);
        video.addEventListener('timeupdate', scheduleRender);
        video.addEventListener('pause', updateLayer);
        updateLayer();
        applySettings();
    };

    const syncPage = () => {
        if ( !isVideoPage() ) {
            video?.removeEventListener('play', scheduleRender);
            video?.removeEventListener('playing', scheduleRender);
            video?.removeEventListener('timeupdate', scheduleRender);
            video?.removeEventListener('pause', updateLayer);
            player?.querySelector('#youtube-focus-ambient-layer')?.remove();
            layer = null;
            canvas = null;
            video = null;
            player = null;
            host?.remove();
            host = null;
            shadow = null;
            panel = null;
            return;
        }
        if ( !host ) { createUI(); }
        bindVideo();
    };

    const scheduleSync = () => {
        if ( syncQueued ) { return; }
        syncQueued = true;
        requestAnimationFrame(() => {
            syncQueued = false;
            syncPage();
        });
    };

    const start = async () => {
        await loadSettings();
        syncPage();
        if ( typeof ResizeObserver === 'function' ) {
            resizeObserver = new ResizeObserver(updateLayer);
            resizeObserver.observe(document.documentElement);
        }
        navigationObserver = new MutationObserver(scheduleSync);
        navigationObserver.observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener('yt-navigate-finish', scheduleSync, true);
        document.addEventListener('yt-page-data-fetched', scheduleSync, true);
        window.addEventListener('resize', updateLayer, true);
        document.addEventListener('visibilitychange', scheduleRender, true);
        const loop = () => {
            if ( isVideoPage() ) { scheduleRender(); }
            window.setTimeout(loop, isVideoPage()
                ? 1000 / Math.max(10, settings.fps)
                : 1000);
        };
        loop();
    };

    void start();
})();
