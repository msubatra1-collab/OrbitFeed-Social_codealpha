'use strict';

const state = { user: null, page: '/', cursor: null, hasMore: false, loading: false, loadingMore: false, csrf: null, pendingImage: null, searchTimer: null, search: null, searchRequestId: 0, relations: null };
const main = document.querySelector('#main-content');
const authDialog = document.querySelector('#auth-dialog');
const profileDialog = document.querySelector('#profile-dialog');
const relationsDialog = document.querySelector('#relations-dialog');
const toast = document.querySelector('#toast');

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function safeImage(value) {
  if (!value || typeof value !== 'string') return '';
  if (/^\/(?:media|manus-storage)\/[a-zA-Z0-9._/-]+$/.test(value) || /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(value)) return value;
  return '';
}
function initials(name) { return esc((name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()); }
function avatar(name, url, size = '') {
  const src = safeImage(url);
  return `<span class="avatar ${size}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : initials(name)}</span>`;
}
function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'just now';
  const secs = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fullDate(value) { return new Date(value).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function toastMessage(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastMessage.timer);
  toastMessage.timer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}
async function getCsrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  const data = await response.json();
  state.csrf = data.token;
}
async function request(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!state.csrf) await getCsrf();
    headers.set('x-csrf-token', state.csrf);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(url, { ...options, method, headers, credentials: 'same-origin' });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403 && data.error === 'csrf_failed') { state.csrf = null; }
    throw new Error(data.message || `Request failed (${response.status}).`);
  }
  return data;
}
function currentRoute() {
  const path = window.location.pathname;
  if (path === '/explore') return { name: 'explore' };
  const profile = path.match(/^\/profile\/([a-z0-9_]{3,30})$/i);
  if (profile) return { name: 'profile', username: decodeURIComponent(profile[1]).toLowerCase() };
  return { name: 'feed' };
}
function setNavActive() {
  const route = currentRoute();
  document.querySelectorAll('[data-route]').forEach((el) => el.classList.toggle('is-active', (route.name === 'feed' && el.dataset.route === '/') || (route.name === 'explore' && el.dataset.route === '/explore')));
  document.querySelector('#feed-nav')?.classList.toggle('is-active', route.name === 'feed');
}
function navigate(path) {
  if (window.location.pathname !== path) history.pushState({}, '', path);
  state.page = path;
  state.cursor = null;
  state.hasMore = false;
  setNavActive();
  const loading = loadPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return loading;
}
function pageHeader(title, eyebrow, subtitle = '') {
  return `<header class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1 class="page-title">${title}</h1>${subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : ''}</div></header>`;
}
function explorerSearchMarkup() {
  return `<section class="search-card explore-search-card"><label for="explore-search">Find your people</label><div class="search-box"><span aria-hidden="true">⌕</span><input id="explore-search" type="search" placeholder="Search names or @handles" autocomplete="off"></div><div id="search-results-main" class="search-results" aria-live="polite"></div></section>`;
}
function composer() {
  if (!state.user) return `<section class="compose-card signed-out-card"><div class="compose-row">${avatar('O', null)}<div><strong>There’s room for your voice.</strong><p class="page-subtitle">Sign in to share a thought or join a conversation.</p></div></div><div class="compose-bottom"><span class="compose-hint">A good conversation starts somewhere.</span><button class="button button-primary" data-action="open-login">Join the conversation</button></div></section>`;
  return `<section class="compose-card" aria-label="Create a post"><div class="compose-row">${avatar(state.user.displayName, state.user.avatarUrl)}<textarea class="compose-input" id="compose-body" maxlength="500" rows="2" placeholder="What’s on your mind, ${esc(state.user.displayName.split(' ')[0])}?" aria-label="Write your post"></textarea></div><div class="image-preview" id="compose-preview"><img alt="Selected image preview"><button type="button" class="remove-preview" data-action="remove-image" aria-label="Remove selected image">×</button></div><div class="compose-bottom"><label class="upload-button" title="Attach an image"><span aria-hidden="true">▧</span><input id="post-image-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden></label><span class="compose-hint">Keep it kind. Keep it you.</span><span class="compose-char" id="compose-count">0 / 500</span><button class="button button-primary" id="publish-post" type="button">Post</button></div></section>`;
}
function postCard(post) {
  const url = safeImage(post.image_url);
  const handle = `@${post.username}`;
  const author = `/profile/${encodeURIComponent(post.username)}`;
  return `<article class="post-card" data-post-id="${Number(post.id)}"><div class="post-top">${avatar(post.display_name, post.avatar_url)}<div class="post-author"><a href="${author}" data-route="${author}">${esc(post.display_name)}</a><span class="post-handle">${esc(handle)}<span>·</span><time datetime="${esc(post.created_at)}">${esc(relativeTime(post.created_at))}</time></span></div><span class="post-time" title="${esc(new Date(post.created_at).toLocaleString())}">${esc(relativeTime(post.created_at))}</span></div><div class="post-body">${esc(post.body).replace(/\n/g, '<br>')}</div>${url ? `<img class="post-image" src="${esc(url)}" alt="Image shared by ${esc(post.display_name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}<div class="post-actions"><button type="button" class="action-button ${post.liked_by_me ? 'is-liked' : ''}" data-action="like" data-id="${Number(post.id)}" aria-pressed="${Boolean(post.liked_by_me)}"><span class="action-icon">${post.liked_by_me ? '♥' : '♡'}</span><span>${Number(post.like_count || 0)}</span></button><button type="button" class="action-button" data-action="comments" data-id="${Number(post.id)}"><span class="action-icon">▱</span><span>${Number(post.comment_count || 0)} ${Number(post.comment_count) === 1 ? 'reply' : 'replies'}</span></button>${state.user && String(state.user.id) === String(post.user_id) ? `<div class="post-owner-actions"><button class="action-button" data-action="edit-post" data-id="${Number(post.id)}">Edit</button><button class="action-button" data-action="delete-post" data-id="${Number(post.id)}">Delete</button></div>` : ''}</div><section class="comments-panel" data-comments-panel="${Number(post.id)}"><div class="comment-list" data-comment-list></div>${state.user ? `<form class="comment-form" data-comment-form="${Number(post.id)}"><input maxlength="500" name="body" placeholder="Add a thoughtful reply…" aria-label="Write a reply" required><button type="submit" class="button button-primary">Reply</button></form>` : `<button class="more-link" data-action="open-login">Sign in to reply</button>`}<button class="more-link" data-action="load-comments" data-id="${Number(post.id)}">Show more replies</button></section></article>`;
}
function emptyState(kind, ownProfile = false) {
  let content;
  if (kind === 'feed') {
    content = `<h3>Your feed is taking shape.</h3><p>Follow a few people and their latest thoughts will find their way here. Or wander through Explore.</p><a class="button button-primary" href="/explore" data-route="/explore">Explore people</a>`;
  } else if (kind === 'profile' && !ownProfile) {
    content = `<h3>No posts here yet.</h3><p>This person hasn’t shared a thought yet. Check back another time.</p>`;
  } else {
    const isProfile = kind === 'profile';
    content = `<h3>${isProfile ? 'Your first post is waiting.' : 'A little quiet, for now.'}</h3><p>${isProfile ? 'Share a thought and it will appear on your profile.' : 'Be the first to start a conversation. A good thought can make someone’s day.'}</p>${state.user ? `<button class="button button-primary" data-action="focus-compose">${isProfile ? 'Write the first post' : 'Start a conversation'}</button>` : `<button class="button button-primary" data-action="open-login">Join OrbitFeed</button>`}`;
  }
  return `<section class="empty-card"><div class="empty-illustration" aria-hidden="true">◎</div>${content}</section>`;
}
async function loadPage(append = false) {
  if (state.loading || (append && state.loadingMore)) return;
  const route = currentRoute();
  state.loading = !append;
  state.loadingMore = append;
  if (!append) main.innerHTML = '<div class="loading-state"><span class="loader"></span><span>Finding your corner of the conversation…</span></div>';
  try {
    if (route.name === 'profile') return await loadProfile(route.username, append);
    const isExplore = route.name === 'explore';
    const heading = isExplore ? pageHeader('A little world<br>of its own.', 'OUT THERE, TOGETHER', 'Recent thoughts from people across OrbitFeed.') : pageHeader('Your corner<br>of the conversation.', 'THE HOME EDITION', state.user ? 'The latest from people you follow.' : 'Take a look around, then make yourself at home.');
    const endpoint = isExplore ? '/api/explore' : (state.user ? '/api/feed' : '/api/explore');
    const query = new URLSearchParams({ limit: '15' });
    if (append && state.cursor) query.set('cursor', state.cursor);
    const data = await request(`${endpoint}?${query}`);
    state.cursor = data.nextCursor;
    state.hasMore = Boolean(data.nextCursor);
    if (append) {
      document.querySelector('#post-list')?.insertAdjacentHTML('beforeend', data.items.map(postCard).join(''));
      document.querySelector('#page-sentinel')?.remove();
      attachSentinel();
    } else {
      const list = data.items.length ? `<div class="post-list" id="post-list">${data.items.map(postCard).join('')}</div>` : emptyState(isExplore ? 'explore' : 'feed');
      main.innerHTML = `${heading}${isExplore ? explorerSearchMarkup() : ''}${!isExplore ? composer() : ''}${list}${state.hasMore ? '<div class="sentinel" id="page-sentinel"></div>' : ''}`;
      bindCompose();
      attachSentinel();
    }
  } catch (error) {
    if (!append) main.innerHTML = `${pageHeader('Let’s try again.', 'A QUICK PAUSE')}<div class="error-banner">${esc(error.message)}</div><button class="button button-primary load-more" data-action="reload">Try again</button>`;
    else toastMessage(error.message);
  } finally { state.loading = false; state.loadingMore = false; }
}
async function loadProfile(username, append = false) {
  const data = await request(`/api/users/${encodeURIComponent(username)}?limit=15${state.cursor ? `&cursor=${encodeURIComponent(state.cursor)}` : ''}`);
  const u = data.user;
  state.cursor = data.posts.nextCursor;
  state.hasMore = Boolean(data.posts.nextCursor);
  if (append) {
    document.querySelector('#post-list')?.insertAdjacentHTML('beforeend', data.posts.items.map(postCard).join(''));
    document.querySelector('#page-sentinel')?.remove();
    attachSentinel();
    return;
  }
  const date = fullDate(u.created_at);
  const action = u.currentUser ? '<button class="button button-quiet profile-action" data-action="edit-profile">Edit profile</button>' : state.user ? `<button class="button ${u.followed_by_me ? 'button-quiet' : 'button-primary'} profile-action" data-action="follow" data-username="${esc(u.username)}">${u.followed_by_me ? 'Following' : 'Follow'}</button>` : `<button class="button button-primary profile-action" data-action="open-login">Follow</button>`;
  const profile = `<section class="profile-hero"><div class="profile-cover" aria-hidden="true"></div><div class="profile-details"><div class="profile-avatar-row">${avatar(u.display_name,u.avatar_url)}${action}</div><h1 class="profile-name">${esc(u.display_name)}</h1><div class="profile-handle">@${esc(u.username)}</div>${u.bio ? `<p class="profile-bio">${esc(u.bio)}</p>` : ''}<div class="profile-stats"><span><b>${Number(u.post_count)}</b> posts</span><button class="profile-stat" data-action="show-followers" data-username="${esc(u.username)}"><b>${Number(u.follower_count)}</b> followers</button><button class="profile-stat" data-action="show-following" data-username="${esc(u.username)}"><b>${Number(u.following_count)}</b> following</button></div><div class="profile-date">Joined ${esc(date)}</div></div></section><div class="section-row"><h2 class="section-title">${u.currentUser ? 'Your posts' : `${esc(u.display_name.split(' ')[0])}’s posts`}</h2><span class="feed-count">${Number(u.post_count)} TOTAL</span></div>`;
  const posts = data.posts.items.length ? `<div class="post-list" id="post-list">${data.posts.items.map(postCard).join('')}</div>` : emptyState('profile', u.currentUser);
  main.innerHTML = `${profile}${u.currentUser ? composer() : ''}${posts}${state.hasMore ? '<div class="sentinel" id="page-sentinel"></div>' : ''}`;
  if (u.currentUser) bindCompose();
  attachSentinel();
}
function attachSentinel() {
  const sentinel = document.querySelector('#page-sentinel');
  if (!sentinel || !state.hasMore) return;
  const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); loadPage(true); } }, { rootMargin: '250px' });
  observer.observe(sentinel);
}
async function loadComments(postId, append = false) {
  const panel = document.querySelector(`[data-comments-panel="${postId}"]`);
  const list = panel?.querySelector('[data-comment-list]');
  if (!panel || !list) return;
  panel.classList.add('is-open');
  const cursor = append ? panel.dataset.cursor : '';
  const query = new URLSearchParams({ limit: '10' });
  if (cursor) query.set('cursor', cursor);
  try {
    const data = await request(`/api/posts/${postId}/comments?${query}`);
    if (!append) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', data.items.map((c) => `<div class="comment-row" data-comment-id="${Number(c.id)}">${avatar(c.display_name,c.avatar_url)}<div class="comment-content"><strong>${esc(c.display_name)}</strong><time>${esc(relativeTime(c.created_at))}</time><p>${esc(c.body)}</p></div>${state.user && String(state.user.id) === String(c.user_id) ? `<button class="comment-delete" data-action="delete-comment" data-id="${Number(c.id)}" aria-label="Delete reply">×</button>` : ''}</div>`).join(''));
    panel.dataset.cursor = data.nextCursor || '';
    const more = panel.querySelector('[data-action="load-comments"]');
    if (more) { more.hidden = !data.nextCursor; more.textContent = data.nextCursor ? 'Show more replies' : 'That’s all the replies'; }
  } catch (error) { toastMessage(error.message); }
}
function bindCompose() {
  const textarea = document.querySelector('#compose-body');
  const count = document.querySelector('#compose-count');
  textarea?.addEventListener('input', () => { if (count) count.textContent = `${textarea.value.length} / 500`; });
  document.querySelector('#publish-post')?.addEventListener('click', submitPost);
  document.querySelector('#post-image-input')?.addEventListener('change', previewPostImage);
}
async function uploadFile(file) {
  const form = new FormData();
  form.append('image', file);
  return request('/api/uploads', { method: 'POST', body: form });
}
async function previewPostImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toastMessage('Images must be 5 MB or smaller.'); event.target.value = ''; return; }
  try {
    const image = await uploadFile(file);
    state.pendingImage = image;
    const preview = document.querySelector('#compose-preview');
    preview.querySelector('img').src = URL.createObjectURL(file);
    preview.classList.add('is-visible');
    toastMessage('Image attached.');
  } catch (error) { toastMessage(error.message); event.target.value = ''; }
}
async function submitPost() {
  const body = document.querySelector('#compose-body')?.value.trim();
  if (!body) { toastMessage('Write a thought before posting.'); return; }
  const button = document.querySelector('#publish-post');
  button.disabled = true; button.textContent = 'Posting…';
  try {
    await request('/api/posts', { method: 'POST', body: JSON.stringify({ body, imageUrl: state.pendingImage?.url || null, imageKey: state.pendingImage?.key || null }) });
    state.cursor = null; state.pendingImage = null;
    toastMessage('Your thought is out there.');
    await loadPage();
  } catch (error) { toastMessage(error.message); button.disabled = false; button.textContent = 'Post'; }
}
function setAuthMode(mode) {
  const registering = mode === 'register';
  const form = document.querySelector('#auth-form');
  const handle = form.elements.handle;
  const displayName = form.elements.displayName;
  const identifier = form.elements.identifier;
  const password = form.elements.password;
  const changingMode = Boolean(form.dataset.mode && form.dataset.mode !== mode);
  document.querySelectorAll('.auth-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.authMode === mode));
  document.querySelector('#auth-title').textContent = registering ? 'Make it yours.' : 'Come on in.';
  document.querySelector('#auth-copy').textContent = registering ? 'Create a little corner for your thoughts.' : 'Find the conversations that feel like yours.';
  document.querySelector('#username-field').hidden = !registering;
  document.querySelector('#display-field').hidden = !registering;
  handle.required = registering;
  handle.autocomplete = 'nickname';
  displayName.required = registering;
  document.querySelector('#identifier-label').textContent = registering ? 'Email address' : 'Email or username';
  identifier.type = registering ? 'email' : 'text';
  identifier.autocomplete = registering ? 'email' : 'username';
  password.autocomplete = registering ? 'new-password' : 'current-password';
  password.minLength = registering ? 10 : 1;
  if (changingMode) password.value = '';
  if (registering && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(handle.value.trim())) handle.value = '';
  if (registering && identifier.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.value.trim())) identifier.value = '';
  form.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
  document.querySelector('#auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  document.querySelector('#auth-message').textContent = '';
  form.dataset.mode = mode;
}
async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const registering = form.dataset.mode === 'register';
  const message = document.querySelector('#auth-message');
  const button = document.querySelector('#auth-submit');
  message.textContent = '';
  if (!form.reportValidity()) {
    const invalid = form.querySelector(':invalid');
    invalid?.setAttribute('aria-invalid', 'true');
    if (invalid?.name === 'handle') message.textContent = 'Choose a username with 3–30 letters, numbers, or underscores.';
    else if (invalid?.name === 'identifier') message.textContent = registering ? 'Enter a valid email address.' : 'Enter your email address or username.';
    else if (invalid?.name === 'password') message.textContent = registering ? 'Use a password with at least 10 characters.' : 'Enter your password.';
    else if (invalid?.name === 'displayName') message.textContent = 'Add the display name people will see.';
    invalid?.focus();
    return;
  }
  const values = new FormData(form);
  const payload = registering
    ? { username: String(values.get('handle')).trim().toLowerCase(), displayName: values.get('displayName'), email: values.get('identifier'), password: values.get('password') }
    : { identifier: values.get('identifier'), password: values.get('password') };
  button.disabled = true;
  button.textContent = registering ? 'Creating account…' : 'Signing in…';
  try {
    const data = await request(registering ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    state.user = data.user;
    authDialog.close();
    await refreshAccount();
    navigate('/');
    toastMessage(registering ? 'Your OrbitFeed account is ready.' : 'Good to see you again.');
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; button.textContent = form.dataset.mode === 'register' ? 'Create account' : 'Sign in'; }
}
async function refreshAccount() {
  try { const data = await request('/api/auth/me'); state.user = data.user; } catch { state.user = null; }
  const slot = document.querySelector('#account-slot');
  slot.innerHTML = state.user ? `<div class="account-card">${avatar(state.user.displayName,state.user.avatarUrl)}<div class="account-meta"><strong>${esc(state.user.displayName)}</strong><span>@${esc(state.user.username)}</span></div><button class="mini-logout" data-action="logout" title="Sign out">↗</button></div>` : `<button class="button button-primary button-wide" data-action="open-login">Sign in or join</button>`;
}
async function editProfile() {
  if (!state.user) return showAuth();
  const profile = await request(`/api/users/${encodeURIComponent(state.user.username)}`);
  const form = document.querySelector('#profile-form');
  form.elements.displayName.value = profile.user.display_name;
  form.elements.bio.value = profile.user.bio || '';
  document.querySelector('#profile-message').textContent = '';
  profileDialog.showModal();
}
async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = { displayName: form.elements.displayName.value, bio: form.elements.bio.value };
  const file = form.elements.avatar.files?.[0];
  try {
    if (file) { const uploaded = await uploadFile(file); data.avatarUrl = uploaded.url; data.avatarKey = uploaded.key; }
    const response = await request('/api/users/me', { method: 'PATCH', body: JSON.stringify(data) });
    state.user = response.user;
    profileDialog.close(); await refreshAccount(); await loadPage(); toastMessage('Profile updated.');
  } catch (error) { document.querySelector('#profile-message').textContent = error.message; }
}
function showAuth() { setAuthMode('login'); authDialog.showModal(); }
async function action(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action: kind, id, username } = button.dataset;
  try {
    if (kind === 'open-login') return showAuth();
    if (kind === 'reload') return loadPage();
    if (kind === 'focus-compose') {
      let input = document.querySelector('#compose-body');
      if (!input && state.user) {
        await navigate('/');
        input = document.querySelector('#compose-body');
      }
      if (input) { input.focus(); input.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (!state.user) showAuth();
      else toastMessage('The post composer could not open. Please try again.');
      return;
    }
    if (kind === 'remove-image') { state.pendingImage = null; document.querySelector('#compose-preview')?.classList.remove('is-visible'); const input = document.querySelector('#post-image-input'); if (input) input.value = ''; return; }
    if (kind === 'like') {
      if (!state.user) return showAuth();
      const liked = button.getAttribute('aria-pressed') === 'true';
      await request(`/api/posts/${id}/like`, { method: liked ? 'DELETE' : 'POST' });
      button.setAttribute('aria-pressed', String(!liked)); button.classList.toggle('is-liked', !liked); button.querySelector('.action-icon').textContent = liked ? '♡' : '♥';
      const count = button.querySelector('span:last-child'); count.textContent = String(Math.max(0, Number(count.textContent) + (liked ? -1 : 1)));
      return;
    }
    if (kind === 'comments') { const panel = document.querySelector(`[data-comments-panel="${id}"]`); panel.classList.toggle('is-open'); if (panel.classList.contains('is-open') && !panel.dataset.loaded) { await loadComments(id); panel.dataset.loaded = 'true'; } return; }
    if (kind === 'load-comments') return loadComments(id, true);
    if (kind === 'delete-post') { if (!confirm('Delete this post and its replies?')) return; await request(`/api/posts/${id}`, { method: 'DELETE' }); button.closest('.post-card').remove(); toastMessage('Post deleted.'); return; }
    if (kind === 'edit-post') { const card = button.closest('.post-card'); const body = card.querySelector('.post-body').innerText; const next = prompt('Edit your post (up to 500 characters):', body); if (next === null) return; await request(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify({ body: next }) }); toastMessage('Post updated.'); return loadPage(); }
    if (kind === 'delete-comment') { await request(`/api/comments/${id}`, { method: 'DELETE' }); button.closest('.comment-row').remove(); return; }
    if (kind === 'follow') { if (!state.user) return showAuth(); const following = button.textContent.trim() === 'Following'; await request(`/api/users/${encodeURIComponent(username)}/follow`, { method: following ? 'DELETE' : 'POST' }); return loadPage(); }
    if (kind === 'edit-profile') return editProfile();
    if (kind === 'show-followers' || kind === 'show-following') return showRelations(username, kind === 'show-followers' ? 'followers' : 'following');
    if (kind === 'more-relations' && state.relations) return showRelations(state.relations.username, state.relations.relation, true);
    if (kind === 'more-search' && state.search?.term) return searchUsers(state.search.term, true);
    if (kind === 'logout') { await request('/api/auth/logout', { method: 'POST' }); state.user = null; await refreshAccount(); navigate('/'); toastMessage('You’re signed out.'); }
  } catch (error) { toastMessage(error.message); }
}
async function showRelations(username, relation, append = false) {
  if (!append) {
    state.relations = { username, relation, cursor: null };
    document.querySelector('#relations-title').textContent = relation === 'followers' ? 'Followers' : 'Following';
    document.querySelector('#relations-list').innerHTML = '';
    relationsDialog.showModal();
  }
  try {
    const query = new URLSearchParams({ limit: '20' });
    if (append && state.relations.cursor) query.set('cursor', state.relations.cursor);
    const data = await request(`/api/users/${encodeURIComponent(username)}/${relation}?${query}`);
    const rows = data.items.map((u) => `<a class="relation-item" href="/profile/${encodeURIComponent(u.username)}" data-route="/profile/${encodeURIComponent(u.username)}">${avatar(u.display_name,u.avatar_url)}<span><b>${esc(u.display_name)}</b><small>@${esc(u.username)}${u.bio ? ` · ${esc(u.bio)}` : ''}</small></span></a>`).join('');
    const list = document.querySelector('#relations-list');
    if (append) list.insertAdjacentHTML('beforeend', rows); else list.innerHTML = rows || '<p class="page-subtitle">No one here yet.</p>';
    state.relations.cursor = data.nextCursor;
    document.querySelector('#relations-more').hidden = !data.nextCursor;
  } catch (error) { toastMessage(error.message); }
}
async function searchUsers(term, append = false) {
  const resultTargets = [...document.querySelectorAll('#search-results, #search-results-main')];
  const normalized = term.trim();
  if (!normalized) { resultTargets.forEach((target) => { target.innerHTML = ''; }); return; }
  if (!append) state.search = { term: normalized, cursor: null, loading: false, requestId: state.searchRequestId };
  if (!state.search || state.search.term !== normalized || state.search.loading || (append && !state.search.cursor)) return;
  const requestId = state.search.requestId;
  const cursor = append ? state.search.cursor : null;
  state.search.loading = true;
  try {
    const query = new URLSearchParams({ q: normalized, limit: '8' });
    if (cursor) query.set('cursor', cursor);
    const data = await request(`/api/users/search?${query}`);
    if (requestId !== state.searchRequestId || state.search?.term !== normalized) return;
    const html = data.users.map((u) => `<a class="search-person" href="/profile/${encodeURIComponent(u.username)}" data-route="/profile/${encodeURIComponent(u.username)}">${avatar(u.display_name,u.avatar_url)}<span><b>${esc(u.display_name)}</b><small>@${esc(u.username)} · ${Number(u.follower_count)} followers</small></span></a>`).join('');
    const more = data.nextCursor ? '<button type="button" class="more-link search-more" data-action="more-search">Show more people</button>' : '';
    resultTargets.forEach((target) => {
      target.querySelector('[data-action="more-search"]')?.remove();
      if (append) {
        target.querySelector('.search-person-list')?.insertAdjacentHTML('beforeend', html);
        if (data.nextCursor) target.insertAdjacentHTML('beforeend', more);
      } else {
        target.innerHTML = data.users.length ? `<div class="search-person-list">${html}</div>${more}` : '<p class="page-subtitle">No matches yet.</p>';
      }
    });
    state.search.cursor = data.nextCursor;
  } catch (error) {
    if (requestId === state.searchRequestId) resultTargets.forEach((target) => { if (!append) target.innerHTML = `<p class="page-subtitle">${esc(error.message)}</p>`; });
  } finally {
    if (requestId === state.searchRequestId && state.search) state.search.loading = false;
  }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('orbitfeed-theme', theme);
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#17191d' : '#f5f3ed';
}
function toggleTheme() { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }

// Event delegation keeps dynamic feed cards accessible without inline handlers.
document.addEventListener('click', (event) => {
  const routeLink = event.target.closest('[data-route]');
  if (routeLink) { event.preventDefault(); navigate(routeLink.dataset.route); return; }
  if (event.target.closest('[data-action]')) action(event);
  if (event.target.matches('[data-close]')) document.getElementById(event.target.dataset.close).close();
  if (event.target.closest('#theme-toggle, #mobile-theme-toggle')) toggleTheme();
  if (event.target.closest('#profile-nav, #mobile-profile-nav')) { if (state.user) navigate(`/profile/${encodeURIComponent(state.user.username)}`); else showAuth(); }
});
document.querySelector('#auth-form').addEventListener('submit', submitAuth);
document.querySelector('#auth-form').addEventListener('input', (event) => {
  if (!event.target.matches('input')) return;
  event.target.removeAttribute('aria-invalid');
  const message = document.querySelector('#auth-message');
  if (event.target.name === 'identifier' || event.target.name === 'handle' || !message.textContent.startsWith('Too many unsuccessful attempts')) message.textContent = '';
});
document.querySelector('#profile-form').addEventListener('submit', saveProfile);
document.querySelectorAll('[data-auth-mode]').forEach((el) => el.addEventListener('click', () => setAuthMode(el.dataset.authMode)));
document.addEventListener('input', (event) => {
  if (!event.target.matches('#people-search, #explore-search')) return;
  clearTimeout(state.searchTimer);
  const term = event.target.value.trim();
  state.searchRequestId += 1;
  state.search = { term, cursor: null, loading: false, requestId: state.searchRequestId };
  if (!term) { document.querySelectorAll('#search-results, #search-results-main').forEach((target) => { target.innerHTML = ''; }); return; }
  state.searchTimer = setTimeout(() => searchUsers(term), 220);
});
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-comment-form]');
  if (!form) return;
  event.preventDefault();
  const postId = form.dataset.commentForm;
  const input = form.elements.body;
  try { await request(`/api/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body: input.value }) }); input.value = ''; await loadComments(postId); const count = document.querySelector(`[data-action="comments"][data-id="${postId}"] span:last-child`); if (count) { const n = Number(count.textContent.match(/\d+/)?.[0] || 0) + 1; count.textContent = `${n} ${n === 1 ? 'reply' : 'replies'}`; } }
  catch (error) { toastMessage(error.message); }
});
window.addEventListener('popstate', () => { state.page = window.location.pathname; setNavActive(); loadPage(); });

(async function boot() {
  applyTheme(localStorage.getItem('orbitfeed-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  try { await getCsrf(); await refreshAccount(); } catch (error) { console.error('Session check failed:', error); }
  setNavActive();
  await loadPage();
})();
