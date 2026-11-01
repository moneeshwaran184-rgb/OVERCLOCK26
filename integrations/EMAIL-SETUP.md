# Gmail intake setup

1. Run `supabase/20261028_email_intake.sql` once in Supabase SQL Editor after the existing CampusOps migrations. This adds an inbox and administrator review RPC. It does not change existing user accounts.
2. In Supabase Edge Function Secrets add `CAMPUSOPS_EMAIL_WEBHOOK_SECRET` (a new random secret of at least 32 bytes), `CAMPUSOPS_EMAIL_COLLEGE_ID` (your college UUID), `GEMINI_API_KEY`, and `GEMINI_MODEL` (the working model ID used by your AI integration). Supabase supplies its URL/service-role variables automatically. Never commit secret values.
3. Deploy `supabase/functions/campusops-email-ingest/index.ts` as `campusops-email-ingest`. Disable platform JWT verification for this function only (`supabase functions deploy campusops-email-ingest --no-verify-jwt`); it authenticates requests using timestamped HMAC signatures instead. Keep JWT checks on your other functions.
4. Create a dedicated test Gmail inbox. In that account create a Google Apps Script project and paste `integrations/gmail-intake.gs`. Under Project Settings → Script Properties add `CAMPUSOPS_EMAIL_URL` (the deployed function HTTPS URL) and `CAMPUSOPS_EMAIL_WEBHOOK_SECRET` (same secret as Supabase).
5. Run `forwardCampusOpsEmails` once and authorize Gmail/HTTP access. Add a time-driven trigger for that function every five minutes. Only use the dedicated inbox: the script processes unread inbox threads, forwards plain text, labels successful threads CampusOps-Processed, and marks them read. New unread replies are processed on later runs. Attachments are not forwarded. Keep emails below 10,000 characters; longer bodies are truncated. AI failure does not lose the email; admin can review manually.
6. Sign in to CampusOps as report admin → Email Intake. Verify sender, extracted details, room, category and priority, then Create report or Reject. Conversion currently supports senders whose email matches an active registered student. Unknown/faculty senders remain in the inbox for clarification or rejection; no accounts are created. Sender addresses may be spoofed—verify identity before conversion. Sender details are visible only in the staff email inbox; Student Reports hides student identity.

## Checks after configuration

- Send a test message from a registered student address. Run the script; confirm one inbox item and inspect AI output.
- Create a report, confirm it appears in Student Reports and the student's account, then dispatch through the existing workflow.
- Mark the processed thread unread and run again: the message ID must produce no duplicate inbox item. Repeating the review RPC must return the same report ID.
- Reject another message and confirm no report is created.
- A wrong signature or a timestamp older than five minutes must return 401. A replay within five minutes returns duplicate success without creating another item.
- Student/faculty sessions must not read the email table or execute its review RPC.
- Check tabs/search/scroll/open report details while waiting over 30 seconds in Student Reports. Confirm no identity or AI-review section appears there.

The inbox and Edge Function have not been deployed or tested against your Gmail/Supabase account. Configure these steps before claiming the integration is live.
