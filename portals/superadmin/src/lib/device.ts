/**
 * Device identification & PC Name management for shared accounts
 */

const STORAGE_PC_NAME = 'sa_client_pc_name'
const STORAGE_SESSION_ID = 'sa_client_session_id'

// Detect friendly OS name
function getOSName(): string {
  if (typeof window === 'undefined' || !navigator) return 'PC'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'Windows-PC'
  if (/Macintosh|Mac OS/i.test(ua)) return 'MacBook'
  if (/Linux/i.test(ua)) return 'Linux-PC'
  if (/iPhone|iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android-Device'
  return 'Workstation'
}

// Generate random 4-char suffix
function randomSuffix(): string {
  try {
    const bytes = new Uint8Array(2)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  } catch {
    return Math.floor(1000 + Math.random() * 9000).toString()
  }
}

/**
 * Retrieve or automatically generate a persistent PC name for this machine
 */
export function getPCName(): string {
  if (typeof window === 'undefined') return 'Office PC'
  let name = localStorage.getItem(STORAGE_PC_NAME)?.trim()
  if (!name) {
    const os = getOSName()
    const code = randomSuffix()
    name = `${os}-${code}`
    localStorage.setItem(STORAGE_PC_NAME, name)
  }
  return name
}

/**
 * Explicitly rename this PC / Station
 */
export function setPCName(name: string): string {
  const cleaned = name.trim().slice(0, 80) || getPCName()
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_PC_NAME, cleaned)
  }
  return cleaned
}

/**
 * Unique identifier for the current browser session / tab
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') return 'srv-session'
  let id = sessionStorage.getItem(STORAGE_SESSION_ID)
  if (!id) {
    try {
      id = window.crypto?.randomUUID ? window.crypto.randomUUID() : 'sess_' + Date.now() + '_' + randomSuffix()
    } catch {
      id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
    }
    sessionStorage.setItem(STORAGE_SESSION_ID, id)
  }
  return id
}

/**
 * Device metadata for logging or debugging
 */
export function getDeviceInfo() {
  if (typeof window === 'undefined') return { os: 'Unknown', browser: 'Server' }
  const ua = navigator.userAgent
  let browser = 'Browser'
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome'
  else if (/Edg/i.test(ua)) browser = 'Edge'
  else if (/Firefox/i.test(ua)) browser = 'Firefox'
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari'

  return {
    os: getOSName(),
    browser,
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    language: navigator.language || 'en',
  }
}
