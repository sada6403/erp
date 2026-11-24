// Deterministic CPU benchmark of the real renderer catalog and cart store.
// This does not measure IPC, SQLite commit, printing, or end-to-end payment.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { performance } = require('node:perf_hooks')

function load(relative) {
  const filename = path.resolve(__dirname, '..', relative)
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(path.dirname(filename))
  instance._compile(compiled, filename)
  return instance.exports
}
const { PosCatalog } = load('src/lib/posCatalog.ts')
const { useCartStore } = load('src/store/cartStore.ts')
const products = Array.from({ length: 12000 }, (_, i) => ({
  id: String(i), name: `Grocery product ${i}`, sku: `SKU${i}`, barcode: String(1000000000000 + i),
  is_active: true, selling_price: 100 + i % 100, unit: 'pcs', tax_rate: 0, stock: 10000,
}))
const started = performance.now()
const catalog = new PosCatalog(products)
const buildMs = performance.now() - started
const search = [], add = []
for (let bill = 0; bill < 250; bill++) {
  useCartStore.getState().clear()
  for (let item = 0; item < 30; item++) {
    const p = products[(bill * 31 + item * 173) % products.length]
    let at = performance.now()
    const found = catalog.search(item % 5 === 0 ? 'grocry' : item % 3 === 0 ? 'grocery prod' : p.barcode)
    search.push(performance.now() - at)
    if (!found.length) throw new Error('Search lost a product')
    at = performance.now()
    useCartStore.getState().addItem(p)
    add.push(performance.now() - at)
  }
}
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) }
}
const report = { products: products.length, bills: 250, linesPerBill: 30, buildMs, searchMs: stats(search), cartAddMs: stats(add) }
console.log(JSON.stringify(report, null, 2))
if (report.searchMs.p99 >= 10 || report.cartAddMs.p99 >= 50) process.exitCode = 1
