import {assessEmail} from '../_shared/email-ai.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const enc=new TextEncoder();
const json=(data:unknown,status=200)=>Response.json(data,{status});
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'POST required'},405);
 try{
 const secret=Deno.env.get('CAMPUSOPS_EMAIL_WEBHOOK_SECRET'),college=Deno.env.get('CAMPUSOPS_EMAIL_COLLEGE_ID');
 if(!secret||!college)return json({error:'Integration not configured'},503);
 const body=await req.text();if(body.length>24000)return json({error:'Message too large'},413);
 const timestamp=req.headers.get('x-campusops-timestamp')||'',signature=req.headers.get('x-campusops-signature')||'';
 if(!/^\d+$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>300000||!/^[a-f0-9]{64}$/.test(signature))return json({error:'Invalid signature'},401);
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=new Uint8Array(signature.match(/../g)!.map(v=>parseInt(v,16)));
 if(!await crypto.subtle.verify('HMAC',key,bytes,enc.encode(timestamp+'.'+body)))return json({error:'Invalid signature'},401);
 const m=JSON.parse(body);
 if(typeof m.message_id!=='string'||m.message_id.length>200||!m.message_id||typeof m.sender!=='string'||m.sender.length>254||!/^[^\s@]+@[^\s@]+$/.test(m.sender)||typeof m.subject!=='string'||m.subject.length>300||typeof m.body!=='string'||!m.body.trim()||m.body.length>10000||!Number.isFinite(Date.parse(m.received_at)))return json({error:'Invalid message'},400);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const {data:row,error}=await db.from('campusops_email_intake').insert({college_id:college,message_id:m.message_id,sender:m.sender.toLowerCase(),subject:m.subject,body:m.body,received_at:m.received_at}).select('id').single();
 if(error){if(error.code==='23505')return json({accepted:true,duplicate:true});throw error;}
 let assessment:Record<string,unknown>;
 try{assessment=await assessEmail(m.subject,m.body);}catch(e){assessment={error:e instanceof Error?e.message:'AI unavailable; review manually'};}
 const reject=assessment.rejected===true;
 const {error:updateError}=await db.from('campusops_email_intake').update({assessment,status:reject?'rejected':'pending',reviewed_at:reject?new Date().toISOString():null}).eq('id',row.id).eq('status','pending').is('reviewed_by',null);
 if(updateError)throw updateError;
 return json({accepted:true,id:row.id});
 }catch{return json({error:'Email could not be accepted; retry later'},500);}
});
