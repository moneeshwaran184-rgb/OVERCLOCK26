// Run in the dedicated maintenance inbox. Secrets belong in Script Properties.
function forwardCampusOpsEmails() {
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try {
 const p=PropertiesService.getScriptProperties(),url=p.getProperty('CAMPUSOPS_EMAIL_URL'),secret=p.getProperty('CAMPUSOPS_EMAIL_WEBHOOK_SECRET');
 if(!url||!url.startsWith('https://')||!secret)throw Error('Configure URL and secret');
 const label=GmailApp.getUserLabelByName('CampusOps-Processed')||GmailApp.createLabel('CampusOps-Processed');
 const threads=GmailApp.search('in:inbox is:unread',0,20);
 console.log('Unread threads: '+threads.length);
 threads.forEach(thread=>{let complete=true;
 thread.getMessages().forEach(message=>{
 if(!message.isUnread())return;
 const from=message.getFrom(),match=from.match(/<([^>]+)>/),sender=(match?match[1]:from).trim();
 const body=JSON.stringify({message_id:message.getId(),sender,subject:message.getSubject().slice(0,300),body:message.getPlainBody().slice(0,10000),received_at:message.getDate().toISOString()});
 const timestamp=String(Date.now());
 const signature=Utilities.computeHmacSha256Signature(timestamp+'.'+body,secret,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
 const response=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json; charset=utf-8',payload:Utilities.newBlob('').setDataFromString(body,'UTF-8').getBytes(),headers:{'x-campusops-timestamp':timestamp,'x-campusops-signature':signature},muteHttpExceptions:true});
 console.log('Supabase HTTP status: '+response.getResponseCode());
 if(response.getResponseCode()===200)message.markRead();else complete=false;
 });if(complete)thread.addLabel(label);
 });
 }finally{lock.releaseLock();}
}
