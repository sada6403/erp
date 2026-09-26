const fs = require('fs');
const path = require('path');
const os = require('os');
const Store = require('electron-store');
const { CloudApi } = require('../dist-electron/services/cloudApi');
const { decryptSecret } = require('../dist-electron/ipc/settings');
const Database = require('better-sqlite3');

const posErpDir = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp');
const store = new Store({ cwd: posErpDir });
const db = new Database(path.join(posErpDir, 'pos-erp.db'));

const settings = store.get('app_settings');
const baseUrl = String(settings?.cloud_api_url || '').trim();
const apiKey = decryptSecret(settings?.cloud_api_key).trim();
const deviceId = store.get('device_id') ?? null;

const cloud = new CloudApi({ baseUrl, apiKey, deviceId });

async function testPush() {
  const prod = db.prepare("SELECT * FROM products WHERE id = 'prod_furn_sofa_royal_teak_7s'").get();
  console.log('Testing push of product to cloud:', prod.name);
  try {
    await cloud.push({
      table: 'products',
      operation: 'INSERT',
      recordId: prod.id,
      record: prod
    });
    console.log('PUSH SUCCESSFUL TO CLOUD!');
  } catch (err) {
    console.error('PUSH FAILED:', err.message);
  }
}

testPush();
