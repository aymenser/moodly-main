// ==============================================
// runtime-config.js — Local/production URLs
// Moodly storefront
//
// Local values work on your PC.
// After you deploy backend/admin/storefront, replace ONLY the PRODUCTION_* values.
// ==============================================

(function () {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  const LOCAL_API_BASE = 'http://localhost:8080/api';
  const LOCAL_ADMIN_APP_URL = 'http://localhost:3000';
  const LOCAL_STOREFRONT_URL = 'http://localhost:5500';

  const PRODUCTION_API_BASE = 'https://moodly-api-backend.onrender.com/api';
  const PRODUCTION_ADMIN_APP_URL = 'https://REPLACE_WITH_ADMIN_URL';
  const PRODUCTION_STOREFRONT_URL = 'https://REPLACE_WITH_STOREFRONT_URL';

  window.MOODLY_CONFIG = {
    API_BASE: isLocal ? LOCAL_API_BASE : PRODUCTION_API_BASE,
    ADMIN_APP_URL: isLocal ? LOCAL_ADMIN_APP_URL : PRODUCTION_ADMIN_APP_URL,
    STOREFRONT_URL: isLocal ? LOCAL_STOREFRONT_URL : PRODUCTION_STOREFRONT_URL,
  };
})();
