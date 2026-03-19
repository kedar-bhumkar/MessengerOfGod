import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';

/**
 * Singleton Supabase client configured with the service role key.
 * The service role key bypasses RLS, which is required for the
 * background scheduler that reads/writes on behalf of all contacts.
 */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
