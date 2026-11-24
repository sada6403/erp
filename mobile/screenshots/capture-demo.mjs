/* global selectTheme, AppState, switchRole, updateHeaderLoginUI -- these live in the web demo page and run inside page.evaluate */
// DEV-ONLY: captures every screen/state of the spec web-demo, per theme, at Pixel-like 412x915 @2.625x.
// Usage: node capture-demo.mjs [--demo <dir>] [--only <substring>] [--theme olive|purple]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const DEMO_DIR = path.resolve(arg('demo', process.env.DEMO_DIR || 'C:/work/mobile app/web-demo'));
const OUT_DIR = path.join(here, 'demo');
const ONLY = arg('only', '');
const THEMES = arg('theme', '') ? [arg('theme')] : ['olive', 'purple'];
const VIEWPORT = { width: 412, height: 915 };
const SCALE = 2.625;
const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// ---------------------------------------------------------------- screen catalogue
// role: guest | customer | smartbuy | agent.  id = `${role}-${screen}-${theme}`
// `setup` is JS evaluated in the page after login/theme are applied.
const S = [];
const add = (role, screen, label, deeplinkHint, setup = '', opts = {}) =>
  S.push({ role, screen, label, deeplinkHint, setup, ...opts });

// helper snippets (run in page context)
const scrollTo = (sel, mode = 'start') =>
  `(() => { const vp = document.getElementById('appViewport'); const el = document.querySelector(${JSON.stringify(sel)});
    const vr = vp.getBoundingClientRect(), er = el.getBoundingClientRect();
    let d = er.top - vr.top;
    if ('${mode}' === 'end') d = er.bottom - vr.bottom;
    vp.scrollTop += d; })()`;

add('guest', 'login-signin', 'Login screen - Sign In tab', 'naturalplantation://login', `openLoginPage();`, { login: false });
add('guest', 'login-signup', 'Login screen - Sign Up tab', 'naturalplantation://register', `openLoginPage(); switchAuthTab('register');`, { login: false });
add('guest', 'shop-top', 'Guest shop home (logged out, header Login button)', 'naturalplantation:// (logged out)', ``, { login: false });

add('customer', 'shop-top', 'Customer shop home (top: search, categories, banner)', 'naturalplantation://');
add('customer', 'shop-flash', 'Customer shop - Flash Harvest Deals + product grid', 'naturalplantation://flash-deals', scrollTo('#dealsSection'));
add('customer', 'shop-smartbuy', 'Customer shop - Smart Buy promo block (bottom)', 'naturalplantation://smartbuy-promo', scrollTo('.smartbuy-cta-card', 'end'));
add('customer', 'categories', 'Customer categories', 'naturalplantation://categories', `switchCustomerTab('categories');`);
add('customer', 'cart-step1', 'Cart - step 1 (items)', 'naturalplantation://cart', `switchCustomerTab('cart'); goToCheckoutStep(1);`);
add('customer', 'cart-step2', 'Cart - step 2 (address)', 'naturalplantation://checkout (step 2)', `switchCustomerTab('cart'); goToCheckoutStep(2);`);
add('customer', 'cart-step3', 'Cart - step 3 (payment)', 'naturalplantation://checkout (step 3)', `switchCustomerTab('cart'); goToCheckoutStep(3);`);
add('customer', 'track', 'Order tracking', 'naturalplantation://orders', `switchCustomerTab('track');`);
add('customer', 'settings', 'Settings (theme + language)', 'naturalplantation://settings', `switchCustomerTab('settings');`);
add('customer', 'product-modal', 'Product detail modal', 'naturalplantation://product/101', `openProductModal(101);`);
add('customer', 'notifications-modal', 'Notifications inbox modal', 'naturalplantation://notifications', `openNotifications();`);
add('customer', 'push-banner', 'In-app push banner over shop', 'push notification received (foreground)', `triggerTestPush();`);
add(
  'customer',
  'offline-bar',
  'Offline alert bar over shop',
  'naturalplantation://offline (airplane mode)',
  `AppState.isOffline = true; document.getElementById('offlineAlertBar').classList.add('show');`
);
add(
  'customer',
  'offline-buylater',
  'Offline Buy-Later bottom sheet',
  'naturalplantation://offline (airplane mode, tap Add to Cart)',
  `AppState.isOffline = true; document.getElementById('offlineAlertBar').classList.add('show'); openOfflineBuyLaterModal();`
);

add('smartbuy', 'schemes', 'Smart Buy - schemes hub', 'naturalplantation://schemes', `switchSmartBuyTab('schemes');`);
add('smartbuy', 'draws', 'Smart Buy - draws', 'naturalplantation://draws', `switchSmartBuyTab('draws');`);
add('smartbuy', 'draw-video-modal', 'Smart Buy - draw proof video modal', 'naturalplantation://draw-video/7', `switchSmartBuyTab('draws'); openDrawVideoModal();`);
add('smartbuy', 'wallet', 'Smart Buy - wallet', 'naturalplantation://wallet', `switchSmartBuyTab('wallet');`);
add('smartbuy', 'join-modal', 'Smart Buy - join scheme modal', 'naturalplantation://join', `switchSmartBuyTab('schemes'); openJoinSchemeModal();`);

add('agent', 'deliveries', 'Agent - deliveries dashboard (top)', 'naturalplantation://deliveries', `switchAgentTab('deliveries');`);
add('agent', 'deliveries-list', 'Agent - deliveries list (scrolled to cards)', 'naturalplantation://deliveries (scrolled)', `switchAgentTab('deliveries');` + scrollTo('#deliveriesList'));
add('agent', 'otp-modal', 'Agent - OTP verification modal', 'naturalplantation://deliveries/NP-ORD-9042', `switchAgentTab('deliveries'); openAgentOtpModal('NP-ORD-9042');`);
add('agent', 'members', 'Agent - members', 'naturalplantation://members', `switchAgentTab('members');`);
add('agent', 'earnings', 'Agent - earnings', 'naturalplantation://commission', `switchAgentTab('earnings');`);
add('agent', 'bill-modal', 'Agent - ESC/POS bill preview modal', 'naturalplantation://bill/NP-ORD-9042', `switchAgentTab('deliveries'); openBillForDelivery('NP-ORD-9042');`);
add(
  'agent',
  'commission-statement',
  'Agent - commission statement modal',
  'naturalplantation://commission (statement)',
  `switchAgentTab('earnings'); showCommissionStatement();`,
  { waitFor: '#billModal.active' }
);

// ---------------------------------------------------------------- static server
function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(dir, path.normalize(p));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------- determinism
const INIT_SCRIPT = `
(() => {
  const FIXED = new Date('2026-10-30T10:35:00+05:30').getTime();
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(FIXED); }
    static now() { return FIXED; }
  }
  window.Date = FixedDate;
  // freeze live clock + flash-deal countdown (both use setInterval); keep setTimeout (needed by flows)
  window.setInterval = () => 0;
  Math.random = () => 0.42;
})();
`;

const FREEZE_CSS = `
*, *::before, *::after {
  animation: none !important; transition: none !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}
html, body, * { scrollbar-width: none !important; }
::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
#toastPopup { display: none !important; }
`;

const LOGIN = {
  customer: { role: 'customer', name: 'Sunil Jayawardena', id: '077 123 4567', phone: '077 123 4567' },
  smartbuy: { role: 'smartbuy', name: 'Sunil Jayawardena', id: 'NP-1042', phone: '071 987 6543' },
  agent: { role: 'agent', name: 'Kamal Perera', id: 'NP-AG-204', phone: '075 443 2211' },
};

// Launch bundled chromium; if that exact build is not cached, fall back to the newest
// chromium found in the ms-playwright cache (or CHROMIUM_PATH).
async function launchBrowser() {
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    return await chromium.launch();
  } catch (e) {
    const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    const cands = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => parseInt(b.split('-')[1]) - parseInt(a.split('-')[1])) : [];
    for (const d of cands) {
      const exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(exe)) {
        console.warn('bundled chromium missing, falling back to', exe);
        return chromium.launch({ executablePath: exe });
      }
    }
    throw e;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await serve(DEMO_DIR);
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await launchBrowser();
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    locale: 'en-US',
    timezoneId: 'Asia/Colombo',
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript(INIT_SCRIPT);

  const manifest = [];
  const failures = [];

  for (const theme of THEMES) {
    for (const s of S) {
      const id = `${s.role}-${s.screen}-${theme}`;
      if (ONLY && !id.includes(ONLY)) continue;
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.addStyleTag({ content: FREEZE_CSS });
        // fonts: wait, but never hang if Google Fonts is unreachable
        await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 6000))]));
        await page.waitForFunction(() => typeof selectTheme === 'function' && document.getElementById('productsGrid')?.children.length > 0);
        await page.evaluate(
          ([theme, login]) => {
            selectTheme(theme);
            if (login) {
              AppState.isLoggedIn = true;
              AppState.loggedInUser = login;
              switchRole(login.role);
              updateHeaderLoginUI();
            }
            document.getElementById('toastPopup').classList.remove('active');
          },
          [theme, s.login === false ? null : LOGIN[s.role]]
        );
        if (s.setup) await page.evaluate(s.setup);
        if (s.waitFor) await page.waitForSelector(s.waitFor, { timeout: 4000 });
        await page.evaluate(() => {
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          const t = document.getElementById('toastPopup');
          if (t) t.classList.remove('active');
        });
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(OUT_DIR, `${id}.png`) });
        manifest.push({ id, role: s.role, screen: s.screen, theme, label: s.label, deeplinkHint: s.deeplinkHint });
        console.log('ok  ', id);
      } catch (e) {
        failures.push({ id, error: String(e.message || e) });
        console.error('FAIL', id, e.message);
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();
  server.close();

  // merge with existing manifest when running a partial capture
  const mpath = path.join(here, 'screens.json');
  let all = manifest;
  if (ONLY || arg('theme', '')) {
    try {
      const prev = JSON.parse(fs.readFileSync(mpath, 'utf8'));
      const map = new Map(prev.map((p) => [p.id, p]));
      manifest.forEach((m) => map.set(m.id, m));
      all = [...map.values()];
    } catch {}
  }
  fs.writeFileSync(mpath, JSON.stringify(all, null, 2) + '\n');
  console.log(`\n${manifest.length} captured, ${failures.length} failed -> ${OUT_DIR}`);
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
}

main();
