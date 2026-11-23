/*******************************************************************************

    YouTube sponsor-segment helper
    Uses the read-only SponsorBlock API:
    https://github.com/ajayyy/SponsorBlock

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
*/

/*
 * This is intentionally a manual action. The user sees a button when the
 * current playback position enters a known sponsor segment and decides
 * whether to seek past it; no automatic skipping or segment submission is
 * performed.
 */
(() => {
    const API_ORIGIN = 'https://sponsor.ajay.app';
    const segmentCache = new Map();
    const buttonId = 'youtube-focus-sponsor-skip';

    let activeVideoId = '';
    let activeVideo = null;
    let activeSegments = [];
    let currentSegment = null;
    let observer = null;

    const getVideoId = () => {
        const url = new URL(location.href);
        const queryId = url.searchParams.get('v');
        if ( /^[A-Za-z0-9_-]{11}$/.test(queryId || '') ) { return queryId; }
        const pathMatch = url.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/);
        return pathMatch ? pathMatch[1] : '';
    };

    const getButton = () => document.getElementById(buttonId);

    const hideButton = () => {
        const button = getButton();
        if ( button ) { button.hidden = true; }
        currentSegment = null;
    };

    const showButton = segment => {
        let button = getButton();
        if ( !button ) {
            button = document.createElement('button');
            button.id = buttonId;
            button.type = 'button';
            button.textContent = '跳過廣告';
            button.title = 'SponsorBlock 業配區段';
            button.style.cssText = [
                'position:fixed',
                'right:24px',
                'bottom:96px',
                'z-index:2147483647',
                'padding:10px 16px',
                'border:0',
                'border-radius:4px',
                'background:#ff0033',
                'color:#fff',
                'font:600 14px Arial,sans-serif',
                'cursor:pointer',
                'box-shadow:0 2px 8px rgb(0 0 0 / 40%)'
            ].join(';');
            button.addEventListener('click', () => {
                if ( !activeVideo || !currentSegment ) { return; }
                activeVideo.currentTime = currentSegment[1] + 0.05;
                hideButton();
            });
            document.body.append(button);
        }
        currentSegment = segment;
        button.hidden = false;
    };

    const fetchSegments = async videoId => {
        if ( segmentCache.has(videoId) ) { return segmentCache.get(videoId); }
        const url = `${API_ORIGIN}/api/skipSegments?videoID=${encodeURIComponent(videoId)}&category=sponsor`;
        const request = fetch(url, { headers: { Accept: 'application/json' } })
            .then(response => {
                if ( !response.ok ) { throw new Error(`SponsorBlock API returned ${response.status}`); }
                return response.json();
            })
            .then(payload => Array.isArray(payload)
                ? payload
                    .filter(item => Array.isArray(item.segment) && item.segment.length === 2)
                    .map(item => [Number(item.segment[0]), Number(item.segment[1])])
                    .filter(item => Number.isFinite(item[0]) && Number.isFinite(item[1]) && item[1] > item[0])
                : [])
            .catch(error => {
                segmentCache.delete(videoId);
                throw error;
            });
        segmentCache.set(videoId, request);
        return request;
    };

    const updateButton = () => {
        if ( !activeVideo || activeSegments.length === 0 ) {
            hideButton();
            return;
        }
        const time = activeVideo.currentTime;
        const segment = activeSegments.find(item => time >= item[0] && time < item[1]);
        if ( segment ) {
            showButton(segment);
        } else {
            hideButton();
        }
    };

    const bindVideo = async () => {
        const video = document.querySelector('video.html5-main-video, video');
        if ( video !== activeVideo ) {
            activeVideo?.removeEventListener('timeupdate', updateButton);
            activeVideo = video;
            activeVideo?.addEventListener('timeupdate', updateButton);
        }
        const videoId = getVideoId();
        if ( videoId !== activeVideoId ) {
            activeVideoId = videoId;
            activeSegments = [];
            hideButton();
            if ( videoId ) {
                try {
                    activeSegments = await fetchSegments(videoId);
                } catch {
                    activeSegments = [];
                }
            }
        }
        updateButton();
    };

    const schedule = () => {
        void bindVideo();
    };

    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', schedule, true);
    document.addEventListener('yt-page-data-fetched', schedule, true);
    window.addEventListener('popstate', schedule, true);
    schedule();
})();
