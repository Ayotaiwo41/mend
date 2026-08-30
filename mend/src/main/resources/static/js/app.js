//  app.js — Mend frontend logic



const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

let watchlist   = [];
let suggestions = [];
let activeIndex = -1;
let searchTimer = null;

const showInput  = document.getElementById('showInput');
const suggestBox = document.getElementById('suggestionsBox');

showInput.focus();


async function tmdb(path, params = {}) {
    const url = new URL('/api/tmdb' + path, window.location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetch(url);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.status_message || `Error ${response.status}`);
    }
    return response.json();
}

showInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = showInput.value.trim();
    if (!query || query.length < 2) { hideSuggestions(); return; }
    searchTimer = setTimeout(() => fetchSuggestions(query), 300);
});

showInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && suggestions[activeIndex]) { selectSuggestion(suggestions[activeIndex]); }
        else { addShowByText(); }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, suggestions.length - 1);
        highlightSuggestion();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, -1);
        highlightSuggestion();
    } else if (e.key === 'Escape') { hideSuggestions(); }
});

document.addEventListener('click', e => { if (!e.target.closest('#inputSection')) hideSuggestions(); });

async function fetchSuggestions(query) {
    try {
        const data = await tmdb('/search/multi', { query, include_adult: false, page: 1 });
        suggestions = (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 6);
        activeIndex = -1;
        renderSuggestions();
    } catch (e) {}
}

function renderSuggestions() {
    if (!suggestions.length) { hideSuggestions(); return; }
    suggestBox.innerHTML = '';
    suggestions.forEach((item, i) => {
        const title = item.title || item.name || '';
        const year  = (item.release_date || item.first_air_date || '').slice(0, 4);
        const type  = item.media_type === 'movie' ? 'Movie' : 'TV Show';
        const div   = document.createElement('div');
        div.className = 'suggestion-item';
        const posterHtml = item.poster_path
            ? `<img class="suggestion-poster" src="${TMDB_IMG}${item.poster_path}" alt="" loading="lazy"/>`
            : `<div class="suggestion-poster-placeholder">🎬</div>`;
        div.innerHTML = `${posterHtml}<div><div class="suggestion-title">${escapeHtml(title)}</div><div class="suggestion-meta">${type}${year ? ' · ' + year : ''}</div></div>`;
        div.addEventListener('mousedown', e => { e.preventDefault(); selectSuggestion(item); });
        suggestBox.appendChild(div);
    });
    suggestBox.style.display = 'block';
}

function highlightSuggestion() {
    suggestBox.querySelectorAll('.suggestion-item').forEach((el, i) => el.classList.toggle('active', i === activeIndex));
}
function hideSuggestions() { suggestBox.style.display = 'none'; suggestions = []; activeIndex = -1; }

function selectSuggestion(item) {
    addToWatchlist({ id: item.id, title: item.title || item.name || '', type: item.media_type === 'movie' ? 'movie' : 'tv', poster: item.poster_path || null });
    showInput.value = '';
    hideSuggestions();
}

async function addShowByText() {
    const query = showInput.value.trim();
    if (!query) return;
    try {
        const data = await tmdb('/search/multi', { query, include_adult: false });
        const first = (data.results || []).find(r => r.media_type === 'movie' || r.media_type === 'tv');
        if (first) { selectSuggestion(first); }
        else { showError(`Couldn't find "${query}" on TMDB. Try a different spelling.`); }
    } catch (e) { showError(e.message); }
}

function addShow() { addShowByText(); }


function addToWatchlist(item) {
    if (watchlist.find(w => w.id === item.id)) { showError(`"${item.title}" is already in your list.`); return; }
    watchlist.push(item);
    renderTags();
    document.getElementById('watchlistSection').style.display = 'block';
}

function renderTags() {
    const container = document.getElementById('tagContainer');
    container.innerHTML = '';
    watchlist.forEach((show, index) => {
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.innerHTML = `<span>${escapeHtml(show.title)}</span><button class="tag-remove" onclick="removeShow(${index})" title="Remove">×</button>`;
        container.appendChild(tag);
    });
}

function removeShow(index) {
    watchlist.splice(index, 1);
    renderTags();
    if (watchlist.length === 0) {
        document.getElementById('watchlistSection').style.display = 'none';
        document.getElementById('recsSection').style.display = 'none';
    }
}


async function getRecommendations() {
    if (!watchlist.length) { showError('Add at least one title first!'); return; }
    setLoading(true);
    document.getElementById('recsSection').style.display = 'none';
    try {
        const pool = new Map();
        for (const show of watchlist) {
            setLoadingText(`Finding titles similar to ${show.title}...`);
            const endpoint = show.type === 'movie' ? `/movie/${show.id}/recommendations` : `/tv/${show.id}/recommendations`;
            const data = await tmdb(endpoint, { page: 1 });
            for (const result of (data.results || [])) {
                if (watchlist.find(w => w.id === result.id)) continue;
                if (pool.has(result.id)) { pool.get(result.id).score += 1; }
                else { pool.set(result.id, { item: result, score: 1, sourceType: show.type }); }
            }
        }
        const topResults = [...pool.values()]
            .sort((a, b) => b.score !== a.score ? b.score - a.score : (b.item.vote_average || 0) - (a.item.vote_average || 0))
            .slice(0, 12);

        setLoadingText('Fetching trailers...');
        const enriched = await Promise.all(topResults.map(async ({ item, sourceType }) => {
            try {
                const mediaType = item.media_type || sourceType || 'movie';
                const videoData = await tmdb(mediaType === 'movie' ? `/movie/${item.id}/videos` : `/tv/${item.id}/videos`);
                const trailer = (videoData.results || []).find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
                return { ...item, trailerKey: trailer ? trailer.key : null, mediaType };
            } catch { return { ...item, trailerKey: null, mediaType: item.media_type || sourceType }; }
        }));
        renderRecommendations(enriched);
    } catch (err) { setLoading(false); showError('Error: ' + err.message); }
}

function renderRecommendations(recs) {
    setLoading(false);
    const grid = document.getElementById('recsGrid');
    grid.innerHTML = '';
    document.getElementById('recsSubtitle').textContent = `Based on: ${watchlist.map(w => w.title).join(', ')}`;
    recs.forEach(rec => {
        const title    = rec.title || rec.name || 'Unknown';
        const year     = (rec.release_date || rec.first_air_date || '').slice(0, 4);
        const type     = (rec.mediaType === 'movie' || rec.media_type === 'movie') ? 'Movie' : 'TV Show';
        const rating   = rec.vote_average ? `⭐ ${rec.vote_average.toFixed(1)}` : '';
        const overview = rec.overview || 'No description available.';
        const trailerHref = rec.trailerKey
            ? `https://www.youtube.com/watch?v=${rec.trailerKey}`
            : `https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' official trailer')}`;
        const posterHtml = rec.poster_path
            ? `<img class="rec-poster" src="${TMDB_IMG}${rec.poster_path}" alt="${escapeHtml(title)}" loading="lazy"/>`
            : `<div class="rec-poster-placeholder">🎬</div>`;
        const card = document.createElement('div');
        card.className = 'rec-card';
        card.innerHTML = `${posterHtml}<div class="rec-body"><span class="rec-badge">${type}</span><div class="rec-title">${escapeHtml(title)}</div><div class="rec-meta">${year}${year && rating ? ' · ' : ''}${rating}</div><div class="rec-overview">${escapeHtml(overview)}</div><a class="rec-trailer" href="${trailerHref}" target="_blank" rel="noopener noreferrer">▶ Watch Trailer</a></div>`;
        grid.appendChild(card);
    });
    document.getElementById('recsSection').style.display = 'block';
    document.getElementById('recsSection').scrollIntoView({ behavior: 'smooth' });
}

function setLoading(on) {
    const el = document.getElementById('loadingSection');
    el.style.display = on ? 'flex' : 'none';
    if (on) el.scrollIntoView({ behavior: 'smooth' });
}
function setLoadingText(msg) { document.getElementById('loadingText').textContent = msg; }
function showError(msg) {
    const toast = document.getElementById('errorToast');
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(showError._timer);
    showError._timer = setTimeout(() => { toast.style.display = 'none'; }, 4000);
}
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
