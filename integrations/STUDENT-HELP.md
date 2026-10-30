# Student AI help and grievance redressal

Integrated project: `D:\OVERCLOCK26\OVERCLOCK26-merged`.

1. Open Supabase SQL Editor for the existing CampusOps project. Paste and run the complete `supabase/20261031_student_help.sql` file. It creates new grievance/history/usage tables, RLS policies and authenticated RPCs. It does not change reports, attachments, email intake or work orders.
2. In PowerShell:

```powershell
cd D:\OVERCLOCK26\OVERCLOCK26-merged
supabase functions deploy campusops-chat --project-ref frczrvyacgfgrjykztjq
```

If Supabase CLI is unavailable, create a function named `campusops-chat` in the Supabase dashboard and paste `supabase/functions/campusops-chat/index.ts`. Keep JWT verification enabled. It additionally validates the signed-in user and active student membership. It uses the existing `GEMINI_API_KEY` and `GEMINI_MODEL` secrets.

The function name is intentionally new: the frontend calls `campusops-chat`. It does not rename or redeploy `rapid-action`, `campusops-ai`, the grouping function or email functions.

3. Refresh http://localhost:8004/#studenthelp and sign in as a student. The student sees AI Help & Grievances. A report admin sees Grievance Redressal at #grievances.

Optional SQL deployment using a PostgreSQL client and an existing connection environment variable:

```powershell
psql "$env:CAMPUSOPS_DATABASE_URL" -v ON_ERROR_STOP=1 -f .\supabase\20261031_student_help.sql
```

This project uses standalone SQL files, so running `supabase db push` alone will not discover this file.

## Behavior and limitations

- Chat calls Gemini on the server with the latest conversation turns. It can answer general questions and explain known app navigation; it has no live campus policy, account or report lookup. Institution-specific answers must acknowledge missing information.
- Website problems open a student-editable grievance form. Only explicitly confirmed description/page fields are stored, not the full chat. The form works even if AI is unavailable.
- Each submission uses an idempotent UUID. The database checks student membership and college; admins may review only their college's grievances. All changes and history entries are transactional.
- Students can read only their own grievances and history. Admin responses/status updates are visible to the student after Refresh. There is no automatic email notification or background polling.
- Limits: 40 chat requests/hour/user and 10 new grievances/hour/student. Chat is held in browser memory, cleared on sign-out/new account, and sent to the configured Gemini provider. Do not include passwords or OTPs.
- Chat requires a working signed-in page. A completely unreachable website still needs an external support channel; this feature cannot diagnose browser state automatically.
- JavaScript syntax and mocked Edge Function authentication/role/rate-limit/payload/provider behavior were checked locally. The SQL and live Gemini flow require deployment and were not tested against production. No production data was modified.

Run local server if needed (keep PowerShell open):

```powershell
cd D:\OVERCLOCK26\OVERCLOCK26-merged
& "C:\Users\monee\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" serve-local.cjs static 8004
```
