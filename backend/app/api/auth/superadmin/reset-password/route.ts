import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { pool } from '@/lib/db'
import { auditLog } from '@/lib/rbac'

export async function POST(req: NextRequest) {
  try {
    const { email, otp, newPassword } = await req.json()

    if (!email || !otp || !newPassword) {
      return NextResponse.json({ error: 'Email, OTP code, and new password are required' }, { status: 400 })
    }

    if (String(newPassword).length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters long' }, { status: 400 })
    }

    const cleanEmail = String(email).toLowerCase().trim()
    const cleanOtp = String(otp).trim()

    // 1. Verify OTP in superadmin_otps table
    const { rows: otpRows } = await pool.query(
      `SELECT * FROM superadmin_otps WHERE LOWER(email) = ? AND otp = ? AND expires_at > NOW() LIMIT 1`,
      [cleanEmail, cleanOtp]
    )

    if (!otpRows.length) {
      return NextResponse.json({ error: 'Invalid or expired reset code. Please request a new code.' }, { status: 400 })
    }

    // 2. Fetch SuperAdmin user
    const { rows: saRows } = await pool.query(
      `SELECT id, name, email FROM superadmins WHERE LOWER(email) = ? AND is_active = 1 LIMIT 1`,
      [cleanEmail]
    )

    if (!saRows.length) {
      return NextResponse.json({ error: 'SuperAdmin account not found or disabled' }, { status: 404 })
    }

    const sa = saRows[0] as { id: string; name: string; email: string }

    // 3. Hash new password and update database
    const passwordHash = await bcrypt.hash(String(newPassword), 10)
    await pool.query(
      `UPDATE superadmins SET password_hash = ?, updated_at = NOW() WHERE id = ?`,
      [passwordHash, sa.id]
    )

    // 4. Delete used OTP
    await pool.query(`DELETE FROM superadmin_otps WHERE email = ?`, [cleanEmail])

    // 5. Audit log
    await auditLog({
      portal: 'superadmin',
      actorType: 'superadmin',
      actorId: sa.id,
      actorName: sa.name,
      action: 'PASSWORD_RESET_COMPLETED',
    })

    return NextResponse.json({ success: true, message: 'Password reset successful! You can now log in.' })
  } catch (err) {
    console.error('[SuperAdmin ResetPassword Error]:', err)
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
  }
}
