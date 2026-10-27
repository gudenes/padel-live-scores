export type WelcomeRole = 'viewer' | 'scouter' | 'admin'
const roles: Record<WelcomeRole, {label:string; intro:string; features:string[]; next:string}> = {
  viewer: {label:'Viewer',intro:'Your seat in the match room is ready.',features:['Explore all scouted matches and official match reports.','Follow player impact, match momentum and team statistics.','Export the available match data for your analysis.','Tag video moments and leave team review notes without changing scouting data or scores.'],next:'Open Matches and choose a report to explore. Use Video review to tag moments and leave notes. Scouting data and scores remain protected.'},
  scouter: {label:'Scouter',intro:'You’re ready to turn every point into insight.',features:['Scout matches with the Padel Nachos extension.','Record points and edit scouting sessions assigned to you.','Explore insights and exports for all scouted matches.'],next:'Your administrator will share the scouting extension. Start with its Playground, then choose New match when you’re ready.'},
  admin: {label:'Administrator',intro:'Your team’s workspace is ready.',features:['Manage team access and scouting assignments.','Explore match insights, statistics and exports.','Manage official scores, content and system settings.'],next:'Open the admin dashboard to explore the workspace and manage your team.'},
}
const escapeHtml = (value:string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export function teamWelcomeTemplate({email,role}:{email:string;role:WelcomeRole}) {
  const info=roles[role], safeEmail=escapeHtml(email)
  const loginUrl='https://admin.padelnachos.com/login'
  const subject='Welcome to Padel Nachos · '+info.label+' access'
  const text=`Welcome to Padel Nachos\n\n${info.intro}\n\nYour access: ${info.label}\nSign in with: ${email}\n\n${info.features.map(f=>'• '+f).join('\n')}\n\nOpen admin: ${loginUrl}\n\nSign in with Google using this email, or choose “Email me a sign-in link”. No new password is required.\n\nYour first step\n${info.next}\n\nAccess was granted by your team administrator. If you weren’t expecting this, contact them before signing in.\nPadel Nachos × Padel Labs\n`
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title><style>@media(max-width:600px){.content{padding:28px 24px!important}.outer{padding:16px 8px!important}.title{font-size:34px!important}.brand{padding:24px!important}}</style></head>
<body style="margin:0;background:#f2f5ed;color:#1a2118;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Your ${info.label} access is ready. Open your Padel Nachos workspace.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f5ed"><tr><td class="outer" align="center" style="padding:40px 16px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dce2d3;border-radius:20px;overflow:hidden">
<tr><td class="brand" style="background:#1e2824;padding:28px 36px;border-radius:20px 20px 0 0"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td><img src="https://admin.padelnachos.com/brand/padelnachos.png" width="80" height="56" alt="Padel Nachos" style="display:block;object-fit:contain"></td><td style="padding:0 20px;color:#64716b;font-size:28px">|</td><td><img src="https://admin.padelnachos.com/brand/padellabs-white.png" width="136" height="36" alt="Padel Labs" style="display:block;object-fit:contain"></td></tr></table></td></tr>
<tr><td style="height:4px;background:#c9f43b;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="content" style="padding:36px 40px 32px">
<p style="margin:0 0 20px;font-size:11px;letter-spacing:2px;font-weight:bold;color:#58664c">WELCOME TO THE TEAM</p>
<h1 class="title" style="margin:0 0 14px;font-size:42px;letter-spacing:-1.8px;line-height:1.08;color:#1a2118">Great matches.<br><span style="color:#d64740">Better insights.</span></h1>
<p style="font-size:17px;line-height:1.6;margin:0 0 26px;color:#58614f">${info.intro}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7ee;border:1px solid #e0e7d7;border-radius:12px"><tr><td style="padding:18px 20px"><span style="display:inline-block;background:#c9f43b;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:bold;color:#1a2118">${info.label} access</span><p style="margin:12px 0 0;font-size:12px;color:#626c59">YOUR SIGN-IN EMAIL</p><p style="margin:6px 0 0;font-size:15px;line-height:1.5;overflow-wrap:anywhere;color:#1a2118">${safeEmail}</p></td></tr></table>
<h2 style="font-size:16px;margin:28px 0 14px">Your workspace, unlocked.</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${info.features.map(f=>`<tr><td width="24" valign="top" style="padding:0 0 12px;font-size:17px;color:#df5248">↗</td><td style="padding:0 0 12px;font-size:14px;line-height:1.6;color:#505b47">${f}</td></tr>`).join('')}</table>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0 16px"><tr><td bgcolor="#c9f43b" style="border-radius:10px"><a href="${loginUrl}" style="display:inline-block;padding:16px 28px;background:#c9f43b;border:1px solid #c9f43b;border-radius:10px;font-size:15px;font-weight:bold;color:#1a2118;text-decoration:none">Open Padel Nachos admin &nbsp;→</a></td></tr></table>
<p style="margin:0;font-size:12px;line-height:1.7;color:#64705b">Sign in with Google using this email, or choose <strong>Email me a sign-in link</strong>. No new password is required.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;border-top:1px solid #e2e7dc"><tr><td style="padding-top:22px"><h2 style="font-size:14px;margin:0 0 8px">Your first step</h2><p style="margin:0;font-size:13px;line-height:1.7;color:#58614f">${info.next}</p></td></tr></table>
</td></tr>
<tr><td style="padding:24px 40px;background:#f7f8f4;border-top:1px solid #e2e7dc;border-radius:0 0 20px 20px"><p style="margin:0 0 8px;font-size:12px;font-weight:bold;color:#43513b">PADEL NACHOS × PADEL LABS</p><p style="margin:0;font-size:11px;line-height:1.7;color:#707a67">Access was granted by your team administrator. If you weren’t expecting this, contact them before signing in.</p><p style="margin:12px 0 0;font-size:11px"><a href="${loginUrl}" style="color:#43513b;text-decoration:underline">admin.padelnachos.com</a></p></td></tr>
</table></td></tr></table></body></html>`
  return {subject,html,text}
}
