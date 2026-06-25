/* ==============================================
   product-page.js — Mobile product detail page
   Moodly · Unified with main storefront architecture

   Now imports from api.js and state-manager.js
   instead of duplicating logic.
   ============================================== */

'use strict';

// ---- Imports ----
import {
  apiFetch,
  fetchProducts,
  fetchProductById,
  fetchCartForUser,
  fetchUserWishlist,
  addOrderItem,
  addWishlistItem,
  removeWishlistItem,
  deleteOrderItem,
  shapeProduct,
  colorToHex,
  gradientForColor,
  normalizeImageUrl,
  normalizeReview,
  COLOR_HEX_MAP,
  GRADIENT_MAP,
  getCurrentProfile,
  restoreSessionProfile,
  signIn,
  signOut,
  signUp,
} from './api.js';

import {
  getState,
  getStateSnapshot,
  setState,
  subscribe,
  updateCartItems,
  updateWishlistItems,
  addCartItem,
  removeCartItem,
  addWishlistItem as addWishlistItemState,
  removeWishlistItem as removeWishlistItemState,
  setUser,
  clearUser,
  getCartItems,
  getWishlistItems,
  getUserProfile,
  isLoggedIn,
  setAllProducts,
  getProduct,
  setCurrentProduct,
} from './state-manager.js';

import * as UI from './ui.js';

// ---- Constants ----
const API_BASE = window.MOODLY_CONFIG?.API_BASE || 'http://localhost:8080/api';

// ---- Local State (UI-specific) ----
let product = null;
let currentSlide = 0;
let qty = 1;
let selectedColor = null;
let selectedSize = null;
let openedFrom = 'shop';
let toastTimer = null;
let stateUnsubscribe = null;
let isWished = false;

// ---- DOM Helpers ----
function qs(selector) { return document.querySelector(selector); }
function byId(id) { return document.getElementById(id); }

function escapeHtml(value = '') {
  return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatPrice(price) {
  return `${number(price).toLocaleString('fr-DZ')} DA`;
}

function starText(rating) {
  const rounded = Math.round(number(rating, 0));
  return '★'.repeat(rounded) + '☆'.repeat(Math.max(0, 5 - rounded));
}

function normalizeText(value = '') {
  return String(value)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
}

// ---- State Synchronization ----
function syncWithGlobalState() {
  const globalState = getStateSnapshot();

  // Update badges
  updateBadges(globalState);

  // Update wish status for current product
  if (product && globalState.wishlistItems) {
    isWished = globalState.wishlistItems.some(item =>
        String(item.id) === String(product.id)
    );
    updateWishUI(isWished);
  }
}

function updateBadges(state) {
  const cartBadge = byId('cartBadgeMobile');
  const wishBadge = byId('wishBadgeMobile');

  const cartCount = state.cartItems.reduce((sum, item) => sum + number(item.qty, 1), 0);
  const wishCount = state.wishlistItems.length;

  if (cartBadge) {
    cartBadge.textContent = String(cartCount);
    cartBadge.classList.toggle('show', cartCount > 0);
  }
  if (wishBadge) {
    wishBadge.textContent = String(wishCount);
    wishBadge.classList.toggle('show', wishCount > 0);
  }
}

function updateWishUI(wished) {
  [byId('ppWishBtn'), byId('ppCtaWish')].forEach((button) => {
    if (!button) return;
    button.classList.toggle('wished', wished);
  });
  isWished = wished;
}

// ---- Authentication ----
function requireLogin() {
  if (isLoggedIn()) return true;
  openProfile();
  showToast('Connectez-vous pour continuer.');
  return false;
}

// ---- Product Loading ----
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
  const next = stored.map(item =>
      String(item.id) === String(updatedProduct.id) ? updatedProduct : item
  );
  sessionStorage.setItem('moodly-products', JSON.stringify(next));
}

function rememberProductView(targetProduct) {
  if (!targetProduct?.id) return;
  const profile = getUserProfile();
  const key = `moodly-latest-viewed-${profile?.id || 'guest'}`;
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

  const filtered = items.filter(item => String(item.id) !== String(entry.id));
  localStorage.setItem(key, JSON.stringify([entry, ...filtered].slice(0, 12)));
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
    images: [],
    reviewsList: [],
  });
}

async function loadInitialProduct() {
  openedFrom = sessionStorage.getItem('moodly-opened-from') === 'home' ? 'home' : 'shop';

  // Try to get products from session storage first
  const storedProducts = readStoredProducts();
  if (storedProducts.length) {
    setAllProducts(storedProducts);
  }

  const params = new URLSearchParams(window.location.search);
  const urlProductId = params.get('p');
  const raw = sessionStorage.getItem('moodly-product');

  // Try to find product in stored products
  let foundProduct = null;
  if (urlProductId) {
    const products = getStateSnapshot().allProducts;
    foundProduct = products.find(item => String(item.id) === String(urlProductId));
  }

  // If not found, fetch from API
  if (!foundProduct && urlProductId) {
    try {
      foundProduct = await fetchProductById(urlProductId);
    } catch (err) {
      console.warn('Product fetch failed:', err);
    }
  }

  // Try session storage
  if (!foundProduct && raw) {
    try {
      foundProduct = JSON.parse(raw);
    } catch {
      foundProduct = null;
    }
  }

  // Fallback to demo
  if (!foundProduct) {
    foundProduct = getDemoProduct();
  }

  product = foundProduct;
  setCurrentProduct(product);
  writeStoredProduct(product);
  return product;
}

// ---- Product Rendering ----
function renderProduct() {
  if (!product) return;

  document.title = `${product.name} — Moodly`;
  byId('ppCategory').textContent = product.category || 'Collection 2026';
  byId('ppName').textContent = product.name;
  byId('ppPrice').textContent = formatPrice(product.price);
  byId('ppDesc').textContent = product.description || 'Une pièce soigneusement sélectionnée pour votre style.';

  const stars = byId('ppStars');
  if (stars) {
    stars.innerHTML = `${starText(product.rating)} <span>${product.rating} (${product.reviewCount || 0})</span>`;
  }

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
      badge.textContent = product.badge === 'out' ? 'Rupture' :
          product.badge === 'low' ? 'Dernières pièces' : 'Nouveau';
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
  updateStockUi();

  // Sync wish status
  const globalState = getStateSnapshot();
  isWished = globalState.wishlistItems.some(item =>
      String(item.id) === String(product.id)
  );
  updateWishUI(isWished);
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
  [product.images, product.productImages, product.product_images]
      .forEach(source => Array.isArray(source) && source.forEach(add));

  if (images.length) {
    return images.map(src =>
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}" loading="eager" decoding="async">`
    );
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
    if (content.startsWith('<img')) {
      inner.innerHTML = content;
    } else {
      inner.style.cssText = `width:100%;height:100%;${content}`;
    }
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

// ---- Variant Helpers ----
function variantsForColor(color) {
  return (product.variants || []).filter(v =>
      normalizeText(v.color) === normalizeText(color)
  );
}

function variantsForSize(size) {
  return (product.variants || []).filter(v =>
      normalizeText(v.size) === normalizeText(size)
  );
}

function availableVariantFor(color, size) {
  return (product.variants || []).find(v =>
      normalizeText(v.color) === normalizeText(color) &&
      normalizeText(v.size) === normalizeText(size) &&
      number(v.stockQuantity) > 0
  );
}

function selectedVariant() {
  return (product.variants || []).find(v =>
      normalizeText(v.color) === normalizeText(selectedColor || 'Default') &&
      normalizeText(v.size) === normalizeText(selectedSize || 'Default')
  ) || null;
}

function firstAvailableVariant() {
  return product?.variants?.find(v => number(v.stockQuantity) > 0) || null;
}

function totalStock() {
  return (product?.variants || []).reduce((sum, v) => sum + number(v.stockQuantity), 0);
}

function setInitialSelection() {
  const available = firstAvailableVariant();
  selectedColor = available?.color || product.colorNames?.[0] || 'Default';
  selectedSize = available?.size || product.sizes?.[0] || 'Default';
}

// ---- Color & Size Rendering ----
function renderColors() {
  const container = byId('ppColors');
  if (!container) return;

  const colorNames = product.colorNames?.length ? product.colorNames : ['Default'];
  container.innerHTML = '';

  colorNames.forEach((name) => {
    const colorStock = variantsForColor(name).reduce((sum, v) => sum + number(v.stockQuantity), 0);
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
  if (help) help.textContent = totalStock() <= 0 ? 'Toutes les couleurs sont en rupture.' : '';
  byId('ppSelectedColor').textContent = selectedColor || '—';
}

function renderSizes() {
  const container = byId('ppSizes');
  if (!container) return;

  const sizes = product.sizes?.length ? product.sizes : ['Default'];
  container.innerHTML = '';

  sizes.forEach((size) => {
    const variant = availableVariantFor(selectedColor, size);
    const btn = document.createElement('button');
    btn.className = `pp-size-btn${normalizeText(size) === normalizeText(selectedSize) ? ' active' : ''}${!variant ? ' unavailable' : ''}`;
    btn.type = 'button';
    btn.textContent = size;
    btn.disabled = !variant;
    btn.title = !variant ? 'Rupture pour cette combinaison' : `${variant.stockQuantity} disponible(s)`;
    btn.onclick = () => selectSize(size);
    container.appendChild(btn);
  });
}

function selectColor(color) {
  selectedColor = color;
  const firstAvailableForColor = variantsForColor(color).find(v => number(v.stockQuantity) > 0);
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

// ---- Stock UI ----
function updateStockUi() {
  const variant = selectedVariant();
  const stock = number(variant?.stockQuantity, 0);
  const total = totalStock();
  const stockState = byId('ppStockState');
  const cartBtn = byId('ppCartBtn');
  const minus = byId('ppQtyMinus');
  const plus = byId('ppQtyPlus');

  if (stockState) {
    if (total <= 0) {
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
  [minus, plus].forEach(btn => {
    if (!btn) return;
    btn.disabled = disabled;
    btn.classList.toggle('disabled', disabled);
  });
}

// ---- Reviews ----
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
    ${reviews.slice(0, 4).map(review => `
      <article class="pp-review-card">
        <div class="pp-review-stars">${starText(review.rating)}</div>
        <p class="pp-review-text">${escapeHtml(review.comment || 'Avis sans commentaire.')}</p>
        <div class="pp-review-author">${escapeHtml(review.author)}</div>
      </article>
    `).join('')}`;
}

// ---- Also Like ----
function renderAlsoLike() {
  const container = byId('ppAlsoScroll');
  if (!container) return;

  const allProducts = getStateSnapshot().allProducts;
  const products = (allProducts.length ? allProducts : getDemoRelated())
      .filter(item => String(item.id) !== String(product.id))
      .slice(0, 8);

  container.innerHTML = products.map(item => {
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

function getDemoRelated() {
  return [
    { id: 'r1', name: 'Top Caramel', price: 2800, colorNames: ['Camel'], variants: [{ color: 'Camel', size: 'M', stockQuantity: 4 }] },
    { id: 'r2', name: 'Pantalon Noir', price: 3900, colorNames: ['Noir'], variants: [{ color: 'Noir', size: 'L', stockQuantity: 2 }] },
    { id: 'r3', name: 'Robe Bordeaux', price: 5200, colorNames: ['Bordeaux'], variants: [{ color: 'Bordeaux', size: 'M', stockQuantity: 1 }] },
  ];
}

function openRelatedProduct(event, productId) {
  event.preventDefault();
  const allProducts = getStateSnapshot().allProducts;
  const nextProduct = allProducts.find(item => String(item.id) === String(productId));
  if (nextProduct) {
    sessionStorage.setItem('moodly-product', JSON.stringify(nextProduct));
  }
  window.location.href = `product.html?p=${encodeURIComponent(productId)}`;
}

// ---- Gallery Navigation ----
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
  let startX = 0, startY = 0, isDragging = false, isHorizontal = false;

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

// ---- Cart Operations ----
async function addToCart() {
  const profile = getUserProfile();
  if (!profile?.id) {
    openProfile();
    showToast('Connectez-vous pour ajouter au panier.');
    return;
  }

  const variant = selectedVariant();
  if (!variant?.id || number(variant.stockQuantity) <= 0) {
    alertMeStock(product);
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
    const state = getStateSnapshot();
    let order = state.cartOrder;
    if (!order?.id) {
      order = await fetchCartForUser(profile.id);
      setState({ cartOrder: order });
    }

    await addOrderItem(order.id, variant.id, qty, product.price);

    // Update variant stock
    variant.stockQuantity = Math.max(0, number(variant.stockQuantity) - qty);
    product.totalStock = totalStock();
    product.badge = product.totalStock <= 0 ? 'out' : product.totalStock <= 5 ? 'low' : product.badge;
    writeStoredProduct(product);

    // Refresh cart state
    const updatedOrder = await fetchCartForUser(profile.id);
    updateCartItems(updatedOrder);

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

function alertMeStock(product) {
  const profile = getUserProfile();
  if (!profile?.id) {
    openProfile();
    showToast('Connectez-vous pour recevoir une alerte.');
    return;
  }

  const key = `moodly-stock-alerts-${profile.id}`;
  let items = [];
  try { items = JSON.parse(localStorage.getItem(key) || '[]'); } catch { items = []; }
  if (!items.some(item => String(item.productId) === String(product.id))) {
    items.unshift({
      productId: product.id,
      name: product.name || 'Produit',
      createdAt: new Date().toISOString()
    });
    localStorage.setItem(key, JSON.stringify(items));
  }
  showToast('Vous serez notifié quand ce produit revient en stock.');
}

// ---- Wishlist Operations ----
async function toggleWish() {
  if (!requireLogin()) return;
  if (!product?.id) return;

  const profile = getUserProfile();
  try {
    const state = getStateSnapshot();
    const existing = state.wishlistItems.find(item =>
        String(item.id) === String(product.id)
    );

    if (existing?.wishlistId) {
      await removeWishlistItem(existing.wishlistId);
      isWished = false;
    } else {
      await addWishlistItem(product.id, profile.id);
      isWished = true;
    }

    // Refresh wishlist
    const rows = await fetchUserWishlist(profile.id);
    updateWishlistItems(rows);
    updateWishUI(isWished);
    showToast(isWished ? 'Ajouté aux favoris.' : 'Retiré des favoris.');
  } catch (error) {
    showToast(error.message || 'Action impossible.');
  }
}

// ---- Navigation ----
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

function goToWishlist() { openWishlist(); }
function goToCart() { openCart(); }
function goToProfile() { openProfile(); }

// ---- Drawer Controls ----
function closeCart() { byId('cartDrawer')?.classList.remove('open'); }
function closeWishlist() { byId('wishlistDrawer')?.classList.remove('open'); }
function closeProfile() { byId('profileDrawer')?.classList.remove('open'); }
function closeAuthModal() { byId('authModal')?.classList.remove('open'); }

function openCart() {
  if (!requireLogin()) return;
  byId('cartDrawer')?.classList.add('open');
}

function openWishlist() {
  if (!requireLogin()) return;
  byId('wishlistDrawer')?.classList.add('open');
}

function openProfile() {
  // Re-use the main app's profile drawer via UI module
  UI.openProfile(isLoggedIn(), getUserProfile());
  // If the main app's drawer isn't available, use local one
  const localProfile = byId('profileDrawer');
  if (localProfile) {
    renderProfileDrawer();
    localProfile.classList.add('open');
  }
}

function renderProfileDrawer() {
  const el = byId('profileContent');
  if (!el) return;

  const profile = getUserProfile();
  if (!profile) {
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

  const userEmail = profile.email || '';
  const userName = profile.fullName || profile.name || userEmail.split('@')[0];
  const wishCount = getWishlistItems().length;

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

// ---- Auth Functions ----
async function doLoginProfile() {
  const email = byId('ppLoginEmail')?.value?.trim();
  const password = byId('ppLoginPassword')?.value;
  const btn = byId('ppLoginBtn');

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
    const result = await signIn(email, password);
    setUser(result.user, result.profile);
    closeAuthModal();
    closeProfile();
    syncWithGlobalState();
    showToast('Bienvenue chez Moodly.');
  } catch (error) {
    showAuthError('ppLoginError', translateAuthError(error));
    showToast(translateAuthError(error));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
}

async function doSignupProfile() {
  const name = byId('ppSignupName')?.value?.trim();
  const email = byId('ppSignupEmail')?.value?.trim();
  const password = byId('ppSignupPassword')?.value;
  const btn = byId('ppSignupBtn');

  if (!name) { showAuthError('ppSignupError', 'Veuillez saisir votre prénom.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('ppSignupError', 'Email invalide.'); return; }
  if (!password || password.length < 6) { showAuthError('ppSignupError', 'Mot de passe trop court.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }
  try {
    await signUp(email, password, name);
    showToast('Compte créé. Vérifiez votre email, puis connectez-vous.');
    switchProfTab('signin');
  } catch (error) {
    showAuthError('ppSignupError', translateAuthError(error));
    showToast(translateAuthError(error));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer mon compte'; }
  }
}

async function doLogoutProfile() {
  await signOut().catch(() => null);
  clearUser();
  closeProfile();
  syncWithGlobalState();
  showToast('Déconnecté.');
}

function switchProfTab(tab) {
  byId('profTabSign')?.classList.toggle('active', tab === 'signin');
  byId('profTabReg')?.classList.toggle('active', tab === 'signup');
  byId('profSignin')?.style.setProperty('display', tab === 'signin' ? 'flex' : 'none');
  byId('profSignup')?.style.setProperty('display', tab === 'signup' ? 'flex' : 'none');
}

function switchModalTab(tab) {
  byId('authTabSignin')?.classList.toggle('active', tab === 'signin');
  byId('authTabSignup')?.classList.toggle('active', tab === 'signup');
  byId('modalSigninForm')?.style.setProperty('display', tab === 'signin' ? 'flex' : 'none');
  byId('modalSignupForm')?.style.setProperty('display', tab === 'signup' ? 'flex' : 'none');
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

// ---- Share ----
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

// ---- Size Guide ----
function openSizeGuide() { byId('ppSizeSheet')?.classList.add('open'); }
function closeSizeGuide() { byId('ppSizeSheet')?.classList.remove('open'); }

// ---- Toast ----
function showToast(message) {
  const toast = byId('ppToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ---- Bottom Nav ----
function setActiveBottomNav() {
  document.querySelectorAll('.bottom-nav-btn').forEach((button) => button.classList.remove('active'));
  byId(openedFrom === 'home' ? 'bnHome' : 'bnExplore')?.classList.add('active');
}

// ---- Bootstrap ----
async function boot() {
  // Load theme
  const savedTheme = localStorage.getItem('moodly-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Load product
  await loadInitialProduct();
  setActiveBottomNav();
  renderProduct();

  // Ready state
  document.body.classList.add('pp-ready');
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    window.dispatchEvent(new Event('resize'));
  });

  // Init interactions
  initSwipe();
  initScroll();
  initGalleryHint();

  // Sync with global state
  syncWithGlobalState();

  // Remember this product
  rememberProductView(product);

  // Close size sheet on overlay click
  byId('ppSizeSheet')?.addEventListener('click', (event) => {
    if (event.target === byId('ppSizeSheet')) closeSizeGuide();
  });

  // Subscribe to state changes
  stateUnsubscribe = subscribe((prev, next) => {
    updateBadges(next);
    if (product) {
      const wished = next.wishlistItems.some(item =>
          String(item.id) === String(product.id)
      );
      if (wished !== isWished) {
        updateWishUI(wished);
      }
    }
  });
}

// ---- Expose globals for inline handlers ----
// ---- Expose globals for inline handlers ----
function exposeGlobals() {
  Object.assign(window, {
    // Navigation
    goToHome,
    goToShop,
    goBackToStore,
    goToWishlist,
    goToCart,
    goToProfile,

    // Drawer controls
    openCart,
    closeCart,
    openWishlist,
    closeWishlist,
    openProfile,
    closeProfile,
    openAuthModal,
    closeAuthModal,
    switchModalTab,
    switchProfTab,

    // Auth
    doLoginProfile,
    doSignupProfile,
    doLogoutProfile,

    // Product interactions
    changeQty,
    selectColor,
    selectSize,
    addToCart,
    toggleWish,

    // Utility
    openSizeGuide,
    closeSizeGuide,
    shareProduct,
    showToast,
    openRelatedProduct,
  });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  exposeGlobals();
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