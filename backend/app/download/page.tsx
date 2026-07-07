import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Download – Enterprise POS ERP',
  description: 'Download the Enterprise POS ERP desktop application for Windows.',
}

const FEATURES = [
  'Multi-branch inventory',
  'Offline POS billing',
  'Installment management',
  'Cloud sync & backup',
  'Role-based access control',
  'Thermal & A4 printing',
  'Customer loyalty points',
  'Branch transfer tracking',
]

const STEPS = [
  'Download and run the installer (Enterprise-POS-ERP-Setup.exe)',
  'If Windows SmartScreen appears, click "More info → Run anyway"',
  'Launch the app and enter your Company Code provided by your administrator',
]

export default function DownloadPage() {
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #0a0f1e;
          color: #e2e8f0;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        .dl-card {
          background: linear-gradient(135deg, #111827 0%, #1a2235 100%);
          border: 1px solid #1e3a5f;
          border-radius: 24px;
          padding: 2.5rem;
          max-width: 560px;
          width: 100%;
          box-shadow: 0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,179,237,0.05);
          text-align: center;
        }
        .dl-logo {
          width: 76px; height: 76px;
          background: linear-gradient(135deg, #3b82f6, #06b6d4);
          border-radius: 20px;
          display: flex; align-items: center; justify-content: center;
          font-size: 34px;
          margin: 0 auto 1.25rem;
          box-shadow: 0 8px 32px rgba(59,130,246,0.4);
        }
        .dl-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(59,130,246,0.12);
          border: 1px solid rgba(59,130,246,0.3);
          color: #60a5fa;
          font-size: 0.72rem;
          font-weight: 600;
          padding: 4px 14px;
          border-radius: 999px;
          margin-bottom: 1.1rem;
          letter-spacing: 0.04em;
        }
        .dl-title {
          font-size: 1.75rem;
          font-weight: 800;
          background: linear-gradient(135deg, #60a5fa, #22d3ee);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 0.5rem;
        }
        .dl-subtitle {
          color: #64748b;
          font-size: 0.9rem;
          margin-bottom: 1.75rem;
          line-height: 1.65;
        }
        .dl-chips {
          display: flex; gap: 0.75rem;
          margin-bottom: 1.5rem;
        }
        .dl-chip {
          flex: 1;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          padding: 0.65rem;
          font-size: 0.72rem;
          color: #94a3b8;
          display: flex; flex-direction: column; gap: 2px;
        }
        .dl-chip strong { color: #cbd5e1; font-size: 0.82rem; }
        .dl-btn {
          display: flex; align-items: center; justify-content: center; gap: 10px;
          width: 100%;
          background: linear-gradient(135deg, #2563eb, #0891b2);
          color: #fff;
          font-size: 1rem;
          font-weight: 700;
          padding: 0.95rem 2rem;
          border-radius: 14px;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 8px 24px rgba(37,99,235,0.45);
          letter-spacing: 0.02em;
          margin-bottom: 0.65rem;
        }
        .dl-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 14px 36px rgba(37,99,235,0.55);
          background: linear-gradient(135deg, #1d4ed8, #0e7490);
        }
        .dl-btn:active { transform: translateY(0); }
        .dl-hint { font-size: 0.7rem; color: #475569; margin-bottom: 1.5rem; }
        .dl-steps {
          text-align: left;
          display: flex; flex-direction: column; gap: 0.65rem;
          margin: 1.25rem 0 1.5rem;
        }
        .dl-step {
          display: flex; align-items: flex-start; gap: 10px;
          font-size: 0.8rem; color: #94a3b8;
          line-height: 1.5;
        }
        .dl-step-num {
          flex-shrink: 0;
          width: 20px; height: 20px;
          background: rgba(59,130,246,0.14);
          border: 1px solid rgba(59,130,246,0.3);
          border-radius: 50%;
          font-size: 0.65rem;
          font-weight: 700;
          color: #60a5fa;
          display: flex; align-items: center; justify-content: center;
        }
        .dl-features {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 0.55rem;
          margin: 1.25rem 0 1.5rem;
          text-align: left;
        }
        .dl-feature {
          display: flex; align-items: flex-start; gap: 7px;
          font-size: 0.77rem; color: #94a3b8;
        }
        .dl-check { color: #22c55e; flex-shrink: 0; }
        .dl-hr { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 1.25rem 0; }
        .dl-footer { font-size: 0.7rem; color: #475569; line-height: 1.65; }
      `}</style>

      <div className="dl-card">
        <div className="dl-logo">🏪</div>

        <div className="dl-badge">
          <span style={{ color: '#22c55e' }}>●</span>
          Windows 10/11 · v2.0.14
        </div>

        <h1 className="dl-title">Enterprise POS ERP</h1>
        <p className="dl-subtitle">
          Offline-first multi-branch Point of Sale &amp; ERP system.<br />
          Works without internet — syncs automatically when online.
        </p>

        <div className="dl-chips">
          <div className="dl-chip"><strong>Windows 10/11</strong><span>64-bit only</span></div>
          <div className="dl-chip"><strong>~120 MB</strong><span>Installer size</span></div>
          <div className="dl-chip"><strong>Auto-update</strong><span>Always latest</span></div>
        </div>

        <a className="dl-btn" href="api/download?direct=1">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download for Windows
        </a>
        <p className="dl-hint">Free download · No account required to install</p>

        <div className="dl-hr" />

        <div className="dl-steps">
          {STEPS.map((s, i) => (
            <div key={i} className="dl-step">
              <div className="dl-step-num">{i + 1}</div>
              <span>{s}</span>
            </div>
          ))}
        </div>

        <div className="dl-hr" />

        <div className="dl-features">
          {FEATURES.map(f => (
            <div key={f} className="dl-feature">
              <span className="dl-check">✓</span>
              <span>{f}</span>
            </div>
          ))}
        </div>

        <div className="dl-hr" />
        <p className="dl-footer">
          By downloading you agree to the software license terms.<br />
          For support contact your system administrator.
        </p>
      </div>
    </>
  )
}
