// Photo/video gallery — loads entries from data/content.json ("gallery" array)
// and opens them in a lightbox. Depends on helpers from main.js (escapeHtml,
// icon), which is loaded first.
//
// Each entry: { src, caption, title?, alt?, tags?, poster? }
// Media type is inferred from the extension. Videos show their poster image in
// the grid and only fetch the video itself when opened (preload="none"), so a
// gallery full of clips costs no more to load than a gallery of stills.
//
// Files live in assets/gallery/. An entry whose file is missing renders as a
// labelled placeholder showing the expected filename rather than a broken image.

document.addEventListener('DOMContentLoaded', () => {
    loadGallery();
    initLightbox();
});

let galleryItems = [];

const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;
const isVideo = src => VIDEO_RE.test(String(src || ''));
const posterFor = item => item.poster || String(item.src).replace(VIDEO_RE, '.jpg');

// ============================================
// Loading
// ============================================

async function loadGallery() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;

    try {
        const response = await fetch('data/content.json');
        if (!response.ok) throw new Error('Failed to load gallery');
        const data = await response.json();
        galleryItems = data.gallery || [];
    } catch (error) {
        console.error('Error loading gallery:', error);
        grid.innerHTML = '<p class="error">Could not load the gallery.</p>';
        return;
    }

    if (galleryItems.length === 0) {
        grid.innerHTML = `
            <p class="loading">
                No media yet — add files to <code>assets/gallery/</code> and list
                them under <code>"gallery"</code> in <code>data/content.json</code>.
            </p>
        `;
        return;
    }

    grid.innerHTML = galleryItems.map((item, i) => {
        const filename = String(item.src || '').split('/').pop();
        const video = isVideo(item.src);
        const thumb = video ? posterFor(item) : item.src;
        return `
            <figure class="gallery-item" data-index="${i}" tabindex="0" role="button"
                    aria-label="${escapeHtml((video ? 'Play video: ' : '') + (item.caption || filename))}">
                <div class="gallery-thumb">
                    <img src="${escapeHtml(thumb)}"
                         alt="${escapeHtml(item.alt || item.caption || '')}"
                         loading="lazy" decoding="async"
                         onerror="this.closest('.gallery-item').classList.add('gallery-item--missing')">
                    ${video ? '<span class="gallery-play" aria-hidden="true">&#9654;</span>' : ''}
                    <span class="gallery-missing" aria-hidden="true">
                        ${icon('image', 'icon-lg')}
                        <span class="mono">${escapeHtml(filename)}</span>
                    </span>
                </div>
                <figcaption>
                    ${item.title ? `<span class="gallery-title">${escapeHtml(item.title)}</span>` : ''}
                    ${escapeHtml(item.caption || '')}
                </figcaption>
                ${item.tags && item.tags.length ? `
                    <div class="tag-list gallery-tags">
                        ${item.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}
                    </div>` : ''}
            </figure>
        `;
    }).join('');

    grid.querySelectorAll('.gallery-item').forEach(el => {
        el.addEventListener('click', () => openLightbox(Number(el.dataset.index)));
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openLightbox(Number(el.dataset.index));
            }
        });
    });
}

// ============================================
// Lightbox
// ============================================

let currentIndex = 0;
let lastFocused = null;

function initLightbox() {
    const box = document.getElementById('lightbox');
    if (!box) return;

    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev').addEventListener('click', () => step(-1));
    document.getElementById('lightbox-next').addEventListener('click', () => step(1));

    box.addEventListener('click', e => {
        if (e.target === box) closeLightbox();
    });

    document.addEventListener('keydown', e => {
        if (!box.classList.contains('active')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'Tab') {
            const controls = Array.from(box.querySelectorAll('button:not([hidden]), video[controls]'));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
        // Leave arrows to the video's own scrubbing when it has focus
        if (e.target.tagName === 'VIDEO') return;
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
    });
}

function openLightbox(index) {
    const box = document.getElementById('lightbox');
    if (!box || !galleryItems.length) return;

    lastFocused = document.activeElement;
    currentIndex = index;
    renderLightbox();

    box.classList.add('active');
    box.inert = false;
    document.querySelector('.layout').inert = true;
    document.body.style.overflow = 'hidden';
    document.getElementById('lightbox-close').focus();
}

function stopVideo() {
    const v = document.querySelector('#lightbox-stage video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
}

function closeLightbox() {
    const box = document.getElementById('lightbox');
    stopVideo();
    box.classList.remove('active');
    box.inert = true;
    document.querySelector('.layout').inert = false;
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
}

function step(delta) {
    if (galleryItems.length < 2) return;
    stopVideo();
    currentIndex = (currentIndex + delta + galleryItems.length) % galleryItems.length;
    renderLightbox();
}

function renderLightbox() {
    const item = galleryItems[currentIndex];
    const stage = document.getElementById('lightbox-stage');
    const caption = document.getElementById('lightbox-caption');
    const counter = document.getElementById('lightbox-counter');
    const filename = String(item.src || '').split('/').pop();
    const missing = `this.replaceWith(Object.assign(document.createElement('p'),{className:'error',textContent:'Missing file: ${escapeHtml(filename)}'}))`;

    stage.innerHTML = isVideo(item.src)
        ? `<video src="${escapeHtml(item.src)}" poster="${escapeHtml(posterFor(item))}"
                  controls autoplay loop muted playsinline
                  onerror="${missing}"></video>`
        : `<img src="${escapeHtml(item.src)}"
                alt="${escapeHtml(item.alt || item.caption || '')}"
                onerror="${missing}">`;

    caption.innerHTML = `
        ${item.caption ? `<p class="lightbox-text">${escapeHtml(item.caption)}</p>` : ''}
        ${item.tags && item.tags.length ? `
            <div class="tag-list">
                ${item.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}
            </div>` : ''}
    `;

    counter.textContent = `${currentIndex + 1} / ${galleryItems.length}`;

    const multiple = galleryItems.length > 1;
    document.getElementById('lightbox-prev').hidden = !multiple;
    document.getElementById('lightbox-next').hidden = !multiple;
    counter.hidden = !multiple;
}
