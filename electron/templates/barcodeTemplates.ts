// Code 39 barcode → monochrome SVG (real, scannable). Relocated out of
// ipc/printer.ts (byte-identical) so both printer.ts (transfer-note
// barcodes) and templates/labelTemplates.ts (product labels) can share one
// implementation without printer.ts <-> templates circularly importing
// each other.

const CODE39: Record<string, string> = {
  '0':'000110100','1':'100100001','2':'001100001','3':'101100000','4':'000110001',
  '5':'100110000','6':'001110000','7':'000100101','8':'100100100','9':'001100100',
  'A':'100001001','B':'001001001','C':'101001000','D':'000011001','E':'100011000',
  'F':'001011000','G':'000001101','H':'100001100','I':'001001100','J':'000011100',
  'K':'100000011','L':'001000011','M':'101000010','N':'000010011','O':'100010010',
  'P':'001010010','Q':'000000111','R':'100000110','S':'001000110','T':'000010110',
  'U':'110000001','V':'011000001','W':'111000000','X':'010010001','Y':'110010000',
  'Z':'011010000','-':'010000101','.':'110000100',' ':'011000100','$':'010101000',
  '/':'010100010','+':'010001010','%':'000101010','*':'010010100',
}

export function buildBarcodeSvg(raw: string, height = 44): string {
  const text = String(raw || '').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '-')
  const data = `*${text}*`
  const NARROW = 2, WIDE = 5, GAP = NARROW
  let x = 0
  const rects: string[] = []
  for (const ch of data) {
    const pat = CODE39[ch] || CODE39['-']
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === '1' ? WIDE : NARROW
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`) // even = bar
      x += w
    }
    x += GAP
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" fill="#000">${rects.join('')}</svg>`
}
