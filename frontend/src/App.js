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
      badgeColor: '#166534', badgeBg: '#dcfce7',
      heroDesc: "Top 8% of Razorpay's network — strongest signals across transaction reliability, network tenure, and merchant-mix diversity.",
      cardDesc: 'Top tier — strongest signals across transaction reliability and tenure',
      pct: '~8%',
    },
    'B': {
      label: 'Prime Customers',
      badgeColor: '#065f46', badgeBg: '#d1fae5',
      heroDesc: 'Strong transactors with a healthy credit profile and consistent engagement on Razorpay\'s platform.',
      cardDesc: 'Healthy financial profile, consistent transactional behavior',
      pct: '~22%',
    },
    'C': {
      label: 'Power Customers',
      badgeColor: '#1e40af', badgeBg: '#dbeafe',
      heroDesc: 'Active Razorpay users with good transactional behaviour and moderate creditworthiness.',
      cardDesc: 'High network activity, moderate creditworthiness',
      pct: '~18%',
    },
    'D': {
      label: 'Sub-prime Customers',
      badgeColor: '#92400e', badgeBg: '#fef9c3',
      heroDesc: 'Infrequent transactors with mixed credit signals — manual review recommended before extending credit.',
      cardDesc: 'Mixed signals — caution advised, manual review recommended',
      pct: '~16%',
    },
    'E': {
      label: 'Dormant Customers',
      badgeColor: '#c2410c', badgeBg: '#ffedd5',
      heroDesc: 'Digitally inactive with zero engagement on Razorpay\'s platform in the last 12 months.',
      cardDesc: 'Low recent activity on the Razorpay network',
      pct: '~12%',
    },
    'F': {
      label: 'Risky Customers',
      badgeColor: '#9d174d', badgeBg: '#fce7f3',
      heroDesc: 'Negative engagement history including chargebacks, fraud attempts, and payment declines due to insufficient balance.',
      cardDesc: 'Negative signals across multiple risk models',
      pct: '~9%',
    },
    'G': {
      label: 'New to Razorpay',
      badgeColor: '#5b21b6', badgeBg: '#ede9fe',
      heroDesc: 'No prior activity on Razorpay\'s platform — insufficient signal to score. Recommend richer KYC before extending credit.',
      cardDesc: 'Insufficient signal — recommend richer KYC',
      pct: '~15%',
    },
  };
  return map[band] || { label: 'Unknown', badgeColor: '#6b7280', badgeBg: '#f3f4f6', heroDesc: '', cardDesc: '', pct: '—' };
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

// ── Sample phone sidebar ──────────────────────────────────────────────────────
const SAMPLE_PHONES = [
  {
    band: 'A', label: 'Band A — Elite',
    badgeColor: '#166534', badgeBg: '#dcfce7',
    phones: ['9355518700', '9964129431', '9415341740', '8376993489', '9004414413'],
  },
  {
    band: 'C', label: 'Band C — Power',
    badgeColor: '#1e40af', badgeBg: '#dbeafe',
    phones: ['9936410230', '9949009502', '8853256537', '7676748598', '9835007089'],
  },
  {
    band: 'F', label: 'Band F — Risky',
    badgeColor: '#9d174d', badgeBg: '#fce7f3',
    phones: ['9012135298', '8975529064', '8432870993', '8318252968', '9325513903'],
  },
];

function SampleSidebar({ selected, onSelect }) {
  return (
    <aside className="sample-sidebar">
      <div className="sample-sidebar-title">Sample Numbers</div>
      {SAMPLE_PHONES.map(section => (
        <div key={section.band} className="sample-section">
          <div className="sample-section-header">
            <span className="sample-band-badge" style={{ background: section.badgeBg, color: section.badgeColor }}>
              {section.band}
            </span>
            <span className="sample-section-label" style={{ color: section.badgeColor }}>
              {section.label}
            </span>
          </div>
          <ul className="sample-phone-list">
            {section.phones.map(ph => (
              <li key={ph}>
                <button
                  className={`sample-phone-btn ${selected === ph ? 'sample-phone-active' : ''}`}
                  style={selected === ph ? { background: section.badgeBg, color: section.badgeColor, borderColor: section.badgeColor } : {}}
                  onClick={() => onSelect(ph)}
                >
                  {ph.slice(0, 5)} {ph.slice(5)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}

// ── Shared phone input form (controlled) ──────────────────────────────────────
function PhoneForm({ phone, setPhone, onSubmit, loading }) {
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

// ── TS 1.0 band grid — hero card + full 7-band reference row ─────────────────
const TS1_BANDS = ['A','B','C','D','E','F','G'];

function Ts1BandGrid({ band: customerBand, allBands }) {
  const info = ts1BandInfo(customerBand);

  return (
    <div className="ts1-wrap">

      {/* ── Hero card ── */}
      <div className="ts1-hero">
        <div className="ts1-hero-badge" style={{ background: info.badgeBg, color: info.badgeColor }}>
          {customerBand}
        </div>
        <div className="ts1-hero-body">
          <div className="ts1-hero-eyebrow">RISK PROFILE BAND</div>
          <h2 className="ts1-hero-name">{info.label}</h2>
          <p className="ts1-hero-desc">{info.heroDesc}</p>
          <div className="ts1-hero-meta">
            <span>Approx <strong>{info.pct}</strong> of network</span>
            <span className="ts1-meta-dot">·</span>
            <span>Confidence <strong>High</strong></span>
            <span className="ts1-meta-dot">·</span>
            <span>Model version <strong>TS-1.0.4</strong></span>
          </div>
        </div>
      </div>

      {/* ── Reference row header ── */}
      <div className="ts1-ref-header">
        <span className="ts1-ref-title">WHERE THIS CUSTOMER SITS — FULL BAND REFERENCE</span>
        <span className="ts1-ref-note">% of network is illustrative · From Razorpay TrustScan walkthrough</span>
      </div>

      {/* ── 7-band reference cards ── */}
      <div className="ts1-ref-row">
        {allBands.map(b => {
          const bi = ts1BandInfo(b);
          const isCurrent = b === customerBand;
          return (
            <div key={b} className={`ts1-ref-card ${isCurrent ? 'ts1-ref-current' : ''}`}>
              {isCurrent && <div className="ts1-current-pill">CURRENT</div>}
              <div className="ts1-ref-badge" style={{ background: bi.badgeBg, color: bi.badgeColor }}>
                {b}
              </div>
              <div className="ts1-ref-card-name">{bi.label}</div>
              <div className="ts1-ref-card-desc">{bi.cardDesc}</div>
              <div className="ts1-ref-card-pct"><strong>{bi.pct}</strong> of network</div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

// ── Shared scan view logic ────────────────────────────────────────────────────
function useScanState(preselect) {
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

  // Fire scan automatically when sidebar selects a number
  useEffect(() => {
    if (preselect?.phone) {
      setPhone(preselect.phone);
      handleScan(preselect.phone);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect]);

  return { result, loading, error, notFound, phone, setPhone, handleScan };
}

// ── Trust Scan 1.0 view ───────────────────────────────────────────────────────
function TrustScan1View({ preselect }) {
  const { result, loading, error, notFound, phone, setPhone, handleScan } = useScanState(preselect);
  const band = result?.ts1_band?.trim();

  return (
    <>
      <PhoneForm phone={phone} setPhone={setPhone} onSubmit={handleScan} loading={loading} />
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
function TrustScan2View({ preselect }) {
  const { result, loading, error, notFound, phone, setPhone, handleScan } = useScanState(preselect);

  return (
    <>
      <PhoneForm phone={phone} setPhone={setPhone} onSubmit={handleScan} loading={loading} />
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
  const [tier,    setTier]    = useState('ts2');
  const [selected, setSelected] = useState(null);

  // Each sidebar click generates a new object so useEffect always fires,
  // even if the same number is clicked twice
  function handleSidebarSelect(ph) {
    setSelected({ phone: ph, ts: Date.now() });
  }

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

        <div className="content-layout">
          <SampleSidebar selected={selected?.phone} onSelect={handleSidebarSelect} />

          <div className="content-main">
            <div className="tabs-row">
              <div className="tabs">
                {[{ id: 'ts1', label: 'Trust Scan 1.0' }, { id: 'ts2', label: 'Trust Scan 2.0' }].map(t => (
                  <button key={t.id} className={`tab ${tier === t.id ? 'active' : ''}`} onClick={() => setTier(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: tier === 'ts1' ? 'block' : 'none' }}>
              <TrustScan1View preselect={selected} />
            </div>
            <div style={{ display: tier === 'ts2' ? 'block' : 'none' }}>
              <TrustScan2View preselect={selected} />
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        © 2025 Razorpay Software Private Limited &nbsp;·&nbsp; TrustScan is for authorised use only
      </footer>
    </div>
  );
}
