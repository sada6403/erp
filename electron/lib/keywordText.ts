import { hasMojibake } from './textEncoding'
import { normalizeKeyword, foldTanglish } from './keywordNormalize'
export { normalizeKeyword, foldTanglish } from './keywordNormalize'

export type KeywordScope = 'global' | 'branch' | 'terminal' | 'user'
export type KeywordScript = 'latin' | 'tamil' | 'sinhala' | 'numeric'
export function validateKeyword(value: unknown) {
  if (typeof value !== 'string') throw new Error('Keyword must be text')
  const keyword = value.normalize('NFC').trim()
  const normalized = normalizeKeyword(keyword)
  if (!normalized || Array.from(normalized).length > 255) throw new Error('Keyword must contain 1–255 characters')
  if (hasMojibake(keyword) || /[?\ufffd\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2060-\u206f]/u.test(keyword)) throw new Error('Garbled, lost or control text cannot be saved as a keyword')
  const tamil = /[\u0b80-\u0bff]/u.test(keyword), sinhala = /[\u0d80-\u0dff]/u.test(keyword)
  if (tamil && sinhala) throw new Error('Save Tamil and Sinhala as separate keywords')
  const script: KeywordScript = tamil ? 'tamil' : sinhala ? 'sinhala' : /^\d+$/.test(normalized) ? 'numeric' : 'latin'
  if (/[^\p{Script=Latin}\p{Script=Tamil}\p{Script=Sinhala}\p{M}\p{N}\p{P}\p{Zs}]/u.test(normalized)) throw new Error('Unsupported keyword script')
  return { keyword, normalized, script }
}

// Best-effort, review-required Romanization. These proposals are never active
// until an authorized user approves them. No language model/network dependency.
const tamilConsonants: Record<string,string> = { 'க':'k','ங':'ng','ச':'s','ஞ':'nj','ட':'t','ண':'n','த':'th','ந':'n','ப':'p','ம':'m','ய':'y','ர':'r','ல':'l','வ':'v','ழ':'zh','ள':'l','ற':'r','ன':'n','ஜ':'j','ஷ':'sh','ஸ':'s','ஹ':'h','ஶ':'sh' }
const sinhalaConsonants: Record<string,string> = { 'ක':'k','ඛ':'kh','ග':'g','ඝ':'gh','ඞ':'ng','ඟ':'ng','ච':'ch','ඡ':'ch','ජ':'j','ඣ':'jh','ඤ':'ny','ඥ':'gn','ඦ':'nj','ට':'t','ඨ':'th','ඩ':'d','ඪ':'dh','ණ':'n','ඬ':'nd','ත':'th','ථ':'th','ද':'d','ධ':'dh','න':'n','ඳ':'nd','ප':'p','ඵ':'ph','බ':'b','භ':'bh','ම':'m','ඹ':'mb','ය':'y','ර':'r','ල':'l','ව':'v','ශ':'sh','ෂ':'sh','ස':'s','හ':'h','ළ':'l','ෆ':'f' }
const vowels: Record<string,string> = { 'அ':'a','ஆ':'aa','இ':'i','ஈ':'ii','உ':'u','ஊ':'uu','எ':'e','ஏ':'ee','ஐ':'ai','ஒ':'o','ஓ':'oo','ஔ':'au','ஂ':'m','ஃ':'h','අ':'a','ආ':'aa','ඇ':'ae','ඈ':'aae','ඉ':'i','ඊ':'ii','උ':'u','ඌ':'uu','ඍ':'ri','ඎ':'rii','ඏ':'li','ඐ':'lii','එ':'e','ඒ':'ee','ඓ':'ai','ඔ':'o','ඕ':'oo','ඖ':'au','ං':'ng','ඃ':'h' }
const signs: Record<string,string> = { 'ா':'aa','ி':'i','ீ':'ii','ு':'u','ூ':'uu','ெ':'e','ே':'ee','ை':'ai','ொ':'o','ோ':'oo','ௌ':'au','்':'','ා':'aa','ැ':'ae','ෑ':'aae','ි':'i','ී':'ii','ු':'u','ූ':'uu','ෘ':'ri','ෲ':'rii','ෙ':'e','ේ':'ee','ෛ':'ai','ො':'o','ෝ':'oo','ෞ':'au','්':'' }
export function transliterationProposals(input: string): string[] {
  const validated = validateKeyword(input)
  if (!['tamil','sinhala'].includes(validated.script)) return []
  const chars = Array.from(normalizeKeyword(input)), consonants = { ...tamilConsonants, ...sinhalaConsonants }
  let result = ''
  for (let i=0;i<chars.length;i++) {
    const ch = chars[i]
    if (consonants[ch]) { const sign = signs[chars[i+1]]; result += consonants[ch] + (sign === undefined ? 'a' : sign); if (sign !== undefined) i++ }
    else if (vowels[ch]) result += vowels[ch]
    else if (/^[\x20-\x7e]$/.test(ch)) result += ch
    else return [] // Unknown marks must not become guessed/junk aliases.
  }
  const variants = [result, foldTanglish(result).replace(/ii/g,'i').replace(/uu/g,'u').replace(/oo/g,'o'), result.replace(/th/g,'t').replace(/s/g,'c')]
  return [...new Set(variants.map(normalizeKeyword))].filter(Boolean).slice(0,3)
}
