/**
 * CampusOps Supabase Client Configuration
 * Uses Project URL and publishable (anon) key only.
 * Never includes service_role or secret keys.
 * Configured with session persistence, auto-refresh, and URL callback detection.
 */

const SUPABASE_URL = 'https://frczrvyacgfgrjykztjq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1pzdPwTzWcH2W-HQBmNy7A_zEB-Z6Io';

window.CAMPUSOPS_CONFIG = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  collegeCode: 'COPS01'
};

if (window.supabase) {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'campusops_supabase_auth_token'
    }
  });
  console.log('✅ CampusOps Supabase client initialized with session persistence');
} else {
  console.error('❌ Supabase library not loaded. Make sure the Supabase CDN script is included before this file.');
}