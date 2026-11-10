import fs from 'node:fs';
import path from 'node:path';

const htmlPath = path.resolve('c:/Users/USER/OneDrive/Documents/Desktop/POS_ERP/director-deploy/deploy/updates/index.html');
const cssPath = path.resolve('c:/Users/USER/OneDrive/Documents/Desktop/POS_ERP/erp/backend/app/director/director.module.css');

console.log('================================================================');
console.log('ENTERPRISE POS ERP — DIRECTOR PORTAL REDESIGN VERIFICATION');
console.log('================================================================\n');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function assert(condition, description) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${description}`);
  } else {
    failedChecks++;
    console.error(`  [FAIL] ${description}`);
  }
}

// 1. HTML Verification
console.log('--- 1. Testing deploy/updates/index.html ---');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1.1 Color Tokens
const requiredColorTokens = [
  '--bg-base: #060B1A',
  '--bg-deep: #080F20',
  '--bg-elevated: #0B1630',
  '--blue-600: #2563EB',
  '--blue-500: #3B82F6',
  '--cyan-400: #38BDF8',
  '--indigo-500: #6366F1',
  '--text-primary: #F8FAFC',
  '--text-secondary: #CBD5E1',
  '--text-muted: #94A3B8',
  '--border-subtle: rgba(148, 163, 184, 0.12)',
  '--border-strong: rgba(148, 163, 184, 0.24)',
  '--success: #10B981',
  '--danger: #EF4444'
];

requiredColorTokens.forEach(token => {
  const normToken = token.replace(/\s+/g, '');
  const normHtml = html.replace(/\s+/g, '');
  assert(normHtml.includes(normToken), `Design token present: ${token}`);
});

// 1.2 Layout & Viewport Checks
assert(html.includes('name="viewport"') && html.includes('width=device-width'), 'Viewport meta tag configured for responsive mobile/desktop scaling');
assert(html.includes('grid-template-columns:') && (html.includes('1.35fr') || html.includes('1.25fr')), 'Desktop ~58%/42% split layout configured');
assert(html.includes('max-width: 1023px') || html.includes('max-width: 1024px'), 'Tablet breakpoint declared');
assert(html.includes('max-width: 639px') || html.includes('max-width: 640px'), 'Mobile breakpoint declared');
assert(html.includes('overflow-x: hidden'), 'Root prevents horizontal scroll overflow');

// 1.3 Essential Brand Assets & Preserved Functional Elements
assert(html.includes('src="logo.png"'), 'Official logo asset preserved (src="logo.png")');
assert(html.includes('id="version"'), 'Dynamic version element preserved (id="version")');
assert(html.includes('id="downloadBtn"'), 'Download anchor button preserved (id="downloadBtn")');
assert(html.includes('id="director-login-form"'), 'Login form element preserved (id="director-login-form")');
assert(html.includes('id="company-input"'), 'Company input ID preserved (id="company-input")');
assert(html.includes('name="company"'), 'Company input name attribute preserved (name="company")');
assert(html.includes('id="email-input"'), 'Email input ID preserved (id="email-input")');
assert(html.includes('name="email"'), 'Email input name attribute preserved (name="email")');
assert(html.includes('id="password-input"'), 'Password input ID preserved (id="password-input")');
assert(html.includes('name="password"'), 'Password input name attribute preserved (name="password")');
assert(html.includes('id="password-toggle"'), 'Password reveal toggle button exists (id="password-toggle")');
assert(html.includes('id="director-login-error"'), 'Error banner element exists (id="director-login-error")');
assert(html.includes('id="director-login-button"'), 'Login submit button exists (id="director-login-button")');

// 1.4 API Endpoints & Auth Handlers
assert(html.includes('/api/management/login'), 'Auth POST endpoint points to /api/management/login');
assert(html.includes("platform: 'director'"), "Auth payload includes platform: 'director'");
assert(html.includes("credentials: 'same-origin'"), "Auth request enforces credentials: 'same-origin'");
assert(html.includes("window.location.assign('/director')"), "Successful login redirects to /director");
assert(html.includes("fetch('/latest.yml"), "Desktop version updater fetches /latest.yml");

// 1.5 Accessibility & WCAG Standards
assert(html.includes('class="skip-link"'), 'Skip-to-content accessibility link exists');
assert(html.includes('role="alert"'), 'Error banner has role="alert"');
assert(html.includes('aria-live="polite"'), 'Error banner has aria-live="polite"');
assert(html.includes('aria-label="Show password"'), 'Password toggle has descriptive aria-label');
assert(html.includes('aria-pressed="false"'), 'Password toggle has aria-pressed state');
assert(html.includes('@media (prefers-reduced-motion: reduce)'), 'prefers-reduced-motion media query handled');
assert(html.includes('visibilitychange'), 'Page visibility listener pauses ambient animations');

// 1.6 Illustrative Dashboard Preview
assert(html.includes('Illustrative preview'), 'Dashboard preview contains required "Illustrative preview" disclaimer');
assert(html.includes('data-counter-target'), 'Live count-up metric counters implemented');
assert(html.includes('stroke-dashoffset'), 'Animated SVG area/line chart implemented');

// 2. CSS Modules (Director Dashboard) Verification
console.log('\n--- 2. Testing backend/app/director/director.module.css ---');
const css = fs.readFileSync(cssPath, 'utf8');

assert(!css.includes(':root {'), 'No impure :root selectors (pure Next.js CSS Modules compliance)');
assert(css.includes('.app, .loginPage, .loading {'), 'CSS tokens scoped safely to .app, .loginPage, .loading');
assert(css.includes('--bg-base: #060B1A;'), 'Director dashboard matches dark slate palette');
assert(css.includes('--blue-600: #2563EB;'), 'Director dashboard matches primary actions');
assert(css.includes('backdrop-filter: blur('), 'Glassmorphic panel effects applied in dashboard');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'Director dashboard respects reduced-motion preferences');

console.log('\n================================================================');
console.log(`SUMMARY: ${passedChecks}/${totalChecks} checks passed (${failedChecks} failures).`);
console.log('================================================================');

if (failedChecks > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
