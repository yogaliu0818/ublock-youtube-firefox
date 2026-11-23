/*******************************************************************************

    YouTube controls: SponsorBlock categories, playback speed and settings
    SponsorBlock data is read-only; this script never submits segments.

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
*/
(() => {
    const API_ORIGIN = 'https://sponsor.ajay.app';
    const HOST_ID = 'youtube-focus-controls';
    const STORAGE_KEY = 'youtubeFocusSettings';
    const categories = {
        sponsor: '業配',
        intro: '片頭',
        outro: '片尾',
        selfpromo: '自我宣傳',
        interaction: '互動提醒',
        recap: '回顧'
    };
    const defaults = {
        speed: 1,
        speedPanel: true,
        categories: Object.fromEntries(Object.keys(categories).map(key => [key, true]))
    };
    const segmentCache = new Map();
    let settings = {
        ...defaults,
        categories: { ...defaults.categories }
    };
    let activeVideoId = '';
    let activeVideo = null;
    let activeSegments = [];
    let currentSegment = null;
    let host = null;
    let shadow = null;
    let sponsorButton = null;
    let speedPanel = null;
    let speedValue = null;
    let speedSlider = null;
    let observer = null;

    const extensionStorage = globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local;

    const getVideoId = () => {
        const url = new URL(location.href);
        const queryId = url.searchParams.get('v');
        if ( /^[A-Za-z0-9_-]{11}$/.test(queryId || '') ) { return queryId; }
        const pathMatch = url.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/);
        return pathMatch ? pathMatch[1] : '';
    };

    const isVideoPage = () => location.pathname === '/watch' ||
        location.pathname.startsWith('/shorts/') ||
        location.pathname.startsWith('/embed/') ||
        location.hostname === 'youtu.be';

    const saveSettings = async () => {
        if ( extensionStorage ) {
            await extensionStorage.set({ [STORAGE_KEY]: settings });
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        }
    };

    const loadSettings = async () => {
        let stored;
        if ( extensionStorage ) {
            stored = (await extensionStorage.get(STORAGE_KEY))[STORAGE_KEY];
        } else {
            try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* defaults */ }
        }
        if ( stored instanceof Object ) {
            settings = {
                ...defaults,
                ...stored,
                categories: { ...defaults.categories, ...(stored.categories || {}) }
            };
        }
    };

    const getVideo = () => document.querySelector('video.html5-main-video, video');

    const formatSpeed = value => `${Number(value).toFixed(2)}x`;

    const applySpeed = value => {
        const next = Math.max(0.1, Math.min(4, Number(value) || 1));
        settings.speed = Math.round(next * 20) / 20;
        if ( activeVideo ) { activeVideo.playbackRate = settings.speed; }
        if ( speedValue ) { speedValue.textContent = formatSpeed(settings.speed); }
        if ( speedSlider ) { speedSlider.value = settings.speed; }
        void saveSettings();
    };

    const categoryLabel = category => categories[category] || '區段';

    const updateSponsorButton = () => {
        if ( !sponsorButton ) { return; }
        const time = activeVideo?.currentTime;
        currentSegment = activeSegments.find(item =>
            settings.categories[item.category] !== false &&
            time >= item.segment[0] && time < item.segment[1]
        ) || null;
        if ( currentSegment ) {
            sponsorButton.textContent = `跳過${categoryLabel(currentSegment.category)}`;
            sponsorButton.hidden = false;
        } else {
            sponsorButton.hidden = true;
        }
    };

    const fetchSegments = async videoId => {
        if ( segmentCache.has(videoId) ) { return segmentCache.get(videoId); }
        const url = `${API_ORIGIN}/api/skipSegments?videoID=${encodeURIComponent(videoId)}&category=all`;
        const request = fetch(url, { headers: { Accept: 'application/json' } })
            .then(response => {
                if ( !response.ok ) { throw new Error(`SponsorBlock API returned ${response.status}`); }
                return response.json();
            })
            .then(payload => Array.isArray(payload)
                ? payload
                    .filter(item => categories[item.category] && Array.isArray(item.segment))
                    .map(item => ({
                        category: item.category,
                        segment: [Number(item.segment[0]), Number(item.segment[1])]
                    }))
                    .filter(item => Number.isFinite(item.segment[0]) &&
                        Number.isFinite(item.segment[1]) && item.segment[1] > item.segment[0])
                : [])
            .catch(error => {
                segmentCache.delete(videoId);
                throw error;
            });
        segmentCache.set(videoId, request);
        return request;
    };

    const createUI = () => {
        if ( host || !document.documentElement ) { return; }
        host = document.createElement('div');
        host.id = HOST_ID;
        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                .root { position: fixed; right: 20px; bottom: 86px; z-index: 2147483647;
                    display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
                    color: #fff; font: 14px Arial, sans-serif; }
                button, input { font: inherit; }
                button { border: 0; color: #fff; cursor: pointer; }
                .skip { padding: 10px 16px; border-radius: 5px; background: #ff0033;
                    font-weight: 700; box-shadow: 0 2px 10px #0008; }
                .card { width: min(390px, calc(100vw - 32px)); padding: 14px; box-sizing: border-box;
                    border-radius: 12px; background: #242424eF; box-shadow: 0 3px 18px #0009;
                    backdrop-filter: blur(8px); }
                .toolbar { display: flex; align-items: center; gap: 8px; }
                .toolbar button, .preset, .setting { background: #4a4749; border-radius: 999px; }
                .toolbar button { width: 38px; height: 38px; font-size: 20px; }
                .speed { flex: 1; text-align: center; font-weight: 700; font-size: 18px; }
                input[type=range] { width: 100%; accent-color: #fff; }
                .presets { display: flex; gap: 7px; margin-top: 10px; overflow-x: auto; }
                .preset { flex: 1 0 48px; padding: 9px 7px; }
                .preset.active { background: #ff0033; }
                .settings { margin-top: 12px; border-top: 1px solid #ffffff30; padding-top: 10px; }
                .setting { display: flex; justify-content: space-between; align-items: center;
                    width: 100%; margin: 5px 0; padding: 9px 11px; box-sizing: border-box; text-align: left; }
                .note { opacity: .7; font-size: 12px; margin-top: 9px; }
                @media (max-width: 600px) { .root { right: 12px; bottom: 74px; } .card { padding: 12px; } }
            </style>
            <div class="root">
                <button class="skip" type="button" hidden></button>
                <div class="card">
                    <div class="toolbar">
                        <button class="minus" type="button" aria-label="減慢速度">−</button>
                        <span class="speed">1.00x</span>
                        <button class="plus" type="button" aria-label="加快速度">＋</button>
                    </div>
                    <input class="slider" type="range" min="0.1" max="4" step="0.05" value="1" aria-label="播放速度">
                    <div class="presets">
                        <button class="preset" data-speed="0.5">0.5</button>
                        <button class="preset" data-speed="1">1.0</button>
                        <button class="preset" data-speed="1.25">1.25</button>
                        <button class="preset" data-speed="1.5">1.5</button>
                        <button class="preset" data-speed="2">2.0</button>
                        <button class="preset" data-speed="3">3.0</button>
                        <button class="preset" data-speed="4">4.0</button>
                    </div>
                    <div class="settings">
                        <button class="setting-toggle setting" type="button">SponsorBlock 設定</button>
                        <div class="settings-list" hidden></div>
                        <div class="note">只顯示已知區段，不會自動跳過或提交資料。</div>
                    </div>
                </div>
            </div>`;
        document.documentElement.append(host);
        sponsorButton = shadow.querySelector('.skip');
        speedPanel = shadow.querySelector('.card');
        speedValue = shadow.querySelector('.speed');
        speedSlider = shadow.querySelector('.slider');
        sponsorButton.addEventListener('click', () => {
            if ( activeVideo && currentSegment ) {
                activeVideo.currentTime = currentSegment.segment[1] + 0.05;
                updateSponsorButton();
            }
        });
        shadow.querySelector('.minus').addEventListener('click', () => applySpeed(settings.speed - 0.05));
        shadow.querySelector('.plus').addEventListener('click', () => applySpeed(settings.speed + 0.05));
        speedSlider.addEventListener('input', event => applySpeed(event.target.value));
        for ( const button of shadow.querySelectorAll('.preset') ) {
            button.addEventListener('click', () => applySpeed(button.dataset.speed));
        }
        shadow.querySelector('.setting-toggle').addEventListener('click', () => {
            const list = shadow.querySelector('.settings-list');
            list.hidden = !list.hidden;
        });
        const list = shadow.querySelector('.settings-list');
        for ( const [key, label] of Object.entries(categories) ) {
            const button = document.createElement('button');
            button.className = 'setting';
            button.type = 'button';
            button.dataset.category = key;
            button.addEventListener('click', () => {
                settings.categories[key] = settings.categories[key] === false;
                button.textContent = `${label}：${settings.categories[key] ? '開啟' : '關閉'}`;
                void saveSettings();
                updateSponsorButton();
            });
            list.append(button);
        }
        refreshUI();
    };

    const refreshUI = () => {
        if ( !shadow ) { return; }
        speedPanel.hidden = settings.speedPanel === false;
        speedValue.textContent = formatSpeed(settings.speed);
        speedSlider.value = settings.speed;
        for ( const button of shadow.querySelectorAll('.setting[data-category]') ) {
            const key = button.dataset.category;
            button.textContent = `${categories[key]}：${settings.categories[key] ? '開啟' : '關閉'}`;
        }
        for ( const button of shadow.querySelectorAll('.preset') ) {
            button.classList.toggle('active', Number(button.dataset.speed) === settings.speed);
        }
    };

    const bindVideo = async () => {
        const video = getVideo();
        if ( video !== activeVideo ) {
            activeVideo?.removeEventListener('timeupdate', updateSponsorButton);
            activeVideo = video;
            activeVideo?.addEventListener('timeupdate', updateSponsorButton);
            if ( activeVideo ) { activeVideo.playbackRate = settings.speed; }
        }
        const videoId = getVideoId();
        if ( videoId !== activeVideoId ) {
            activeVideoId = videoId;
            activeSegments = [];
            currentSegment = null;
            if ( videoId ) {
                try { activeSegments = await fetchSegments(videoId); } catch { /* unavailable */ }
            }
        }
        updateSponsorButton();
    };

    let syncQueued = false;
    const syncPage = () => {
        if ( !isVideoPage() ) {
            activeVideo?.removeEventListener('timeupdate', updateSponsorButton);
            activeVideo = null;
            activeVideoId = '';
            activeSegments = [];
            currentSegment = null;
            host?.remove();
            host = null;
            shadow = null;
            sponsorButton = null;
            speedPanel = null;
            speedValue = null;
            speedSlider = null;
            return;
        }
        if ( !host ) { createUI(); }
        void bindVideo();
    };
    const schedule = () => {
        if ( syncQueued ) { return; }
        syncQueued = true;
        requestAnimationFrame(() => {
            syncQueued = false;
            syncPage();
        });
    };

    void loadSettings().then(() => {
        schedule();
    });
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', schedule, true);
    document.addEventListener('yt-page-data-fetched', schedule, true);
    window.addEventListener('popstate', schedule, true);
})();
