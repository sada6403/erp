/**
 * Onboarding Guide helper for generating formatted messages for WhatsApp and copy-paste.
 */

export interface OnboardingGuideData {
  companyName: string
  adminName?: string
  adminEmail: string
  adminPassword?: string
  adminPhone?: string
  companyKey: string
  apiKey?: string
  downloadUrl?: string
  serverUrl?: string
  includeTechnicalDetails?: boolean
}

export function buildWhatsAppGuideText(data: OnboardingGuideData): string {
  const downloadUrl = data.downloadUrl || 'http://72.61.115.222/download'
  const passwordText = data.adminPassword
    ? `\`${data.adminPassword}\` ⚠️ *(Must change after first login)*`
    : '(Your chosen password)'

  // Technical details (Server IP / API Key) are omitted by default to protect server IP & security
  const technicalBlock = data.includeTechnicalDetails && data.apiKey
    ? `⚡ *POS API Key:* \`${data.apiKey}\`\n🌐 *Cloud Server URL:* ${data.serverUrl || 'http://72.61.115.222:4001'}\n`
    : ''

  return `*🎉 Welcome to Enterprise POS ERP!*

Hi *${data.adminName || 'Admin'}*, your company account *${data.companyName}* has been successfully registered.

━━━━━━━━━━━━━━━━━━━━━
*🔑 YOUR LOGIN & SETUP CREDENTIALS*
━━━━━━━━━━━━━━━━━━━━━
📧 *Admin Email:* ${data.adminEmail}
🔒 *Admin Password:* ${passwordText}
🏢 *Company Activation Key:* \`${data.companyKey}\`
${technicalBlock}📥 *Download POS App:* ${downloadUrl}

━━━━━━━━━━━━━━━━━━━━━
*💻 PC SETUP & INSTALLATION STEPS:*
━━━━━━━━━━━━━━━━━━━━━
1️⃣ Download the POS desktop app from the link above.
2️⃣ Run the installer and open *Enterprise POS ERP*.
3️⃣ In the activation screen, enter your *Company Activation Key* to activate this PC.
4️⃣ Log in using your *Admin Email* and *Admin Password*.
5️⃣ ⚠️ *CRITICAL:* Change your temporary Admin Password immediately after your first login (*Settings → Security*).
6️⃣ Confirm cloud connection status under *Settings → Cloud Sync*.

━━━━━━━━━━━━━━━━━━━━━
⚠️ *SECURITY NOTICE:*
━━━━━━━━━━━━━━━━━━━━━
This Admin Password is a temporary credential. For your account security, you must update your password immediately upon first login. Please keep these credentials confidential.

Need assistance? Contact our support team.
— *NF Software Solution*`
}

export function openWhatsApp(phone: string, text: string) {
  let cleaned = (phone || '').replace(/[^0-9]/g, '')
  if (cleaned.startsWith('0')) {
    cleaned = '94' + cleaned.slice(1) // Sri Lanka default if local 07x format
  }
  const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`
  window.open(url, '_blank')
}

export interface PasswordGuideData {
  companyName: string
  adminName?: string
  adminEmail: string
  password: string
  companyKey?: string
  downloadUrl?: string
  isReset?: boolean
}

export function buildWhatsAppPasswordText(data: PasswordGuideData): string {
  const downloadUrl = data.downloadUrl || 'http://72.61.115.222/download'
  const title = data.isReset
    ? '*🔐 Enterprise POS ERP — Password Reset*'
    : '*🔐 Enterprise POS ERP — Admin Login Credentials*'

  const keyLine = data.companyKey
    ? `🏢 *Company Activation Key:* \`${data.companyKey}\`\n`
    : ''

  return `${title}

Hi *${data.adminName || 'Admin'}*,

Here are your Admin login credentials for *${data.companyName}*:

━━━━━━━━━━━━━━━━━━━━━
📧 *Admin Email:* ${data.adminEmail}
🔒 *Admin Password:* \`${data.password}\` ⚠️ *(Must change after login)*
${keyLine}📥 *Download POS App:* ${downloadUrl}
━━━━━━━━━━━━━━━━━━━━━

*To log into your POS Terminal:*
1️⃣ Open *Enterprise POS ERP* on your PC.
2️⃣ Enter your Admin Email and Password above to sign in.
3️⃣ Go to *Settings → Security* to update your password anytime.

━━━━━━━━━━━━━━━━━━━━━
⚠️ *SECURITY NOTICE:*
━━━━━━━━━━━━━━━━━━━━━
This is your private Admin Password. For security, please keep these credentials confidential.

Need assistance? Contact our support team.
— *NF Software Solution*`
}

