// Blog JavaScript - Post Loading and Markdown Rendering
// Depends on helpers from main.js (escapeHtml, icon), which is loaded first.

document.addEventListener('DOMContentLoaded', () => {
    loadBlogPosts();
    initModal();
});

// ============================================
// Blog Post Loading
// ============================================

async function loadBlogPosts() {
    const blogGrid = document.getElementById('blog-grid');
    if (!blogGrid) return;           // Blog section not on the page

    try {
        const response = await fetch('blog/posts.json');
        if (!response.ok) throw new Error('Failed to load blog posts');
        const posts = await response.json();

        if (posts.length === 0) {
            blogGrid.innerHTML = '<p class="loading">No blog posts yet. Check back soon!</p>';
            return;
        }

        // Sort posts by date (newest first)
        posts.sort((a, b) => new Date(b.date) - new Date(a.date));

        blogGrid.innerHTML = posts.map(post => `
            <article class="card is-clickable" data-slug="${escapeHtml(post.slug)}">
                <div class="card-content">
                    <a href="#blog" class="card-title">${escapeHtml(post.title)}</a>
                    <div class="card-meta">
                        <span>${icon('calendar')}<span>${formatDate(post.date)}</span></span>
                    </div>
                    ${post.tags && post.tags.length ? `
                        <div class="tag-list">
                            ${post.tags.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}
                        </div>
                    ` : ''}
                    <p class="card-desc">${escapeHtml(post.description)}</p>
                </div>
                <span class="card-link">Read</span>
            </article>
        `).join('');

        // Add click handlers to blog cards
        document.querySelectorAll('.card[data-slug]').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                openBlogPost(card.getAttribute('data-slug'), posts);
            });
        });

    } catch (error) {
        console.error('Error loading blog posts:', error);
        blogGrid.innerHTML = `
            <article class="card">
                <div class="card-content">
                    <span class="card-title">Welcome to the Blog</span>
                    <p class="card-desc">Blog posts will appear here. Add posts to blog/posts/ and update blog/posts.json to get started.</p>
                </div>
            </article>
        `;
    }
}

// ============================================
// Modal Management
// ============================================

function initModal() {
    const modal = document.getElementById('blog-modal');
    const closeBtn = document.getElementById('modal-close');

    closeBtn.addEventListener('click', closeModal);

    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

function openModal() {
    const modal = document.getElementById('blog-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('blog-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================
// Blog Post Rendering
// ============================================

async function openBlogPost(slug, posts) {
    const postContent = document.getElementById('blog-post-content');
    const post = posts.find(p => p.slug === slug);

    if (!post) {
        postContent.innerHTML = '<p class="error">Post not found.</p>';
        openModal();
        return;
    }

    postContent.innerHTML = '<p class="loading">Loading post...</p>';
    openModal();

    try {
        const response = await fetch(`blog/posts/${slug}.md`);
        if (!response.ok) throw new Error('Failed to load post');
        const markdown = await response.text();

        marked.setOptions({
            highlight: function (code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(code, { language: lang }).value;
                }
                return hljs.highlightAuto(code).value;
            },
            breaks: true,
            gfm: true
        });

        const htmlContent = marked.parse(markdown);

        const tags = post.tags && post.tags.length
            ? `<span>${post.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join(' ')}</span>`
            : '';

        postContent.innerHTML = `
            <h1 class="page-title">${escapeHtml(post.title)}</h1>
            <div class="blog-post-meta">
                <span>${icon('calendar')}<span>${formatDate(post.date)}</span></span>
                ${tags}
            </div>
            <div class="prose">${htmlContent}</div>
        `;

        // Re-highlight any code blocks marked may have missed
        postContent.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });

    } catch (error) {
        console.error('Error loading blog post:', error);
        postContent.innerHTML = `
            <h1 class="page-title">Error Loading Post</h1>
            <p class="error">Could not load the blog post. Make sure the file blog/posts/${escapeHtml(slug)}.md exists.</p>
        `;
    }
}

// ============================================
// Utility Functions
// ============================================

function formatDate(dateString) {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString('en-US', options);
}
