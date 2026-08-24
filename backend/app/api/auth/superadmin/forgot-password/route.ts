import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { auditLog } from '@/lib/rbac'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const cleanEmail = String(email).toLowerCase().trim()

    // 1. Check if superadmin exists
    const { rows } = await pool.query(
      `SELECT id, name, email FROM superadmins WHERE LOWER(email) = ? AND is_active = 1 LIMIT 1`,
      [cleanEmail]
    )

    if (!rows.length) {
      // Return generic success to prevent email enumeration
      return NextResponse.json({ success: true, sent: false, message: 'If this email is registered, a reset code has been sent.' })
    }

    const sa = rows[0] as { id: string; name: string; email: string }

    // 2. Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000))

    // 3. Clear old OTPs and store new OTP valid for 10 minutes
    await pool.query(`DELETE FROM superadmin_otps WHERE email = ?`, [cleanEmail])
    await pool.query(
      `INSERT INTO superadmin_otps (id, email, otp, expires_at)
       VALUES (UUID(), ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [cleanEmail, otp]
    )

    // 4. Send email
    const mailRes = await sendEmail({
      to: cleanEmail,
      subject: 'SuperAdmin Password Reset Code — POS ERP',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #2563eb; margin-top: 0;">SuperAdmin Password Reset</h2>
          <p style="color: #334155; font-size: 15px;">Hello <strong>${sa.name}</strong>,</p>
          <p style="color: #334155; font-size: 14px;">Your 6-digit verification code to reset your SuperAdmin password is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 16px; background: #f1f5f9; border-radius: 8px; text-align: center; color: #0f172a; margin: 20px 0;">
            ${otp}
          </div>
          <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">This code expires in 10 minutes. If you did not request this code, please ignore this email.</p>
        </div>
      `,
      text: `Your SuperAdmin password reset code is: ${otp} (Expires in 10 minutes).`,
    })

    await auditLog({
      portal: 'superadmin',
      actorType: 'superadmin',
      actorId: sa.id,
      actorName: sa.name,
      action: 'PASSWORD_RESET_OTP_SENT',
    })

    if (mailRes.ok) {
      return NextResponse.json({ success: true, sent: true, message: 'Reset code sent to your email.' })
    }

    return NextResponse.json({
      success: true,
      sent: false,
      noSmtp: true,
      message: 'SMTP is not configured on platform. Ask administrator for reset code.',
    })
  } catch (err) {
    console.error('[SuperAdmin ForgotPassword Error]:', err)
    return NextResponse.json({ error: 'Failed to process password reset request' }, { status: 500 })
  }
}
