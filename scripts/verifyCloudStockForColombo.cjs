const Store = require('electron-store');
const path = require('path');
const os = require('os');
const { CloudApi } = require('../dist-electron/services/cloudApi');
const { decryptSecret } = require('../dist-electron/ipc/settings');

const posErpDir = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp');
const store = new Store({ cwd: posErpDir });
const settings = store.get('app_settings');
const baseUrl = String(settings?.cloud_api_url || '').trim();
const apiKey = decryptSecret(settings?.cloud_api_key).trim();
const deviceId = store.get('device_id') ?? null;
const cloud = new CloudApi({ baseUrl, apiKey, deviceId });

async function verifyCloudStockData() {
  console.log('--- VERIFYING EXACT CLOUD STOCK DATA ---');
  const stocks = await cloud.changes('stocks', '1970-01-01T00:00:00.000Z');
  console.log(`Total stock records on cloud: ${stocks.length}`);

  const colomboStocks = stocks.filter(s => s.branch_id === 'b1111111-1111-4111-8111-111111111111');
  console.log(`Colombo stocks on cloud: ${colomboStocks.length}`);

  const prods = await cloud.changes('products', '1970-01-01T00:00:00.000Z');
  console.log(`Total products on cloud: ${prods.length}`);

  // Check how many products have stock > 0 in Colombo on Cloud
  const prodsWithStockInColombo = prods.filter(p => {
    const st = colomboStocks.filter(s => s.product_id === p.id);
    const totalQty = st.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
    return totalQty > 0;
  });

  console.log(`Products with stock > 0 in Colombo on Cloud: ${prodsWithStockInColombo.length} out of ${prods.length}`);
  for (const p of prods) {
    const st = colomboStocks.filter(s => s.product_id === p.id);
    const totalQty = st.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
    console.log(`  - [${p.sku}] ${p.name.slice(0, 25)}: Qty on Cloud for Colombo = ${totalQty}`);
  }
}

verifyCloudStockData().catch(console.error);
