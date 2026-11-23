/*******************************************************************************

    YouTube dislike count integration
    Based on the Return YouTube Dislike project
    https://returnyoutubedislike.com/
    Copyright (C) 2026 YouTube focus contributors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
*/

/*
 * Only the read-only vote-count path is integrated. Account, voting,
 * discussion, analytics, and consent flows stay out of the blocker so that
 * adding a count does not expand its data collection surface.
 */
(() => {
    const API_ORIGIN = 'https://returnyoutubedislikeapi.com';
    const cache = new Map();
    const selectors = [
        'dislike-button-view-model',
        'ytd-toggle-button-renderer',
    ];

    let activeVideoId = '';
    let activeRequest = null;
    let renderQueued = false;

    const formatCount = value => {
        const count = Number(value);
        if ( !Number.isFinite(count) || count < 0 ) { return ''; }
        return new Intl.NumberFormat(undefined, {
            notation: 'compact',
            maximumFractionDigits: 1,
        }).format(count);
    };

    const videoIdFromLocation = () => {
        const url = new URL(location.href);
        const queryId = url.searchParams.get('v');
        if ( /^[A-Za-z0-9_-]{11}$/.test(queryId || '') ) { return queryId; }

        const pathMatch = url.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/);
        if ( pathMatch ) { return pathMatch[1]; }

        if ( url.hostname === 'youtu.be' ) {
            const shortId = url.pathname.slice(1).split('/')[0];
            if ( /^[A-Za-z0-9_-]{11}$/.test(shortId) ) { return shortId; }
        }
        return '';
    };

    const getDislikeButton = () => {
        for ( const selector of selectors ) {
            const node = document.querySelector(selector);
            if ( node ) { return node; }
        }
        return null;
    };

    const removeRenderedCount = () => {
        for ( const node of document.querySelectorAll('[data-youtube-focus-dislikes]') ) {
            node.remove();
        }
    };

    const renderCount = count => {
        const button = getDislikeButton();
        if ( !button ) { return false; }

        removeRenderedCount();
        const countNode = document.createElement('span');
        countNode.dataset.youtubeFocusDislikes = 'true';
        countNode.textContent = formatCount(count);
        countNode.title = 'Dislike estimate from Return YouTube Dislike';
        button.append(countNode);
        return true;
    };

    const fetchCount = async videoId => {
        if ( cache.has(videoId) ) { return cache.get(videoId); }
        activeRequest?.abort();
        activeRequest = new AbortController();
        const response = await fetch(
            `${API_ORIGIN}/votes?videoId=${encodeURIComponent(videoId)}`,
            {
                headers: { Accept: 'application/json' },
                signal: activeRequest.signal,
            },
        );
        if ( !response.ok ) { throw new Error(`RYD API returned ${response.status}`); }
        const payload = await response.json();
        const count = Number.isFinite(Number(payload.dislikes)) ? payload.dislikes : null;
        if ( count !== null ) { cache.set(videoId, count); }
        return count;
    };

    const update = async () => {
        const videoId = videoIdFromLocation();
        if ( videoId !== activeVideoId ) {
            activeVideoId = videoId;
            removeRenderedCount();
        }
        if ( !videoId ) { return; }

        try {
            const count = await fetchCount(videoId);
            if ( videoId === activeVideoId && count !== null ) {
                renderCount(count);
            }
        } catch {
            // A failed optional request must never affect video playback.
        }
    };

    const scheduleUpdate = () => {
        if ( renderQueued ) { return; }
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            void update();
        });
    };

    const style = document.createElement('style');
    style.textContent = '[data-youtube-focus-dislikes]{margin-inline-start:6px;font-size:.9em;opacity:.85;white-space:nowrap}';
    document.documentElement.append(style);

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', scheduleUpdate, true);
    document.addEventListener('yt-page-data-fetched', scheduleUpdate, true);
    window.addEventListener('popstate', scheduleUpdate, true);
    scheduleUpdate();
})();
