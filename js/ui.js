// ==============================================
// ui.js — DOM manipulation, rendering & animations
// Moodly · ING 3 Refactoring
//
// Rules:
// · All display toggles use opacity + visibility (NOT display:none/block)
//   except for full page switches where layout stability is not a concern.
// · Drawer/overlay transitions rely solely on class toggling.
// · No data fetching here — receive data as arguments.
// ==============================================

// ---- State (UI-local only) ----
export let cartItems     = [];
export let wishlistItems = [];
export let currentProduct = null;
export let currentQty     = 1;
export let appliedPromo   = null;
let previousBottomNav = null; // Track previous bottom nav state

export function setCartItems(items = []) {
  cartItems = Array.isArray(items) ? items : [];
  renderCart();
  updateCartBadge();
}

export function setWishlistItems(items = []) {
  wishlistItems = Array.isArray(items) ? items : [];
  renderWishlist();
  updateWishBadge();
}

export function setAppliedPromo(promo = null) {
  appliedPromo = promo;
  renderCart();
}

// ---- Page switching ----
export function showHome() {
  document.getElementById('homePage').style.display = 'block';
  document.getElementById('shopPage').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const bnHome = document.getElementById('bnHome');
  if (bnHome) setBottomNav(bnHome);
}

export function showShop() {
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('shopPage').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.getElementById('shopSearchInput').value = '';
  const bnExplore = document.getElementById('bnExplore');
  if (bnExplore) setBottomNav(bnExplore);
}

// ---- Product rendering ----
export function starsHtml(rating) {
  const full = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  const empty = 5 - Math.ceil(rating);
  return '★'.repeat(full) + (hasHalf ? '½' : '') + '☆'.repeat(empty);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function getProductPrimaryImage(product = {}) {
  if (product.imageUrl) return product.imageUrl;

  const imageSources = [
    product.images,
    product.productImages,
    product.product_images,
    product.raw?.images,
    product.raw?.productImages,
    product.raw?.product_images,
  ];

  for (const source of imageSources) {
    if (!Array.isArray(source)) continue;
    const image = source.find((item) => item?.imageUrl || item?.image_url || item?.url);
    if (image) return image.imageUrl || image.image_url || image.url;
  }

  return '';
}

function productImageHtml(product = {}, alt = 'Produit') {
  const imageUrl = getProductPrimaryImage(product);
  return imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`
    : '';
}

function getProductGalleryImages(product = {}) {
  const seen = new Set();
  const images = [];
  const add = (value) => {
    const url = typeof value === 'string' ? value : value?.imageUrl || value?.image_url || value?.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push(url);
  };

  add(product.imageUrl);
  [product.images, product.productImages, product.product_images, product.raw?.images, product.raw?.productImages, product.raw?.product_images]
    .forEach((source) => Array.isArray(source) && source.forEach(add));

  return images;
}

function normalizeText(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getProductStock(product) {
  if (Number.isFinite(Number(product?.totalStock))) return Number(product.totalStock);
  return (product?.variants || []).reduce((sum, variant) => sum + Number(variant.stockQuantity || 0), 0);
}

function getSelectedValues(selector, valueGetter) {
  return [...document.querySelectorAll(selector)]
    .filter((element) => element.offsetParent !== null || element.closest('.mobile-filter-drawer.open'))
    .map(valueGetter)
    .map(normalizeText)
    .filter(Boolean);
}

function getSelectedCategoryValues() {
  const checked = [...document.querySelectorAll('#categoryFilters input[type="checkbox"]:checked, #mobileFilterCats input[type="checkbox"]:checked')];
  return [...new Set(checked
    .filter((input) => input.dataset.filter !== 'all')
    .map((input) => String(input.value || '').trim())
    .filter(Boolean))];
}

function getMaxPriceFilter() {
  const visibleSliders = [...document.querySelectorAll('[data-filter="max-price"]')]
    .filter((input) => input.offsetParent !== null || input.closest('.mobile-filter-drawer.open'))
    .map((input) => Number(input.value))
    .filter(Number.isFinite);

  if (!visibleSliders.length) return Infinity;
  return Math.max(...visibleSliders);
}


const fallbackColorHexMap = {
  noir: '#1a1a1a', noire: '#1a1a1a', black: '#1a1a1a',
  blanc: '#f0ece8', blanche: '#f0ece8', white: '#f0ece8',
  rose: '#e8909e', pink: '#e8909e',
  bleu: '#7aa8c8', blue: '#7aa8c8',
  camel: '#d4a07a', marron: '#b07845', brown: '#b07845',
  kaki: '#8aab88', vert: '#5a7a58', green: '#5a7a58',
  beige: '#e8d8c0', crème: '#e8d8c0', creme: '#e8d8c0',
  bordeaux: '#a05070', rouge: '#ef4444', red: '#ef4444',
  gris: '#9a9a9a', grey: '#9a9a9a', gray: '#9a9a9a',
  violet: '#8b5cf6', purple: '#8b5cf6',
  jaune: '#facc15', yellow: '#facc15',
  orange: '#f97316', argent: '#c0c0c0', gold: '#d4af37', dore: '#d4af37', doré: '#d4af37',
};

let lastColorFilterSignature = '';

function colorNameToHex(colorName, fallback = '#ccc') {
  const value = String(colorName || '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;

  const normalized = normalizeText(value);
  for (const [key, hex] of Object.entries(fallbackColorHexMap)) {
    if (normalized.includes(normalizeText(key))) return hex;
  }

  return fallback;
}

function addColorCandidate(map, label, hex = null) {
  const cleanLabel = String(label || '').trim();
  if (!cleanLabel || normalizeText(cleanLabel) === 'default') return;

  const key = normalizeText(cleanLabel);
  if (!key || map.has(key)) return;

  map.set(key, {
    key,
    label: cleanLabel,
    hex: hex || colorNameToHex(cleanLabel),
  });
}

function getProductColorEntries(product = {}) {
  const colors = new Map();
  const colorNames = Array.isArray(product.colorNames) ? product.colorNames : [];
  const colorHexes = Array.isArray(product.colors) ? product.colors : [];

  colorNames.forEach((name, index) => addColorCandidate(colors, name, colorHexes[index]));

  const variantSources = [
    product.variants,
    product.colorVariants,
    product.raw?.variants,
    product.raw?.productVariants,
    product.raw?.product_variants,
  ];

  variantSources.forEach((source) => {
    if (!Array.isArray(source)) return;
    source.forEach((variant) => addColorCandidate(colors, variant?.color || variant?.colorName || variant?.colour));
  });

  return [...colors.values()];
}

function getProductColorKeys(product = {}) {
  return getProductColorEntries(product).map((color) => color.key);
}

function collectAvailableProductColors(products = []) {
  const colors = new Map();

  products.forEach((product) => {
    getProductColorEntries(product).forEach((color) => {
      if (!colors.has(color.key)) colors.set(color.key, color);
    });
  });

  return [...colors.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }));
}

function getSelectedColorKeys() {
  return [...document.querySelectorAll('.color-swatch.selected[data-color-key]')]
    .map((swatch) => swatch.dataset.colorKey)
    .filter(Boolean);
}

function renderColorFilterTarget(target, colors, selectedKeys) {
  if (!target) return;

  if (!colors.length) {
    target.innerHTML = '<span class="filter-empty">Aucune couleur disponible</span>';
    return;
  }

  target.innerHTML = colors.map((color) => `
    <button
      class="color-swatch${selectedKeys.has(color.key) ? ' selected' : ''}"
      type="button"
      data-color-key="${escapeHtml(color.key)}"
      data-color="${escapeHtml(color.label)}"
      title="${escapeHtml(color.label)}"
      aria-label="Filtrer par couleur ${escapeHtml(color.label)}"
      style="background:${escapeHtml(color.hex)}${color.hex === '#f0ece8' || color.hex === '#fff' || color.hex === '#ffffff' ? ';border-color:#ddd' : ''}"
      onclick="window.__toggleColorFilter?.(this)"
    ></button>
  `).join('');
}

export function renderColorFilters(products = []) {
  const targets = [document.getElementById('dynamicColorFilters'), document.getElementById('mobileColorFilters')]
    .filter(Boolean);
  if (!targets.length) return;

  const colors = collectAvailableProductColors(products);
  const signature = colors.map((color) => `${color.key}:${color.hex}`).join('|');
  const hasPlaceholder = targets.some((target) => /chargement/i.test(target.textContent || '') || !target.querySelector('[data-color-key], .filter-empty'));

  if (signature === lastColorFilterSignature && !hasPlaceholder) return;

  const selectedKeys = new Set(getSelectedColorKeys().filter((key) => colors.some((color) => color.key === key)));
  lastColorFilterSignature = signature;

  targets.forEach((target) => renderColorFilterTarget(target, colors, selectedKeys));
}

export function toggleColorFilter(element) {
  const key = element?.dataset?.colorKey;
  if (!key) return;

  const shouldSelect = !element.classList.contains('selected');
  document.querySelectorAll(`.color-swatch[data-color-key="${CSS.escape(key)}"]`).forEach((swatch) => {
    swatch.classList.toggle('selected', shouldSelect);
  });

  renderShopProducts(window.__allProducts || []);
}

export function resetColorFilters(products = window.__allProducts || []) {
  document.querySelectorAll('.color-swatch.selected[data-color-key]').forEach((swatch) => {
    swatch.classList.remove('selected');
  });

  renderShopProducts(products);
}

export function productCardHtml(p, allProducts, showHeart = true) {
  const inWish = wishlistItems.some(w => String(w.id) === String(p.id));
  const stock = getProductStock(p);
  const isOut = stock <= 0;
  const hasImg = Boolean(p.imageUrl);
  const safeName = escapeHtml(p.name);
  const imgContent = hasImg
    ? `<img src="${escapeHtml(p.imageUrl)}" alt="${safeName}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;">`
    : `<div class="product-img-inner ${escapeHtml(p.grad || 'grad-default')}" style="width:100%;height:100%;"></div>`;

  const stockBadge = isOut
    ? '<span class="product-badge badge-out">Rupture</span>'
    : stock <= 5
      ? '<span class="product-badge badge-low">Bientôt épuisé</span>'
      : p.badge === 'new'
        ? '<span class="product-badge badge-new">Nouveau</span>'
        : '';

  return `
    <div class="product-card${isOut ? ' is-out-of-stock' : ''}" data-id="${escapeHtml(p.id)}" data-stock="${stock}" onclick="window.__openModal('${escapeHtml(p.id)}')">
      <div class="product-img">
        ${imgContent}
        ${stockBadge}
        <div class="product-quick-actions" onclick="event.stopPropagation()">
          <button class="quick-btn quick-btn-cart" onclick="${isOut ? `window.__alertMeStock('${escapeHtml(p.id)}')` : `window.__addToCart('${escapeHtml(p.id)}')`};event.stopPropagation()">
            <svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            ${isOut ? 'M’alerter' : 'Ajouter'}
          </button>
          ${showHeart ? `
          <button class="quick-btn quick-btn-wish ${inWish ? 'wished' : ''}" onclick="window.__toggleWish('${escapeHtml(p.id)}');event.stopPropagation()">
            <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>` : ''}
        </div>
      </div>
      <div class="product-info">
        <div class="product-name">${safeName}</div>
        <div class="product-price">${Number(p.price || 0).toLocaleString('fr-DZ')} DA</div>
        <div class="product-meta">
          <div class="stars">${starsHtml(Number(p.rating || 0))} <span>${Number(p.rating || 0).toFixed(1)}</span></div>
          <div class="product-swatches">${(p.colors || []).map(c => `<div class="mini-swatch" style="background:${escapeHtml(c)}"></div>`).join('')}</div>
        </div>
        <div class="product-sizes">${(p.sizes || []).map(s => `<span class="mini-size">${escapeHtml(s)}</span>`).join('')}</div>
        <div class="stock-line ${isOut ? 'stock-out' : ''}">${isOut ? 'Produit en rupture' : `${stock} en stock`}</div>
      </div>
    </div>`;
}

export function renderHomeProducts(allProducts, categoryId = null) {
  const products = categoryId
    ? allProducts.filter((product) => String(product.categoryId) === String(categoryId))
    : allProducts;

  const target = document.getElementById('homeProductGrid');
  if (!target) return;

  target.innerHTML =
    products.slice(0, 4).map(p => productCardHtml(p, allProducts)).join('') ||
    '<p style="padding:20px;color:var(--text-muted)">Aucun produit disponible.</p>';

  if (typeof window.patchAllCardsMobile === 'function') {
    window.patchAllCardsMobile(products, () => allProducts);
  }
}

export function getSelectedFilters() {
  const search = normalizeText(document.getElementById('shopSearchInput')?.value || '');
  const categories = getSelectedCategoryValues();
  const sizes = getSelectedValues('.size-chip.active', (button) => button.textContent || '');
  const colors = [...new Set(getSelectedColorKeys())];
  const maxPrice = getMaxPriceFilter();

  return { search, categories, sizes, colors, maxPrice };
}

export function renderShopProducts(allProducts) {
  renderColorFilters(allProducts);
  const filters = getSelectedFilters();

  let filtered = allProducts.filter((product) => {
    const productName = normalizeText(product.name);
    const productCategory = String(product.categoryId || '');
    const productSizes = (product.sizes || []).map(normalizeText);
    const productColors = getProductColorKeys(product);
    const productPrice = Number(product.price || 0);

    const matchSearch = !filters.search || productName.includes(filters.search);
    const matchCategory = filters.categories.length === 0 || filters.categories.includes(productCategory);
    const matchSize = filters.sizes.length === 0 || filters.sizes.some((size) => productSizes.includes(size));
    const matchColor = filters.colors.length === 0 || filters.colors.some((color) =>
      productColors.some((productColor) => productColor.includes(color) || color.includes(productColor))
    );
    const matchPrice = productPrice <= filters.maxPrice;

    return matchSearch && matchCategory && matchSize && matchColor && matchPrice;
  });

  const sort = document.getElementById('shopSort')?.value;
  if (sort === 'Prix croissant') filtered.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  if (sort === 'Prix décroissant') filtered.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  if (sort === 'Meilleures ventes') filtered.sort((a, b) => Number(b.reviews || 0) - Number(a.reviews || 0));

  const grid = document.getElementById('shopProductGrid');
  if (!grid) return;

  grid.innerHTML =
    filtered.map(p => productCardHtml(p, allProducts)).join('') ||
    '<p style="padding:20px;color:var(--text-muted)">Aucun produit trouvé.</p>';

  const countEl = document.getElementById('resultsCount');
  if (countEl) countEl.textContent = `${filtered.length} articles`;

  if (typeof window.patchAllCardsMobile === 'function') {
    window.patchAllCardsMobile(filtered, () => allProducts);
  }
}

// SVG illustrations for categories — fashion-themed, inline SVG
function getCatSvg(catName, colorClass) {
  const gradMap = {
    'c-default': ['#f0b8c0','#e8909e'],
    'c-alt0':    ['#f0b8c0','#e8909e'],
    'c-alt1':    ['#7aa8c8','#4d7fa8'],
    'c-alt2':    ['#1a1a1a','#3a3a3a'],
    'c-alt3':    ['#d4a07a','#b07845'],
    'c-alt4':    ['#8aab88','#5a7a58'],
    'c-alt5':    ['#e8d8c0','#d4c0a0'],
  };
  const [c1, c2] = gradMap[colorClass] || gradMap['c-default'];
  const n = (catName || '').toLowerCase();

  // Choose SVG illustration based on category name keywords
  let illustration;
  if (n.includes('robe') || n.includes('dress')) {
    illustration = `<path d="M17 3h-10l-2 7h14l-2-7z" fill="${c2}" opacity=".6"/>
      <path d="M5 10l-2 14h18l-2-14h-14z" fill="white" opacity=".9"/>
      <path d="M12 3 C12 3 10 6 12 8 C14 6 14 3 12 3z" fill="${c2}"/>`;
  } else if (n.includes('haut') || n.includes('top') || n.includes('t-shirt') || n.includes('blouse')) {
    illustration = `<path d="M8 4 L4 8 L4 12 L8 10 L8 20 L16 20 L16 10 L20 12 L20 8 L16 4 C16 4 14 6 12 6 C10 6 8 4 8 4z" fill="white" opacity=".9" stroke="${c2}" stroke-width=".5"/>`;
  } else if (n.includes('pantalon') || n.includes('jean') || n.includes('pant')) {
    illustration = `<path d="M7 3 L7 13 L9 22 L12 22 L12 13 M17 3 L17 13 L15 22 L12 22 L12 13 M7 3 L17 3" fill="white" opacity=".9" stroke="${c2}" stroke-width="1" stroke-linecap="round"/>`;
  } else if (n.includes('veste') || n.includes('manteau') || n.includes('blouson') || n.includes('coat') || n.includes('jacket')) {
    illustration = `<path d="M7 4 L4 8 L4 20 L10 20 L10 12 L14 12 L14 20 L20 20 L20 8 L17 4 C16 5 14 6 12 6 C10 6 8 5 7 4z" fill="white" opacity=".85" stroke="${c2}" stroke-width=".5"/>
      <path d="M10 12 L14 12 L14 8 L10 8 Z" fill="${c2}" opacity=".4"/>`;
  } else if (n.includes('sac') || n.includes('bag') || n.includes('pochette')) {
    illustration = `<rect x="6" y="9" width="12" height="12" rx="2" fill="white" opacity=".9"/>
      <path d="M9 9 C9 6 15 6 15 9" fill="none" stroke="white" stroke-width="1.5" opacity=".9"/>
      <line x1="6" y1="14" x2="18" y2="14" stroke="${c2}" stroke-width=".8" opacity=".5"/>`;
  } else if (n.includes('chaussure') || n.includes('talon') || n.includes('shoe') || n.includes('boot')) {
    illustration = `<path d="M6 16 C6 12 9 8 13 8 L15 8 L16 12 L18 12 L18 16 C18 17 17 18 16 18 L8 18 C7 18 6 17 6 16z" fill="white" opacity=".9"/>
      <path d="M13 8 L13 12" stroke="${c2}" stroke-width="1" opacity=".5"/>`;
  } else if (n.includes('access') || n.includes('bijou') || n.includes('jewel')) {
    illustration = `<circle cx="12" cy="10" r="5" fill="none" stroke="white" stroke-width="1.5" opacity=".9"/>
      <path d="M9 14 L12 20 L15 14" fill="${c2}" opacity=".7"/>
      <circle cx="12" cy="10" r="2" fill="white" opacity=".7"/>`;
  } else if (n.includes('jupe') || n.includes('skirt')) {
    illustration = `<path d="M9 4 L15 4 L18 20 L6 20 Z" fill="white" opacity=".9" stroke="${c2}" stroke-width=".5"/>
      <line x1="9" y1="4" x2="15" y2="4" stroke="${c2}" stroke-width="1.2"/>`;
  } else if (n.includes('sous-vêt') || n.includes('lingerie') || n.includes('bra')) {
    illustration = `<path d="M7 9 C7 7 9 6 11 8 C12 9 12 9 12 9 C12 9 12 9 13 8 C15 6 17 7 17 9 C17 11 15 13 12 15 C9 13 7 11 7 9z" fill="white" opacity=".9"/>`;
  } else {
    // Generic fashion icon — hanger
    illustration = `<path d="M12 5 C12 3 14 3 14 5 C14 6 13 6 12 7 L18 13 C19 14 19 15 18 16 L6 16 C5 15 5 14 6 13 L12 7" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" opacity=".9"/>
      <line x1="6" y1="16" x2="18" y2="16" stroke="white" stroke-width="1.4" opacity=".9"/>`;
  }

  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:52px;height:52px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.15))">
    ${illustration}
  </svg>`;
}

export function renderCategories(categories) {
  const container = document.getElementById('categoryScroll');
  if (!container) return;

  const allSvg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:52px;height:52px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.12))">
    <circle cx="12" cy="12" r="7" fill="white" opacity=".25"/>
    <path d="M12 8 L13.5 11 L17 11.5 L14.5 14 L15.2 17.5 L12 15.8 L8.8 17.5 L9.5 14 L7 11.5 L10.5 11 Z" fill="white" opacity=".9"/>
  </svg>`;

  const colorClasses = ['c-alt1','c-alt2','c-alt3','c-alt4','c-alt5','c-alt0'];
  const cards = [
    `<div class="cat-card active" onclick="window.__filterByCategory(null, this)">
      <div class="cat-img c-default">${allSvg}</div>
      <div class="cat-label">Tout</div>
    </div>`,
    ...categories.map((cat, i) => {
      const colorClass = colorClasses[i % colorClasses.length];
      const svg = getCatSvg(cat.name, colorClass);
      return `<div class="cat-card" onclick="window.__filterByCategory('${escapeHtml(cat.id)}', this)" data-cat-id="${escapeHtml(cat.id)}">
        <div class="cat-img ${colorClass}">${svg}</div>
        <div class="cat-label">${escapeHtml(cat.name)}</div>
      </div>`;
    }),
  ];

  // Keep one copy only. Duplicating this list made DOM updates heavier on every reload.
  container.innerHTML = cards.join('');
  buildSidebarCategories(categories);
}

export function buildSidebarCategories(categories) {
  const desktopEl = document.getElementById('categoryFilters');
  const mobileEl = document.getElementById('mobileFilterCats');

  const html = [
    `<label class="filter-check"><input type="checkbox" data-filter="all" checked onchange="window.__handleCategoryFilterChange(this)"> Tout</label>`,
    ...categories.map(cat => `<label class="filter-check"><input type="checkbox" value="${escapeHtml(cat.id)}" onchange="window.__handleCategoryFilterChange(this)"> ${escapeHtml(cat.name)}</label>`),
  ].join('');

  if (desktopEl) desktopEl.innerHTML = html;
  if (mobileEl) mobileEl.innerHTML = html;
}

export function handleCategoryFilterChange(changedInput) {
  const group = changedInput?.closest('#categoryFilters, #mobileFilterCats');
  if (!group) {
    renderShopProducts(window.__allProducts || []);
    return;
  }

  const allInput = group.querySelector('input[data-filter="all"]');
  const categoryInputs = [...group.querySelectorAll('input[type="checkbox"]:not([data-filter="all"])')];

  if (changedInput === allInput) {
    categoryInputs.forEach((input) => { input.checked = false; });
    allInput.checked = true;
  } else {
    allInput.checked = categoryInputs.every((input) => !input.checked);
  }

  renderShopProducts(window.__allProducts || []);
}

export function getCategoryFilter() {
  return getSelectedCategoryValues();
}

////////////////// ---- Skeletons ----

export function showCategorySkeletons() {
  const container = document.getElementById('categoryScroll');
  if (!container) return;

  const catHTML = `
  <div class="cat-skeleton" style="display:flex; align-items:center; justify-content:center;">
    <span class="skeleton-img-label">Moodly</span>
  </div>
`;

  container.innerHTML = Array(6).fill(catHTML).join('');
}


export function showProductSkeletons() {
  const container = document.getElementById('homeProductGrid');
  if (!container) return;

  const productHTML = `
    <div class="product-skeleton">
      <div class="skeleton-img" style="display:flex; align-items:center; justify-content:center;">
        <span class="skeleton-img-label" style="color:rgba(0,0,0,0.2); font-weight:bold; font-size:14px;">Moodly</span>
      </div>
      <div class="skeleton-text"></div>
      <div class="skeleton-text short"></div>
    </div>
  `;

  container.innerHTML = Array(4).fill(productHTML).join('');
}
// ---- Modal ----
function productReviewsHtml(product = {}) {
  const reviews = product.reviewsList || [];
  if (!reviews.length) {
    return `
      <div class="modal-reviews-head">
        <h4>Avis clients</h4>
        <span>Aucun avis</span>
      </div>
      <p class="modal-review-empty">Aucun avis pour ce produit pour le moment.</p>`;
  }

  return `
    <div class="modal-reviews-head">
      <h4>Avis clients</h4>
      <span>${Number(product.rating || 0).toFixed(1)} / 5 · ${reviews.length} avis</span>
    </div>
    <div class="modal-review-list">
      ${reviews.slice(0, 4).map((review) => `
        <article class="modal-review-card">
          <div class="modal-review-stars">${starsHtml(Number(review.rating || 0))}</div>
          <p>${escapeHtml(review.comment || 'Avis sans commentaire.')}</p>
          <small>${escapeHtml(review.author || 'Cliente Moodly')}</small>
        </article>`).join('')}
    </div>`;
}

function getModalSelectedVariant(product = currentProduct) {
  const selectedSize = document.querySelector('.modal-size-btn.active')?.dataset.size || document.querySelector('.modal-size-btn.active')?.textContent?.trim();
  const selectedColor = document.querySelector('.modal-color.selected')?.dataset.color || document.querySelector('.modal-color.selected')?.getAttribute('title')?.trim();

  return (product?.variants || []).find((variant) =>
    String(variant.size || 'Default') === String(selectedSize || 'Default') &&
    String(variant.color || 'Default') === String(selectedColor || 'Default')
  ) || null;
}

export function updateModalStockState() {
  const button = document.querySelector('.modal-add-cart');
  const message = document.getElementById('modalStockMessage');
  if (!button || !message || !currentProduct) return;

  const variant = getModalSelectedVariant(currentProduct);
  const available = Number(variant?.stockQuantity || 0);
  const canAdd = Boolean(variant) && available >= currentQty;

  if (!variant) {
    button.disabled = false;
    button.classList.remove('disabled');
    button.onclick = () => window.__alertMeStock(currentProduct.id);
    button.lastChild.textContent = ' M’alerter';
    message.textContent = "Cette combinaison couleur / taille n'existe pas.";
    message.className = 'stock-state stock-out';
    return;
  }

  if (available <= 0) {
    button.disabled = false;
    button.classList.remove('disabled');
    button.onclick = () => window.__alertMeStock(currentProduct.id);
    button.lastChild.textContent = ' M’alerter';
    message.textContent = 'Ce produit est en rupture pour cette variante.';
    message.className = 'stock-state stock-out';
    return;
  }

  button.onclick = () => window.addToCartFromModal();
  button.disabled = !canAdd;
  button.classList.toggle('disabled', !canAdd);

  if (available < currentQty) {
    button.lastChild.textContent = ' Stock insuffisant';
    message.textContent = `Stock disponible: ${available}. Diminuez la quantité.`;
    message.className = 'stock-state stock-low';
    return;
  }

  button.lastChild.textContent = ' Ajouter au panier';
  message.textContent = available <= 5 ? `Plus que ${available} en stock.` : `${available} en stock.`;
  message.className = available <= 5 ? 'stock-state stock-low' : 'stock-state';
}

export function openModal(id, allProducts) {
  const p = allProducts.find(x => String(x.id) === String(id));
  if (!p) return;
  currentProduct = p;
  currentQty = 1;

  const stock = getProductStock(p);
  document.getElementById('modalName').textContent = p.name;
  document.getElementById('modalPrice').textContent = Number(p.price || 0).toLocaleString('fr-DZ') + ' DA';
  document.getElementById('qtyVal').textContent = '1';
  document.getElementById('modalDesc').textContent = p.description || 'Aucune description disponible.';
  const modalReviews = document.getElementById('modalReviews');
  if (modalReviews) modalReviews.innerHTML = productReviewsHtml(p);
  document.getElementById('modalStars').innerHTML =
    starsHtml(Number(p.rating || 0)) + ` <span>${Number(p.rating || 0).toFixed(1)} (${p.reviews || 0} avis)</span>`;

  const galEl = document.getElementById('modalImg');
  const dotsEl = document.getElementById('modalDots');
  const galleryImages = getProductGalleryImages(p);
  let modalGalleryIndex = 0;

  const renderModalGallery = (index = 0) => {
    modalGalleryIndex = Math.max(0, Math.min(index, Math.max(galleryImages.length - 1, 0)));

    if (!galEl) return;

    galEl.className = 'modal-gallery-main' + (!galleryImages.length ? ` ${p.grad || 'grad-default'}` : '');
    galEl.innerHTML = galleryImages.length
      ? `
        <div class="modal-gallery-slides" style="transform:translateX(-${modalGalleryIndex * 100}%);">
          ${galleryImages.map((imageUrl) => `<div class="modal-gallery-slide"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async"></div>`).join('')}
        </div>
        ${galleryImages.length > 1 ? `
          <button class="modal-gallery-arrow modal-gallery-prev" type="button" onclick="event.stopPropagation();window.__modalGoToImage(${modalGalleryIndex - 1})" aria-label="Image précédente">‹</button>
          <button class="modal-gallery-arrow modal-gallery-next" type="button" onclick="event.stopPropagation();window.__modalGoToImage(${modalGalleryIndex + 1})" aria-label="Image suivante">›</button>
        ` : ''}
      `
      : '';

    if (dotsEl) {
      dotsEl.innerHTML = galleryImages.length > 1
        ? galleryImages.map((_, dotIndex) => `<button class="modal-dot${dotIndex === modalGalleryIndex ? ' active' : ''}" type="button" onclick="event.stopPropagation();window.__modalGoToImage(${dotIndex})" aria-label="Voir l'image ${dotIndex + 1}"></button>`).join('')
        : '';
    }
  };

  window.__modalGoToImage = (index) => {
    if (!galleryImages.length) return;
    const safeIndex = (index + galleryImages.length) % galleryImages.length;
    renderModalGallery(safeIndex);
  };

  renderModalGallery(0);

  const variants = p.variants || [];
  const firstAvailable = variants.find((variant) => Number(variant.stockQuantity || 0) > 0) || variants[0];
  const selectedColor = firstAvailable?.color || p.colorNames?.[0] || 'Default';
  const selectedSize = firstAvailable?.size || p.sizes?.[0] || 'Default';
  const uniqueColors = [...new Map(variants.map((variant) => [String(variant.color || 'Default'), variant])).values()];
  const uniqueSizes = [...new Map(variants.map((variant) => [String(variant.size || 'Default'), variant])).values()];

  document.getElementById('modalColors').innerHTML = (uniqueColors.length ? uniqueColors : [{ color: selectedColor }]).map((variant) => {
    const colorName = variant.color || 'Default';
    const colorHex = p.colors?.[p.colorNames?.findIndex((name) => String(name) === String(colorName))] || '#ccc';
    return `<div class="modal-color${String(colorName) === String(selectedColor) ? ' selected' : ''}" data-color="${escapeHtml(colorName)}" style="background:${escapeHtml(colorHex)}" title="${escapeHtml(colorName)}"
      onclick="document.querySelectorAll('.modal-color').forEach(x=>x.classList.remove('selected'));this.classList.add('selected');window.__modalVariantChanged?.()"></div>`;
  }).join('');

  document.getElementById('modalSizes').innerHTML = (uniqueSizes.length ? uniqueSizes : [{ size: selectedSize }]).map((variant) => {
    const size = variant.size || 'Default';
    const sizeStock = variants
      .filter((candidate) => String(candidate.size || 'Default') === String(size))
      .reduce((sum, candidate) => sum + Number(candidate.stockQuantity || 0), 0);
    return `<button class="modal-size-btn${String(size) === String(selectedSize) ? ' active' : ''}${sizeStock <= 0 ? ' unavailable' : ''}" data-size="${escapeHtml(size)}"
      onclick="document.querySelectorAll('.modal-size-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');window.__modalVariantChanged?.()">${escapeHtml(size)}</button>`;
  }).join('');

  const stockMessage = document.getElementById('modalStockMessage');
  if (stockMessage) {
    stockMessage.textContent = stock <= 0 ? 'Produit en rupture.' : `${stock} pièces disponibles au total.`;
  }

  const inWish = wishlistItems.some(w => String(w.id) === String(id));
  updateModalWishBtn(inWish);

  const others = allProducts.filter(x => String(x.id) !== String(id)).slice(0, 4);
  document.getElementById('alsoLike').innerHTML = others.map(op => `
    <div class="also-card" onclick="closeModal();setTimeout(()=>window.__openModal('${escapeHtml(op.id)}'),200)">
      <div class="also-img ${escapeHtml(op.grad || 'grad-default')}">${op.imageUrl ? `<img src="${escapeHtml(op.imageUrl)}" alt="${escapeHtml(op.name)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">` : ''}</div>
      <div class="also-info">
        <div class="also-name">${escapeHtml(op.name)}</div>
        <div class="also-price">${Number(op.price || 0).toLocaleString('fr-DZ')} DA</div>
      </div>
    </div>`).join('');

  updateModalStockState();
  document.getElementById('productModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeModal() {
  document.getElementById('productModal').classList.remove('open');
  document.body.style.overflow = '';
}

export function changeQty(d) {
  const variant = getModalSelectedVariant(currentProduct);
  const max = Math.max(1, Number(variant?.stockQuantity || currentProduct?.totalStock || 1));
  currentQty = Math.max(1, Math.min(max, currentQty + d));
  document.getElementById('qtyVal').textContent = currentQty;
  updateModalStockState();
}

function updateModalWishBtn(inWish) {
  const wb = document.getElementById('modalWishBtn');
  wb.className = 'modal-add-wish' + (inWish ? ' wished' : '');
  wb.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:${inWish ? 'currentColor' : 'none'};stroke-width:2;stroke-linecap:round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg> ${inWish ? 'Retirer des favoris' : 'Ajouter aux favoris'}`;
}

// ---- Cart ----
export function addToCart(id, allProducts, qty = 1) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  const existing = cartItems.find(x => x.id === id);
  if (existing) existing.qty += qty;
  else cartItems.push({ ...p, qty });
  renderCart();
  updateCartBadge();
  showToast(`"${p.name}" ajouté au panier 🛒`);
}

export function removeFromCart(id) {
  cartItems = cartItems.filter(x => x.id !== id);
  renderCart();
  updateCartBadge();
}

export function renderCart() {
  const body = document.getElementById('cartItems');
  if (!body) return;

  if (cartItems.length === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        <p>Votre panier est vide</p>
        <p style="font-size:0.8rem;margin-top:6px;font-style:italic">Commencez à shopper !</p>
      </div>`;
    document.getElementById('cartSubtotal').textContent = '0 DA';
    return;
  }

  body.innerHTML = cartItems.map(item => `
    <div class="cart-item" onclick="window.__openProductFromList('${item.id}')">
      <div class="cart-item-img ${item.grad || 'grad-default'}">${productImageHtml(item, item.name)}</div>
      <div class="cart-item-details">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-meta">Taille: ${item._selectedSize || 'Default'} · Couleur: ${item._selectedColor || 'Default'} · Qté: ${item.qty || 1}</div>
        <div class="cart-item-price">${((item.price || 0) * (item.qty || 1)).toLocaleString('fr-DZ')} DA</div>
      </div>
      <button class="cart-item-del" onclick="event.stopPropagation();window.__removeFromCart('${item.cartItemId || item.id}')">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>`).join('');

  const subtotal = cartItems.reduce((s, x) => s + (x.price || 0) * (x.qty || 1), 0);
  const discount = appliedPromo ? subtotal * ((appliedPromo.discountPercent || 0) / 100) : 0;
  const total = Math.max(0, subtotal - discount);
  const subtotalEl = document.getElementById('cartSubtotal');
  if (subtotalEl) {
    subtotalEl.textContent = appliedPromo
      ? `${total.toLocaleString('fr-DZ')} DA (${discount.toLocaleString('fr-DZ')} DA remise)`
      : `${subtotal.toLocaleString('fr-DZ')} DA`;
  }
}

export function updateCartBadge() {
  const count = cartItems.reduce((s, x) => s + x.qty, 0);
  const navBadge = document.getElementById('cartBadgeNav');
  const mobBadge = document.getElementById('cartBadgeMobile');
  [navBadge, mobBadge].forEach(badge => {
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  });
}

// ---- Wishlist ----
export function toggleWish(id, allProducts) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  const idx = wishlistItems.findIndex(x => x.id === id);
  if (idx >= 0) {
    wishlistItems.splice(idx, 1);
    showToast('Retiré des favoris');
  } else {
    wishlistItems.push({ ...p });
    showToast(`"${p.name}" ajouté aux favoris ❤️`);
  }
  const inWish = wishlistItems.some(w => w.id === id);
  // Update desktop wish buttons on cards
  document.querySelectorAll('.quick-btn-wish').forEach(btn => {
    const card = btn.closest('.product-card');
    if (card && String(card.dataset.id) === String(id)) btn.classList.toggle('wished', inWish);
  });
  // Sync all mobile heart buttons via mobile_inject helper
  if (typeof window.__syncMobileWishButtons === 'function') window.__syncMobileWishButtons();
  updateWishBadge();
}

export function removeFromWish(id) {
  wishlistItems = wishlistItems.filter(x => x.id !== id);
  renderWishlist();
  updateWishBadge();
}

export function renderWishlist() {
  const body = document.getElementById('wishlistItems');
  const slogans = [
    '💭 Chérie, arrête de regarder et commande ! Ces pièces t\'attendent depuis trop longtemps...',
    '👀 Elles sont encore là... pour combien de temps ?',
    '😤 Ta wishlist t\'observe et elle n\'est pas contente.',
    ' ⏳ Le temps passe, les stocks diminuent... Ne laisse pas tes favoris devenir des regrets !',
    '🔥 Ces articles sont populaires, ils partent vite ! C\'est le moment de craquer.',
    '❤️ Tu as aimé ça ? Ajoute-le à ton panier !',
    '😉 Un petit clic pour toi, un grand pas pour ton style !',
    '👀 Ça reste que du SHOOFING comme ça hehe..',
  ];
  document.getElementById('wishlistTagline').textContent = slogans[Math.floor(Math.random() * slogans.length)];
  if (wishlistItems.length === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <p>Aucun favori pour l'instant</p>
        <p style="font-size:0.8rem;margin-top:6px;font-style:italic">Coeur les articles qui vous plaisent !</p>
      </div>`;
    return;
  }
  body.innerHTML = wishlistItems.map(item => `
    <div class="wish-item" onclick="window.__openProductFromList('${item.id}')">
      <div class="wish-item-img ${item.grad || 'grad-default'}">${productImageHtml(item, item.name)}</div>
      <div class="wish-item-details">
        <div class="wish-item-name">${item.name}</div>
        <div class="wish-item-price">${item.price.toLocaleString('fr-DZ')} DA</div>
        <button class="wish-item-add" onclick="event.stopPropagation();window.__addToCart('${item.id}');window.__removeFromWish('${item.id}')">+ Ajouter au panier</button>
      </div>
      <button class="wish-item-del" onclick="event.stopPropagation();window.__removeFromWish('${item.id}')">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>`).join('');
}

export function updateWishBadge() {
  const count = wishlistItems.length;
  const mobBadge = document.getElementById('wishBadgeMobile');
  const navBadge = document.getElementById('wishBadgeNav');

  [mobBadge, navBadge].forEach(badge => {
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  });
}


// ---- Drawers ----
export function openCart() {
  // Save current bottom nav state
  previousBottomNav = document.querySelector('.bottom-nav-btn.active');
  
  renderCart();
  document.getElementById('cartDrawer').classList.add('open');
  showOverlay();
  document.body.style.overflow = 'hidden';
}
export function closeCart() {
  document.getElementById('cartDrawer').classList.remove('open');
  hideOverlay();
  document.body.style.overflow = '';
  
  // Restore previous bottom nav state
  if (previousBottomNav) {
    setBottomNav(previousBottomNav);
    previousBottomNav = null;
  }
}
export function openWishlist() {
  // Save current bottom nav state
  previousBottomNav = document.querySelector('.bottom-nav-btn.active');
  
  renderWishlist();
  document.getElementById('wishlistDrawer').classList.add('open');
  showOverlay();
  document.body.style.overflow = 'hidden';
}
export function closeWishlist() {
  document.getElementById('wishlistDrawer').classList.remove('open');
  hideOverlay();
  document.body.style.overflow = '';
  
  // Restore previous bottom nav state
  if (previousBottomNav) {
    setBottomNav(previousBottomNav);
    previousBottomNav = null;
  }
}
export function openProfile(isLoggedIn, user) {
  // Save current bottom nav state
  previousBottomNav = document.querySelector('.bottom-nav-btn.active');
  
  renderProfile(isLoggedIn, user);
  document.getElementById('profileDrawer').classList.add('open');
  showOverlay();
  document.body.style.overflow = 'hidden';
}
export function closeProfile() {
  document.getElementById('profileDrawer').classList.remove('open');
  hideOverlay();
  document.body.style.overflow = '';
  
  // Restore previous bottom nav state
  if (previousBottomNav) {
    setBottomNav(previousBottomNav);
    previousBottomNav = null;
  }
}

export function openMobileFilter() {
  document.getElementById('mobileFilterDrawer').classList.add('open');
  showOverlay();
  document.body.style.overflow = 'hidden';
}
export function closeMobileFilter() {
  document.getElementById('mobileFilterDrawer').classList.remove('open');
  hideOverlay();
  document.body.style.overflow = '';
}

// ---- Profile ----
export function renderProfile(isLoggedIn, user) {
  const el = document.getElementById('profileContent');
  if (!isLoggedIn || !user) {
    el.innerHTML = `
      <div style="padding:40px 28px;text-align:center;">
        <div style="width:80px;height:80px;border-radius:50%;background:var(--bg);border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:2rem;">👋</div>
        <h3 style="font-family:var(--serif);font-size:1.4rem;margin-bottom:8px;">Bienvenue !</h3>
        <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:28px;">Connectez-vous pour accéder à vos commandes, favoris et bien plus.</p>
        <div class="auth-tabs" style="margin-bottom:24px;">
          <button class="auth-tab active" id="profTabSign" onclick="window.__switchProfTab('signin')">Se connecter</button>
          <button class="auth-tab" id="profTabReg" onclick="window.__switchProfTab('signup')">S'inscrire</button>
        </div>
        <div class="auth-form" id="profSignin">
          <input class="form-input" type="email" placeholder="Votre email">
          <input class="form-input" type="password" placeholder="Mot de passe">
          <button class="auth-submit" onclick="window.__doLogin()">Se connecter</button>
        </div>
        <div class="auth-form" id="profSignup" style="display:none;">
          <input class="form-input" type="text" placeholder="Votre prénom">
          <input class="form-input" type="email" placeholder="Votre email">
          <input class="form-input" type="password" placeholder="Mot de passe">
          <button class="auth-submit" onclick="window.__doSignup()">Créer mon compte</button>
        </div>
      </div>`;
    return;
  }

  const userEmail = user.email || user.authUser?.email || 'User';
  const userName = user.fullName || user.name || user.user_metadata?.name || user.authUser?.user_metadata?.name || userEmail.split('@')[0];
  const userAvatar = userName.charAt(0).toUpperCase();

  el.innerHTML = `
    <div class="profile-hero-card">
      <div class="profile-avatar-lg">${userAvatar}</div>
      <div class="profile-name-lg">${userName}</div>
      <div class="profile-email-sm">${userEmail}</div>
    </div>
    <div class="profile-stats">
      <div class="profile-stat-card">
        <span class="profile-stat-num">${user.orderCount || 0}</span>
        <span class="profile-stat-label">Commandes</span>
      </div>
      <div class="profile-stat-card">
        <span class="profile-stat-num">${wishlistItems.length}</span>
        <span class="profile-stat-label">Favoris</span>
      </div>
      <div class="profile-stat-card">
        <span class="profile-stat-num" style="font-size:1rem;">0 DA</span>
        <span class="profile-stat-label">Dépensé</span>
      </div>
    </div>
    <div class="profile-section-title">Mon compte</div>
    <button class="profile-menu-item" onclick="window.__openProfileInfoEditor()">
      <div class="profile-menu-icon"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
      <div class="profile-menu-text"><span class="profile-menu-title">Mes informations</span><span class="profile-menu-sub">Connecté en tant que ${userEmail}</span></div>
      <span class="profile-menu-arrow">›</span>
    </button>
    <button class="profile-menu-item" onclick="window.__closeProfile();window.__openWishlist()">
      <div class="profile-menu-icon"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
      <div class="profile-menu-text"><span class="profile-menu-title">Mes favoris</span><span class="profile-menu-sub">${wishlistItems.length} articles sauvegardés</span></div>
      <span class="profile-menu-arrow">›</span>
    </button>
    <button class="profile-menu-item" onclick="window.__closeProfile();window.__openOrderHistory()">
      <div class="profile-menu-icon"><svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></div>
      <div class="profile-menu-text"><span class="profile-menu-title">Mes commandes</span><span class="profile-menu-sub">Historique connecté au backend</span></div>
      <span class="profile-menu-arrow">›</span>
    </button>
    <button class="profile-menu-item" onclick="window.__openLatestViewedPanel()">
      <div class="profile-menu-icon"><svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></div>
      <div class="profile-menu-text"><span class="profile-menu-title">Derniers produits vus</span><span class="profile-menu-sub">Reprendre votre navigation</span></div>
      <span class="profile-menu-arrow">›</span>
    </button>
    <button class="profile-menu-item" onclick="window.__openNotificationsPanel()">
      <div class="profile-menu-icon"><svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
      <div class="profile-menu-text"><span class="profile-menu-title">Notifications</span><span class="profile-menu-sub">Suivi des commandes et changements de statut</span></div>
      <span class="profile-menu-arrow">›</span>
    </button>
    <div style="padding:0 28px;">
      <button class="profile-logout" onclick="window.__doLogout()">
        <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Se déconnecter
      </button>
    </div>`;
}

// ---- Auth modal ----
export function openAuthModal() {
  document.getElementById('authModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
export function closeAuthModal() {
  const overlay = document.getElementById('authModal');
  if (overlay) overlay.classList.remove('open');
  setTimeout(() => { document.body.style.overflow = ''; }, 350);
}

export function switchModalTab(tab) {
  document.getElementById('authTabSignin').className = 'auth-tab' + (tab === 'signin' ? ' active' : '');
  document.getElementById('authTabSignup').className = 'auth-tab' + (tab === 'signup' ? ' active' : '');
  document.getElementById('modalSigninForm').style.display = tab === 'signin' ? 'flex' : 'none';
  document.getElementById('modalSignupForm').style.display = tab === 'signup' ? 'flex' : 'none';
  document.getElementById('authModalTitle').textContent   = tab === 'signin' ? 'Bon retour ! 👋' : 'Rejoignez-nous ✨';
  document.getElementById('authModalSub').textContent     = tab === 'signin'
    ? 'Connectez-vous pour accéder à vos favoris et commandes.'
    : 'Créez votre compte Moodly gratuitement.';
}

export function switchAuthTab(btn, tab) {
  document.querySelectorAll('#homeAuthTabs .auth-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('homeSigninForm').style.display = tab === 'signin' ? 'flex' : 'none';
  document.getElementById('homeSignupForm').style.display = tab === 'signup' ? 'flex' : 'none';
}

export function switchProfTab(tab) {
  document.getElementById('profTabSign').className = 'auth-tab' + (tab === 'signin' ? ' active' : '');
  document.getElementById('profTabReg').className  = 'auth-tab' + (tab === 'signup' ? ' active' : '');
  document.getElementById('profSignin').style.display = tab === 'signin' ? 'flex' : 'none';
  document.getElementById('profSignup').style.display = tab === 'signup' ? 'flex' : 'none';
}

// ---- Misc UI ----
export function setBottomNav(el) {
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

export function showOverlay() {
  document.getElementById('overlay').classList.add('show');
}
export function hideOverlay() {
  const open = ['cartDrawer','wishlistDrawer','profileDrawer','mobileMenu','mobileFilterDrawer']
    .some(id => document.getElementById(id)?.classList.contains('open'));
  if (!open) document.getElementById('overlay').classList.remove('show');
}

export function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3000);
}

// ---- Theme ----
export function initTheme() {
  const saved = localStorage.getItem('moodly-theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('sunIcon').style.display  = 'none';
    document.getElementById('moonIcon').style.display = 'block';
  }
}

export function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('sunIcon').style.display  = isDark ? 'block' : 'none';
  document.getElementById('moonIcon').style.display = isDark ? 'none' : 'block';
  localStorage.setItem('moodly-theme', isDark ? 'light' : 'dark');
}



// ---- Scroll reveal ----
export function initScrollReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}
