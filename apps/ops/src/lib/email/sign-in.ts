import {Resend} from 'resend'
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export async function sendSignInEmail({to,url}:{to:string;url:string}):Promise<void>{
  if(!process.env.RESEND_API_KEY)throw Error('Sign-in email service is unavailable.')
  const link=escapeHtml(url)
  const result=await new Resend(process.env.RESEND_API_KEY).emails.send({
    from:process.env.AUTH_EMAIL_FROM??'PadelNachos Admin <admin@padelnachos.com>',to,
    subject:'Sign in to PadelNachos Admin',
    text:`Sign in to PadelNachos Admin\n\nOpen this link to sign in: ${url}\n\nThis link expires in 24 hours. If you did not request it, ignore this email.`,
    html:`<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px"><h1 style="font-size:20px;color:#1a2118;margin:0 0 16px">Sign in to PadelNachos Admin</h1><p style="font-size:14px;color:#58614f;margin:0 0 24px">Click below to sign in. This link expires in 24 hours.</p><a href="${link}" style="display:inline-block;background:#c9f43b;color:#1a2118;font-weight:bold;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:14px">Sign in</a><p style="font-size:11px;color:#707a67;margin-top:32px">If you didn’t request this, ignore this email.</p></div>`,
  })
  if(result.error||!result.data?.id){
    // No recipient, authentication URL, token or provider response body in logs.
    const message=result.error?.message??''
    const reason=/domain.*not verified/i.test(message)?'sender_domain_unverified':/testing emails/i.test(message)?'testing_recipient_restriction':/restricted|permission/i.test(message)?'sender_permission_rejected':'provider_rejected'
    console.error('auth.email_delivery_rejected',{code:result.error?.name??'missing_message_id',reason})
    throw Error('Sign-in email could not be sent.')
  }
}
