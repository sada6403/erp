const Store = require('electron-store');
const path = require('path');
const store = new Store({ cwd: path.join(process.env.APPDATA, 'pos-erp') });

console.log('cloud_api_url:', store.get('cloud_api_url'));
console.log('company_id:', store.get('company_id'));
console.log('branch_id:', store.get('branch_id'));
console.log('branch_name:', store.get('branch_name'));
console.log('sync_pull_errors:', store.get('sync_pull_errors'));
console.log('last_successful_sync:', store.get('last_successful_sync'));
