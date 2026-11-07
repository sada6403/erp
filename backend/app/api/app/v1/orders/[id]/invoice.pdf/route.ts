import PDFDocument from 'pdfkit'
import { appRoute, need } from '@/lib/app/context'
import { loadOwnOrder, loadOrderItems } from '@/lib/app/ordersLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const money = (n: number) => 'Rs ' + n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const GET = appRoute({ auth: 'user', roles: ['customer'] }, async (c) => {
  const { company, user, params, origin } = need(c)
  const o = await loadOwnOrder(company, user, params.id)
  const items = await loadOrderItems(company.tp, String(o.id), origin)
  const doc = new PDFDocument({ size: 'A5', margin: 36 })
  const chunks: Buffer[] = []
  doc.on('data', (d: Buffer) => chunks.push(d))
  const done = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))))
  doc.fontSize(16).text(company.name, { align: 'center' })
  doc.fontSize(10).text(`Order ${String(o.order_number)}`, { align: 'center' })
  doc.text(`Date: ${new Date(o.created_at as string).toLocaleString('en-GB')}`, { align: 'center' }).moveDown()
  doc.text(`Status: ${String(o.status)}    Payment: ${String(o.payment_method ?? '-')} (${String(o.payment_status)})`)
  if (o.customer_address) doc.text(`Deliver to: ${String(o.customer_name)}, ${String(o.customer_address)}`)
  doc.moveDown()
  for (const i of items) {
    const label = `${i.name}${i.variant_name ? ' - ' + i.variant_name : ''}`
    doc.text(`${label}`, { continued: false })
    doc.fillColor('#555').text(`   ${i.quantity} ${i.unit} x ${money(i.unit_price)} = ${money(i.line_total)}`).fillColor('#000')
  }
  doc.moveDown()
  doc.text(`Delivery fee: ${money(Number(o.delivery_fee) || 0)}`)
  doc.fontSize(12).text(`Total: ${money(Number(o.total_amount))}`)
  doc.end()
  const pdf = await done
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${String(o.order_number)}.pdf"`, 'cache-control': 'private, no-store' },
  })
})
