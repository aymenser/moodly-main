// ==============================================
// main.js — Entry point & orchestration
// Moodly · Supabase auth + Spring Boot backend integration
//
// This file keeps the existing index.html UI, then connects the visible
// auth, product, wishlist, cart, checkout, order, and review actions to
// the working backend logic from login.html and order-interface.html.
// ==============================================

import {
  addOrderItem,
  addWishlistItem,
  checkoutOrder,
  deleteOrderItem,
  fetchAllReviews,
  fetchBaladiyas,
  fetchCartForUser,
  fetchCategories,
  fetchProducts,
  fetchUserOrders,
  fetchUserWishlist,
  fetchWilayas,
  updateOrderStatus,
  createAddress,
  setProfileAddress,
  updateAddress,
  updateAuthEmail,
  updateProfile,
  getCurrentProfile,
  normalizeCartItems,
  normalizeWishlistItems,
  removeWishlistItem,
  restoreSessionProfile,
  signIn,
  signOut,
  signUp,
  submitProductReview,
  validatePromoCode,
} from './api.js';
import * as UI from './ui.js';
import { ADMIN_APP_URL, ENABLE_SECTION_SNAP, HERO_SLIDES, NEWSLETTER_RECEIVER_EMAIL, STORY_IMAGE } from './site-config.js';

let allProducts = [];
let currentUser = null;
let currentProfile = null;
let currentCartOrder = null;
let currentOrders = [];
let isLoggedIn = false;
let appliedPromo = null;

// ==============================================
// Small helpers
// ==============================================

const STAY_ON_STOREFRONT_KEY = 'moodly-stay-on-storefront';

function shouldStayOnStorefront() {
  return sessionStorage.getItem(STAY_ON_STOREFRONT_KEY) === '1';
}

function enableStayOnStorefront() {
  sessionStorage.setItem(STAY_ON_STOREFRONT_KEY, '1');
}

function disableStayOnStorefront() {
  sessionStorage.removeItem(STAY_ON_STOREFRONT_KEY);
}

function clearSupabaseBrowserStorage() {
  // Supabase keeps sessions in browser storage per origin.
  // We clear local tokens too, so admin logout cannot bounce 5500 back to 3000.
  for (const storage of [localStorage, sessionStorage]) {
    Object.keys(storage).forEach((key) => {
      const isSupabaseAuthKey =
        key.includes('supabase.auth.token') ||
        (key.startsWith('sb-') && key.endsWith('-auth-token')) ||
        key.includes('auth-token');

      if (isSupabaseAuthKey) storage.removeItem(key);
    });
  }
}

function isAdminProfile(profile) {
  return String(profile?.role || '').toLowerCase() === 'admin';
}

function redirectToAdminApp(session = null) {
  const url = new URL(ADMIN_APP_URL);

  if (session?.access_token && session?.refresh_token) {
    const hashParams = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });

    url.hash = hashParams.toString();
  }

  window.location.href = url.toString();
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getProduct(productId) {
  return allProducts.find((product) => String(product.id) === String(productId));
}

function findProductFromOrderItem(item = {}) {
  const variant = item.productVariant || item.variant || {};
  const productId = variant.product?.id || variant.productId || variant.product_id || item.product?.id || item.productId || item.product_id;
  return variant.product || item.product || getProduct(productId) || { id: productId, name: 'Produit' };
}

function getOrderItems(order = {}) {
  return order.orderItems || order.items || order.order_items || [];
}

function getOrderTotal(order = {}) {
  const directTotal = Number(order.totalPrice ?? order.total_price ?? order.total ?? 0);
  if (Number.isFinite(directTotal) && directTotal > 0) return directTotal;

  return getOrderItems(order).reduce((sum, item) => {
    const price = Number(item.priceAtPurchase ?? item.price_at_purchase ?? item.productVariant?.product?.price ?? 0);
    const qty = Number(item.quantity || 1);
    return sum + price * qty;
  }, 0);
}

function getProductImageUrl(product = {}) {
  if (product.imageUrl) return product.imageUrl;

  const sources = [
    product.images,
    product.productImages,
    product.product_images,
    product.raw?.images,
    product.raw?.productImages,
    product.raw?.product_images,
  ];

  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    const found = source.find((item) => item?.imageUrl || item?.image_url || item?.url);
    if (found) return found.imageUrl || found.image_url || found.url;
  }

  return '';
}

function productPreviewHtml(product = {}, extraClass = '') {
  const shaped = product.variants ? product : getProduct(product.id) || product;
  const imageUrl = getProductImageUrl(shaped);
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(shaped.name || 'Produit')}" loading="lazy" decoding="async">`
    : '';
  return `<div class="mini-product-preview ${escapeHtml(extraClass)} ${escapeHtml(shaped.grad || 'grad-default')}" onclick="window.__openProductFromList('${escapeHtml(shaped.id || '')}')">${image}</div>`;
}

function showGlobalLoader(message = 'Chargement...') {
  let overlay = document.getElementById('globalLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'globalLoadingOverlay';
    overlay.className = 'global-loading-overlay';
    overlay.innerHTML = `
      <div class="global-loading-card">
        <div class="global-loading-spinner"></div>
        <p id="globalLoadingMessage">Chargement...</p>
        <small>Si cela prend trop de temps, vérifiez votre connexion.</small>
      </div>`;
    document.body.appendChild(overlay);
  }

  const text = overlay.querySelector('#globalLoadingMessage');
  if (text) text.textContent = message;
  overlay.classList.add('show');
}

function hideGlobalLoader() {
  document.getElementById('globalLoadingOverlay')?.classList.remove('show');
}

function latestViewedKey() {
  return `moodly-latest-viewed-${currentProfile?.id || 'guest'}`;
}

function readLatestViewed() {
  try { return JSON.parse(localStorage.getItem(latestViewedKey()) || '[]'); }
  catch { return []; }
}

function writeLatestViewed(items) {
  localStorage.setItem(latestViewedKey(), JSON.stringify(items.slice(0, 12)));
}

function rememberViewedProduct(product) {
  if (!product?.id) return;
  const entry = {
    id: product.id,
    name: product.name || 'Produit',
    price: Number(product.price || 0),
    imageUrl: getProductImageUrl(product) || null,
    grad: product.grad || 'grad-default',
    viewedAt: new Date().toISOString(),
  };
  const next = [entry, ...readLatestViewed().filter((item) => String(item.id) !== String(entry.id))];
  writeLatestViewed(next);
}

function stockAlertKey() {
  return `moodly-stock-alerts-${currentProfile?.id || 'guest'}`;
}

function readStockAlerts() {
  try { return JSON.parse(localStorage.getItem(stockAlertKey()) || '[]'); }
  catch { return []; }
}

function writeStockAlerts(items) {
  localStorage.setItem(stockAlertKey(), JSON.stringify(items));
}

function hasStockAlert(productId) {
  return readStockAlerts().some((item) => String(item.productId) === String(productId));
}

function getResolvedStockAlerts() {
  return readStockAlerts()
    .map((alert) => {
      const product = getProduct(alert.productId);
      if (!product || Number(product.totalStock || 0) <= 0) return null;
      return { ...alert, product };
    })
    .filter(Boolean);
}

function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadgeNav');
  if (!badge) return;

  if (!isLoggedIn || !currentProfile?.id) {
    badge.textContent = '';
    badge.classList.remove('show');
    return;
  }

  const cache = readNotificationStatusCache();
  const changedOrders = (currentOrders || []).filter((order) => {
    const status = String(order.status || '').toLowerCase();
    if (!status || status === 'pending') return false;
    return (cache[order.id] && cache[order.id] !== order.status) || status === 'delivered';
  }).length;
  const count = changedOrders + getResolvedStockAlerts().length;

  badge.textContent = count > 0 ? String(count) : '';
  badge.classList.toggle('show', count > 0);
}


function requireLogin() {
  if (isLoggedIn && currentProfile?.id) return true;
  UI.openAuthModal();
  UI.showToast('Connectez-vous pour continuer.');
  return false;
}

function getFirstAvailableVariant(product) {
  return product?.variants?.find((variant) => Number(variant.stockQuantity || 0) > 0) || null;
}

function getSelectedModalVariant(product) {
  const selectedSize = document.querySelector('.modal-size-btn.active')?.dataset.size || document.querySelector('.modal-size-btn.active')?.textContent?.trim();
  const selectedColor = document.querySelector('.modal-color.selected')?.dataset.color || document.querySelector('.modal-color.selected')?.getAttribute('title')?.trim();

  return product?.variants?.find((variant) => (
    String(variant.size || 'Default') === String(selectedSize || 'Default') &&
    String(variant.color || 'Default') === String(selectedColor || 'Default')
  )) || null;
}

function updateAuthUi() {
  const authSection = document.getElementById('connexion');
  if (authSection) authSection.style.display = isLoggedIn ? 'none' : '';

  document.querySelectorAll('[data-auth-link], .nav-links a, .mobile-menu a').forEach((link) => {
    if (link.textContent.trim().toLowerCase() !== 'connexion' && link.dataset.authLink !== 'true') return;
    link.dataset.authLink = 'true';
    link.textContent = isLoggedIn ? 'Mon compte' : 'Connexion';
    link.onclick = (event) => {
      event.preventDefault();
      if (isLoggedIn) window.openProfile();
      else window.openAuthModal();
      window.closeMobileMenu?.();
    };
  });
}

function renderAllProductViews() {
  UI.renderHomeProducts(allProducts, window.__activeHomeCategoryId || null);
  UI.renderShopProducts(allProducts);
}

function getExistingWishlistItem(productId) {
  return UI.wishlistItems.find((item) => String(item.id) === String(productId));
}

function setLoggedOutState() {
  currentUser = null;
  currentProfile = null;
  currentCartOrder = null;
  currentOrders = [];
  isLoggedIn = false;
  appliedPromo = null;
  UI.setCartItems([]);
  UI.setWishlistItems([]);
  UI.setAppliedPromo(null);
  updateAuthUi();
  updateNotificationBadge();
}

// ==============================================
// Data sync
// ==============================================
async function syncCustomerState({ refreshOrders = true } = {}) {
  if (!isLoggedIn || !currentProfile?.id) {
    UI.setCartItems([]);
    UI.setWishlistItems([]);
    return;
  }

  const [wishlistRows, cartOrder, orders] = await Promise.all([
    fetchUserWishlist(currentProfile.id),
    fetchCartForUser(currentProfile.id),
    refreshOrders ? fetchUserOrders(currentProfile.id) : Promise.resolve(currentOrders),
  ]);

  currentCartOrder = cartOrder;
  currentOrders = orders || [];
  currentProfile.orderCount = currentOrders.filter((order) => (order.status || '').toLowerCase() !== 'pending').length;

  UI.setWishlistItems(normalizeWishlistItems(wishlistRows, allProducts));
  UI.setCartItems(normalizeCartItems(currentCartOrder, allProducts));
  updateNotificationBadge();

  requestAnimationFrame(() => {
    if (typeof window.__syncMobileWishButtons === 'function') window.__syncMobileWishButtons();
  });
}

async function refreshCartOnly() {
  if (!currentProfile?.id) return;
  currentCartOrder = await fetchCartForUser(currentProfile.id);
  UI.setCartItems(normalizeCartItems(currentCartOrder, allProducts));
}

async function refreshWishlistOnly() {
  if (!currentProfile?.id) return;
  const wishlistRows = await fetchUserWishlist(currentProfile.id);
  UI.setWishlistItems(normalizeWishlistItems(wishlistRows, allProducts));
  requestAnimationFrame(() => {
    if (typeof window.__syncMobileWishButtons === 'function') window.__syncMobileWishButtons();
  });
}

async function loadCategories() {
  UI.showCategorySkeletons();
  try {
    const categories = await fetchCategories();
    UI.renderCategories(categories);
  } catch (err) {
    console.error('Categories error:', err);
    document.getElementById('categoryScroll').innerHTML =
      '<p style="color:var(--text-muted);font-size:0.85rem;">Impossible de charger les catégories.</p>';
  }
}

async function loadProducts(categoryId = null) {
  UI.showProductSkeletons();
  try {
    allProducts = await fetchProducts(categoryId);
    window.__allProducts = allProducts;
    renderAllProductViews();

    const countEl = document.getElementById('resultsCount');
    if (countEl) countEl.textContent = `${allProducts.length} articles`;

    if (typeof window.patchAllCardsMobile === 'function') {
      window.patchAllCardsMobile(allProducts, () => allProducts);
    }

    if (isLoggedIn) await syncCustomerState({ refreshOrders: false });
  } catch (err) {
    console.error('Products error:', err);
    document.getElementById('homeProductGrid').innerHTML =
      `<p style="color:var(--text-muted);padding:20px;">Impossible de charger les produits: ${escapeHtml(err.message)}</p>`;
  }
}

async function restoreSession() {
  try {
    const restored = await restoreSessionProfile();
    if (!restored) {
      setLoggedOutState();
      return;
    }

    currentUser = restored.user;
    currentProfile = restored.profile;
    isLoggedIn = true;
    updateAuthUi();

    if (isAdminProfile(currentProfile) && !shouldStayOnStorefront()) {
      redirectToAdminApp(restored.session);
      return;
    }
  } catch (err) {
    console.warn('Session restore failed:', err.message);
    setLoggedOutState();
  }
}

// ==============================================
// Auth helpers
// ==============================================
function getActiveAuthForm(type) {
  const formIds = type === 'signin'
    ? {
        modal: 'modalSigninForm',
        profile: 'profSignin',
        home: 'homeSigninForm',
      }
    : {
        modal: 'modalSignupForm',
        profile: 'profSignup',
        home: 'homeSignupForm',
      };

  const authModal = document.getElementById('authModal');
  const profileDrawer = document.getElementById('profileDrawer');
  const homePage = document.getElementById('homePage');
  const homeAuthSection = document.getElementById('connexion');

  // Hidden drawers keep layout boxes in some browsers, so offsetParent is not enough.
  // Priority must follow the UI the user actually opened.
  if (authModal?.classList.contains('open')) {
    return document.getElementById(formIds.modal);
  }

  if (profileDrawer?.classList.contains('open')) {
    return document.getElementById(formIds.profile);
  }

  if (homePage?.style.display !== 'none' && homeAuthSection && isElementInViewport(homeAuthSection)) {
    return document.getElementById(formIds.home);
  }

  return document.getElementById(formIds.home) || document.getElementById(formIds.modal) || document.getElementById(formIds.profile);
}

function isElementInViewport(element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function showAuthError(formElement, message) {
  if (!formElement) {
    UI.showToast(message);
    return;
  }

  formElement.querySelector('.auth-error-msg')?.remove();
  const error = document.createElement('div');
  error.className = 'auth-error-msg';
  error.innerHTML = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;flex-shrink:0;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${escapeHtml(message)}</span>`;
  formElement.appendChild(error);
  setTimeout(() => error.remove(), 5000);
}

function clearAuthError(formElement) {
  formElement?.querySelector('.auth-error-msg')?.remove();
}

function setAuthLoading(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.style.opacity = loading ? '0.65' : '1';
  button.dataset.origText = button.dataset.origText || button.textContent;
  button.textContent = loading ? 'Chargement…' : button.dataset.origText;
}

function translateAuthError(err) {
  const message = (err?.message || '').toLowerCase();
  if (message.includes('profile not found')) return 'Profil backend introuvable. Créez le profil côté Spring Boot ou contactez le support.';
  if (message.includes('invalid login') || message.includes('invalid credentials')) return 'Email ou mot de passe incorrect.';
  if (message.includes('email not confirmed')) return 'Votre email n\'est pas encore confirmé. Vérifiez votre boîte mail.';
  if (message.includes('already registered') || message.includes('already exists')) return 'Un compte existe déjà avec cet email.';
  if (message.includes('password') && message.includes('least')) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (message.includes('rate limit') || message.includes('too many')) return 'Trop de tentatives. Attendez quelques minutes.';
  if (message.includes('network') || message.includes('fetch') || message.includes('failed')) return 'Erreur réseau. Vérifiez Spring Boot, Supabase et votre connexion.';
  if (message.includes('invalid email')) return 'Adresse email invalide.';
  return err?.message || 'Une erreur inattendue est survenue.';
}

window.__doLogin = async () => {
  const formElement = getActiveAuthForm('signin');
  const emailInput = formElement?.querySelector('input[type="email"]');
  const passwordInput = formElement?.querySelector('input[type="password"]');
  const submitButton = formElement?.querySelector('.auth-submit');
  const email = emailInput?.value?.trim();
  const password = passwordInput?.value;

  clearAuthError(formElement);

  if (!email) {
    showAuthError(formElement, 'Veuillez saisir votre adresse email.');
    emailInput?.focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAuthError(formElement, 'Adresse email invalide.');
    emailInput?.focus();
    return;
  }
  if (!password) {
    showAuthError(formElement, 'Veuillez saisir votre mot de passe.');
    passwordInput?.focus();
    return;
  }

  setAuthLoading(submitButton, true);
  try {
    const result = await signIn(email, password);
    currentUser = result.user;
    currentProfile = result.profile;
    isLoggedIn = true;
    updateAuthUi();

    if (isAdminProfile(currentProfile)) {
      disableStayOnStorefront();
      redirectToAdminApp(result.session);
      return;
    }

    await syncCustomerState();
    UI.closeAuthModal();
    if (document.getElementById('profileDrawer')?.classList.contains('open')) {
      UI.renderProfile(isLoggedIn, currentProfile);
    }
    UI.showToast(`Bienvenue, ${currentProfile.fullName || currentProfile.name || currentProfile.email} !`);
  } catch (err) {
    console.error('Login error:', err);
    showAuthError(formElement, translateAuthError(err));
  } finally {
    setAuthLoading(submitButton, false);
  }
};

window.__doSignup = async () => {
  const formElement = getActiveAuthForm('signup');
  const nameInput = formElement?.querySelector('input[type="text"]');
  const emailInput = formElement?.querySelector('input[type="email"]');
  const passwordInput = formElement?.querySelector('input[type="password"]');
  const submitButton = formElement?.querySelector('.auth-submit');
  const name = nameInput?.value?.trim();
  const email = emailInput?.value?.trim();
  const password = passwordInput?.value;

  clearAuthError(formElement);

  if (!name) {
    showAuthError(formElement, 'Veuillez saisir votre prénom.');
    nameInput?.focus();
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAuthError(formElement, 'Adresse email invalide.');
    emailInput?.focus();
    return;
  }
  if (!password || password.length < 6) {
    showAuthError(formElement, 'Le mot de passe doit contenir au moins 6 caractères.');
    passwordInput?.focus();
    return;
  }

  setAuthLoading(submitButton, true);
  try {
    await signUp(email, password, name);
    clearAuthError(formElement);
    UI.showToast('Compte créé. Vérifiez votre email, puis connectez-vous.');
    UI.switchModalTab?.('signin');
  } catch (err) {
    console.error('Signup error:', err);
    showAuthError(formElement, translateAuthError(err));
  } finally {
    setAuthLoading(submitButton, false);
  }
};

window.__doLogout = async () => {
  try {
    await signOut();
    setLoggedOutState();
    UI.renderProfile(false, null);
    UI.showToast('Vous êtes déconnecté.');
  } catch (err) {
    console.error('Logout error:', err);
    UI.showToast('Erreur lors de la déconnexion.');
  }
};

// ==============================================
// Product, wishlist, cart, checkout actions
// ==============================================
window.__openModal = (productId) => {
  const product = getProduct(productId);
  if (!product) return;
  rememberViewedProduct(product);

  if (typeof window.openProductPage === 'function') {
    window.openProductPage(product, allProducts);
    return;
  }

  UI.openModal(productId, allProducts);
};

window.__addToCart = async (productId, quantity = 1, forcedVariant = null) => {
  if (!requireLogin()) return false;

  const product = getProduct(productId);
  const variant = forcedVariant || getFirstAvailableVariant(product);
  const requestedQty = Number(quantity || 1);

  if (!product) {
    UI.showToast('Produit introuvable.');
    return false;
  }

  if (!variant) {
    UI.showToast('Produit en rupture de stock.');
    window.__alertMeStock(productId);
    return false;
  }

  if (Number(variant.stockQuantity || 0) < requestedQty) {
    UI.showToast(`Stock insuffisant. Disponible: ${Number(variant.stockQuantity || 0)}.`);
    return false;
  }

  showGlobalLoader('Ajout au panier...');
  try {
    if (!currentCartOrder?.id) currentCartOrder = await fetchCartForUser(currentProfile.id);
    await addOrderItem(currentCartOrder.id, variant.id, requestedQty, product.price);

    variant.stockQuantity = Math.max(0, Number(variant.stockQuantity || 0) - requestedQty);
    product.totalStock = Math.max(0, Number(product.totalStock || 0) - requestedQty);
    if (product.totalStock === 0) product.badge = 'out';
    else if (product.totalStock <= 5) product.badge = 'low';

    await refreshCartOnly();
    UI.renderHomeProducts(allProducts, window.__activeHomeCategoryId || null);
    UI.renderShopProducts(allProducts);
    UI.showToast(`"${product.name}" ajouté au panier.`);
    return true;
  } catch (err) {
    console.error('Add cart error:', err);
    UI.showToast(`Ajout impossible: ${err.message}`);
    return false;
  } finally {
    hideGlobalLoader();
  }
};

window.__removeFromCart = async (orderItemId) => {
  if (!requireLogin()) return;
  showGlobalLoader('Suppression...');
  try {
    await deleteOrderItem(orderItemId);
    await refreshCartOnly();
    UI.showToast('Article retiré du panier.');
  } catch (err) {
    console.error('Remove cart error:', err);
    UI.showToast(`Suppression impossible: ${err.message}`);
  } finally {
    hideGlobalLoader();
  }
};

window.__toggleWish = async (productId) => {
  if (!requireLogin()) return;

  showGlobalLoader('Mise à jour des favoris...');
  try {
    const existing = getExistingWishlistItem(productId);
    if (existing?.wishlistId) {
      await removeWishlistItem(existing.wishlistId);
      UI.showToast('Retiré des favoris.');
    } else {
      await addWishlistItem(productId, currentProfile.id);
      UI.showToast('Ajouté aux favoris.');
    }

    await refreshWishlistOnly();
    UI.renderHomeProducts(allProducts, window.__activeHomeCategoryId || null);
    UI.renderShopProducts(allProducts);
  } catch (err) {
    console.error('Wishlist error:', err);
    UI.showToast(`Favoris impossible: ${err.message}`);
  } finally {
    hideGlobalLoader();
  }
};

window.__removeFromWish = async (productId) => {
  if (!requireLogin()) return;
  const existing = getExistingWishlistItem(productId);
  if (!existing?.wishlistId) return;

  showGlobalLoader('Suppression...');
  try {
    await removeWishlistItem(existing.wishlistId);
    await refreshWishlistOnly();
    UI.showToast('Retiré des favoris.');
  } catch (err) {
    console.error('Remove wishlist error:', err);
    UI.showToast(`Suppression impossible: ${err.message}`);
  } finally {
    hideGlobalLoader();
  }
};

window.addToCartFromModal = async () => {
  if (!UI.currentProduct) return;
  const variant = getSelectedModalVariant(UI.currentProduct);
  const added = await window.__addToCart(UI.currentProduct.id, UI.currentQty, variant);
  if (!added) return;
  UI.closeModal();
  UI.openCart();
};

window.toggleModalWish = async () => {
  if (!UI.currentProduct) return;
  await window.__toggleWish(UI.currentProduct.id);
  const inWish = UI.wishlistItems.some((item) => String(item.id) === String(UI.currentProduct.id));
  const button = document.getElementById('modalWishBtn');
  if (!button) return;

  button.className = `modal-add-wish${inWish ? ' wished' : ''}`;
  button.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:${inWish ? 'currentColor' : 'none'};stroke-width:2;stroke-linecap:round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ${inWish ? 'Retirer des favoris' : 'Ajouter aux favoris'}`;
};

window.__applyPromoCode = async (codeFromInput = null) => {
  if (!requireLogin()) return;

  const code = (codeFromInput || document.querySelector('.promo-input')?.value || '').trim().toUpperCase();
  if (!code) {
    UI.showToast('Saisissez un code promo.');
    return;
  }

  try {
    appliedPromo = await validatePromoCode(code);
    UI.setAppliedPromo(appliedPromo);
    UI.showToast(`Code appliqué: -${appliedPromo.discountPercent}%`);
  } catch (err) {
    appliedPromo = null;
    UI.setAppliedPromo(null);
    UI.showToast('Code promo invalide ou expiré.');
  }
};

async function openCheckoutDialog() {
  const wilayas = await fetchWilayas();

  let modal = document.getElementById('backendCheckoutModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'backendCheckoutModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:none;align-items:center;justify-content:center;padding:20px;';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="width:min(460px,100%);background:var(--card-bg,#fff);color:var(--text,#111);border-radius:18px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.25);">
      <h2 style="font-family:var(--serif);margin:0 0 6px;">Adresse de livraison</h2>
      <p style="margin:0 0 18px;color:var(--text-muted,#777);font-size:.9rem;">Complétez l'adresse pour confirmer la commande.</p>
      <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:6px;">Rue / adresse</label>
      <input id="checkoutStreet" class="form-input" type="text" placeholder="Adresse complète" style="width:100%;margin-bottom:12px;">
      <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:6px;">Wilaya</label>
      <select id="checkoutWilaya" class="form-input" style="width:100%;margin-bottom:12px;">
        <option value="">Choisir une wilaya</option>
        ${wilayas.map((wilaya) => `<option value="${wilaya.id}">${escapeHtml(wilaya.name)}</option>`).join('')}
      </select>
      <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:6px;">Baladiya</label>
      <select id="checkoutBaladiya" class="form-input" style="width:100%;margin-bottom:18px;">
        <option value="">Choisir la wilaya d'abord</option>
      </select>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="checkoutCancel" class="continue-shop-btn" type="button">Annuler</button>
        <button id="checkoutSubmit" class="checkout-btn" type="button" style="width:auto;padding-inline:22px;">Confirmer</button>
      </div>
    </div>`;

  modal.style.display = 'flex';

  return new Promise((resolve) => {
    const close = (value) => {
      modal.style.display = 'none';
      resolve(value);
    };

    modal.querySelector('#checkoutCancel').onclick = () => close(null);
    modal.querySelector('#checkoutWilaya').onchange = async (event) => {
      const baladiyaSelect = modal.querySelector('#checkoutBaladiya');
      baladiyaSelect.innerHTML = '<option value="">Chargement...</option>';
      const baladiyas = await fetchBaladiyas(event.target.value).catch(() => []);
      baladiyaSelect.innerHTML = '<option value="">Choisir une baladiya</option>' +
        baladiyas.map((baladiya) => `<option value="${baladiya.id}">${escapeHtml(baladiya.name)}</option>`).join('');
    };
    modal.querySelector('#checkoutSubmit').onclick = () => {
      const street = modal.querySelector('#checkoutStreet').value.trim();
      const wilayaId = modal.querySelector('#checkoutWilaya').value;
      const baladiyaId = modal.querySelector('#checkoutBaladiya').value;
      if (!street || !wilayaId || !baladiyaId) {
        UI.showToast('Complétez toute l\'adresse.');
        return;
      }
      close({ street, wilayaId, baladiyaId });
    };
  });
}

window.__checkout = async () => {
  if (!requireLogin()) return;
  if (!currentCartOrder?.orderItems?.length && UI.cartItems.length === 0) {
    UI.showToast('Votre panier est vide.');
    return;
  }

  try {
    const address = await openCheckoutDialog();
    if (!address) return;

    showGlobalLoader('Confirmation de la commande...');
    await checkoutOrder(currentCartOrder.id, {
      ...address,
      promoId: appliedPromo?.id || null,
    });

    appliedPromo = null;
    UI.setAppliedPromo(null);
    const promoInput = document.querySelector('.promo-input');
    if (promoInput) promoInput.value = '';
    UI.closeCart();
    await syncCustomerState();
    UI.showToast('Commande confirmée avec succès.');
  } catch (err) {
    console.error('Checkout error:', err);
    UI.showToast(`Commande impossible: ${err.message}`);
  } finally {
    hideGlobalLoader();
  }
};

// ==============================================
// Order history + reviews
// ==============================================
function ensureOrderHistoryModal() {
  let modal = document.getElementById('backendOrderHistoryModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'backendOrderHistoryModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:none;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="width:min(860px,100%);max-height:82vh;overflow:hidden;background:var(--card-bg,#fff);color:var(--text,#111);border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 24px;border-bottom:1px solid var(--border,#eee);">
        <h2 style="font-family:var(--serif);margin:0;">Mes commandes</h2>
        <button id="closeOrderHistoryModal" class="drawer-close" type="button"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div id="backendOrderHistoryBody" style="overflow:auto;padding:20px 24px;"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#closeOrderHistoryModal').onclick = () => { modal.style.display = 'none'; };
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.style.display = 'none';
  });
  return modal;
}


function getOrderProgress(status) {
  const normalized = String(status || '').toLowerCase();
  const map = { pending: 0, confirmed: 1, paid: 1, shipped: 2, delivered: 3, cancelled: 0 };
  return map[normalized] ?? 0;
}

function orderProgressHtml(order) {
  const status = String(order.status || '').toLowerCase();
  const activeIndex = getOrderProgress(status);
  const steps = [
    { key: 'confirmed', label: 'Confirmée', icon: '✓' },
    { key: 'paid', label: 'Préparée', icon: '↗' },
    { key: 'shipped', label: 'Expédiée', icon: '▣' },
    { key: 'delivered', label: 'Livrée', icon: '⌂' },
  ];

  return `
    <div class="order-progress ${status === 'cancelled' ? 'is-cancelled' : ''}">
      <div class="order-progress-line"><span style="width:${status === 'cancelled' ? 0 : (activeIndex / (steps.length - 1)) * 100}%"></span></div>
      ${steps.map((step, index) => `
        <div class="order-step ${index <= activeIndex && status !== 'cancelled' ? 'done' : ''}">
          <span class="order-step-dot">${index <= activeIndex && status !== 'cancelled' ? '✓' : ''}</span>
          <span class="order-step-icon">${step.icon}</span>
          <strong>${step.label}</strong>
        </div>
      `).join('')}
    </div>`;
}

function renderOrderHistory(orders) {
  const body = document.getElementById('backendOrderHistoryBody');
  const pastOrders = orders
    .filter((order) => (order.status || '').toLowerCase() !== 'pending')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (!pastOrders.length) {
    body.innerHTML = '<p style="color:var(--text-muted,#777);text-align:center;padding:30px 0;">Aucune commande pour le moment.</p>';
    return;
  }

  body.innerHTML = pastOrders.map((order) => {
    const normalizedStatus = String(order.status || '').toLowerCase();
    const delivered = normalizedStatus === 'delivered';
    const confirmed = normalizedStatus === 'confirmed';
    const items = getOrderItems(order).map((item) => {
      const variant = item.productVariant || {};
      const product = findProductFromOrderItem(item);
      const productId = product.id || variant.productId || variant.product_id;
      const productName = product.name || 'Produit';
      const reviewButton = delivered && productId
          ? `<button class="order-item-review" style="background:#000;color:#fff !important;" onclick="event.stopPropagation();window.__openReviewModal('${escapeHtml(productId)}', '${escapeHtml(productName)}')">Faire un avis</button>`
          : '';

      return `<li class="order-product-row" onclick="window.__openProductFromList('${escapeHtml(productId)}')">
        ${productPreviewHtml(product, 'order-product-thumb')}
        <div class="order-product-main">
          <b>${Number(item.quantity || 1)}× ${escapeHtml(productName)}</b>
          <span>${escapeHtml(variant.size || '')}${variant.color ? ` / ${escapeHtml(variant.color)}` : ''}</span>
        </div>
        ${reviewButton}
      </li>`;
    }).join('');

    const cancelButton = confirmed
      ? `<button class="order-cancel-btn" onclick="window.__cancelOrder('${escapeHtml(order.id)}')">Annuler la commande</button>`
      : '';

    return `
      <article class="order-history-card">
        <div class="order-card-head">
          <div>
            <h3>Commande #${escapeHtml(String(order.id || '').slice(0, 8))}</h3>
            <p>Total: <b>${Number(getOrderTotal(order)).toLocaleString('fr-DZ')} DA</b>${order.promoCode?.code ? ` · Promo: <b>${escapeHtml(order.promoCode.code)}</b>` : ''}</p>
          </div>
          <span class="order-status-chip status-${escapeHtml(normalizedStatus)}">${escapeHtml(getOrderStatusLabel(order.status))}</span>
        </div>
        ${orderProgressHtml(order)}
        <ul class="order-products-list">${items}</ul>
        <div class="order-card-actions">${cancelButton}</div>
      </article>`;
  }).join('');
}

window.__openOrderHistory = async () => {
  if (!requireLogin()) return;

  const modal = ensureOrderHistoryModal();
  const body = modal.querySelector('#backendOrderHistoryBody');
  modal.style.display = 'flex';
  body.innerHTML = '<p style="color:var(--text-muted,#777);text-align:center;padding:30px 0;">Chargement...</p>';

  try {
    currentOrders = await fetchUserOrders(currentProfile.id);
    currentProfile.orderCount = currentOrders.filter((order) => (order.status || '').toLowerCase() !== 'pending').length;
    renderOrderHistory(currentOrders);
  } catch (err) {
    body.innerHTML = `<p style="color:#ef4444;">Impossible de charger les commandes: ${escapeHtml(err.message)}</p>`;
  }
};

window.__cancelOrder = async (orderId) => {
  if (!requireLogin()) return;
  const order = currentOrders.find((item) => String(item.id) === String(orderId));
  if (String(order?.status || '').toLowerCase() !== 'confirmed') {
    UI.showToast('Seules les commandes confirmées peuvent être annulées.');
    return;
  }

  if (!confirm('Annuler cette commande ?')) return;

  showGlobalLoader('Annulation de la commande...');
  try {
    await updateOrderStatus(orderId, 'cancelled');
    currentOrders = await fetchUserOrders(currentProfile.id);
    renderOrderHistory(currentOrders);
    UI.showToast('Commande annulée.');
  } catch (error) {
    UI.showToast(error.message || 'Annulation impossible.');
  } finally {
    hideGlobalLoader();
  }
};

window.__openProductFromList = (productId) => {
  if (!productId) return;
  const modal = document.getElementById('backendOrderHistoryModal');
  if (modal) modal.style.display = 'none';
  UI.closeCart();
  UI.closeWishlist();
  UI.closeProfile();

  const product = getProduct(productId);
  if (product && window.innerWidth <= 768) {
    const openedFrom = document.getElementById('homePage')?.style.display !== 'none' ? 'home' : 'shop';
    sessionStorage.setItem('moodly-product', JSON.stringify(product));
    sessionStorage.setItem('moodly-products', JSON.stringify(allProducts));
    sessionStorage.setItem('moodly-opened-from', openedFrom);
    window.location.href = `product.html?p=${encodeURIComponent(product.id)}`;
    return;
  }

  window.__openModal(productId);
};


function ensureReviewModal() {
  let modal = document.getElementById('backendReviewModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'backendReviewModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:6000;display:none;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="width:min(430px,100%);background:var(--card-bg,#fff);color:var(--text,#111);border-radius:18px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.25);">
      <h2 style="font-family:var(--serif);margin:0 0 6px;">Laisser un avis</h2>
      <p id="reviewProductName" style="margin:0 0 18px;color:var(--text-muted,#777);"></p>
      <select id="reviewRating" class="form-input" style="width:100%;margin-bottom:12px;">
        <option value="5">5 / 5</option>
        <option value="4">4 / 5</option>
        <option value="3">3 / 5</option>
        <option value="2">2 / 5</option>
        <option value="1">1 / 5</option>
      </select>
      <textarea id="reviewComment" class="form-input" rows="4" placeholder="Votre avis" style="width:100%;resize:vertical;margin-bottom:18px;"></textarea>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="reviewCancel" class="continue-shop-btn" type="button">Annuler</button>
        <button id="reviewSubmit" class="checkout-btn" type="button" style="width:auto;padding-inline:22px;">Envoyer</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#reviewCancel').onclick = () => { modal.style.display = 'none'; };
  return modal;
}

window.__openReviewModal = async (productId, productName) => {
  if (!requireLogin()) return;

  const modal = ensureReviewModal();
  const reviews = await fetchAllReviews(true).catch(() => []);
  const existing = reviews.find((review) => {
    const reviewProductId = review.product?.id || review.productId || review.product_id;
    const reviewProfileId = review.profile?.id || review.user?.id || review.profileId || review.userId;
    return String(reviewProductId) === String(productId) && String(reviewProfileId) === String(currentProfile.id);
  });

  modal.dataset.productId = productId;
  modal.dataset.reviewId = existing?.id || '';
  modal.querySelector('#reviewProductName').textContent = productName;
  modal.querySelector('#reviewRating').value = String(existing?.rating || 5);
  modal.querySelector('#reviewComment').value = existing?.comment || '';
  modal.style.display = 'flex';

  modal.querySelector('#reviewSubmit').onclick = async () => {
    try {
      await submitProductReview({
        reviewId: modal.dataset.reviewId || null,
        productId: modal.dataset.productId,
        rating: modal.querySelector('#reviewRating').value,
        comment: modal.querySelector('#reviewComment').value,
      });
      modal.style.display = 'none';
      await loadProducts();
      UI.showToast('Avis enregistré.');
    } catch (err) {
      UI.showToast(`Avis impossible: ${err.message}`);
    }
  };
};


// ==============================================
// Homepage media, newsletter, profile info, notifications
// ==============================================
let heroSlideIndex = 0;
let heroSlideTimer = null;

function initSectionSnap() {
  document.documentElement.classList.toggle('moodly-snap', Boolean(ENABLE_SECTION_SNAP));
}

function setActiveNav(section) {
  const next = section || 'home';
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === next);
  });
}

function initActiveNavTracking() {
  const sections = [
    ['home', document.querySelector('.hero')],
    ['nouveautes', document.getElementById('nouveautes')],
    ['histoire', document.getElementById('histoire')],
  ].filter(([, element]) => Boolean(element));

  const observer = new IntersectionObserver((entries) => {
    if (document.getElementById('shopPage')?.style.display !== 'none') return;
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    const found = sections.find(([, element]) => element === visible?.target);
    if (found) setActiveNav(found[0]);
  }, { threshold: [0.35, 0.55, 0.75] });

  sections.forEach(([, element]) => observer.observe(element));
}

function initHeroSlideshow() {
  const container = document.getElementById('heroSlideshow');
  const copy = document.getElementById('heroSlideCopy');
  const dots = document.getElementById('heroSlideDots');
  if (!container || !copy || !dots || !HERO_SLIDES.length) return;

  container.innerHTML = HERO_SLIDES.map((slide, index) => `
    <figure class="hero-slide${index === 0 ? ' active' : ''}" aria-hidden="${index === 0 ? 'false' : 'true'}">
      <img src="${escapeHtml(slide.image)}" alt="${escapeHtml(slide.title || 'Moodly slide')}" loading="${index === 0 ? 'eager' : 'lazy'}" decoding="async">
    </figure>
  `).join('');

  dots.innerHTML = HERO_SLIDES.map((_, index) => `
    <button class="hero-slide-dot${index === 0 ? ' active' : ''}" type="button" aria-label="Slide ${index + 1}" onclick="window.__goToHeroSlide(${index})"></button>
  `).join('');

  renderHeroSlide(0);
  clearInterval(heroSlideTimer);
  heroSlideTimer = setInterval(() => renderHeroSlide(heroSlideIndex + 1), 5200);
}

function renderHeroSlide(index) {
  const slides = [...document.querySelectorAll('.hero-slide')];
  const dots = [...document.querySelectorAll('.hero-slide-dot')];
  const copy = document.getElementById('heroSlideCopy');
  if (!slides.length || !copy) return;

  heroSlideIndex = ((index % slides.length) + slides.length) % slides.length;
  const slide = HERO_SLIDES[heroSlideIndex];

  slides.forEach((element, i) => {
    element.classList.toggle('active', i === heroSlideIndex);
    element.setAttribute('aria-hidden', i === heroSlideIndex ? 'false' : 'true');
  });
  dots.forEach((dot, i) => dot.classList.toggle('active', i === heroSlideIndex));

  copy.innerHTML = `
    <span>${escapeHtml(slide.eyebrow || 'Moodly')}</span>
    <strong>${escapeHtml(slide.title || '')}</strong>
    <small>${escapeHtml(slide.caption || '')}</small>
  `;
}

function initStoryVisual() {
  const target = document.getElementById('storyVisual');
  if (!target || !STORY_IMAGE?.image) return;

  target.innerHTML = `
    <img src="${escapeHtml(STORY_IMAGE.image)}" alt="${escapeHtml(STORY_IMAGE.title || 'Notre histoire Moodly')}" loading="lazy" decoding="async">
    <div class="story-visual-caption">
      <span>${escapeHtml(STORY_IMAGE.eyebrow || 'Notre histoire')}</span>
      <strong>${escapeHtml(STORY_IMAGE.title || 'Moodly')}</strong>
    </div>
  `;
}

function initHomeMedia() {
  initHeroSlideshow();
  initStoryVisual();
}

window.__goToHeroSlide = (index) => {
  renderHeroSlide(index);
  clearInterval(heroSlideTimer);
  heroSlideTimer = setInterval(() => renderHeroSlide(heroSlideIndex + 1), 5200);
};

window.__scrollToSection = (sectionId) => {
  UI.showHome();
  setActiveNav(sectionId === 'nouveautes' ? 'nouveautes' : sectionId === 'histoire' ? 'histoire' : 'home');
  setTimeout(() => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
};

window.__subscribeNewsletter = () => {
  const input = document.getElementById('newsletterEmail');
  const email = input?.value?.trim().toLowerCase() || '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    UI.showToast('Saisissez une adresse email valide.');
    input?.focus();
    return;
  }

  const saved = JSON.parse(localStorage.getItem('moodly-newsletter') || '[]');
  if (!saved.includes(email)) saved.push(email);
  localStorage.setItem('moodly-newsletter', JSON.stringify(saved));
  input.value = '';

  if (NEWSLETTER_RECEIVER_EMAIL) {
    const subject = encodeURIComponent('Nouvelle inscription newsletter Moodly');
    const body = encodeURIComponent(`Email: ${email}\nSource: ${window.location.href}`);
    window.location.href = `mailto:${NEWSLETTER_RECEIVER_EMAIL}?subject=${subject}&body=${body}`;
  }

  UI.showToast('Merci ! Votre email est enregistré.');
};

function getProfileAddress(profile = currentProfile) {
  return profile?.address || profile?.defaultAddress || profile?.shippingAddress || null;
}

async function loadBaladiyaOptions(selectEl, wilayaId, selectedBaladiyaId = null) {
  if (!selectEl) return;
  if (!wilayaId) {
    selectEl.innerHTML = '<option value="">Choisir une wilaya d\'abord</option>';
    return;
  }

  selectEl.innerHTML = '<option value="">Chargement...</option>';
  const baladiyas = await fetchBaladiyas(wilayaId).catch(() => []);
  selectEl.innerHTML = '<option value="">Choisir une baladiya</option>' +
    baladiyas.map((baladiya) => `<option value="${baladiya.id}"${String(baladiya.id) === String(selectedBaladiyaId || '') ? ' selected' : ''}>${escapeHtml(baladiya.name)}</option>`).join('');
}

window.__profileInfoLoadBaladiyas = async () => {
  const wilayaSelect = document.getElementById('profileWilaya');
  const baladiyaSelect = document.getElementById('profileBaladiya');
  await loadBaladiyaOptions(baladiyaSelect, wilayaSelect?.value, null);
};

window.__openProfileInfoEditor = async () => {
  if (!requireLogin()) return;
  const target = document.getElementById('profileContent');
  if (!target) return;

  target.innerHTML = '<div class="profile-panel"><p class="profile-muted">Chargement de vos informations...</p></div>';

  const address = getProfileAddress();
  const wilayas = await fetchWilayas().catch(() => []);
  const currentWilayaId = address?.wilaya?.id || address?.wilayaId || address?.wilaya_id || '';
  const currentBaladiyaId = address?.baladiya?.id || address?.baladiyaId || address?.baladiya_id || '';

  target.innerHTML = `
    <div class="profile-panel profile-edit-panel">
      <button class="profile-back-link" type="button" onclick="window.openProfile()">← Retour au profil</button>
      <h3>Mes informations</h3>
      <p class="profile-muted">Mettez à jour vos informations de contact et votre adresse par défaut.</p>

      <div class="profile-form-grid">
        <label>Nom complet
          <input id="profileFullName" class="form-input" type="text" value="${escapeHtml(currentProfile.fullName || currentProfile.name || '')}" placeholder="Votre nom complet">
        </label>
        <label>Email
          <input id="profileEmail" class="form-input" type="email" value="${escapeHtml(currentProfile.email || currentProfile.authUser?.email || '')}" placeholder="email@example.com">
        </label>
        <label>Téléphone
          <input id="profilePhone" class="form-input" type="tel" value="${escapeHtml(currentProfile.phoneNumber || '')}" placeholder="0550 00 00 00">
        </label>
        <label>Adresse
          <input id="profileStreet" class="form-input" type="text" value="${escapeHtml(address?.street || '')}" placeholder="Rue, quartier, bâtiment...">
        </label>
        <label>Wilaya
          <select id="profileWilaya" class="form-input" onchange="window.__profileInfoLoadBaladiyas()">
            <option value="">Choisir une wilaya</option>
            ${wilayas.map((wilaya) => `<option value="${wilaya.id}"${String(wilaya.id) === String(currentWilayaId) ? ' selected' : ''}>${escapeHtml(wilaya.name)}</option>`).join('')}
          </select>
        </label>
        <label>Baladiya
          <select id="profileBaladiya" class="form-input"><option value="">Choisir une wilaya d'abord</option></select>
        </label>
      </div>

      <div class="profile-inline-actions">
        <button class="auth-submit" id="profileSaveBtn" onclick="window.__saveProfileInfo()">Enregistrer</button>
        <button class="continue-shop-btn" onclick="window.openProfile()">Annuler</button>
      </div>
      <p class="profile-muted small">Si vous changez l'email, Supabase peut demander une confirmation selon la configuration du projet.</p>
    </div>
  `;

  await loadBaladiyaOptions(document.getElementById('profileBaladiya'), currentWilayaId, currentBaladiyaId);
};

window.__saveProfileInfo = async () => {
  if (!requireLogin()) return;

  const saveBtn = document.getElementById('profileSaveBtn');
  const fullName = document.getElementById('profileFullName')?.value?.trim() || '';
  const email = document.getElementById('profileEmail')?.value?.trim().toLowerCase() || '';
  const phoneNumber = document.getElementById('profilePhone')?.value?.trim() || '';
  const street = document.getElementById('profileStreet')?.value?.trim() || '';
  const wilayaId = document.getElementById('profileWilaya')?.value || '';
  const baladiyaId = document.getElementById('profileBaladiya')?.value || '';

  if (!fullName) {
    UI.showToast('Le nom complet est obligatoire.');
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    UI.showToast('Email invalide.');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Enregistrement...';

  try {
    let nextAddress = getProfileAddress();

    if (street || wilayaId || baladiyaId) {
      if (!street || !wilayaId || !baladiyaId) {
        throw new Error('Complétez toute l\'adresse ou laissez-la vide.');
      }

      const payload = { street, wilayaId, baladiyaId };
      nextAddress = nextAddress?.id
        ? await updateAddress(nextAddress.id, payload)
        : await createAddress(payload);

      if (!getProfileAddress()?.id && nextAddress?.id) {
        currentProfile = await setProfileAddress(currentProfile.id, nextAddress.id);
      }
    }

    if (email && email !== (currentProfile.authUser?.email || currentProfile.email)) {
      await updateAuthEmail(email);
    }

    const profilePayload = {
      ...currentProfile,
      fullName,
      email: email || currentProfile.email,
      phoneNumber,
      address: nextAddress || getProfileAddress(),
    };

    const updatedProfile = await updateProfile(currentProfile.id, profilePayload);
    currentProfile = {
      ...updatedProfile,
      token: currentProfile.token,
      authUser: currentProfile.authUser,
      orderCount: currentProfile.orderCount || 0,
    };

    UI.renderProfile(true, currentProfile);
    UI.showToast('Informations mises à jour.');
  } catch (error) {
    console.error('Profile update error:', error);
    UI.showToast(error.message || 'Mise à jour impossible.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Enregistrer';
    }
  }
};

function getOrderStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  const labels = {
    pending: 'En attente',
    confirmed: 'Confirmée',
    paid: 'Payée',
    shipped: 'Expédiée',
    delivered: 'Livrée',
    cancelled: 'Annulée',
  };
  return labels[normalized] || status || 'Mise à jour';
}


window.__alertMeStock = (productId) => {
  if (!requireLogin()) return;
  const product = getProduct(productId) || UI.currentProduct;
  if (!product?.id) {
    UI.showToast('Produit introuvable.');
    return;
  }

  if (Number(product.totalStock || 0) > 0) {
    UI.showToast('Ce produit est déjà disponible.');
    return;
  }

  const alerts = readStockAlerts();
  if (!alerts.some((item) => String(item.productId) === String(product.id))) {
    alerts.unshift({
      productId: product.id,
      name: product.name || 'Produit',
      createdAt: new Date().toISOString(),
    });
    writeStockAlerts(alerts);
  }

  UI.showToast('Vous serez notifié quand ce produit revient en stock.');
  updateNotificationBadge();
};

window.__openLatestViewedPanel = () => {
  if (!requireLogin()) return;
  const target = document.getElementById('profileContent');
  const latest = readLatestViewed();
  target.innerHTML = `
    <div class="profile-panel latest-viewed-panel">
      <button class="profile-back-link" type="button" onclick="window.openProfile()">← Retour au profil</button>
      <h3>Derniers produits vus</h3>
      <p class="profile-muted">Retrouvez rapidement les produits que vous avez consultés.</p>
      <div class="latest-viewed-grid">
        ${latest.length ? latest.map((item) => `
          <button class="latest-viewed-card" type="button" onclick="window.__openProductFromList('${escapeHtml(item.id)}')">
            ${productPreviewHtml(item, 'latest-viewed-thumb')}
            <span>${escapeHtml(item.name)}</span>
            <strong>${Number(item.price || 0).toLocaleString('fr-DZ')} DA</strong>
          </button>
        `).join('') : '<p class="profile-muted empty-state">Aucun produit vu pour le moment.</p>'}
      </div>
    </div>`;
};

function notificationCacheKey() {
  return `moodly-order-status-cache-${currentProfile?.id || 'guest'}`;
}

function readNotificationStatusCache() {
  try { return JSON.parse(localStorage.getItem(notificationCacheKey()) || '{}'); }
  catch { return {}; }
}

function writeNotificationStatusCache(orders) {
  const cache = {};
  orders.forEach((order) => { cache[order.id] = order.status; });
  localStorage.setItem(notificationCacheKey(), JSON.stringify(cache));
}

window.__openNotificationsPanel = async () => {
  if (!requireLogin()) return;
  const target = document.getElementById('profileContent');
  if (!target) return;

  target.innerHTML = '<div class="profile-panel"><p class="profile-muted">Chargement des notifications...</p></div>';

  try {
    currentOrders = await fetchUserOrders(currentProfile.id);
    const cache = readNotificationStatusCache();
    const resolvedStockAlerts = getResolvedStockAlerts();
    const orders = currentOrders
      .filter((order) => String(order.status || '').toLowerCase() !== 'pending')
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    target.innerHTML = `
      <div class="profile-panel notifications-panel">
        <button class="profile-back-link" type="button" onclick="window.openProfile()">← Retour au profil</button>
        <h3>Notifications</h3>
        <p class="profile-muted">Suivez les commandes, les avis et les retours en stock.</p>
        <div class="notifications-list">
          ${resolvedStockAlerts.map((alert) => `
            <article class="notification-card is-new" onclick="window.__openProductFromList('${escapeHtml(alert.product.id)}')">
              <div>
                <span class="notification-pill">Stock</span>
                <h4>${escapeHtml(alert.product.name)}</h4>
                <p>Bonne nouvelle, ce produit est de retour en stock.</p>
              </div>
              <small>Disponible</small>
            </article>
          `).join('')}
          ${orders.length ? orders.map((order) => {
            const cachedStatus = cache[order.id];
            const isNew = cachedStatus && cachedStatus !== order.status;
            const normalizedStatus = String(order.status || '').toLowerCase();
            const statusLabel = getOrderStatusLabel(order.status);
            const reviewHint = normalizedStatus === 'delivered'
              ? `<button class="notification-review-btn" type="button" onclick="event.stopPropagation();window.__closeProfile();window.__openOrderHistory()">Faire un avis</button>`
              : '';
            return `
              <article class="notification-card${isNew || normalizedStatus === 'delivered' ? ' is-new' : ''}" onclick="window.__closeProfile();window.__openOrderHistory()">
                <div>
                  <span class="notification-pill">${isNew ? 'Nouveau' : 'Commande'}</span>
                  <h4>Commande #${escapeHtml(String(order.id || '').slice(0, 8))}</h4>
                  <p>Votre commande est maintenant <strong>${escapeHtml(statusLabel)}</strong>.</p>
                  ${reviewHint}
                </div>
                <small>${order.createdAt ? new Date(order.createdAt).toLocaleDateString('fr-DZ') : ''}</small>
              </article>
            `;
          }).join('') : (!resolvedStockAlerts.length ? '<p class="profile-muted empty-state">Aucune notification pour le moment.</p>' : '')}
        </div>
        <button class="continue-shop-btn" type="button" onclick="window.__markNotificationsRead()">Marquer comme lu</button>
      </div>
    `;
  } catch (error) {
    target.innerHTML = `<div class="profile-panel"><button class="profile-back-link" onclick="window.openProfile()">← Retour</button><p class="profile-muted">Impossible de charger les notifications.</p></div>`;
  }
};

window.__markNotificationsRead = () => {
  writeNotificationStatusCache(currentOrders || []);
  UI.showToast('Notifications marquées comme lues.');
  updateNotificationBadge();
  window.__openNotificationsPanel();
};

function handleInitialRouteAfterProducts() {
  if (window.location.hash === '#shop' || sessionStorage.getItem('moodly-from-product') === 'true') {
    sessionStorage.removeItem('moodly-from-product');
    UI.showShop();
    UI.renderShopProducts(allProducts);
    setActiveNav('shop');
    return;
  }

  setActiveNav('home');
}

// ==============================================
// Global bridges used by index.html inline handlers
// ==============================================
window.showHome = () => { UI.showHome(); setActiveNav('home'); };
window.showShop = async () => {
  setActiveNav('shop');
  if (!allProducts.length) await loadProducts();
  UI.showShop();
  UI.renderShopProducts(allProducts);
};
window.openCart = () => {
  if (!requireLogin()) return;
  UI.openCart();
  refreshCartOnly().catch((err) => {
    console.error('Cart refresh error:', err);
    UI.showToast('Impossible de charger le panier.');
  });
};
window.closeCart = () => UI.closeCart();
window.openWishlist = () => {
  if (!requireLogin()) return;
  UI.openWishlist();
  refreshWishlistOnly().catch((err) => {
    console.error('Wishlist refresh error:', err);
    UI.showToast('Impossible de charger les favoris.');
  });
};
window.closeWishlist = () => UI.closeWishlist();
window.openProfile = () => {
  UI.openProfile(isLoggedIn, currentProfile || currentUser);
  if (isLoggedIn) {
    syncCustomerState().then(() => {
      if (document.getElementById('profileDrawer')?.classList.contains('open')) {
        UI.renderProfile(true, currentProfile || currentUser);
      }
    }).catch((err) => console.error('Profile sync error:', err));
  }
};

window.openNotifications = async () => {
  if (!requireLogin()) return;
  UI.openProfile(true, currentProfile || currentUser);
  try {
    await syncCustomerState();
  } catch (err) {
    console.error('Notification sync error:', err);
  }
  window.__openNotificationsPanel?.();
};
window.closeProfile = () => UI.closeProfile();
window.openAuthModal = () => UI.openAuthModal();
window.closeAuthModal = () => UI.closeAuthModal();
window.closeModal = () => UI.closeModal();
window.changeQty = (delta) => UI.changeQty(delta);
window.__modalVariantChanged = () => UI.updateModalStockState();
window.showToast = (message) => UI.showToast(message);
window.switchModalTab = (tab) => UI.switchModalTab(tab);
window.switchAuthTab = (button, tab) => UI.switchAuthTab(button, tab);
window.filterProducts = () => UI.renderShopProducts(allProducts);
window.openMobileFilter = () => UI.openMobileFilter();
window.closeMobileFilter = () => UI.closeMobileFilter();
window.setBottomNav = (element) => UI.setBottomNav(element);
window.applySidebarFilter = () => UI.renderShopProducts(allProducts);
window.__applySidebarFilter = window.applySidebarFilter;
window.__toggleColorFilter = (element) => UI.toggleColorFilter(element);
window.__resetColorFilters = () => UI.resetColorFilters(allProducts);
window.__handleCategoryFilterChange = (input) => UI.handleCategoryFilterChange(input);
window.__closeProfile = () => UI.closeProfile();
window.__openWishlist = () => window.openWishlist();
window.__switchProfTab = (tab) => UI.switchProfTab(tab);
window.__UIModule = UI;
window.closeMobileMenu = () => {
  document.getElementById('mobileMenu')?.classList.remove('open');
  document.getElementById('overlay')?.classList.remove('show');
  document.body.style.overflow = '';
};
window.__filterByCategory = (categoryId, element) => {
  document.querySelectorAll('.cat-card').forEach((card) => card.classList.remove('active'));
  element?.classList.add('active');
  window.__activeHomeCategoryId = categoryId || null;
  UI.renderHomeProducts(allProducts, window.__activeHomeCategoryId);
};
window.setActiveNav = setActiveNav;

// ==============================================
// Bootstrap
// ==============================================
function bindStaticEvents() {
  window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 50);
    document.getElementById('scrollTop')?.classList.toggle('show', window.scrollY > 400);
  });

  document.getElementById('themeToggle')?.addEventListener('click', UI.toggleTheme);

  document.getElementById('hamburger')?.addEventListener('click', () => {
    document.getElementById('mobileMenu')?.classList.add('open');
    document.getElementById('overlay')?.classList.add('show');
    document.body.style.overflow = 'hidden';
  });

  document.getElementById('overlay')?.addEventListener('click', () => {
    window.closeMobileMenu();
    UI.closeCart();
    UI.closeWishlist();
    UI.closeProfile();
    UI.closeAuthModal();
    UI.closeMobileFilter();
  });

  document.getElementById('productModal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) UI.closeModal();
  });

  document.getElementById('authModal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) UI.closeAuthModal();
  });

  const promoButton = document.querySelector('.promo-apply');
  if (promoButton) {
    promoButton.onclick = (event) => {
      event.preventDefault();
      window.__applyPromoCode(document.querySelector('.promo-input')?.value || '');
    };
  }

  const checkoutButton = document.querySelector('#cartDrawer .checkout-btn');
  if (checkoutButton) {
    checkoutButton.onclick = (event) => {
      event.preventDefault();
      window.__checkout();
    };
  }
}

async function handleStorefrontLogoutRequest() {
  const params = new URLSearchParams(window.location.search);
  const shouldLogoutStorefront = params.get('logoutStorefront') === '1';

  if (!shouldLogoutStorefront) return false;

  enableStayOnStorefront();

  try {
    await signOut();
  } catch (error) {
    console.warn('Storefront logout cleanup failed:', error);
  }

  clearSupabaseBrowserStorage();
  setLoggedOutState();

  params.delete('logoutStorefront');

  const query = params.toString();
  const cleanUrl = `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;

  window.history.replaceState({}, document.title, cleanUrl);

  return true;
}

window.addEventListener('pageshow', () => {
  if (!allProducts.length) return;
  if (sessionStorage.getItem('moodly-from-product') === 'true' || window.location.hash === '#shop') {
    sessionStorage.removeItem('moodly-from-product');
    UI.showShop();
    UI.renderShopProducts(allProducts);
    setActiveNav('shop');
  }
});

async function init() {
  UI.initTheme();
  UI.initScrollReveal();
  initSectionSnap();
  bindStaticEvents();

  const didForceStorefrontLogout = await handleStorefrontLogoutRequest();

  if (!didForceStorefrontLogout) {
    await restoreSession();
  } else {
    updateAuthUi();
  }

  await Promise.all([loadCategories(), loadProducts()]);
  initHomeMedia();
  initActiveNavTracking();
  handleInitialRouteAfterProducts();

  if (isLoggedIn) {
    await syncCustomerState();
  } else {
    UI.updateCartBadge();
    UI.updateWishBadge();
  }
}

init().catch((err) => {
  console.error('App init error:', err);
  UI.showToast('Erreur de démarrage de l\'application.');
});
