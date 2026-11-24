import { z } from 'zod';

/** Messages are i18n keys; Field translates them. */
export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'validation.identifierRequired'),
  password: z.string().min(1, 'validation.passwordRequired'),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'validation.nameRequired'),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?94|0)?7\d{8}$/, 'validation.phoneInvalid'),
  password: z.string().min(8, 'validation.passwordShort'),
});
export type RegisterForm = z.infer<typeof registerSchema>;

export const setPasswordSchema = z
  .object({
    current: z.string().min(1, 'validation.passwordRequired'),
    next: z.string().min(8, 'validation.passwordShort'),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ['confirm'], message: 'validation.passwordMismatch' })
  .refine((v) => v.next !== v.current, { path: ['next'], message: 'validation.passwordSame' });
export type SetPasswordForm = z.infer<typeof setPasswordSchema>;

export const emailSchema = z.object({ email: z.string().trim().email('validation.emailInvalid') });
export const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'validation.codeInvalid') });

export const resetSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'validation.codeInvalid'),
  password: z.string().min(8, 'validation.passwordShort'),
});

export const nicSchema = z.object({ nic: z.string().trim().regex(/^(\d{9}[VvXx]|\d{12})$/, 'validation.nicInvalid') });

export const addressSchema = z.object({
  label: z.string().trim().min(1, 'validation.required'),
  recipient_name: z.string().trim().min(2, 'validation.nameRequired'),
  phone: z.string().trim().regex(/^(\+?94|0)?7\d{8}$/, 'validation.phoneInvalid'),
  line1: z.string().trim().min(3, 'validation.required'),
  city: z.string().trim().min(2, 'validation.required'),
});
export type AddressForm = z.infer<typeof addressSchema>;
