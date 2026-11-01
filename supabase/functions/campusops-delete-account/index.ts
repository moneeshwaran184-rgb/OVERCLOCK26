import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
      auth: { persistSession: false },
    });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) return reply({ error: 'Sign in required' }, 401);
    const actor = auth.user.id;

    const body = await req.json().catch(() => ({}));
    const target = String(body?.target_user_id || '').trim();
    if (!target) return reply({ error: 'target_user_id is required' }, 400);
    if (target === actor) return reply({ error: 'You cannot delete your own account.' }, 400);

    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Caller must be an active system_admin.
    const { data: callerMembers, error: callerErr } = await service
      .from('campusops_members')
      .select('college_id, role, active')
      .eq('user_id', actor)
      .eq('active', true);
    if (callerErr) return reply({ error: callerErr.message }, 500);
    const callerAdminColleges = (callerMembers || [])
      .filter((m: any) => m.role === 'system_admin')
      .map((m: any) => m.college_id);
    if (!callerAdminColleges.length) {
      return reply({ error: 'System Administrator privileges required.' }, 403);
    }

    // Target's memberships.
    const { data: targetMembers, error: targetErr } = await service
      .from('campusops_members')
      .select('college_id, role')
      .eq('user_id', target);
    if (targetErr) return reply({ error: targetErr.message }, 500);

    const targetColleges = (targetMembers || []).map((m: any) => m.college_id);
    const shared = targetColleges.filter((c: string) => callerAdminColleges.includes(c));

    // If the target has memberships, the caller must administer at least one of them.
    if (targetColleges.length && !shared.length) {
      return reply({ error: 'You can only delete accounts in colleges you administer.' }, 403);
    }

    // Never delete the last system_admin in any shared college.
    for (const collegeId of shared) {
      const targetIsAdminThere = (targetMembers || []).some(
        (m: any) => m.college_id === collegeId && m.role === 'system_admin'
      );
      if (!targetIsAdminThere) continue;
      const { count, error: countErr } = await service
        .from('campusops_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('college_id', collegeId)
        .eq('role', 'system_admin')
        .eq('active', true);
      if (countErr) return reply({ error: countErr.message }, 500);
      if ((count || 0) <= 1) {
        return reply(
          { error: 'Cannot delete the last System Admin of a college.' },
          409
        );
      }
    }

    // 1. Purge all campus data owned by the target.
    const { data: purge, error: purgeErr } = await service.rpc(
      'campusops_purge_account_data',
      { p_user: target, p_actor: actor }
    );
    if (purgeErr) return reply({ error: purgeErr.message }, 500);

    const paths: string[] = Array.isArray(purge?.attachment_paths)
      ? purge.attachment_paths
      : [];

    // 2. Remove the attachment binaries from Storage.
    if (paths.length) {
      const { error: storageErr } = await service.storage
        .from('campusops-evidence')
        .remove(paths);
      if (storageErr) {
        console.error('storage remove failed', storageErr.message);
      }
    }

    // 3. Delete the auth identity (invalidates sessions).
    const { error: deleteErr } = await service.auth.admin.deleteUser(target);
    if (deleteErr) {
      return reply(
        { error: deleteErr.message, purged: true, user_id: target },
        500
      );
    }

    return reply({ ok: true, user_id: target, removed_paths: paths.length });
  } catch (e) {
    console.error('campusops-delete-account failed', e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
