// config-standalone.js — Supabase client for product.html (non-module context)
// Same credentials as config.js but exposed as window.sbClient for plain <script> use

(function() {
  const SUPABASE_URL = 'https://ljkywvcisjtymrfrcapn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxqa3l3dmNpc2p0eW1yZnJjYXBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MjgyNzQsImV4cCI6MjA4ODIwNDI3NH0.TUnQPlSLej4o_yximFJecWZfb-MPImIR-RiJuulgs0w';
  window.sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
