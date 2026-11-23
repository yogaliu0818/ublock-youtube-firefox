/*******************************************************************************

    YouTube focus helpers for the Firefox build of uBlock Origin
    Copyright (C) 2026 YouTube focus contributors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU General Public License for more details.
*/

/*
 * YouTube is a single-page application: a filter which matches the first
 * document is not enough. Keep this helper small and idempotent so it can
 * safely run after every client-side navigation and DOM update.
 */
(() => {
    const AD_SELECTORS = [
        'ytd-display-ad-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ytd-promoted-sparkles-web-renderer',
        'ytd-banner-promo-renderer',
        'ytd-action-companion-ad-renderer',
        'ytd-ad-slot-renderer',
        '.ytp-ad-overlay-container',
        '.ytp-ad-overlay-image',
        '.ytp-ad-text',
    ];

    const hideAds = root => {
        if ( root instanceof Element && AD_SELECTORS.some(s => root.matches(s)) ) {
            root.hidden = true;
        }
        for ( const selector of AD_SELECTORS ) {
            for ( const node of root.querySelectorAll?.(selector) || [] ) {
                node.hidden = true;
            }
        }
    };

    const scan = () => hideAds(document);

    let scanQueued = false;
    const scheduleScan = () => {
        if ( scanQueued ) { return; }
        scanQueued = true;
        requestAnimationFrame(() => {
            scanQueued = false;
            scan();
        });
    };

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    document.addEventListener('yt-navigate-finish', scheduleScan, true);
    window.addEventListener('popstate', scheduleScan, true);
    scan();
})();
