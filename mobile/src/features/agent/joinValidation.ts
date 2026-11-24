/** Client-side checks that mirror the server (the server stays the authority). */
const NIC_RE = /^(\d{9}[VvXx]|\d{12})$/;

export function isValidNic(v: string): boolean {
  return NIC_RE.test(v.trim());
}

/** Sri Lankan mobile: 07XXXXXXXX, 7XXXXXXXX, 947XXXXXXXX or +947XXXXXXXX. */
export function isValidMobile(v: string): boolean {
  const d = v.replace(/[^\d+]/g, '').replace(/^\+/, '');
  return /^(?:0|94)?7\d{8}$/.test(d);
}
