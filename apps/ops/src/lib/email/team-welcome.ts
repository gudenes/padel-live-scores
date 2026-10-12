import {Resend} from 'resend'
import {teamWelcomeTemplate,type WelcomeRole} from './team-welcome-template'
export async function sendTeamWelcomeEmail(opts:{to:string;role:WelcomeRole}):Promise<void> {
  if(!process.env.RESEND_API_KEY)throw new Error('Welcome email service is unavailable.')
  const content=teamWelcomeTemplate({email:opts.to,role:opts.role})
  const result=await new Resend(process.env.RESEND_API_KEY).emails.send({
    from:process.env.AUTH_EMAIL_FROM??'PadelNachos Admin <admin@padelnachos.com>',
    to:opts.to,...content,
  })
  if(result.error || !result.data?.id)throw new Error('Welcome email was not accepted.')
}
