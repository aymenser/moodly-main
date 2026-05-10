// ==============================================
// api.js — Supabase auth + Spring Boot API layer
// Moodly · Integrated storefront
//
// Purpose:
// - Keep Supabase only for authentication.
// - Use the Spring Boot backend for profiles, products, wishlist, cart,
//   checkout, orders, reviews, wilayas, and promo codes.
// - Keep DOM manipulation out of this file so main.js/ui.js stay clean.
// ==============================================

import { sbClient } from './config.js';
import { API_BASE } from './site-config.js';

let currentProfile = null;
let currentAccessToken = null;
let reviewsCache = null;

// ---- Shared HTTP helper ----
export async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': '69420',
    ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 204) return null;

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`API ${response.status}: ${message || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  return response.json();
}

function setAuthContext(profile, accessToken) {
  currentProfile = profile || null;
  currentAccessToken = accessToken || null;
}

export function getCurrentProfile() {
  return currentProfile;
}

export function getAccessToken() {
  return currentAccessToken;
}

export async function getSession() {
  const { data } = await sbClient.auth.getSession();
  return data.session;
}

export async function fetchProfileByEmail(email) {
  if (!email) throw new Error('Missing email.');
  return apiFetch(`/profiles/email/${encodeURIComponent(email)}`);
}

export async function restoreSessionProfile() {
  const session = await getSession();
  if (!session?.user?.email) {
    setAuthContext(null, null);
    return null;
  }

  const profile = await fetchProfileByEmail(session.user.email);
  const enrichedProfile = {
    ...profile,
    email: profile.email || session.user.email,
    token: session.access_token,
    authUser: session.user,
  };

  setAuthContext(enrichedProfile, session.access_token);
  return { session, profile: enrichedProfile, user: session.user };
}

// ---- Auth ----
export async function signIn(email, password) {
  const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const profile = await fetchProfileByEmail(email);
  const enrichedProfile = {
    ...profile,
    email: profile.email || email,
    token: data.session?.access_token,
    authUser: data.user,
  };

  setAuthContext(enrichedProfile, data.session?.access_token);
  return { user: data.user, session: data.session, profile: enrichedProfile };
}

export async function signUp(email, password, name) {
  // Mirrors login.html: account is created in Supabase auth first.
  // The Spring Boot profile must exist/be created by the backend flow used in your project.
  const { data, error } = await sbClient.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const { error } = await sbClient.auth.signOut();
  if (error) throw error;
  setAuthContext(null, null);
}

export async function updateAuthEmail(email) {
  if (!email) throw new Error('Missing email.');
  const { data, error } = await sbClient.auth.updateUser({ email });
  if (error) throw error;
  return data;
}

export async function createAddress({ street, wilayaId, baladiyaId }) {
  return apiFetch('/addresses', {
    method: 'POST',
    body: JSON.stringify({
      street: street || '',
      wilayaId: wilayaId ? Number(wilayaId) : null,
      baladiyaId: baladiyaId ? Number(baladiyaId) : null,
    }),
  });
}

export async function updateAddress(addressId, { street, wilayaId, baladiyaId }) {
  if (!addressId) throw new Error('Missing address id.');
  return apiFetch(`/addresses/${addressId}`, {
    method: 'PUT',
    body: JSON.stringify({
      street: street || '',
      wilayaId: wilayaId ? Number(wilayaId) : null,
      baladiyaId: baladiyaId ? Number(baladiyaId) : null,
    }),
  });
}

export async function setProfileAddress(profileId, addressId) {
  if (!profileId || !addressId) throw new Error('Missing profile or address id.');
  return apiFetch(`/profiles/${profileId}/address/${addressId}`, { method: 'PUT' });
}

export async function updateProfile(profileId, profileDetails) {
  if (!profileId) throw new Error('Missing profile id.');
  return apiFetch(`/profiles/${profileId}`, {
    method: 'PUT',
    body: JSON.stringify(profileDetails),
  });
}

// ---- Product shaping helpers ----
function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeVariant(variant = {}) {
  return {
    id: variant.id,
    size: variant.size || 'Default',
    color: variant.color || 'Default',
    stockQuantity: normalizeNumber(variant.stockQuantity ?? variant.stock_quantity, 0),
    productId: variant.product?.id || variant.productId || variant.product_id,
  };
}

function getProductSizes(variants) {
  const seen = new Set();
  return variants
    .filter((variant) => {
      if (!variant.size || seen.has(variant.size)) return false;
      seen.add(variant.size);
      return true;
    })
    .map((variant) => variant.size);
}

function getProductColors(variants) {
  const seen = new Set();
  return variants.filter((variant) => {
    if (!variant.color || seen.has(variant.color)) return false;
    seen.add(variant.color);
    return true;
  });
}

const colorHexMap = {
  noir: '#1a1a1a',
  black: '#1a1a1a',
  blanc: '#f0ece8',
  white: '#f0ece8',
  rose: '#e8909e',
  pink: '#e8909e',
  bleu: '#7aa8c8',
  blue: '#7aa8c8',
  camel: '#d4a07a',
  marron: '#b07845',
  brown: '#b07845',
  kaki: '#8aab88',
  vert: '#5a7a58',
  green: '#5a7a58',
  beige: '#e8d8c0',
  crème: '#e8d8c0',
  creme: '#e8d8c0',
  bordeaux: '#a05070',
  rouge: '#ef4444',
  red: '#ef4444',
  gris: '#9a9a9a',
  grey: '#9a9a9a',
  gray: '#9a9a9a',
};

export function colorToHex(colorName) {
  if (!colorName) return '#ccc';
  const lower = String(colorName).toLowerCase();
  for (const [key, value] of Object.entries(colorHexMap)) {
    if (lower.includes(key)) return value;
  }
  return '#ccc';
}

export function getColorGrad(colorName) {
  if (!colorName) return 'grad-default';
  const color = String(colorName).toLowerCase();
  if (color.includes('noir') || color.includes('black')) return 'grad-noir';
  if (color.includes('blanc') || color.includes('white')) return 'grad-blanc';
  if (color.includes('rose') || color.includes('pink')) return 'grad-rose';
  if (color.includes('bleu') || color.includes('blue')) return 'grad-bleu';
  if (color.includes('camel') || color.includes('marron') || color.includes('brown')) return 'grad-camel';
  if (color.includes('vert') || color.includes('kaki') || color.includes('green')) return 'grad-vert';
  if (color.includes('beige') || color.includes('crème') || color.includes('creme')) return 'grad-beige';
  if (color.includes('borde') || color.includes('rouge') || color.includes('red')) return 'grad-bordeaux';
  return 'grad-default';
}

export function getProductGrad(variants) {
  return variants?.length ? getColorGrad(variants[0].color) : 'grad-default';
}

function normalizeImageUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return '';

  // Accept full remote URLs, local assets, root-relative files, and data/blob URLs.
  // Reject short backend/public-id fragments like "Vjn" because the browser treats them as /Vjn and returns 404.
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

function getReviewProductId(review = {}) {
  return review.product?.id || review.productId || review.product_id;
}
function normalizeReview(review = {}) {
  return {
    id: review.id,
    rating: normalizeNumber(review.rating, 0),
    comment: review.comment || review.content || review.message || '',
    createdAt: review.createdAt || review.created_at || null,
    author: review.profile?.fullName || review.profile?.name || review.user?.fullName || review.user?.name || 'Cliente Moodly',
    productId: getReviewProductId(review),
    raw: review,
  };
}


function getImageProductId(image = {}) {
  return image.product?.id || image.productId || image.product_id;
}

function getVariantProductId(variant = {}) {
  return variant.product?.id || variant.productId || variant.product_id;
}

function groupByProductId(rows, getProductId) {
  return rows.reduce((groups, row) => {
    const productId = getProductId(row);
    if (!productId) return groups;
    const key = String(productId);
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
    return groups;
  }, {});
}

export function shapeProduct(product, images = [], variants = [], reviews = []) {
  const normalizedVariants = variants.map(normalizeVariant);
  const normalizedImages = images.map(normalizeImage).filter((image) => image.imageUrl);
  const normalizedReviews = reviews.map(normalizeReview);
  const colorVariants = getProductColors(normalizedVariants);
  const sizes = getProductSizes(normalizedVariants);
  const totalStock = normalizedVariants.reduce((sum, variant) => sum + variant.stockQuantity, 0);
  const avgRating = normalizedReviews.length
    ? normalizedReviews.reduce((sum, review) => sum + normalizeNumber(review.rating, 0), 0) / normalizedReviews.length
    : 4.5;

  let badge = null;
  if (totalStock === 0) badge = 'out';
  else if (totalStock <= 5) badge = 'low';

  return {
    id: product.id,
    name: product.name || 'Product',
    description: product.description || '',
    price: normalizeNumber(product.price, 0),
    categoryId: product.category?.id || product.categoryId || product.category_id || null,
    category: product.category?.name || product.categoryName || product.category_name || '',
    grad: getProductGrad(normalizedVariants),
    variants: normalizedVariants,
    sizes: sizes.length ? sizes : ['Default'],
    colorVariants,
    colors: colorVariants.length ? colorVariants.map((variant) => colorToHex(variant.color)) : ['#ccc'],
    colorNames: colorVariants.length ? colorVariants.map((variant) => variant.color || 'Default') : ['Default'],
    rating: Number(avgRating.toFixed(1)),
    reviews: normalizedReviews.length,
    reviewsList: normalizedReviews,
    badge,
    imageUrl: normalizedImages[0]?.imageUrl || null,
    images: normalizedImages,
    raw: product,
    totalStock,
  };
}

// ---- Products / categories / reviews ----
export async function fetchCategories() {
  return apiFetch('/categories');
}

export async function fetchAllReviews(force = false) {
  if (reviewsCache && !force) return reviewsCache;
  reviewsCache = await apiFetch('/reviews').catch(() => []);
  return reviewsCache;
}

export async function fetchProducts(categoryId = null) {
  const [products, reviews, images, variants] = await Promise.all([
    apiFetch('/products'),
    fetchAllReviews(),
    apiFetch('/product-images').catch(() => []),
    apiFetch('/product-variants').catch(() => []),
  ]);

  const reviewsByProduct = groupByProductId(reviews, getReviewProductId);
  const imagesByProduct = groupByProductId(images, getImageProductId);
  const variantsByProduct = groupByProductId(variants, getVariantProductId);

  const activeProducts = products.filter((product) => product.isActive ?? product.is_active ?? true);
  const filteredProducts = categoryId
    ? activeProducts.filter((product) => String(product.category?.id || product.categoryId || product.category_id) === String(categoryId))
    : activeProducts;

  // Four total requests instead of 2 requests per product. This is the biggest frontend lag reduction.
  return filteredProducts.map((product) => {
    const productId = String(product.id);
    return shapeProduct(
      product,
      imagesByProduct[productId] || [],
      variantsByProduct[productId] || [],
      reviewsByProduct[productId] || [],
    );
  });
}

// ---- Wishlist ----
export async function fetchUserWishlist(profileId = currentProfile?.id) {
  if (!profileId) return [];
  return apiFetch(`/wishlists/profile/${profileId}`).catch(() => []);
}

export async function addWishlistItem(productId, profileId = currentProfile?.id) {
  if (!profileId) throw new Error('You must be signed in to update wishlist.');
  return apiFetch('/wishlists', {
    method: 'POST',
    body: JSON.stringify({ profileId, productId }),
  });
}

export async function removeWishlistItem(wishlistId) {
  if (!wishlistId) throw new Error('Missing wishlist item id.');
  return apiFetch(`/wishlists/${wishlistId}`, { method: 'DELETE' });
}

export function normalizeWishlistItems(wishlistRows, allProducts) {
  return wishlistRows
    .map((item) => {
      const productId = item.product?.id || item.productId || item.product_id;
      const product = allProducts.find((candidate) => String(candidate.id) === String(productId)) || item.product;
      if (!product) return null;

      const shaped = product.variants
        ? product
        : shapeProduct(product, product.productImages || product.product_images || [], product.productVariants || product.product_variants || [], []);

      return {
        ...shaped,
        wishlistId: item.id,
      };
    })
    .filter(Boolean);
}

// ---- Cart / order ----
export async function fetchCartForUser(profileId = currentProfile?.id) {
  if (!profileId) return null;
  return apiFetch(`/orders/cart/user/${profileId}`).catch(() => null);
}

export function normalizeCartItems(order, allProducts) {
  const items = order?.orderItems || [];
  return items.map((item) => {
    const variant = item.productVariant || {};
    const productId = variant.product?.id || variant.productId || variant.product_id;
    const product = variant.product || allProducts.find((candidate) => String(candidate.id) === String(productId)) || {};
    const price = normalizeNumber(item.priceAtPurchase ?? item.price_at_purchase ?? product.price, 0);
    const quantity = normalizeNumber(item.quantity, 1);

    return {
      id: product.id || productId || item.id,
      cartItemId: item.id,
      variantId: variant.id,
      name: product.name || 'Product',
      imageUrl: allProducts.find((candidate) => String(candidate.id) === String(product.id || productId))?.imageUrl || null,
      grad: allProducts.find((candidate) => String(candidate.id) === String(product.id || productId))?.grad || 'grad-default',
      price,
      qty: quantity,
      _selectedSize: variant.size || 'Default',
      _selectedColor: variant.color || 'Default',
      raw: item,
    };
  });
}

export async function addOrderItem(orderId, variantId, quantity, priceAtPurchase) {
  if (!orderId) throw new Error('Cart is not ready yet.');
  if (!variantId) throw new Error('No valid product variant was found.');

  return apiFetch(`/order-items/order/${orderId}`, {
    method: 'POST',
    body: JSON.stringify({
      variantId,
      quantity,
      priceAtPurchase,
    }),
  });
}

export async function deleteOrderItem(orderItemId) {
  if (!orderItemId) throw new Error('Missing cart item id.');
  return apiFetch(`/order-items/${orderItemId}`, { method: 'DELETE' });
}

export async function validatePromoCode(code) {
  if (!code) throw new Error('Missing promo code.');
  return apiFetch(`/promo-codes/validate/${encodeURIComponent(code.toUpperCase())}`);
}

export async function fetchWilayas() {
  return apiFetch('/wilayas');
}

export async function fetchBaladiyas(wilayaId) {
  if (!wilayaId) return [];
  return apiFetch(`/baladiyas/by-wilaya/${wilayaId}`);
}

export async function checkoutOrder(orderId, { street, wilayaId, baladiyaId, promoId = null }) {
  if (!orderId) throw new Error('Cart is not ready yet.');
  if (!street || !wilayaId || !baladiyaId) throw new Error('Please complete the shipping address.');

  const address = await apiFetch('/addresses', {
    method: 'POST',
    body: JSON.stringify({
      street,
      wilayaId: Number(wilayaId),
      baladiyaId: Number(baladiyaId),
    }),
  });

  await apiFetch(`/orders/${orderId}/address?addressId=${address.id}`, { method: 'PUT' });

  if (promoId) {
    await apiFetch(`/orders/${orderId}/promo?promoId=${promoId}`, { method: 'PUT' });
  }

  await apiFetch(`/orders/${orderId}/status?status=confirmed`, { method: 'PUT' });
  return address;
}

export async function fetchUserOrders(profileId = currentProfile?.id) {
  if (!profileId) return [];
  return apiFetch(`/orders/user/${profileId}`).catch(() => []);
}

export async function updateOrderStatus(orderId, status) {
  if (!orderId) throw new Error('Missing order id.');
  if (!status) throw new Error('Missing order status.');
  return apiFetch(`/orders/${orderId}/status?status=${encodeURIComponent(status)}`, { method: 'PUT' });
}

// ---- Reviews ----
export async function submitProductReview({ reviewId = null, profileId = currentProfile?.id, productId, rating, comment }) {
  if (!profileId) throw new Error('You must be signed in to review a product.');
  if (!productId) throw new Error('Missing product id.');

  const payload = {
    profileId,
    productId,
    rating: Number(rating),
    comment: comment || '',
  };

  const result = reviewId
    ? await apiFetch(`/reviews/${reviewId}`, { method: 'PUT', body: JSON.stringify(payload) })
    : await apiFetch('/reviews', { method: 'POST', body: JSON.stringify(payload) });

  reviewsCache = null;
  return result;
}
