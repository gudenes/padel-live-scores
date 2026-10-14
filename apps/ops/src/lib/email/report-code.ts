import {Resend} from 'resend'
export async function sendReportCode(to:string,code:string){
 if(!process.env.RESEND_API_KEY)throw Error('Email service is not configured.')
 const result=await new Resend(process.env.RESEND_API_KEY).emails.send({
  from:process.env.AUTH_EMAIL_FROM?.trim()||'Padel Labs <admin@padelnachos.com>',to,subject:'Your Padel Labs report access code',
  text:`Your Padel Labs report access code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
  html:`<div style="max-width:480px;margin:auto;background:#f4f6ee;font-family:Arial,sans-serif;padding:32px;border-radius:16px"><div style="background:#202b26;color:white;padding:20px;border-radius:10px;font-size:22px;font-weight:bold">PADEL LABS</div><h2>Open your match analysis</h2><p>Enter this code to verify your email address.</p><div style="padding:20px;background:#c9f52d;color:#202b26;font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;border-radius:10px">${code}</div><p>Expires in 10 minutes. If you didn’t request this, ignore this email.</p></div>`
 });
 if(result.error||!result.data?.id){
  const message=result.error?.message??''
  const reason=/domain.*not verified/i.test(message)?'sender_domain_unverified':/testing emails/i.test(message)?'testing_recipient_restriction':/restricted|permission/i.test(message)?'sender_permission_rejected':/API key/i.test(message)?'invalid_api_key':'provider_rejected'
  console.error('report.email_delivery_rejected',{code:result.error?.name??'missing_message_id',reason})
  const failure=Error('Email delivery failed.');failure.name=reason+':'+(result.error?.name??'missing_message_id');throw failure
 }
}
