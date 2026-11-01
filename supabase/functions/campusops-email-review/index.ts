import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {assessEmail} from '../_shared/email-ai.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 try{
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
 const {data:auth,error:authError}=await client.auth.getUser();if(authError||!auth.user)return reply({error:'Sign in required'},401);
 const {email_id}=await req.json();
 const {data:email,error}=await client.from('campusops_email_intake').select('*').eq('id',email_id).single();
 if(error||!email)return reply({error:'Email not accessible'},403);
 const {data:member}=await client.from('campusops_members').select('role,active').eq('college_id',email.college_id).eq('user_id',auth.user.id).single();
 if(!member?.active||member.role!=='report_admin')return reply({error:'Report administrator required'},403);
 if(email.status!=='pending'||email.assessment?.review_version===2)return reply({status:email.status,assessment:email.assessment});
 const assessment=await assessEmail(email.subject,email.body);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const {error:saveError}=await db.from('campusops_email_intake').update({assessment,status:assessment.rejected?'rejected':'pending',reviewed_at:assessment.rejected?assessment.reviewed_at:null}).eq('id',email.id).eq('status','pending').is('reviewed_by',null);
 if(saveError)throw Error('Could not save review. Please retry.');
 return reply({assessment});
 }catch(e){return reply({error:e instanceof Error?e.message:'AI review unavailable'},503);}
});
