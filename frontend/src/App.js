import React, { useState, useId, useEffect, useRef } from 'react';
import './App.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function bandInfo(band) {
  const num = parseInt(band?.replace('band_', '') || '0');
  if (num <= 3) return { label: 'LOW RISK',     color: '#059669', bg: '#d1fae5', border: '#059669' };
  if (num <= 5) return { label: 'MEDIUM RISK',  color: '#d97706', bg: '#fef3c7', border: '#d97706' };
  if (num === 6) return { label: 'MEDIUM-HIGH', color: '#ea580c', bg: '#ffedd5', border: '#ea580c' };
  return           { label: 'HIGH RISK',         color: '#dc2626', bg: '#fee2e2', border: '#dc2626' };
}

// Trust Scan 1.0 — A through G band info
function ts1BandInfo(band) {
  const map = {
    'A': {
      label: 'Elite Customers',
      color: '#166534', bg: '#dcfce7', border: '#16a34a',
      bullets: [
        'Good Transactional Behaviour',
        'Good credit behaviour exhibited on Razorpay\'s platform',
        'High Affluence',
      ],
    },
    'B': {
      label: 'Prime Customers',
      color: '#166534', bg: '#d1fae5', border: '#059669',
      bullets: [
        'Good Transactional Behaviour',
        'Good credit behaviour exhibited on Razorpay\'s platform',
      ],
    },
    'C': {
      label: 'Power Customers',
      color: '#3a5c0e', bg: '#ecfccb', border: '#65a30d',
      bullets: [
        'Good Transactional Behaviour',
      ],
    },
    'D': {
      label: 'Sub Prime Customers',
      color: '#92400e', bg: '#fef3c7', border: '#d97706',
      bullets: [
        'Infrequent transactors',
      ],
    },
    'E': {
      label: 'Dormant Customers',
      color: '#92400e', bg: '#ffedd5', border: '#ea580c',
      bullets: [
        'Digitally inactive with zero engagement on Razorpay\'s platform in last 12 months',
      ],
    },
    'F': {
      label: 'Risky Customers',
      color: '#991b1b', bg: '#fee2e2', border: '#dc2626',
      bullets: [
        'Negative Engagement in past like chargeback, fraud attempts',
        'Payments decline due to insufficient balance',
      ],
    },
    'G': {
      label: 'New to Razorpay',
      color: '#374151', bg: '#f3f4f6', border: '#9ca3af',
      bullets: [
        'Never active on Razorpay\'s platform',
      ],
    },
  };
  return map[band] || { label: 'Unknown', color: '#9ca3af', bg: '#f3f4f6', border: '#d1d5db', bullets: [] };
}

function formatINR(amount) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(amount);
}

// Parse probability string (e.g. "1.391E-1") → percentage number
function parseProb(val) {
  if (val == null || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : +(n * 100).toFixed(2);
}

// Weighted average of available default probabilities → Trust Score 0-100
function computeTrustScore(data) {
  const slots = [
    { val: parseProb(data?.dpd30_probability), w: 35 },
    { val: parseProb(data?.dpd90_probability), w: 35 },
    { val: parseProb(data?.cd_probability),    w: 30 },
  ].filter(s => s.val != null);
  if (!slots.length) return null;
  const totalW  = slots.reduce((s, x) => s + x.w, 0);
  const avgProb = slots.reduce((s, x) => s + x.val * x.w, 0) / totalW;
  return Math.round(100 - avgProb);
}

function trustVerdict(score) {
  if (score >= 65) return { label: 'APPROVE',  color: '#059669', bg: '#d1fae5', border: '#059669' };
  if (score >= 45) return { label: 'REVIEW',   color: '#d97706', bg: '#fef3c7', border: '#d97706' };
  return                  { label: 'DECLINE',  color: '#dc2626', bg: '#fee2e2', border: '#dc2626' };
}

// ── Scan steps loading animation ─────────────────────────────────────────────
const SCAN_STEPS = [
  { text: 'Scanning from Razorpay universe', duration: 700  },
  { text: 'Hashing · Unhashing',             duration: 700  },
  { text: 'Getting predicted values',        duration: null },
];

function ScanSteps({ active }) {
  const [step, setStep] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) { setStep(0); return; }
    setStep(0);
    let current = 0;

    function advance() {
      const next = current + 1;
      if (next < SCAN_STEPS.length) {
        current = next;
        setStep(next);
        if (SCAN_STEPS[next].duration) {
          timerRef.current = setTimeout(advance, SCAN_STEPS[next].duration);
        }
      }
    }

    timerRef.current = setTimeout(advance, SCAN_STEPS[0].duration);
    return () => clearTimeout(timerRef.current);
  }, [active]);

  if (!active) return null;

  return (
    <div className="scan-steps">
      <div className="scan-steps-rings"><div /><div /><div /></div>
      <div className="scan-steps-list">
        {SCAN_STEPS.map((s, i) => (
          <div key={i} className={`scan-step ${i < step ? 'done' : i === step ? 'active' : 'pending'}`}>
            <span className="scan-step-icon">
              {i < step ? '✓' : i === step ? <span className="step-spinner" /> : '○'}
            </span>
            <span className="scan-step-text">{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Gauge chart (SVG semicircle) ──────────────────────────────────────────────
function CreditGauge({ score, color }) {
  const uid  = useId();
  const MIN  = 300, MAX = 1200;
  const pct  = Math.min(Math.max((score - MIN) / (MAX - MIN), 0), 1);
  const r    = 46, cx = 60, cy = 62;
  const circ = 2 * Math.PI * r;
  const half = circ / 2;
  const fill = pct * half;

  return (
    <svg width="120" height="78" viewBox="0 0 120 78">
      <defs>
        <clipPath id={uid}>
          <rect x="0" y="0" width="120" height="62" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid})`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="10"
          strokeDasharray={`${half} ${half}`}
          transform={`rotate(-180,${cx},${cy})`} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${fill} ${circ - fill}`}
          transform={`rotate(-180,${cx},${cy})`} strokeLinecap="round" />
      </g>
      <text x={cx} y={54} textAnchor="middle" fontSize="20" fontWeight="900" fill="#111827">
        {score?.toLocaleString() ?? '—'}
      </text>
      <text x={cx} y={70} textAnchor="middle" fontSize="10" fill="#9ca3af" letterSpacing="0.5">
        Credit Score
      </text>
    </svg>
  );
}

// ── Risk card ─────────────────────────────────────────────────────────────────
function RiskCard({ title, band, creditScore, probability }) {
  const info = bandInfo(band);
  const bandNum = band?.replace('band_', '') ?? '';
  return (
    <div className="risk-card" style={{ borderTop: `4px solid ${info.border}` }}>
      <div className="card-title">{title}</div>
      <div className="card-body-center">
        <div className="band-badge" style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}` }}>
          Band {bandNum} · {info.label}
        </div>
        <CreditGauge score={creditScore} color={info.color} />
      </div>
      <div className="prob-section">
        <div className="prob-row">
          <div className="prob-label">Default Probability</div>
          <div className="prob-value" style={{ color: info.color }}>
            {parseProb(probability) != null ? `${parseProb(probability)}%` : '—'}
          </div>
        </div>
        <div className="prob-bar-bg">
          <div className="prob-bar-fill"
            style={{ width: `${Math.min(parseProb(probability) ?? 0, 100)}%`, background: info.color }} />
        </div>
      </div>
    </div>
  );
}

// ── Trust Score card ──────────────────────────────────────────────────────────
function TrustScoreCard({ data }) {
  const score   = computeTrustScore(data);
  if (score == null) return null;
  const verdict = trustVerdict(score);
  const pct     = score;

  return (
    <div className="trust-card" style={{ borderColor: verdict.border }}>
      <div className="trust-left">
        <div className="trust-verdict-label">Overall Verdict</div>
        <div className="trust-verdict" style={{ background: verdict.bg, color: verdict.color, border: `2px solid ${verdict.border}` }}>
          {verdict.label}
        </div>
        <div className="trust-sub">Based on 3 ML model signals</div>
      </div>
      <div className="trust-right">
        <div className="trust-score-label">Trust Score</div>
        <div className="trust-score-num" style={{ color: verdict.color }}>{score}</div>
        <div className="trust-bar-bg">
          <div className="trust-bar-fill" style={{ width: `${pct}%`, background: verdict.color }} />
        </div>
        <div className="trust-bar-ends">
          <span>0 — High Risk</span><span>100 — Low Risk</span>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="empty-state">
      <h2 className="empty-title">Run a scan to see the output</h2>
      <p className="empty-sub">
        Pick a sample number above, or type any 10-digit number. We'll show you exactly what
        TS 1.0 and TS 2.0 return for the same input.
      </p>
      <div className="empty-cards">
        <div className="empty-card">
          <div className="empty-card-title">TS 1.0 will show</div>
          <div className="empty-card-body">
            One risk band (A–G), the customer's name &amp; meaning, and where they sit relative to the network.
          </div>
        </div>
        <div className="empty-card">
          <div className="empty-card-title">TS 2.0 will show</div>
          <div className="empty-card-body">
            30/90-day default risk, customer-durable loan score, predicted income, customer cohort, and DE-layer variables.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared phone input form ───────────────────────────────────────────────────
function PhoneForm({ onSubmit, loading }) {
  const [phone, setPhone] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (phone.length !== 10) return;
    onSubmit(phone);
  }

  return (
    <form className="search-box" onSubmit={handleSubmit}>
      <div className="phone-input-wrap">
        <span className="phone-prefix">+91</span>
        <input type="tel" className="phone-input" placeholder="Enter 10-digit phone number"
          value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
          maxLength={10} autoFocus />
      </div>
      <button type="submit" className="scan-btn" disabled={loading || phone.length !== 10}>
        {loading ? <><span className="spinner" /> Scanning…</> : 'SCAN NOW'}
      </button>
    </form>
  );
}

// ── TS 1.0 band grid — all 7 bands, customer's band highlighted ───────────────
const TS1_BANDS = ['A','B','C','D','E','F','G'];

function Ts1BandGrid({ band: customerBand, allBands }) {
  const [hovered, setHovered] = useState(null);

  const row1 = allBands.slice(0, 4); // A B C D
  const row2 = allBands.slice(4);    // E F G

  function renderTile(b) {
    const info = ts1BandInfo(b);
    const isCustomer = b === customerBand;
    const isHovered  = hovered === b;
    return (
      <div
        key={b}
        className={`ts1-tile ${isCustomer ? 'ts1-tile-customer' : 'ts1-tile-other'}`}
        style={{
          borderColor: isCustomer ? info.border : '#e5e7eb',
          background:  isCustomer ? info.bg    : 'white',
        }}
        onMouseEnter={() => setHovered(b)}
        onMouseLeave={() => setHovered(null)}
      >
        <div className="ts1-tile-letter" style={{ color: isCustomer ? info.color : '#9ca3af' }}>
          {b}
        </div>
        <div className="ts1-tile-name" style={{ color: isCustomer ? info.color : '#6b7280' }}>
          {info.label}
        </div>
        {isCustomer && <div className="ts1-tile-you">Your Customer</div>}

        {isHovered && (
          <div className="ts1-tile-tooltip" style={{ borderColor: info.border }}>
            <div className="ts1-tooltip-header" style={{ color: info.color }}>
              Band {b} · {info.label}
            </div>
            <ul className="ts1-tooltip-bullets">
              {info.bullets.map((pt, i) => <li key={i}>{pt}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ts1-grid-wrap">
      <div className="ts1-grid-row ts1-row-top">{row1.map(renderTile)}</div>
      <div className="ts1-grid-row ts1-row-bottom">{row2.map(renderTile)}</div>
      <div className="ts1-grid-legend">
        <span style={{ color: '#059669' }}>◀ Lower Risk</span>
        <span style={{ color: '#9ca3af' }}>Higher Risk ▶</span>
      </div>
    </div>
  );
}

// ── Trust Scan 1.0 view ───────────────────────────────────────────────────────

function TrustScan1View() {
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [phone,    setPhone]    = useState('');

  async function handleScan(ph) {
    setPhone(ph);
    setLoading(true); setError(null); setResult(null); setNotFound(false);
    try {
      const [res] = await Promise.all([
        fetch(`/api/trust-scan/${ph}`),
        new Promise(r => setTimeout(r, 2000)),
      ]);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error((await res.json()).detail || 'Scan failed');
      setResult(await res.json());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  const band = result?.ts1_band?.trim();

  return (
    <>
      <PhoneForm onSubmit={handleScan} loading={loading} />
      <ScanSteps active={loading} />

      {notFound && !loading && (
        <div className="status-box not-found">
          <span className="status-icon">🔍</span>
          <h3>No Profile Found</h3>
          <p>+91 {phone} is not in our dataset.</p>
        </div>
      )}
      {error && !loading && (
        <div className="status-box error-box">
          <span className="status-icon">⚠️</span>
          <h3>Something went wrong</h3><p>{error}</p>
        </div>
      )}

      {!result && !loading && !notFound && !error && <EmptyState />}

      {result && !loading && (
        <div className="results">
          <div className="results-header">
            <div>
              <span className="customer-label">Customer</span>
              <span className="customer-number">+91 {result.phone}</span>
            </div>
            <div className="data-date">Trust Scan 1.0</div>
          </div>

          {band ? (
            <Ts1BandGrid band={band} allBands={TS1_BANDS} />
          ) : (
            <div className="status-box not-found">
              <span className="status-icon">📊</span>
              <h3>No TS 1.0 Band Available</h3>
              <p>This contact has no Trust Scan 1.0 data. Try Trust Scan 2.0 for detailed signals.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Trust Scan 2.0 view ───────────────────────────────────────────────────────
function TrustScan2View() {
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [phone,    setPhone]    = useState('');

  async function handleScan(ph) {
    setPhone(ph);
    setLoading(true); setError(null); setResult(null); setNotFound(false);
    try {
      const [res] = await Promise.all([
        fetch(`/api/trust-scan/${ph}`),
        new Promise(r => setTimeout(r, 2000)),
      ]);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error((await res.json()).detail || 'Scan failed');
      setResult(await res.json());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <>
      <PhoneForm onSubmit={handleScan} loading={loading} />
      <ScanSteps active={loading} />

      {notFound && !loading && (
        <div className="status-box not-found">
          <span className="status-icon">🔍</span>
          <h3>No Profile Found</h3>
          <p>+91 {phone} is not in our dataset.</p>
        </div>
      )}
      {error && !loading && (
        <div className="status-box error-box">
          <span className="status-icon">⚠️</span>
          <h3>Something went wrong</h3><p>{error}</p>
        </div>
      )}

      {!result && !loading && !notFound && !error && <EmptyState />}

      {result && !loading && (
        <div className="results">
          <div className="results-header">
            <div>
              <span className="customer-label">Customer</span>
              <span className="customer-number">+91 {result.phone}</span>
            </div>
            <div className="data-date">Data as of {result.dpd_date || result.cd_date}</div>
          </div>

          <TrustScoreCard data={result} />

          <div className="section-label">CREDIT RISK PROFILE</div>
          <div className="cards-grid">
            {result.dpd30_band && <RiskCard title="30-Day Default Risk"
              band={result.dpd30_band} creditScore={result.dpd30_credit_score} probability={result.dpd30_probability} />}
            {result.dpd90_band && <RiskCard title="90-Day Default Risk"
              band={result.dpd90_band} creditScore={result.dpd90_credit_score} probability={result.dpd90_probability} />}
            {result.cd_band && <RiskCard title="Credit Demand Score"
              band={result.cd_band} creditScore={result.cd_credit_score} probability={result.cd_probability} />}
          </div>

          {result.predicted_income != null && (
            <>
              <div className="section-label" style={{ marginTop: 28 }}>INCOME PROFILE</div>
              <div className="income-grid">
                <div className="income-card">
                  <div className="income-label">Predicted Annual Income</div>
                  <div className="income-amount">{formatINR(result.predicted_income)}</div>
                  <div className="income-bucket">{result.predicted_income_bucket}</div>
                </div>
                {result.cohort && (
                  <div className="income-card">
                    <div className="income-label">Customer Cohort</div>
                    <div className="cohort-value">{result.cohort}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tier, setTier] = useState('ts2'); // 'ts1' | 'ts2'

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6L12 2z" fill="white" opacity=".9"/>
              <path d="M9 12l2 2 4-4" stroke="#1e3a8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="logo-text">TrustScan</span>
          </div>
          <div className="header-badge">Powered by Razorpay Intelligence</div>
        </div>
      </header>

      <main className="main">
        <div className="hero">
          <h1 className="hero-title">AI-Powered Credit Intelligence</h1>
          <p className="hero-sub">Instant risk profiling & income prediction for any customer</p>
        </div>

        <div className="tabs-row">
          <div className="tabs">
            {[{ id: 'ts1', label: 'Trust Scan 1.0' }, { id: 'ts2', label: 'Trust Scan 2.0' }].map(t => (
              <button key={t.id} className={`tab ${tier === t.id ? 'active' : ''}`} onClick={() => setTier(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: tier === 'ts1' ? 'block' : 'none' }}><TrustScan1View /></div>
        <div style={{ display: tier === 'ts2' ? 'block' : 'none' }}><TrustScan2View /></div>
      </main>

      <footer className="footer">
        © 2025 Razorpay Software Private Limited &nbsp;·&nbsp; TrustScan is for authorised use only
      </footer>
    </div>
  );
}
