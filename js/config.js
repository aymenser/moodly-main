// ==============================================
// config.js — Supabase client initialization
// Moodly · ING 3 Refactoring
//
// SECURITY NOTE:
// - Auth credentials handled exclusively via supabase.auth (auth schema)
// - public.profiles stores ONLY metadata (name, phone) — NEVER passwords
// - The anon key below is safe to expose client-side (row-level security
//   enforced on Supabase side)
// ==============================================

const SUPABASE_URL = 'https://ljkywvcisjtymrfrcapn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxqa3l3dmNpc2p0eW1yZnJjYXBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MjgyNzQsImV4cCI6MjA4ODIwNDI3NH0.TUnQPlSLej4o_yximFJecWZfb-MPImIR-RiJuulgs0w';

// Single shared client instance — imported by api.js and any module that needs it
export const sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
