/* ==============================================
   mobile_inject.js — Mobile product navigation + heart buttons
   Moodly · 2026

   Performance notes:
   - No full-body repeated patching loops after every render.
   - Cards are marked with data-mobile-patched="true" to avoid duplicate listeners.
   - MutationObserver is debounced and only touches product cards.
   ============================================== */

(function () {
  'use strict';

  const MOBILE_BP = 768;
  let pendingPatch = false;

  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  function getWishlistIds() {
    const items = window.__UIModule?.wishlistItems || [];
    return new Set(items.map((item) => String(item.id)));
  }

  function syncOneWishButton(card) {
    const button = card.querySelector('.quick-btn-wish-mobile');
    if (!button) return;
    button.classList.toggle('wished', getWishlistIds().has(String(card.dataset.id)));
  }

  function createMobileWishButton(card) {
    if (card.querySelector('.quick-btn-wish-mobile')) return;

    const productId = card.dataset.id;
    const wishBtn = document.createElement('button');
    wishBtn.className = 'quick-btn-wish-mobile';
    wishBtn.type = 'button';
    wishBtn.setAttribute('aria-label', 'Ajouter aux favoris');
    wishBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

    wishBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (window.__toggleWish) await window.__toggleWish(productId);
      window.__syncMobileWishButtons?.();
    });

    const imgWrap = card.querySelector('.product-img');
    if (imgWrap) imgWrap.appendChild(wishBtn);
    syncOneWishButton(card);
  }

  function patchCard(card, product, getAll) {
    if (!card || card.dataset.mobilePatched === 'true') return;
    card.dataset.mobilePatched = 'true';

    createMobileWishButton(card);

    card.addEventListener('click', (event) => {
      if (event.target.closest('.quick-btn-wish-mobile, .quick-btn-cart-mobile, .quick-btn, button')) return;
      if (!isMobile()) return;

      event.preventDefault();
      event.stopPropagation();
      window.openProductPage(product, typeof getAll === 'function' ? getAll() : null);
    }, true);
  }

  function patchAllCards(products = null, getAll = null) {
    const productList = Array.isArray(products) ? products : (typeof getAll === 'function' ? getAll() : window.__allProducts || []);
    const byId = new Map(productList.map((product) => [String(product.id), product]));

    document.querySelectorAll('.product-card[data-id]').forEach((card) => {
      const product = byId.get(String(card.dataset.id));
      if (product) patchCard(card, product, getAll);
      else createMobileWishButton(card);
    });
  }

  window.__syncMobileWishButtons = function () {
    document.querySelectorAll('.product-card[data-id]').forEach(syncOneWishButton);
  };

  window.openProductPage = function (product, allProducts) {
    if (isMobile()) {
      const openedFrom = document.getElementById('homePage')?.style.display !== 'none' ? 'home' : 'shop';
      sessionStorage.setItem('moodly-product', JSON.stringify(product));
      sessionStorage.setItem('moodly-opened-from', openedFrom);
      if (allProducts) sessionStorage.setItem('moodly-products', JSON.stringify(allProducts));
      window.location.href = `product.html?p=${encodeURIComponent(product.id)}`;
      return;
    }

    if (window.__UIModule?.openModal) {
      window.__UIModule.openModal(product.id, allProducts || window.__allProducts || []);
    }
  };

  window.patchCardForMobile = patchCard;
  window.patchAllCardsMobile = patchAllCards;

  const observer = new MutationObserver(() => {
    if (pendingPatch) return;
    pendingPatch = true;
    requestAnimationFrame(() => {
      pendingPatch = false;
      patchAllCards(null, () => window.__allProducts || []);
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    patchAllCards(null, () => window.__allProducts || []);
    observer.observe(document.body, { childList: true, subtree: true });
  });

  window.addEventListener('pageshow', () => patchAllCards(null, () => window.__allProducts || []));
  window.addEventListener('resize', () => patchAllCards(null, () => window.__allProducts || []));
})();
