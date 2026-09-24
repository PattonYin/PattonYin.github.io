// Main JavaScript - Theme, Navigation, Content Loading

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initPalette();
    initNavigation();
    loadContent();
    initContactForm();
    initFooterYear();
});

// ============================================
// Theme Management
// ============================================
// The initial data-theme is set by an inline script in <head> so there is no
// flash of the wrong palette. Here we only wire up the toggle and keep the
// highlight.js stylesheet in sync.

function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');

    updateHighlightTheme(currentTheme());

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const next = currentTheme() === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateHighlightTheme(next);
        });
    }
}

function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function updateHighlightTheme(theme) {
    const hljsTheme = document.getElementById('hljs-theme');
    if (hljsTheme) {
        hljsTheme.href = theme === 'dark'
            ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
            : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
    }
}

// ============================================
// Color Palette (default / notepad)
// ============================================

function initPalette() {
    const paletteToggle = document.getElementById('palette-toggle');
    const saved = localStorage.getItem('palette');

    if (saved) {
        document.documentElement.setAttribute('data-palette', saved);
    }

    if (paletteToggle) {
        paletteToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-palette');
            const next = current === 'notepad' ? 'default' : 'notepad';
            document.documentElement.setAttribute('data-palette', next);
            localStorage.setItem('palette', next);
        });
    }
}

// ============================================
// Navigation
// ============================================
// Anchor scrolling is native (html { scroll-behavior: smooth } plus
// scroll-margin-top on .section clears the sticky navbar).

function initNavigation() {
    let navLinks = Array.from(document.querySelectorAll('.nav-link'));
    const sections = Array.from(document.querySelectorAll('.section[id]'));

    // Sections are optional; drop nav entries that point at ones not present so
    // removing a section from the HTML never leaves a dead link behind.
    navLinks.forEach(link => {
        const id = (link.getAttribute('href') || '').slice(1);
        if (id && !document.getElementById(id)) {
            const li = link.closest('li');
            (li || link).hidden = true;
        }
    });
    navLinks = navLinks.filter(l => !(l.closest('li') || l).hidden);

    if (!navLinks.length || !sections.length) return;

    const setActive = (id) => {
        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
        });
    };

    const updateActive = () => {
        let active = sections[0];
        if (window.scrollY > 0) {
            sections.forEach(section => {
                const offset = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
                if (section.getBoundingClientRect().top <= offset + 1) active = section;
            });
            // The final section may be too short to reach the sticky navbar.
            if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1) {
                const target = sections.find(section => `#${section.id}` === window.location.hash);
                const offset = target ? parseFloat(getComputedStyle(target).scrollMarginTop) || 0 : 0;
                active = target && target.getBoundingClientRect().top >= offset - 1
                    ? target : sections[sections.length - 1];
            }
        }
        setActive(active.id);
    };

    window.addEventListener('scroll', updateActive, { passive: true });
    window.addEventListener('resize', updateActive);
    window.addEventListener('hashchange', updateActive);
    const observer = new ResizeObserver(updateActive);
    sections.forEach(section => observer.observe(section));
    updateActive();
}

// ============================================
// Content Loading
// ============================================

async function loadContent() {
    try {
        const response = await fetch('data/content.json');
        if (!response.ok) throw new Error('Failed to load content');
        const data = await response.json();

        renderProjects(data.projects);
        renderPublications(data.publications);
        renderTimeline(data.timeline);
    } catch (error) {
        console.error('Error loading content:', error);
        renderPlaceholderContent();
    }
}

function icon(name, size = 'icon-md') {
    return `<svg class="icon ${size}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

// ============================================
// Author name emphasis
// ============================================
// Your name is bolded wherever it appears in an author list. Add any other
// spellings you publish under here — longest variants are matched first.

const SELF_NAMES = [
    'Jiyang (Patton) Yin',
    'Jiyang Yin (Patton)',
    'Patton Jiyang Yin',
    'Patton Yin',
    'Jiyang Yin'
];

// Escapes the authors string first, then bolds name matches in a single pass,
// so nothing from the data can inject markup and matches can't nest.
function highlightSelf(authors) {
    const escaped = escapeHtml(authors);
    const pattern = SELF_NAMES
        .slice()
        .sort((a, b) => b.length - a.length)
        .map(name => escapeHtml(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    return escaped.replace(
        new RegExp(`(${pattern})`, 'g'),
        '<strong class="author-self">$1</strong>'
    );
}

function renderProjects(projects) {
    const list = document.getElementById('projects-grid');
    if (!list) return;               // Research section not on the page
    if (!projects || projects.length === 0) {
        list.innerHTML = '<p class="loading">No projects to display yet.</p>';
        return;
    }

    list.innerHTML = projects.map(project => {
        const title = project.link
            ? `<a href="${escapeHtml(project.link)}" target="_blank" rel="noopener" class="card-title">${escapeHtml(project.title)}</a>`
            : `<span class="card-title">${escapeHtml(project.title)}</span>`;

        const tags = (project.tags || []).length
            ? `<div class="tag-list">${project.tags.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}</div>`
            : '';

        const view = project.link
            ? `<a href="${escapeHtml(project.link)}" target="_blank" rel="noopener" class="card-link">View ${icon('external', 'icon-sm')}</a>`
            : '';

        return `
            <article class="card">
                <div class="card-content">
                    ${title}
                    ${tags}
                    <p class="card-desc">${escapeHtml(project.description)}</p>
                </div>
                ${view}
            </article>
        `;
    }).join('');
}

function renderPublications(publications) {
    const list = document.getElementById('publications-list');
    if (!list) return;               // Publications section not on the page
    if (!publications || publications.length === 0) {
        list.innerHTML = '<p class="loading">Publications coming soon.</p>';
        return;
    }

    list.innerHTML = publications.map(pub => {
        // The title carries the link, so no separate PDF/DOI row. Preference
        // order: project page, PDF, DOI landing page, then code repo.
        const titleHref = pub.project
            || pub.pdf
            || (pub.doi ? `https://doi.org/${pub.doi}` : '')
            || pub.code;
        const title = titleHref
            ? `<a href="${escapeHtml(titleHref)}" target="_blank" rel="noopener" class="card-title">${escapeHtml(pub.title)}</a>`
            : `<span class="card-title">${escapeHtml(pub.title)}</span>`;
        const teaser = pub.image
            ? `<img class="publication-teaser" src="${escapeHtml(pub.image)}"
                    alt="${escapeHtml(pub.imageAlt || `Teaser for ${pub.title}`)}"
                    loading="lazy" decoding="async">`
            : '';

        return `
            <article class="card">
                ${teaser}
                <div class="card-content">
                    ${title}
                    <div class="card-meta">
                        <div class="meta-row">
                            <span>${icon('user')}<span>${highlightSelf(pub.authors)}</span></span>
                        </div>
                        <div class="meta-row">
                            <span>${icon('institution')}<span>${escapeHtml(pub.venue)}</span></span>
                            <span>${icon('calendar')}<span>${escapeHtml(String(pub.year))}</span></span>
                        </div>
                    </div>
                    ${pub.note ? `<p class="pub-note">${escapeHtml(pub.note)}</p>` : ''}
                </div>
            </article>
        `;
    }).join('');
}

function renderTimeline(timeline) {
    const container = document.getElementById('cv-timeline');
    if (!container) return;          // CV section not on the page
    if (!timeline || timeline.length === 0) {
        container.innerHTML = '<p class="loading">Timeline information will be added soon.</p>';
        return;
    }

    container.innerHTML = timeline.map(item => `
        <div class="timeline-item">
            <div class="timeline-marker">
                <div class="dot"></div>
                <div class="timeline-line"></div>
            </div>
            <div class="timeline-content">
                <div class="entry-header">
                    <h3 class="title-md">${escapeHtml(item.title)}</h3>
                    <span class="timeline-period">${escapeHtml(item.date)}</span>
                </div>
                <div class="timeline-subtitle">${escapeHtml(item.subtitle)}</div>
            </div>
        </div>
    `).join('');
}

function renderPlaceholderContent() {
    const set = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };

    set('projects-grid', `
        <article class="card">
            <div class="card-content">
                <span class="card-title">Sample Project</span>
                <div class="tag-list"><span class="tag">#Example</span></div>
                <p class="card-desc">Add your projects to data/content.json to display them here.</p>
            </div>
        </article>
    `);

    set('publications-list', `
        <article class="card">
            <div class="card-content">
                <span class="card-title">Your Publication Title</span>
                <div class="card-meta">
                    <div class="meta-row">
                        <span>${icon('user')}<span>Author 1, Author 2, Your Name</span></span>
                    </div>
                    <div class="meta-row">
                        <span>${icon('institution')}<span>Conference/Journal Name</span></span>
                        <span>${icon('calendar')}<span>2026</span></span>
                    </div>
                </div>
            </div>
        </article>
    `);

    set('cv-timeline', `
        <div class="timeline-item">
            <div class="timeline-marker">
                <div class="dot"></div>
                <div class="timeline-line"></div>
            </div>
            <div class="timeline-content">
                <div class="entry-header">
                    <h3 class="title-md">Master's Student</h3>
                    <span class="timeline-period">2024 - Present</span>
                </div>
                <div class="timeline-subtitle">University Name</div>
            </div>
        </div>
    `);
}

// ============================================
// Contact Form
// ============================================

function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const name = formData.get('name');

        // Static site — no backend. Swap in Formspree/Netlify Forms when ready.
        alert(`Thank you for your message, ${name}! Since this is a static site, please email me directly at your.email@university.edu`);
        form.reset();
    });
}

// ============================================
// Utility Functions
// ============================================

function initFooterYear() {
    const year = document.getElementById('footer-year');
    if (year) year.textContent = new Date().getFullYear();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
