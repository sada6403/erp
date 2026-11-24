import type { AppRole } from './common'

export interface AuthUser {
  id: string
  name: string
  phone: string | null
  email: string | null
  email_verified: boolean
  roles: AppRole[]
  /** Smart Buy member number (e.g. NP-1042) when the user is a member */
  member_no: string | null
  /** Agent code (e.g. NP-AG-204) when the user is an agent */
  agent_code: string | null
  language: 'en' | 'ta' | 'si'
  must_change_password: boolean
  phone_verified: boolean
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
  /** Access token lifetime in seconds (15 min) */
  expires_in: number
}

/** identifier = mobile number OR Smart Buy member number (NP-1042) OR agent code (NP-AG-204) */
export interface LoginRequest {
  identifier: string
  password: string
  device_id?: string
}
export interface LoginResponse {
  tokens: AuthTokens
  user: AuthUser
  /** True after an invite/temporary password: only change-password / logout / me work until changed */
  must_change_password: boolean
}

export interface RefreshRequest {
  refresh_token: string
  device_id?: string
}
export type RefreshResponse = AuthTokens & { user: AuthUser }

export interface LogoutRequest {
  refresh_token?: string
  /** Also remove this Expo push token */
  expo_push_token?: string
}

export interface RegisterRequest {
  name: string
  phone: string
  password: string
  email?: string
  device_id?: string
}
export type RegisterResponse = LoginResponse

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}
/** New tokens are issued; all other sessions are signed out. */
export type ChangePasswordResponse = { tokens: AuthTokens; user: AuthUser }

export interface EmailStartRequest {
  email: string
}
export interface EmailStartResponse {
  sent: boolean
  /** false when the company has no SMTP configured; no code is ever returned in the response */
  smtp_configured: boolean
  expires_in: number
}
export interface EmailVerifyRequest {
  code: string
}
export interface EmailVerifyResponse {
  email: string
  email_verified: true
}

export interface ForgotRequest {
  /** phone / member number / agent code */
  identifier: string
}
export interface ForgotResponse {
  /** 'email_code': a 6-digit code was emailed; 'pos_request': the branch will resend a temporary password */
  method: 'email_code' | 'pos_request'
  message: string
}
export interface ForgotResetRequest {
  identifier: string
  code: string
  new_password: string
}

export interface MeResponse extends AuthUser {
  modules: { smartbuy: boolean; installments: boolean }
}
export interface UpdateMeRequest {
  name?: string
  language?: 'en' | 'ta' | 'si'
}
export interface DeleteMeRequest {
  password: string
}
