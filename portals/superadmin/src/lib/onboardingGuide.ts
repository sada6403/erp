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
  apiKey: string
  downloadUrl?: string
  serverUrl?: string
}

export function buildWhatsAppGuideText(data: OnboardingGuideData): string {
  const downloadUrl = data.downloadUrl || 'http://72.61.115.222/download'
  const serverUrl = data.serverUrl || 'http://72.61.115.222:4001'
  const passwordText = data.adminPassword
    ? `\`${data.adminPassword}\` ⚠️ *(First login-க்கு பின் மாற்றவும் / Must change)*`
    : '(Your chosen password)'

  return `*🎉 Welcome to Enterprise POS ERP!*

Hi *${data.adminName || 'Admin'}*, your company account *${data.companyName}* has been successfully registered.

━━━━━━━━━━━━━━━━━━━━━
*🔑 YOUR LOGIN & SETUP CREDENTIALS*
━━━━━━━━━━━━━━━━━━━━━
📧 *Admin Email:* ${data.adminEmail}
🔒 *Admin Password:* ${passwordText}
🏢 *Company Activation Key:* \`${data.companyKey}\`
⚡ *POS API Key:* \`${data.apiKey}\`
🌐 *Cloud Server URL:* ${serverUrl}
📥 *Download POS App:* ${downloadUrl}

━━━━━━━━━━━━━━━━━━━━━
*💻 PC SETUP & INSTALLATION STEPS:*
━━━━━━━━━━━━━━━━━━━━━
1️⃣ Download the POS desktop app from the link above.
2️⃣ Run the installer and open *Enterprise POS ERP*.
3️⃣ In the activation screen, enter the *Cloud Server URL* and your *Company Activation Key* to activate this PC.
4️⃣ Log in using your *Admin Email* and *Admin Password*.
5️⃣ ⚠️ *CRITICAL:* Login செய்தவுடன் *Settings → Security* சென்று உங்கள் Password-ஐ உடனடியாக மாற்றிக்கொள்ளவும் (Change password immediately).
6️⃣ Confirm cloud connection status under *Settings → Cloud Sync*.

━━━━━━━━━━━━━━━━━━━━━
⚠️ *பாதுகாப்பு குறிப்பு / SECURITY NOTICE:*
━━━━━━━━━━━━━━━━━━━━━
இந்த Admin Password தற்காலிகமானது. உங்கள் நிறுவன கணக்கின் பாதுகாப்பிற்காக, முதல் முறை உள்நுழைந்தவுடன் (First Login) உடனடியாக உங்கள் புதிய கடவுச்சொல்லை மாற்றிக்கொள்ளவும்.
Please keep these credentials strictly confidential and update your temporary password immediately upon first login.

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
