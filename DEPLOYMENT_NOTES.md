# Moodly Storefront deployment notes

Before deployment, edit `js/runtime-config.js` and replace:

- `PRODUCTION_API_BASE` with your deployed Spring Boot URL + `/api`
- `PRODUCTION_ADMIN_APP_URL` with your deployed admin URL
- `PRODUCTION_STOREFRONT_URL` with your deployed storefront URL

Local development still works with:

```bash
python -m http.server 5500
```

Open `http://localhost:5500`.
