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
