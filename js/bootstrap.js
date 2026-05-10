// ==============================================
// bootstrap.js — HTML partial loader
// Moodly · split frontend
//
// Purpose:
// - Keep index.html small and readable.
// - Load HTML sections first, then start the existing app logic.
// - Preserve the current UI and inline handlers while making the layout manageable.
// ==============================================

const partials = [
  ['system-ui', 'partials/system-ui.html'],
  ['nav', 'partials/nav.html'],
  ['home', 'partials/home.html'],
  ['shop', 'partials/shop.html'],
  ['product-modal', 'partials/product-modal.html'],
  ['cart-drawer', 'partials/cart-drawer.html'],
  ['wishlist-drawer', 'partials/wishlist-drawer.html'],
  ['profile-drawer', 'partials/profile-drawer.html'],
  ['auth-modal', 'partials/auth-modal.html'],
  ['mobile-filter-drawer', 'partials/mobile-filter-drawer.html'],
  ['bottom-nav', 'partials/bottom-nav.html'],
];

function ready() {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });
}

async function loadPartial(name, url) {
  const target = document.querySelector(`[data-partial="${name}"]`);
  if (!target) throw new Error(`Missing partial target: ${name}`);

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);

  target.innerHTML = await response.text();
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load script: ${src}`));
    document.body.appendChild(script);
  });
}

async function boot() {
  await ready();
  await Promise.all(partials.map(([name, url]) => loadPartial(name, url)));

  // Load the mobile bridge before main.js so product-card patching is available.
  await loadClassicScript('js/mobile_inject.js');

  // main.js starts itself after import, so import only after all DOM partials exist.
  await import('./main.js');

  document.dispatchEvent(new CustomEvent('moodly:ready'));
}

boot().catch((error) => {
  console.error('Moodly bootstrap error:', error);
  document.body.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif;background:#f5f0eb;color:#0a0a0a;">
      <section style="max-width:520px;background:white;border:1px solid #e0d9d1;border-radius:18px;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.08);">
        <h1 style="margin:0 0 10px;font-size:24px;">Moodly could not start</h1>
        <p style="margin:0 0 12px;color:#666;line-height:1.6;">HTML partials must be served through a local server. Use VS Code Live Server, Spring Boot static hosting, or any simple HTTP server.</p>
        <pre style="white-space:pre-wrap;background:#f7f7f7;border-radius:10px;padding:12px;font-size:12px;">${error.message}</pre>
      </section>
    </main>`;
});
