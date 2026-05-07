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

function formatINR(amount) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(amount);
}

// Parse probability string (e.g. "1.391E-1") → percentage string "13.91"
function formatProb(val) {
  if (val == null || val === '') return null;
  const num = parseFloat(val);
  if (isNaN(num)) return null;
  return (num * 100).toFixed(2);
}

// Weighted average of available default probabilities → Trust Score 0-100
function computeTrustScore(data) {
  const slots = [
    { val: parseFloat(data?.dpd30_probability), w: 35 },
    { val: parseFloat(data?.dpd90_probability), w: 35 },
    { val: parseFloat(data?.cd_probability),    w: 30 },
  ].filter(s => !isNaN(s.val));
  if (!slots.length) return null;
  const totalW = slots.reduce((s, x) => s + x.w, 0);
  const avgProb = slots.reduce((s, x) => s + x.val * x.w, 0) / totalW;
  return Math.round(100 - avgProb * 100);
}

function trustVerdict(score) {
  if (score >= 65) return { label: 'APPROVE',  color: '#059669', bg: '#d1fae5', border: '#059669' };
  if (score >= 45) return { label: 'REVIEW',   color: '#d97706', bg: '#fef3c7', border: '#d97706' };
  return                  { label: 'DECLINE',  color: '#dc2626', bg: '#fee2e2', border: '#dc2626' };
}

function exportCSV(rows) {
  const headers = [
    'Phone','Trust Score','Verdict',
    'DPD30 Band','DPD30 Score','DPD30 Prob %',
    'DPD90 Band','DPD90 Score','DPD90 Prob %',
    'CD Band','CD Score','CD Prob %',
    'Predicted Income','Income Bucket','Cohort',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const score = computeTrustScore(r);
    const v = score != null ? trustVerdict(score).label : '';
    lines.push([
      r.phone, score ?? '', v,
      r.dpd30_band ?? '', r.dpd30_credit_score ?? '', r.dpd30_probability ?? '',
      r.dpd90_band ?? '', r.dpd90_credit_score ?? '', r.dpd90_probability ?? '',
      r.cd_band ?? '', r.cd_credit_score ?? '', r.cd_probability ?? '',
      r.predicted_income ?? '', r.predicted_income_bucket ?? '', r.cohort ?? '',
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = 'trust_scan_results.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Scan steps loading animation ─────────────────────────────────────────────
const SCAN_STEPS = [
  { text: 'Scanning from Razorpay universe', duration: 700  },
  { text: 'Hashing · Unhashing',             duration: 700  },
  { text: 'Getting predicted values',        duration: null },  // stays until done
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
            {formatProb(probability) != null ? `${formatProb(probability)}%` : '—'}
          </div>
        </div>
        <div className="prob-bar-bg">
          <div className="prob-bar-fill"
            style={{ width: `${Math.min(parseFloat(formatProb(probability)) ?? 0, 100)}%`, background: info.color }} />
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
  const pct     = score; // 0-100

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

// ── Single scan tab ───────────────────────────────────────────────────────────
function SingleScan() {
  const [phone, setPhone]       = useState('');
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [notFound, setNotFound] = useState(false);

  async function handleScan(e) {
    e.preventDefault();
    if (phone.length !== 10) return;
    setLoading(true); setError(null); setResult(null); setNotFound(false);
    try {
      const [res] = await Promise.all([
        fetch(`/api/trust-scan/${phone}`),
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
      <form className="search-box" onSubmit={handleScan}>
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

// ── Batch scan tab ────────────────────────────────────────────────────────────
function BatchScan() {
  const [input, setInput]     = useState('');
  const [rows, setRows]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [progress, setProgress] = useState('');

  async function handleBatch(e) {
    e.preventDefault();
    const phones = [...new Set(
      input.split(/[\n,\s]+/).map(p => p.replace(/\D/g, '')).filter(p => p.length === 10)
    )];
    if (!phones.length) { setError('No valid 10-digit numbers found.'); return; }
    setLoading(true); setError(null); setRows(null);
    setProgress(`Scanning ${phones.length} numbers…`);
    try {
      const res = await fetch('/api/batch-trust-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Batch scan failed');
      const data = await res.json();
      setRows(data.results);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); setProgress(''); }
  }

  const sorted = rows ? [...rows].sort((a, b) => {
    const sa = computeTrustScore(a) ?? -1;
    const sb = computeTrustScore(b) ?? -1;
    return sb - sa; // highest trust score first
  }) : [];

  return (
    <>
      <form className="batch-form" onSubmit={handleBatch}>
        <label className="batch-label">
          Paste phone numbers — one per line, comma-separated, or mixed
        </label>
        <textarea className="batch-textarea" rows={6}
          placeholder={"9838433104\n9967010131\n9999554381"}
          value={input} onChange={e => setInput(e.target.value)} />
        <div className="batch-actions">
          <span className="batch-count">
            {input.split(/[\n,\s]+/).filter(p => p.replace(/\D/g,'').length === 10).length} valid numbers detected
          </span>
          <button type="submit" className="scan-btn" disabled={loading}>
            {loading ? <><span className="spinner" /> {progress}</> : 'RUN BATCH SCAN'}
          </button>
        </div>
      </form>

      {error && <div className="status-box error-box" style={{ marginTop: 16 }}>
        <span className="status-icon">⚠️</span><h3>Error</h3><p>{error}</p>
      </div>}

      {rows && (
        <div className="batch-results">
          <div className="batch-results-header">
            <span>{rows.length} results — sorted by Trust Score</span>
            <button className="export-btn" onClick={() => exportCSV(sorted)}>
              ↓ Export CSV
            </button>
          </div>
          <div className="table-wrap">
            <table className="batch-table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Trust Score</th>
                  <th>Verdict</th>
                  <th>DPD30 Band</th>
                  <th>DPD90 Band</th>
                  <th>CD Band</th>
                  <th>Income Bucket</th>
                  <th>Predicted Income</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const score   = computeTrustScore(r);
                  const verdict = score != null ? trustVerdict(score) : null;
                  const notFound = !r.dpd30_band && !r.dpd90_band && !r.cd_band;
                  return (
                    <tr key={r.phone} className={notFound ? 'row-not-found' : ''}>
                      <td className="td-phone">+91 {r.phone}</td>
                      <td className="td-score">
                        {score != null
                          ? <span className="score-pill" style={{ background: verdict.bg, color: verdict.color }}>{score}</span>
                          : <span className="na-pill">N/A</span>}
                      </td>
                      <td>
                        {verdict
                          ? <span className="verdict-pill" style={{ background: verdict.bg, color: verdict.color, border: `1px solid ${verdict.border}` }}>{verdict.label}</span>
                          : <span className="na-pill">Not Found</span>}
                      </td>
                      <td>{r.dpd30_band ? <BandChip band={r.dpd30_band} /> : '—'}</td>
                      <td>{r.dpd90_band ? <BandChip band={r.dpd90_band} /> : '—'}</td>
                      <td>{r.cd_band    ? <BandChip band={r.cd_band}    /> : '—'}</td>
                      <td>{r.predicted_income_bucket ?? '—'}</td>
                      <td>{r.predicted_income != null ? formatINR(r.predicted_income) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function BandChip({ band }) {
  const info = bandInfo(band);
  return (
    <span className="band-chip" style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}` }}>
      {band?.replace('_', ' ')}
    </span>
  );
}

// ── Band-only card (no gauge, just badge + prob band) ─────────────────────────
function BandOnlyCard({ title, band, probBand }) {
  const info = bandInfo(band);
  const bandNum = band?.replace('band_', '') ?? '';
  return (
    <div className="risk-card" style={{ borderTop: `4px solid ${info.border}` }}>
      <div className="card-title">{title}</div>
      <div className="card-body-center">
        <div className="band-badge" style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}` }}>
          Band {bandNum} · {info.label}
        </div>
        {probBand && (
          <div className="prob-band-row">
            <span className="prob-band-label">Prob Band</span>
            <span className="prob-band-value" style={{ color: info.color }}>{probBand}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Single scan (Bands) tab ───────────────────────────────────────────────────
function SingleScanBands() {
  const [phone, setPhone]       = useState('');
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [notFound, setNotFound] = useState(false);

  async function handleScan(e) {
    e.preventDefault();
    if (phone.length !== 10) return;
    setLoading(true); setError(null); setResult(null); setNotFound(false);
    try {
      const [res] = await Promise.all([
        fetch(`/api/bands-scan/${phone}`),
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
      <form className="search-box" onSubmit={handleScan}>
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

      {result && !loading && (
        <div className="results">
          <div className="results-header">
            <div>
              <span className="customer-label">Customer</span>
              <span className="customer-number">+91 {result.phone}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {result.model_version && <span className="data-date">Model {result.model_version}</span>}
              {result.thick_thin_data && <span className="data-date">Data: {result.thick_thin_data}</span>}
              {result.computed_at && <span className="data-date">{result.computed_at.slice(0, 10)}</span>}
            </div>
          </div>

          <div className="section-label">CREDIT RISK BANDS</div>
          <div className="cards-grid">
            {result.dpd30_band && <BandOnlyCard title="30-Day Default Risk"
              band={result.dpd30_band} probBand={result.dpd30_prob_band} />}
            {result.dpd90_band && <BandOnlyCard title="90-Day Default Risk"
              band={result.dpd90_band} probBand={result.dpd90_prob_band} />}
            {result.cd_band && <BandOnlyCard title="CD Default Risk"
              band={result.cd_band} probBand={result.cd_prob_band} />}
          </div>

          {result.predicted_income_bucket && (
            <>
              <div className="section-label" style={{ marginTop: 28 }}>INCOME PROFILE</div>
              <div className="income-grid">
                <div className="income-card">
                  <div className="income-label">Predicted Income Bucket</div>
                  <div className="cohort-value" style={{ fontSize: 28, fontWeight: 900, color: '#1e3a8a' }}>
                    {result.predicted_income_bucket}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ── Batch scan (Bands) tab ────────────────────────────────────────────────────
function BatchScanBands() {
  const [input, setInput]     = useState('');
  const [rows, setRows]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  async function handleBatch(e) {
    e.preventDefault();
    const phones = [...new Set(
      input.split(/[\n,\s]+/).map(p => p.replace(/\D/g, '')).filter(p => p.length === 10)
    )];
    if (!phones.length) { setError('No valid 10-digit numbers found.'); return; }
    setLoading(true); setError(null); setRows(null);
    try {
      const res = await fetch('/api/batch-bands-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Batch scan failed');
      const data = await res.json();
      setRows(data.results);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  function exportBandsCSV(rows) {
    const headers = ['Phone','DPD30 Band','DPD90 Band','CD Band','DPD30 Prob Band','DPD90 Prob Band','CD Prob Band','Income Bucket','Thick/Thin','Model Version','Computed At'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.phone, r.dpd30_band ?? '', r.dpd90_band ?? '', r.cd_band ?? '',
        r.dpd30_prob_band ?? '', r.dpd90_prob_band ?? '', r.cd_prob_band ?? '',
        r.predicted_income_bucket ?? '', r.thick_thin_data ?? '',
        r.model_version ?? '', r.computed_at ?? '',
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = 'bands_scan_results.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <form className="batch-form" onSubmit={handleBatch}>
        <label className="batch-label">
          Paste phone numbers — one per line, comma-separated, or mixed
        </label>
        <textarea className="batch-textarea" rows={6}
          placeholder={"9838433104\n9967010131\n9999554381"}
          value={input} onChange={e => setInput(e.target.value)} />
        <div className="batch-actions">
          <span className="batch-count">
            {input.split(/[\n,\s]+/).filter(p => p.replace(/\D/g,'').length === 10).length} valid numbers detected
          </span>
          <button type="submit" className="scan-btn" disabled={loading}>
            {loading ? <><span className="spinner" /> Scanning…</> : 'RUN BATCH SCAN'}
          </button>
        </div>
      </form>

      {error && <div className="status-box error-box" style={{ marginTop: 16 }}>
        <span className="status-icon">⚠️</span><h3>Error</h3><p>{error}</p>
      </div>}

      {rows && (
        <div className="batch-results">
          <div className="batch-results-header">
            <span>{rows.length} results</span>
            <button className="export-btn" onClick={() => exportBandsCSV(rows)}>↓ Export CSV</button>
          </div>
          <div className="table-wrap">
            <table className="batch-table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>DPD30 Band</th>
                  <th>DPD90 Band</th>
                  <th>CD Band</th>
                  <th>DPD30 Prob Band</th>
                  <th>DPD90 Prob Band</th>
                  <th>CD Prob Band</th>
                  <th>Income Bucket</th>
                  <th>Thick/Thin</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const notFound = !r.dpd30_band && !r.dpd90_band && !r.cd_band;
                  return (
                    <tr key={r.phone} className={notFound ? 'row-not-found' : ''}>
                      <td className="td-phone">+91 {r.phone}</td>
                      <td>{r.dpd30_band ? <BandChip band={r.dpd30_band} /> : '—'}</td>
                      <td>{r.dpd90_band ? <BandChip band={r.dpd90_band} /> : '—'}</td>
                      <td>{r.cd_band    ? <BandChip band={r.cd_band}    /> : '—'}</td>
                      <td>{r.dpd30_prob_band ?? '—'}</td>
                      <td>{r.dpd90_prob_band ?? '—'}</td>
                      <td>{r.cd_prob_band    ?? '—'}</td>
                      <td>{r.predicted_income_bucket ?? '—'}</td>
                      <td>{r.thick_thin_data ?? '—'}</td>
                      <td>{r.model_version   ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('single');

  const tabs = [
    { id: 'single',       label: 'Single Scan' },
    { id: 'batch',        label: 'Batch Scan' },
    { id: 'singleBands',  label: 'Single Scan (Bands)' },
    { id: 'batchBands',   label: 'Batch Scan (Bands)' },
  ];

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

        <div className="tabs">
          {tabs.map(t => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: tab === 'single'      ? 'block' : 'none' }}><SingleScan /></div>
        <div style={{ display: tab === 'batch'       ? 'block' : 'none' }}><BatchScan /></div>
        <div style={{ display: tab === 'singleBands' ? 'block' : 'none' }}><SingleScanBands /></div>
        <div style={{ display: tab === 'batchBands'  ? 'block' : 'none' }}><BatchScanBands /></div>
      </main>

      <footer className="footer">
        © 2025 Razorpay Software Private Limited &nbsp;·&nbsp; TrustScan is for authorised use only
      </footer>
    </div>
  );
}
