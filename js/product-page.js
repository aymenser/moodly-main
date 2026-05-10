/* ==============================================
   product-page.js — Mobile product detail page
   Moodly · Spring Boot backend aware

   Purpose:
   - Opens product details from sessionStorage or ?p=<id>.
   - Keeps wishlist/cart actions connected to Supabase auth + Spring Boot.
   - Handles mobile stock, variant, and responsive UI safely.
   ============================================== */

'use strict';

const PP_API_BASE = window.MOODLY_CONFIG?.API_BASE || 'http://localhost:8080/api';
const COLOR_MAP = {
  noir: '#1a1a1a', black: '#1a1a1a', noire: '#1a1a1a',
  blanc: '#f0ece8', white: '#f0ece8', blanche: '#f0ece8',
  rose: '#e8909e', pink: '#e8909e',
  bleu: '#7aa8c8', blue: '#7aa8c8',
  camel: '#d4a07a', marron: '#b07845', brown: '#b07845',
  kaki: '#8aab88', vert: '#5a7a58', green: '#5a7a58',
  beige: '#e8d8c0', crème: '#e8d8c0', creme: '#e8d8c0',
  bordeaux: '#a05070', rouge: '#ef4444', red: '#ef4444',
  gris: '#9a9a9a', grey: '#9a9a9a', gray: '#9a9a9a',
};

const GRAD_MAP = {
  noir: 'linear-gradient(135deg,#1a1a1a,#3a3a3a)',
  blanc: 'linear-gradient(135deg,#f0ece8,#e0dbd5)',
  rose: 'linear-gradient(135deg,#f0b8c0,#e8909e)',
  bleu: 'linear-gradient(135deg,#7aa8c8,#4d7fa8)',
  camel: 'linear-gradient(135deg,#d4a07a,#b07845)',
  vert: 'linear-gradient(135deg,#8aab88,#5a7a58)',
  beige: 'linear-gradient(135deg,#e8d8c0,#d4c0a0)',
  bordeaux: 'linear-gradient(135deg,#a05070,#7a3050)',
  default: 'linear-gradient(135deg,#c9b8a8,#a89080)',
};

let product = null;
let allProducts = [];
let currentSlide = 0;
let qty = 1;
let selectedColor = null;
let selectedSize = null;
let isWished = false;
let openedFrom = 'shop';
let ppCurrentUser = null;
let ppSpringProfile = null;
let ppCartOrder = null;
let ppWishlistRows = [];
let toastTimer = null;
let authListenerReady = false;

function qs(selector) {
  return document.querySelector(selector);
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeText(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function uniqueBy(list, getKey) {
  const seen = new Set();
  return list.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colorToHex(colorName) {
  const normalized = normalizeText(colorName);
  for (const [key, value] of Object.entries(COLOR_MAP)) {
    if (normalized.includes(key)) return value;
  }
  return '#ccc';
}

function gradientForColor(colorName) {
  const normalized = normalizeText(colorName);
  if (normalized.includes('noir') || normalized.includes('black')) return GRAD_MAP.noir;
  if (normalized.includes('blanc') || normalized.includes('white')) return GRAD_MAP.blanc;
  if (normalized.includes('rose') || normalized.includes('pink')) return GRAD_MAP.rose;
  if (normalized.includes('bleu') || normalized.includes('blue')) return GRAD_MAP.bleu;
  if (normalized.includes('camel') || normalized.includes('marron') || normalized.includes('brown')) return GRAD_MAP.camel;
  if (normalized.includes('vert') || normalized.includes('kaki') || normalized.includes('green')) return GRAD_MAP.vert;
  if (normalized.includes('beige') || normalized.includes('creme') || normalized.includes('crème')) return GRAD_MAP.beige;
  if (normalized.includes('borde') || normalized.includes('rouge') || normalized.includes('red')) return GRAD_MAP.bordeaux;
  if (String(colorName).startsWith('#')) return `linear-gradient(135deg,${colorName},${colorName}cc)`;
  return GRAD_MAP.default;
}

function normalizeImageUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return '';

  if (/^(https?:)?\/\//i.test(url)) return url;
  if (/^(data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return url;
  if (url.startsWith('assets/')) return url;

  return '';
}

function normalizeImage(image = {}) {
  return {
    id: image.id,
    imageUrl: normalizeImageUrl(image.imageUrl || image.image_url || image.url || ''),
  };
}


function getAnyImageUrl(rawProduct = {}) {
  if (rawProduct.imageUrl) return rawProduct.imageUrl;

  const sources = [
    rawProduct.images,
    rawProduct.productImages,
    rawProduct.product_images,
    rawProduct.raw?.images,
    rawProduct.raw?.productImages,
    rawProduct.raw?.product_images,
  ];

  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    const image = source.find((item) => item?.imageUrl || item?.image_url || item?.url);
    if (image) return image.imageUrl || image.image_url || image.url;
  }

  return null;
}

function normalizeVariant(variant = {}) {
  return {
    id: variant.id,
    size: variant.size || 'Default',
    color: variant.color || 'Default',
    stockQuantity: number(variant.stockQuantity ?? variant.stock_quantity, 0),
    productId: variant.product?.id || variant.productId || variant.product_id,
  };
}

function normalizeReview(review = {}) {
  return {
    id: review.id,
    rating: number(review.rating, 0),
    comment: review.comment || '',
    createdAt: review.createdAt || review.created_at || null,
    author: review.profile?.fullName || review.user?.fullName || 'Cliente Moodly',
    productId: review.product?.id || review.productId || review.product_id,
  };
}

function shapeProduct(rawProduct, images = [], variants = [], reviews = []) {
  const normalizedVariants = (variants.length ? variants : rawProduct.variants || rawProduct.product_variants || [])
    .map(normalizeVariant);
  const normalizedImages = (images.length ? images : rawProduct.images || rawProduct.productImages || rawProduct.product_images || [])
    .map(normalizeImage)
    .filter((image) => image.imageUrl);
  const normalizedReviews = (reviews.length ? reviews : rawProduct.reviewsList || rawProduct.product_reviews || [])
    .map(normalizeReview);
  const colorVariants = uniqueBy(normalizedVariants, (variant) => normalizeText(variant.color));
  const sizeVariants = uniqueBy(normalizedVariants, (variant) => normalizeText(variant.size));
  const totalStock = normalizedVariants.reduce((sum, variant) => sum + number(variant.stockQuantity), 0);
  const averageRating = normalizedReviews.length
    ? normalizedReviews.reduce((sum, review) => sum + review.rating, 0) / normalizedReviews.length
    : number(rawProduct.rating, 4.5);

  let badge = rawProduct.badge || null;
  if (totalStock <= 0) badge = 'out';
  else if (totalStock <= 5) badge = 'low';

  return {
    id: rawProduct.id,
    name: rawProduct.name || 'Produit',
    category: rawProduct.category?.name || rawProduct.category || rawProduct.categoryName || 'Collection 2026',
    price: number(rawProduct.price, 0),
    oldPrice: rawProduct.oldPrice,
    description: rawProduct.description || '',
    images: normalizedImages,
    imageUrl: normalizedImages[0]?.imageUrl || rawProduct.imageUrl || null,
    variants: normalizedVariants,
    sizes: sizeVariants.length ? sizeVariants.map((variant) => variant.size) : (rawProduct.sizes || ['Default']),
    colorNames: colorVariants.length ? colorVariants.map((variant) => variant.color) : (rawProduct.colorNames || rawProduct.colors || ['Default']),
    colors: colorVariants.length ? colorVariants.map((variant) => colorToHex(variant.color)) : (rawProduct.colors || ['#ccc']),
    rating: Number(averageRating.toFixed(1)),
    reviewCount: normalizedReviews.length || number(rawProduct.reviews, 0),
    reviewsList: normalizedReviews,
    badge,
    totalStock,
    grad: rawProduct.grad || gradientForColor(colorVariants[0]?.color || rawProduct.colorNames?.[0] || rawProduct.colors?.[0]),
  };
}

async function ppApi(path, options = {}) {
  const sessionData = await window.sbClient?.auth?.getSession?.();
  const token = sessionData?.data?.session?.access_token;
  const response = await fetch(`${PP_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '69420',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) return null;
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`API ${response.status}: ${message || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : null;
}

function readStoredProducts() {
  try {
    return JSON.parse(sessionStorage.getItem('moodly-products') || '[]');
  } catch {
    return [];
  }
}

function writeStoredProduct(updatedProduct) {
  sessionStorage.setItem('moodly-product', JSON.stringify(updatedProduct));
  const stored = readStoredProducts();
  if (!stored.length) return;
  const next = stored.map((item) => String(item.id) === String(updatedProduct.id) ? updatedProduct : item);
  sessionStorage.setItem('moodly-products', JSON.stringify(next));
}

function rememberProductView(targetProduct) {
  if (!targetProduct?.id) return;
  const key = `moodly-latest-viewed-${ppSpringProfile?.id || 'guest'}`;
  let items = [];
  try { items = JSON.parse(localStorage.getItem(key) || '[]'); } catch { items = []; }
  const entry = {
    id: targetProduct.id,
    name: targetProduct.name || 'Produit',
    price: Number(targetProduct.price || 0),
    imageUrl: targetProduct.imageUrl || null,
    grad: targetProduct.grad || 'grad-default',
    viewedAt: new Date().toISOString(),
  };
  localStorage.setItem(key, JSON.stringify([entry, ...items.filter((item) => String(item.id) !== String(entry.id))].slice(0, 12)));
}

function saveStockAlert(targetProduct) {
  if (!targetProduct?.id) return;
  const key = `moodly-stock-alerts-${ppSpringProfile?.id || 'guest'}`;
  let items = [];
  try { items = JSON.parse(localStorage.getItem(key) || '[]'); } catch { items = []; }
  if (!items.some((item) => String(item.productId) === String(targetProduct.id))) {
    items.unshift({ productId: targetProduct.id, name: targetProduct.name || 'Produit', createdAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(items));
  }
  showToast('Vous serez notifié quand ce produit revient en stock.');
}

async function fetchProductById(productId) {
  const [rawProduct, images, variants, reviews] = await Promise.all([
    ppApi(`/products/${encodeURIComponent(productId)}`),
    ppApi(`/product-images/product/${encodeURIComponent(productId)}`).catch(() => []),
    ppApi(`/product-variants/product/${encodeURIComponent(productId)}`).catch(() => []),
    ppApi(`/reviews/product/${encodeURIComponent(productId)}`).catch(() => []),
  ]);
  let finalReviews = reviews;
  if (!Array.isArray(finalReviews) || !finalReviews.length) {
    const allReviews = await ppApi('/reviews').catch(() => []);
    finalReviews = allReviews.filter((review) => String(review.product?.id || review.productId || review.product_id) === String(productId));
  }
  return shapeProduct(rawProduct, images, variants, finalReviews);
}

async function loadInitialProduct() {
  openedFrom = sessionStorage.getItem('moodly-opened-from') === 'home' ? 'home' : 'shop';
  allProducts = readStoredProducts().map((item) => shapeProduct(item));

  const params = new URLSearchParams(window.location.search);
  const urlProductId = params.get('p');
  const raw = sessionStorage.getItem('moodly-product');

  if (urlProductId) {
    const found = allProducts.find((item) => String(item.id) === String(urlProductId));
    product = found || await fetchProductById(urlProductId).catch(() => null);
  }

  if (!product && raw) {
    try {
      product = shapeProduct(JSON.parse(raw));
    } catch {
      product = null;
    }
  }

  if (!product) product = getDemoProduct();
  writeStoredProduct(product);
}

function setActiveBottomNav() {
  document.querySelectorAll('.bottom-nav-btn').forEach((button) => button.classList.remove('active'));
  byId(openedFrom === 'home' ? 'bnHome' : 'bnExplore')?.classList.add('active');
}

function updateBottomNavBadges({ cartCount = null, wishCount = null } = {}) {
  if (cartCount === null) {
    const cart = JSON.parse(localStorage.getItem('moodly-cart') || '[]');
    cartCount = cart.reduce((sum, item) => sum + number(item.qty, 1), 0);
  }
  if (wishCount === null) {
    wishCount = ppWishlistRows.length || JSON.parse(localStorage.getItem('moodly-wishlist') || '[]').length;
  }

  const cartBadge = byId('cartBadgeMobile');
  const wishBadge = byId('wishBadgeMobile');
  if (cartBadge) {
    cartBadge.textContent = String(cartCount);
    cartBadge.classList.toggle('show', cartCount > 0);
  }
  if (wishBadge) {
    wishBadge.textContent = String(wishCount);
    wishBadge.classList.toggle('show', wishCount > 0);
  }
}

function goToHome() {
  sessionStorage.setItem('moodly-from-product', 'true');
  window.location.href = 'index.html';
}

function goToShop() {
  sessionStorage.setItem('moodly-from-product', 'true');
  window.location.href = 'index.html#shop';
}

function goBackToStore() {
  sessionStorage.setItem('moodly-from-product', 'true');
  const destination = openedFrom === 'home' ? 'index.html' : 'index.html#shop';
  window.location.replace(destination);
}

function goToWishlist() {
  openWishlist();
}

function goToCart() {
  openCart();
}

function goToProfile() {
  openProfile();
}

function closeCart() { byId('cartDrawer')?.classList.remove('open'); }
function closeWishlist() { byId('wishlistDrawer')?.classList.remove('open'); }
function closeProfile() { byId('profileDrawer')?.classList.remove('open'); }
function closeAuthModal() { byId('authModal')?.classList.remove('open'); }

function openAuthModal() {
  closeProfile();
  byId('authModal')?.classList.add('open');
}

function switchModalTab(tab) {
  byId('authTabSignin')?.classList.toggle('active', tab === 'signin');
  byId('authTabSignup')?.classList.toggle('active', tab === 'signup');
  byId('modalSigninForm')?.style.setProperty('display', tab === 'signin' ? 'flex' : 'none');
  byId('modalSignupForm')?.style.setProperty('display', tab === 'signup' ? 'flex' : 'none');
}

async function initAuth() {
  try {
    const { data } = await window.sbClient.auth.getSession();
    ppCurrentUser = data?.session?.user || null;
    if (ppCurrentUser?.email) {
      ppSpringProfile = await ppApi(`/profiles/email/${encodeURIComponent(ppCurrentUser.email)}`).catch(() => null);
    }
  } catch {
    ppCurrentUser = null;
    ppSpringProfile = null;
  }

  if (!authListenerReady && window.sbClient?.auth?.onAuthStateChange) {
    authListenerReady = true;
    window.sbClient.auth.onAuthStateChange(async (_event, session) => {
      ppCurrentUser = session?.user || null;
      ppSpringProfile = ppCurrentUser?.email
        ? await ppApi(`/profiles/email/${encodeURIComponent(ppCurrentUser.email)}`).catch(() => null)
        : null;
      if (byId('profileDrawer')?.classList.contains('open')) renderProfileDrawer();
      await syncBackendState();
    });
  }
}

function requireLogin() {
  if (ppSpringProfile?.id) return true;
  openProfile();
  showToast('Connectez-vous pour continuer.');
  return false;
}

function renderProfileDrawer() {
  const el = byId('profileContent');
  if (!el) return;

  if (!ppCurrentUser) {
    el.innerHTML = `
      <div class="pp-profile-auth">
        <div class="pp-profile-avatar">👋</div>
        <h3>Bienvenue !</h3>
        <p>Connectez-vous pour accéder à vos commandes, favoris et panier.</p>
        <div class="auth-tabs">
          <button class="auth-tab active" id="profTabSign" onclick="switchProfTab('signin')">Se connecter</button>
          <button class="auth-tab" id="profTabReg" onclick="switchProfTab('signup')">S'inscrire</button>
        </div>
        <div class="auth-form" id="profSignin">
          <input class="form-input" type="email" placeholder="Votre email" id="ppLoginEmail">
          <input class="form-input" type="password" placeholder="Mot de passe" id="ppLoginPassword">
          <div id="ppLoginError"></div>
          <button class="auth-submit" id="ppLoginBtn" onclick="doLoginProfile()">Se connecter</button>
        </div>
        <div class="auth-form" id="profSignup" style="display:none;">
          <input class="form-input" type="text" placeholder="Votre prénom" id="ppSignupName">
          <input class="form-input" type="email" placeholder="Votre email" id="ppSignupEmail">
          <input class="form-input" type="password" placeholder="Mot de passe (min. 6 car.)" id="ppSignupPassword">
          <div id="ppSignupError"></div>
          <button class="auth-submit" id="ppSignupBtn" onclick="doSignupProfile()">Créer mon compte</button>
        </div>
      </div>`;
    return;
  }

  const userEmail = ppCurrentUser.email || '';
  const userName = ppSpringProfile?.fullName || ppCurrentUser.user_metadata?.name || userEmail.split('@')[0];
  const wishCount = ppWishlistRows.length;
  el.innerHTML = `
    <div class="profile-hero-card">
      <div class="profile-avatar-lg">${escapeHtml(userName.charAt(0).toUpperCase())}</div>
      <div class="profile-name-lg">${escapeHtml(userName)}</div>
      <div class="profile-email-sm">${escapeHtml(userEmail)}</div>
    </div>
    <div class="profile-stats">
      <div class="profile-stat-card"><span class="profile-stat-num">—</span><span class="profile-stat-label">Commandes</span></div>
      <div class="profile-stat-card"><span class="profile-stat-num">${wishCount}</span><span class="profile-stat-label">Favoris</span></div>
      <div class="profile-stat-card"><span class="profile-stat-num" style="font-size:1rem;">Moodly</span><span class="profile-stat-label">Compte</span></div>
    </div>
    <div class="profile-section-title">Mon compte</div>
    <button class="profile-menu-item" onclick="closeProfile();openWishlist()">
      <div class="profile-menu-icon"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
      <div class="profile-menu-text"><span class="profile-menu-title">Mes favoris</span><span class="profile-menu-sub">${wishCount} articles sauvegardés</span></div>
      <span class="profile-menu-arrow">›</span>
    </button>
    <div style="padding:0 28px;margin-top:24px;">
      <button class="profile-logout" onclick="doLogoutProfile()">Se déconnecter</button>
    </div>`;
}

function openProfile() {
  renderProfileDrawer();
  byId('profileDrawer')?.classList.add('open');
}

function switchProfTab(tab) {
  byId('profTabSign')?.classList.toggle('active', tab === 'signin');
  byId('profTabReg')?.classList.toggle('active', tab === 'signup');
  byId('profSignin')?.style.setProperty('display', tab === 'signin' ? 'flex' : 'none');
  byId('profSignup')?.style.setProperty('display', tab === 'signup' ? 'flex' : 'none');
}

function showAuthError(containerId, message) {
  const el = byId(containerId);
  if (!el) return;
  el.innerHTML = `<div class="auth-error-msg" style="margin-top:4px;"><span>${escapeHtml(message)}</span></div>`;
}

function translateAuthError(error) {
  const msg = normalizeText(error?.message || '');
  if (msg.includes('invalid login') || msg.includes('invalid credentials')) return 'Email ou mot de passe incorrect.';
  if (msg.includes('email not confirmed')) return 'Email non confirmé. Vérifiez votre boîte mail.';
  if (msg.includes('already registered') || msg.includes('already exists')) return 'Un compte existe déjà avec cet email.';
  if (msg.includes('least') || msg.includes('password')) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (msg.includes('fetch') || msg.includes('network')) return 'Erreur réseau. Vérifiez Spring Boot et Supabase.';
  return error?.message || 'Une erreur inattendue est survenue.';
}

async function doLoginProfile() {
  const email = byId('ppLoginEmail')?.value?.trim() || qs('#modalSigninForm input[type="email"]')?.value?.trim();
  const password = byId('ppLoginPassword')?.value || qs('#modalSigninForm input[type="password"]')?.value;
  const btn = byId('ppLoginBtn') || qs('#modalSigninForm .auth-submit');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAuthError('ppLoginError', 'Email invalide.');
    return;
  }
  if (!password) {
    showAuthError('ppLoginError', 'Veuillez saisir votre mot de passe.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }
  try {
    const { data, error } = await window.sbClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    ppCurrentUser = data.user;
    ppSpringProfile = await ppApi(`/profiles/email/${encodeURIComponent(email)}`);
    closeAuthModal();
    await syncBackendState();
    renderProfileDrawer();
    showToast('Bienvenue chez Moodly.');
  } catch (error) {
    showAuthError('ppLoginError', translateAuthError(error));
    showToast(translateAuthError(error));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
}

async function doSignupProfile() {
  const name = byId('ppSignupName')?.value?.trim() || qs('#modalSignupForm input[type="text"]')?.value?.trim();
  const email = byId('ppSignupEmail')?.value?.trim() || qs('#modalSignupForm input[type="email"]')?.value?.trim();
  const password = byId('ppSignupPassword')?.value || qs('#modalSignupForm input[type="password"]')?.value;
  const btn = byId('ppSignupBtn') || qs('#modalSignupForm .auth-submit');

  if (!name) { showAuthError('ppSignupError', 'Veuillez saisir votre prénom.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('ppSignupError', 'Email invalide.'); return; }
  if (!password || password.length < 6) { showAuthError('ppSignupError', 'Mot de passe trop court.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }
  try {
    const { error } = await window.sbClient.auth.signUp({ email, password, options: { data: { name } } });
    if (error) throw error;
    showToast('Compte créé. Vérifiez votre email, puis connectez-vous.');
    switchModalTab('signin');
    switchProfTab('signin');
  } catch (error) {
    showAuthError('ppSignupError', translateAuthError(error));
    showToast(translateAuthError(error));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer mon compte'; }
  }
}

async function doLogoutProfile() {
  await window.sbClient.auth.signOut().catch(() => null);
  ppCurrentUser = null;
  ppSpringProfile = null;
  ppCartOrder = null;
  ppWishlistRows = [];
  updateBottomNavBadges({ cartCount: 0, wishCount: 0 });
  renderProfileDrawer();
  showToast('Déconnecté.');
}

function starText(rating) {
  const rounded = Math.round(number(rating, 0));
  return '★'.repeat(rounded) + '☆'.repeat(Math.max(0, 5 - rounded));
}

function formatPrice(price) {
  return `${number(price).toLocaleString('fr-DZ')} DA`;
}

function renderProduct() {
  document.title = `${product.name} — Moodly`;
  byId('ppCategory').textContent = product.category || 'Collection 2026';
  byId('ppName').textContent = product.name;
  byId('ppPrice').textContent = formatPrice(product.price);
  byId('ppDesc').textContent = product.description || 'Une pièce soigneusement sélectionnée pour votre style.';

  const stars = byId('ppStars');
  if (stars) stars.innerHTML = `${starText(product.rating)} <span>${product.rating} (${product.reviewCount || 0})</span>`;

  if (product.oldPrice) {
    byId('ppPriceOld').textContent = formatPrice(product.oldPrice);
    byId('ppPriceOld').classList.add('show');
    const pct = Math.round((1 - product.price / product.oldPrice) * 100);
    byId('ppPriceTag').textContent = `-${pct}%`;
    byId('ppPriceTag').classList.add('show');
  }

  const badge = byId('ppBadge');
  if (badge) {
    if (product.badge) {
      badge.textContent = product.badge === 'out' ? 'Rupture' : product.badge === 'low' ? 'Dernières pièces' : 'Nouveau';
      badge.className = `pp-badge show badge-${product.badge}`;
    } else {
      badge.className = 'pp-badge';
      badge.textContent = '';
    }
  }

  renderGallery();
  setInitialSelection();
  renderColors();
  renderSizes();
  renderReviews();
  renderAlsoLike();
  updateWishUI();
  updateStockUi();
}

function productImages() {
  const images = [];
  const seen = new Set();
  const add = (value) => {
    const src = typeof value === 'string' ? value : value?.imageUrl || value?.image_url || value?.url;
    if (!src || seen.has(src)) return;
    seen.add(src);
    images.push(src);
  };

  add(product.imageUrl);
  [product.images, product.productImages, product.product_images, product.raw?.images, product.raw?.productImages, product.raw?.product_images]
    .forEach((source) => Array.isArray(source) && source.forEach(add));

  if (images.length) {
    return images.map((src) => `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}" loading="eager" decoding="async">`);
  }

  const color = selectedColor || product.colorNames?.[0] || 'rose';
  const base = gradientForColor(color);
  return [`background:${base}`, `background:${base};filter:brightness(.94)`, `background:${base};filter:brightness(1.05)`];
}

function renderGallery() {
  const slides = byId('ppSlides');
  const dots = byId('ppDots');
  if (!slides || !dots) return;

  const images = productImages();
  slides.innerHTML = '';
  dots.innerHTML = '';
  currentSlide = 0;
  slides.style.transform = 'translateX(0%)';

  images.forEach((content, index) => {
    const slide = document.createElement('div');
    slide.className = 'pp-slide';
    const inner = document.createElement('div');
    inner.className = 'pp-slide-inner';
    if (content.startsWith('<img')) inner.innerHTML = content;
    else inner.style.cssText = `width:100%;height:100%;${content}`;
    slide.appendChild(inner);
    slides.appendChild(slide);

    const dot = document.createElement('button');
    dot.className = `pp-dot${index === 0 ? ' active' : ''}`;
    dot.type = 'button';
    dot.onclick = () => goToSlide(index);
    dots.appendChild(dot);
  });

  dots.style.display = images.length > 1 ? 'flex' : 'none';
}

function variantsForColor(color) {
  return (product.variants || []).filter((variant) => normalizeText(variant.color) === normalizeText(color));
}

function variantsForSize(size) {
  return (product.variants || []).filter((variant) => normalizeText(variant.size) === normalizeText(size));
}

function availableVariantFor(color, size) {
  return (product.variants || []).find((variant) => (
    normalizeText(variant.color) === normalizeText(color) &&
    normalizeText(variant.size) === normalizeText(size) &&
    number(variant.stockQuantity) > 0
  ));
}

function selectedVariant() {
  return (product.variants || []).find((variant) => (
    normalizeText(variant.color) === normalizeText(selectedColor || 'Default') &&
    normalizeText(variant.size) === normalizeText(selectedSize || 'Default')
  )) || null;
}

function firstAvailableVariant(targetProduct = product) {
  return targetProduct?.variants?.find((variant) => number(variant.stockQuantity) > 0) || null;
}

function totalStock(targetProduct = product) {
  return (targetProduct?.variants || []).reduce((sum, variant) => sum + number(variant.stockQuantity), 0);
}

function setInitialSelection() {
  const available = firstAvailableVariant(product);
  selectedColor = available?.color || product.colorNames?.[0] || 'Default';
  selectedSize = available?.size || product.sizes?.[0] || 'Default';
}

function renderColors() {
  const container = byId('ppColors');
  if (!container) return;
  const colorNames = product.colorNames?.length ? product.colorNames : ['Default'];
  container.innerHTML = '';

  colorNames.forEach((name) => {
    const colorStock = variantsForColor(name).reduce((sum, variant) => sum + number(variant.stockQuantity), 0);
    const btn = document.createElement('button');
    btn.className = `pp-color-btn${normalizeText(name) === normalizeText(selectedColor) ? ' selected' : ''}${colorStock <= 0 ? ' unavailable' : ''}`;
    btn.type = 'button';
    btn.title = name;
    btn.style.background = colorToHex(name);
    btn.disabled = colorStock <= 0;
    btn.onclick = () => selectColor(name);
    container.appendChild(btn);
  });

  const help = byId('ppColorHelp');
  if (help) help.textContent = totalStock(product) <= 0 ? 'Toutes les couleurs sont en rupture.' : '';
  byId('ppSelectedColor').textContent = selectedColor || '—';
}

function renderSizes() {
  const container = byId('ppSizes');
  if (!container) return;
  const sizes = product.sizes?.length ? product.sizes : ['Default'];
  container.innerHTML = '';

  sizes.forEach((size) => {
    const variant = availableVariantFor(selectedColor, size);
    const hasAnyCombination = variantsForSize(size).some((item) => normalizeText(item.color) === normalizeText(selectedColor));
    const btn = document.createElement('button');
    btn.className = `pp-size-btn${normalizeText(size) === normalizeText(selectedSize) ? ' active' : ''}${!variant ? ' unavailable' : ''}`;
    btn.type = 'button';
    btn.textContent = size;
    btn.disabled = !variant;
    btn.title = !hasAnyCombination ? 'Non disponible pour cette couleur' : !variant ? 'Rupture pour cette combinaison' : `${variant.stockQuantity} disponible(s)`;
    btn.onclick = () => selectSize(size);
    container.appendChild(btn);
  });
}

function selectColor(color) {
  selectedColor = color;
  const firstAvailableForColor = variantsForColor(color).find((variant) => number(variant.stockQuantity) > 0);
  selectedSize = firstAvailableForColor?.size || selectedSize;
  renderColors();
  renderSizes();
  updateStockUi();
}

function selectSize(size) {
  if (!availableVariantFor(selectedColor, size)) {
    showToast('Cette taille est indisponible pour cette couleur.');
    return;
  }
  selectedSize = size;
  renderSizes();
  updateStockUi();
}

function changeQty(delta) {
  const variant = selectedVariant();
  const stock = number(variant?.stockQuantity, 0);
  const max = Math.max(1, stock || 1);
  qty = Math.max(1, Math.min(max, qty + delta));
  byId('ppQty').textContent = String(qty);
  updateStockUi();
}

function updateStockUi() {
  const variant = selectedVariant();
  const stock = number(variant?.stockQuantity, 0);
  const stockState = byId('ppStockState');
  const cartBtn = byId('ppCartBtn');
  const minus = byId('ppQtyMinus');
  const plus = byId('ppQtyPlus');

  if (stockState) {
    if (totalStock(product) <= 0) {
      stockState.textContent = 'Rupture de stock.';
      stockState.className = 'pp-stock-state stock-out';
    } else if (!variant) {
      stockState.textContent = 'Choisissez une combinaison disponible.';
      stockState.className = 'pp-stock-state stock-out';
    } else if (stock <= 0) {
      stockState.textContent = 'Cette taille/couleur est en rupture.';
      stockState.className = 'pp-stock-state stock-out';
    } else if (stock <= 5) {
      stockState.textContent = `Dernières pièces: ${stock} disponible(s).`;
      stockState.className = 'pp-stock-state stock-low';
    } else {
      stockState.textContent = `${stock} disponible(s).`;
      stockState.className = 'pp-stock-state';
    }
  }

  const disabled = !variant || stock <= 0;
  if (cartBtn) {
    cartBtn.disabled = false;
    cartBtn.classList.toggle('disabled', disabled);
    cartBtn.innerHTML = disabled
      ? `<svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> M’alerter`
      : `<svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> Ajouter au panier`;
  }

  if (stock > 0 && qty > stock) {
    qty = stock;
    byId('ppQty').textContent = String(qty);
  }
  [minus, plus].forEach((button) => {
    if (!button) return;
    button.disabled = disabled;
    button.classList.toggle('disabled', disabled);
  });
}

function renderReviews() {
  const container = byId('ppReviewsContent');
  if (!container) return;
  const reviews = product.reviewsList || [];
  if (!reviews.length) {
    container.innerHTML = '<p class="pp-empty-text">Aucun avis pour ce produit pour le moment.</p>';
    return;
  }

  container.innerHTML = `
    <div class="pp-reviews-summary">
      <div class="pp-rating-big">${product.rating}</div>
      <div><div class="pp-stars-big">${starText(product.rating)}</div><div class="pp-rating-count">${reviews.length} avis vérifié(s)</div></div>
    </div>
    ${reviews.slice(0, 4).map((review) => `
      <article class="pp-review-card">
        <div class="pp-review-stars">${starText(review.rating)}</div>
        <p class="pp-review-text">${escapeHtml(review.comment || 'Avis sans commentaire.')}</p>
        <div class="pp-review-author">${escapeHtml(review.author)}</div>
      </article>
    `).join('')}`;
}

function renderAlsoLike() {
  const container = byId('ppAlsoScroll');
  if (!container) return;
  const products = (allProducts.length ? allProducts : getDemoRelated())
    .filter((item) => String(item.id) !== String(product.id))
    .slice(0, 8);

  container.innerHTML = products.map((item) => {
    const imageStyle = item.imageUrl
      ? `background-image:url('${escapeHtml(item.imageUrl)}')`
      : `background:${gradientForColor(item.colorNames?.[0] || item.colors?.[0] || 'rose')}`;
    return `
      <a class="pp-also-card" href="product.html?p=${encodeURIComponent(item.id)}" onclick="openRelatedProduct(event,'${escapeHtml(item.id)}')">
        <div class="pp-also-img" style="${imageStyle}"></div>
        <div class="pp-also-info">
          <div class="pp-also-name">${escapeHtml(item.name)}</div>
          <div class="pp-also-price">${formatPrice(item.price)}</div>
        </div>
      </a>`;
  }).join('') || '<p class="pp-empty-text">Aucune suggestion pour le moment.</p>';
}

function openRelatedProduct(event, productId) {
  event.preventDefault();
  const nextProduct = allProducts.find((item) => String(item.id) === String(productId));
  if (nextProduct) sessionStorage.setItem('moodly-product', JSON.stringify(nextProduct));
  window.location.href = `product.html?p=${encodeURIComponent(productId)}`;
}

function goToSlide(index) {
  const slides = byId('ppSlides');
  const dots = document.querySelectorAll('.pp-dot');
  if (!slides || !dots.length) return;
  currentSlide = Math.max(0, Math.min(index, dots.length - 1));
  slides.style.transform = `translateX(-${currentSlide * 100}%)`;
  dots.forEach((dot, i) => dot.classList.toggle('active', i === currentSlide));
}

function initSwipe() {
  const gallery = byId('ppGallery');
  if (!gallery) return;
  let startX = 0;
  let startY = 0;
  let isDragging = false;
  let isHorizontal = false;

  gallery.addEventListener('touchstart', (event) => {
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    isDragging = true;
    isHorizontal = false;
  }, { passive: true });

  gallery.addEventListener('touchmove', (event) => {
    if (!isDragging) return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    isHorizontal = Math.abs(dx) > Math.abs(dy);
    if (isHorizontal) event.preventDefault();
  }, { passive: false });

  gallery.addEventListener('touchend', (event) => {
    if (!isDragging || !isHorizontal) {
      isDragging = false;
      return;
    }
    const dx = event.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) goToSlide(dx < 0 ? currentSlide + 1 : currentSlide - 1);
    isDragging = false;
  });
}

function initScroll() {
  const header = qs('.pp-header');
  window.addEventListener('scroll', () => {
    header?.classList.toggle('scrolled', window.scrollY > 8);
  }, { passive: true });
}

function initGalleryHint() {
  setTimeout(() => byId('ppSwipeHint')?.classList.add('hidden'), 2200);
}

async function ppRefreshCart() {
  if (!ppSpringProfile?.id) return [];
  ppCartOrder = await ppApi(`/orders/cart/user/${ppSpringProfile.id}`).catch(() => null);
  return normalizeCartItems(ppCartOrder);
}

async function ppRefreshWishlist() {
  if (!ppSpringProfile?.id) return [];
  ppWishlistRows = await ppApi(`/wishlists/profile/${ppSpringProfile.id}`).catch(() => []);
  return normalizeWishlistItems(ppWishlistRows);
}

function normalizeCartItems(order) {
  return (order?.orderItems || []).map((item) => {
    const variant = item.productVariant || {};
    const productId = variant.product?.id || variant.productId || variant.product_id;
    const localProduct = allProducts.find((candidate) => String(candidate.id) === String(productId));
    const rawProduct = localProduct || variant.product || {};
    const shaped = rawProduct.variants || rawProduct.images
      ? rawProduct
      : shapeProduct(rawProduct, rawProduct.productImages || rawProduct.product_images || [], rawProduct.productVariants || rawProduct.product_variants || [], []);

    return {
      id: shaped.id || productId || item.id,
      cartItemId: item.id,
      name: shaped.name || 'Produit',
      imageUrl: getAnyImageUrl(shaped),
      images: shaped.images || [],
      grad: shaped.grad || 'grad-default',
      price: number(item.priceAtPurchase ?? item.price_at_purchase ?? shaped.price, 0),
      qty: number(item.quantity, 1),
      _selectedColor: variant.color || 'Default',
      _selectedSize: variant.size || 'Default',
    };
  });
}

function normalizeWishlistItems(rows) {
  return rows.map((row) => {
    const productId = row.product?.id || row.productId || row.product_id;
    const found = row.product || allProducts.find((candidate) => String(candidate.id) === String(productId));
    return found ? { ...shapeProduct(found), wishlistId: row.id } : null;
  }).filter(Boolean);
}

async function syncBackendState() {
  if (!ppSpringProfile?.id) {
    updateBottomNavBadges({ cartCount: 0, wishCount: 0 });
    return;
  }

  const [cart, wish] = await Promise.all([ppRefreshCart(), ppRefreshWishlist()]);
  isWished = wish.some((item) => String(item.id) === String(product.id));
  updateWishUI();
  updateBottomNavBadges({
    cartCount: cart.reduce((sum, item) => sum + number(item.qty, 1), 0),
    wishCount: wish.length,
  });
}

async function openCart() {
  if (!ppSpringProfile?.id) await initAuth();
  if (!requireLogin()) return;
  const cart = await ppRefreshCart();
  const body = byId('cartItems');
  if (!body) return;

  if (!cart.length) {
    body.innerHTML = '<div class="cart-empty"><p>Votre panier est vide</p><p style="font-size:.8rem;margin-top:6px;font-style:italic">Commencez à shopper !</p></div>';
    byId('cartSubtotal').textContent = '0 DA';
  } else {
    body.innerHTML = cart.map((item) => `
      <div class="cart-item">
        <div class="cart-item-img ${item.grad}">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : ''}</div>
        <div class="cart-item-details">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-meta">Taille: ${escapeHtml(item._selectedSize)} · Couleur: ${escapeHtml(item._selectedColor)} · Qté: ${item.qty}</div>
          <div class="cart-item-price">${formatPrice(item.price * item.qty)}</div>
        </div>
        <button class="cart-item-del" onclick="removeFromCartDirect('${item.cartItemId}')">Supprimer</button>
      </div>`).join('');
    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    byId('cartSubtotal').textContent = formatPrice(total);
  }

  byId('cartDrawer')?.classList.add('open');
  updateBottomNavBadges({ cartCount: cart.reduce((sum, item) => sum + item.qty, 0), wishCount: ppWishlistRows.length });
}

async function openWishlist() {
  if (!ppSpringProfile?.id) await initAuth();
  if (!requireLogin()) return;
  const wish = await ppRefreshWishlist();
  const body = byId('wishlistItems');
  if (!body) return;

  if (!wish.length) {
    body.innerHTML = '<div class="cart-empty"><p>Aucun favori pour le moment.</p></div>';
  } else {
    body.innerHTML = wish.map((item) => `
      <div class="wish-item">
        <div class="wish-item-img ${item.grad || 'grad-default'}">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : ''}</div>
        <div class="wish-item-details">
          <div class="wish-item-name">${escapeHtml(item.name)}</div>
          <div class="wish-item-price">${formatPrice(item.price)}</div>
          <button class="wish-item-add" onclick="addToCartFromWishDirect('${item.id}')">+ Ajouter au panier</button>
        </div>
        <button class="wish-item-del" onclick="removeFromWishDirect('${item.id}')">Supprimer</button>
      </div>`).join('');
  }

  byId('wishlistDrawer')?.classList.add('open');
  updateBottomNavBadges({ wishCount: wish.length });
}

async function addToCart() {
  if (!ppSpringProfile?.id) await initAuth();
  if (!requireLogin()) return;

  const variant = selectedVariant();
  if (!variant?.id || number(variant.stockQuantity) <= 0) {
    saveStockAlert(product);
    showToast('Cette combinaison est en rupture. Alerte activée.');
    updateStockUi();
    return;
  }
  if (number(variant.stockQuantity) < qty) {
    showToast(`Stock insuffisant. Disponible: ${variant.stockQuantity}.`);
    updateStockUi();
    return;
  }

  try {
    if (!ppCartOrder?.id) ppCartOrder = await ppApi(`/orders/cart/user/${ppSpringProfile.id}`);
    await ppApi(`/order-items/order/${ppCartOrder.id}`, {
      method: 'POST',
      body: JSON.stringify({ variantId: variant.id, quantity: qty, priceAtPurchase: product.price }),
    });
    variant.stockQuantity = Math.max(0, number(variant.stockQuantity) - qty);
    product.totalStock = totalStock(product);
    product.badge = product.totalStock <= 0 ? 'out' : product.totalStock <= 5 ? 'low' : product.badge;
    writeStoredProduct(product);
    await syncBackendState();
    renderColors();
    renderSizes();
    updateStockUi();
    showToast(`${qty}× "${product.name}" ajouté au panier.`);
    qty = 1;
    byId('ppQty').textContent = '1';
  } catch (error) {
    showToast(error.message || 'Ajout impossible.');
  }
}

async function toggleWish() {
  if (!ppSpringProfile?.id) await initAuth();
  if (!requireLogin()) return;

  try {
    const rows = await ppRefreshWishlist();
    const existing = rows.find((item) => String(item.id) === String(product.id));
    if (existing?.wishlistId) {
      await ppApi(`/wishlists/${existing.wishlistId}`, { method: 'DELETE' });
      isWished = false;
    } else {
      await ppApi('/wishlists', {
        method: 'POST',
        body: JSON.stringify({ profileId: ppSpringProfile.id, productId: product.id }),
      });
      isWished = true;
    }
    await syncBackendState();
    showToast(isWished ? 'Ajouté aux favoris.' : 'Retiré des favoris.');
  } catch (error) {
    showToast(error.message || 'Action impossible.');
  }
}

function updateWishUI() {
  [byId('ppWishBtn'), byId('ppCtaWish')].forEach((button) => {
    if (!button) return;
    button.classList.toggle('wished', isWished);
  });
}

async function removeFromCartDirect(orderItemId) {
  if (!requireLogin()) return;
  await ppApi(`/order-items/${orderItemId}`, { method: 'DELETE' });
  await openCart();
  await syncBackendState();
  showToast('Article retiré du panier.');
}

async function removeFromWishDirect(productId) {
  if (!requireLogin()) return;
  const rows = await ppRefreshWishlist();
  const existing = rows.find((item) => String(item.id) === String(productId));
  if (existing?.wishlistId) await ppApi(`/wishlists/${existing.wishlistId}`, { method: 'DELETE' });
  await openWishlist();
  await syncBackendState();
  showToast('Retiré des favoris.');
}

async function addToCartFromWishDirect(productId) {
  if (!requireLogin()) return;
  const found = allProducts.find((item) => String(item.id) === String(productId));
  const variant = firstAvailableVariant(found);
  if (!found || !variant?.id) {
    showToast('Produit en rupture de stock.');
    return;
  }
  if (!ppCartOrder?.id) ppCartOrder = await ppApi(`/orders/cart/user/${ppSpringProfile.id}`);
  await ppApi(`/order-items/order/${ppCartOrder.id}`, {
    method: 'POST',
    body: JSON.stringify({ variantId: variant.id, quantity: 1, priceAtPurchase: found.price }),
  });
  await openCart();
  await syncBackendState();
  showToast('Article ajouté au panier.');
}

function getShareUrl() {
  const base = `${window.location.origin}${window.location.pathname}`;
  return product?.id ? `${base}?p=${encodeURIComponent(product.id)}` : base;
}

function shareProduct() {
  const url = getShareUrl();
  const title = `${product?.name || 'Produit'} — Moodly`;
  const text = `Découvrez "${product?.name || 'ce produit'}" sur Moodly`;
  if (navigator.share) {
    navigator.share({ title, text, url }).catch(() => null);
    return;
  }
  navigator.clipboard?.writeText(url).then(() => showToast('Lien copié.')).catch(() => showToast(url));
}

function openSizeGuide() { byId('ppSizeSheet')?.classList.add('open'); }
function closeSizeGuide() { byId('ppSizeSheet')?.classList.remove('open'); }

function showToast(message) {
  const toast = byId('ppToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function getDemoProduct() {
  return shapeProduct({
    id: 'demo-1',
    name: 'Robe Florale Été',
    category: 'Robes',
    price: 4500,
    colorNames: ['Rose', 'Blanc', 'Bleu'],
    sizes: ['S', 'M', 'L'],
    variants: [
      { id: 'demo-v1', color: 'Rose', size: 'S', stockQuantity: 3 },
      { id: 'demo-v2', color: 'Rose', size: 'M', stockQuantity: 8 },
      { id: 'demo-v3', color: 'Blanc', size: 'M', stockQuantity: 0 },
      { id: 'demo-v4', color: 'Bleu', size: 'L', stockQuantity: 2 },
    ],
    description: 'Une robe légère et élégante, parfaite pour les journées ensoleillées.',
  });
}

function getDemoRelated() {
  return [
    shapeProduct({ id: 'r1', name: 'Top Caramel', price: 2800, colorNames: ['Camel'], variants: [{ color: 'Camel', size: 'M', stockQuantity: 4 }] }),
    shapeProduct({ id: 'r2', name: 'Pantalon Noir', price: 3900, colorNames: ['Noir'], variants: [{ color: 'Noir', size: 'L', stockQuantity: 2 }] }),
    shapeProduct({ id: 'r3', name: 'Robe Bordeaux', price: 5200, colorNames: ['Bordeaux'], variants: [{ color: 'Bordeaux', size: 'M', stockQuantity: 1 }] }),
  ];
}

function exposeGlobals() {
  Object.assign(window, {
    goToHome, goToShop, goBackToStore, goToWishlist, goToCart, goToProfile,
    openCart, closeCart, openWishlist, closeWishlist, openProfile, closeProfile,
    openAuthModal, closeAuthModal, switchModalTab, switchProfTab,
    doLoginProfile, doSignupProfile, doLogoutProfile,
    changeQty, selectColor, selectSize, addToCart, toggleWish,
    removeFromCartDirect, removeFromWishDirect, addToCartFromWishDirect,
    openSizeGuide, closeSizeGuide, shareProduct, showToast, openRelatedProduct,
  });
}

async function boot() {
  exposeGlobals();
  const savedTheme = localStorage.getItem('moodly-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  await loadInitialProduct();
  setActiveBottomNav();
  renderProduct();
  document.body.classList.add('pp-ready');
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    window.dispatchEvent(new Event('resize'));
  });
  initSwipe();
  initScroll();
  initGalleryHint();
  await initAuth();
  rememberProductView(product);
  await syncBackendState();
  byId('ppSizeSheet')?.addEventListener('click', (event) => {
    if (event.target === byId('ppSizeSheet')) closeSizeGuide();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch((error) => {
    console.error('Product page boot error:', error);
    showToast('Impossible de charger le produit.');
  });
});


window.addEventListener('pageshow', () => {
  document.body.classList.add('pp-ready');
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
  });
});
