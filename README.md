# Moodly split frontend

This version keeps the same visual UI, CSS files, Supabase auth, and Spring Boot backend integration, but splits the previous big `index.html` into small HTML partials.

## Run locally

Because `index.html` now loads `/partials/*.html` with `fetch()`, open it through a local server, not directly with `file://`.

Recommended options:

```bash
# Option 1: VS Code Live Server
# Right-click index.html -> Open with Live Server

# Option 2: Python local server
python -m http.server 5500
```

Then open:

```txt
http://localhost:5500
```

Spring Boot must still run on:

```txt
http://localhost:8080/api
```

## Structure

```txt
moodly/
  index.html
  product.html
  partials/
    system-ui.html
    nav.html
    home.html
    shop.html
    product-modal.html
    cart-drawer.html
    wishlist-drawer.html
    profile-drawer.html
    auth-modal.html
    mobile-filter-drawer.html
    bottom-nav.html
  css/
    main.css
    variables.css
    animations.css
    layout.css
    components.css
    product-page.css
  js/
    bootstrap.js
    main.js
    api.js
    ui.js
    config.js
    config-standalone.js
    i18n.js
    mobile_inject.js
    product-page.js
```

## What changed

- `index.html` is now a clean shell.
- `js/bootstrap.js` loads all HTML partials first.
- `js/main.js` starts only after the full DOM is ready.
- Existing backend-connected logic is preserved.
- `product.html` is included so mobile product navigation has a target page.

## Next work

After you attach `admin-interface.html`, the next step is to fix:

1. color/size/price filters,
2. stock display and add-to-cart blocking,
3. hiding login/signup after login,
4. delivered-order review logic,
5. backend request optimization.
