import React, { useState, useId, useEffect, useRef } from 'react';
import './App.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function bandInfo(band) {
  // Decile band format (live API): A1 = prob ~1.00 (highest default risk), J10 = prob ~0.01 (lowest)
  // A–B → HIGH RISK, C–D → MEDIUM-HIGH, E–F–G → MEDIUM, H–I–J → LOW RISK
  // K1 = exact zero probability → LOW RISK, Z2 = null → neutral
  if (band && /^[A-Za-z]\d/.test(band)) {
    const l = band[0].toUpperCase();
    if (l === 'K') return { label: 'LOW RISK',    color: '#059669', bg: '#d1fae5', border: '#059669' };
    if (l === 'Z') return { label: 'NO DATA',     color: '#6b7280', bg: '#f3f4f6', border: '#9ca3af' };
    if ('AB'.includes(l))  return { label: 'HIGH RISK',    color: '#dc2626', bg: '#fee2e2', border: '#dc2626' };
    if ('CD'.includes(l))  return { label: 'MEDIUM-HIGH',  color: '#ea580c', bg: '#ffedd5', border: '#ea580c' };
    if ('EFG'.includes(l)) return { label: 'MEDIUM RISK',  color: '#d97706', bg: '#fef3c7', border: '#d97706' };
    if ('HIJ'.includes(l)) return { label: 'LOW RISK',     color: '#059669', bg: '#d1fae5', border: '#059669' };
    return { label: band, color: '#6b7280', bg: '#f3f4f6', border: '#6b7280' };
  }
  // Score-range band format from CSV: band_1 … band_7
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

// Derive overall verdict from decile prob bands (A–J) or raw probabilities.
// For decile bands: A/B = highest default prob = DECLINE, H/I/J = lowest = APPROVE.
// For raw prob %: higher % = higher risk = worse verdict.
function computeTrustScore(data) {
  // Prefer decile bands (live API) — use worst-band letter
  const probBands = [data?.dpd30_prob_band, data?.dpd90_prob_band, data?.cd_prob_band]
    .filter(b => b && /^[A-J]/i.test(b));
  if (probBands.length) {
    const letters = probBands.map(b => b[0].toUpperCase()).filter(l => 'ABCDEFGHIJ'.includes(l)).sort();
    const worst = letters[letters.length - 1];
    // Map worst letter → 0-100 score where 100 = lowest risk
    const letterScore = { A:5, B:15, C:25, D:35, E:45, F:55, G:65, H:75, I:85, J:95 };
    return letterScore[worst] ?? null;
  }
  // Fallback: raw probability percentages from CSV
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
  // score = 0 (highest risk) → 100 (lowest risk)
  if (score >= 60) return { label: 'APPROVE',  color: '#059669', bg: '#d1fae5', border: '#059669' };
  if (score >= 35) return { label: 'REVIEW',   color: '#d97706', bg: '#fef3c7', border: '#d97706' };
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
// ── Income / Data Profile lookup maps ────────────────────────────────────────
const INCOME_BUCKET_MAP = {
  A1: '₹0 – 3L',   B1: '₹3 – 4L',  C1: '₹4 – 6L',
  D1: '₹6 – 10L',  E1: '₹10 – 15L', F1: '₹15 – 25L',
  G1: '₹25L+',     Z2: 'Null',
};
const THICK_THIN_MAP = {
  A1: 'More than 3 annual transactions',
  B1: 'Less than or equal to 3 annual transactions',
  Z2: 'No Razorpay History',
};

// Income bucket: A1=lowest income (red) → G1=highest income (green), Z2=grey
function incomeBandInfo(code) {
  const c = (code || '').toUpperCase();
  if (c === 'Z2') return { color: '#6b7280', bg: '#f3f4f6', border: '#9ca3af' };
  if (c === 'A1') return { color: '#dc2626', bg: '#fee2e2', border: '#dc2626' };
  if (c === 'B1') return { color: '#ea580c', bg: '#ffedd5', border: '#ea580c' };
  if (c === 'C1' || c === 'D1') return { color: '#d97706', bg: '#fef3c7', border: '#d97706' };
  // E1, F1, G1 → green (higher income)
  return { color: '#059669', bg: '#d1fae5', border: '#059669' };
}

// Data profile: A1=thick (green, most data), B1=thin (amber), Z2=no history (grey)
function thickThinBandInfo(code) {
  const c = (code || '').toUpperCase();
  if (c === 'A1') return { color: '#059669', bg: '#d1fae5', border: '#059669' };
  if (c === 'B1') return { color: '#d97706', bg: '#fef3c7', border: '#d97706' };
  return { color: '#6b7280', bg: '#f3f4f6', border: '#9ca3af' };
}

function RiskCard({ title, band }) {
  const info = bandInfo(band);
  // Decile format (A1, B2…): show code directly. Score-range (band_N): show "Band N"
  const isDecile = band && /^[A-Za-z]\d/.test(band);
  const bandDisplay = isDecile ? band.toUpperCase() : `Band ${band?.replace('band_', '') ?? ''}`;
  return (
    <div className="risk-card" style={{ borderTop: `4px solid ${info.border}` }}>
      <div className="card-title">{title}</div>
      <div className="card-body-center">
        <div className="band-badge" style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}` }}>
          {bandDisplay} · {info.label}
        </div>
        <div className="risk-band-icon" style={{ color: info.color }}>
          {info.label === 'LOW RISK' ? '🟢' : info.label === 'MEDIUM RISK' ? '🟡' : info.label === 'MEDIUM-HIGH' ? '🟠' : '🔴'}
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
        <div className="trust-score-label">Risk Tier</div>
        <div className="trust-tier-badge" style={{ background: verdict.bg, color: verdict.color, border: `2px solid ${verdict.border}` }}>
          {verdict.label === 'APPROVE' ? 'LOW RISK' : verdict.label === 'REVIEW' ? 'MEDIUM RISK' : 'HIGH RISK'}
        </div>
        <div className="trust-sub" style={{ marginTop: 8 }}>Composite of DPD-30, DPD-90 & CD signals</div>
      </div>
    </div>
  );
}

// ── Live Enrichment Section ───────────────────────────────────────────────────
const TS2_LIVE_CATEGORIES = [
  {
    key: 'payment_volume',
    icon: 'V',
    label: 'Payment Volume Analysis',
    desc: 'Transaction volume, YoY growth, platform engagement',
    vars: [
      { name: 'thick_thin_data',            desc: 'Indicator of user activity level on the Razorpay platform',                                   scale: 'Discrete' },
      { name: 'yearly_transaction_volume',  desc: 'Aggregate value of all transactions successfully completed in the last 1 year',                scale: 'Decile'   },
      { name: 'yoy_growth_percentage',      desc: 'Year-over-year spends growth in the last 2 years (%)',                                         scale: 'Min-Max'  },
    ],
  },
  {
    key: 'sr_ratio',
    icon: 'SR',
    label: 'SR Ratio',
    desc: 'Success rates, error ratios, decline patterns',
    vars: [
      { name: 'weighted_success_rate',                    desc: 'Weighted transaction success rate across payment methods',                                                        scale: 'Min-Max' },
      { name: 'weighted_error_ratio',                     desc: 'Weighted measure of incomplete payment transactions across methods and time periods',                              scale: 'Min-Max' },
      { name: 'weighted_error_ratio_last_12_weeks',       desc: '% of transactions failed due to risk-identified errors in the last 12 weeks',                                     scale: 'Min-Max' },
      { name: 'weighted_error_ratio_last_24_weeks',       desc: 'Weighted measure of incomplete payment transactions across methods in the last 24 weeks',                         scale: 'Min-Max' },
      { name: 'error_ratio_card',                         desc: '% of card transactions failed due to risk-identified errors (insufficient balance, credit limit exceeded, etc.)', scale: 'Min-Max' },
      { name: 'error_ratio_last_12_weeks_emandate',       desc: '% of e-mandate transactions failed due to risk-identified errors in the last 12 weeks',                          scale: 'Min-Max' },
      { name: 'error_ratio_last_24_weeks_emandate',       desc: '% of e-mandate transactions that did not complete successfully in the last 24 weeks',                            scale: 'Min-Max' },
      { name: 'failed_txn_amount_sum',                    desc: 'Total monetary value of all failed/declined transactions',                                                        scale: 'Min-Max' },
      { name: 'failed_txn_count',                         desc: 'Total count of failed transactions — high rates can indicate lack of funds or risky behaviour',                  scale: 'Min-Max' },
      { name: 'repayment_error_ratio_l12w',               desc: 'Loan repayment transaction failures with risk-identified errors in the last 12 weeks',                           scale: 'Min-Max' },
      { name: 'risky_fails_to_success_trxn_ratio_l12m',  desc: 'Ratio of unsuccessful to successful payment attempts for recurring transactions in the last 12 months',          scale: 'Min-Max' },
      { name: 'risky_fails_to_success_trxn_ratio_l6m',   desc: 'Ratio of unsuccessful to successful payment attempts for recurring transactions in the last 6 months',           scale: 'Min-Max' },
      { name: 'success_rate_last_24_weeks_card',          desc: 'Transaction success rate for card payments in the last 24 weeks',                                                scale: 'Min-Max' },
      { name: 'success_rate_last_24_weeks_emandate',      desc: 'Transaction success rate for e-mandate payments in the last 24 weeks',                                           scale: 'Min-Max' },
    ],
  },
  {
    key: 'spend_propensity',
    icon: '₹',
    label: 'Spend Propensity',
    desc: 'Category-level spend, AOV, vintage, income signals',
    vars: [
      { name: 'avg_amount',                             desc: 'Mean value of successful transactions — proxy for average spending power',                       scale: 'Min-Max'  },
      { name: 'predicted_income_bucket',                desc: 'Spend capacity derived from affluence signal and 98 key variables',                              scale: 'N/A'      },
      { name: 'perc_non_discretionary_spends',          desc: 'Share of spend on essential categories (groceries, utilities, healthcare, financial commitments)',scale: 'Min-Max'  },
      { name: 'upi_payment_amount',                     desc: 'Total payment amount processed via UPI in the last 12 months',                                   scale: 'Decile'   },
      { name: 'ott_trxns_last_1_year',                  desc: 'Total spend on OTT subscriptions in the last 1 year',                                            scale: 'Decile'   },
      { name: 'luxury_category_spend',                  desc: 'Total payment in non-essential categories (dining, entertainment, travel, luxury goods) in 1Y',  scale: 'Decile'   },
      { name: 'total_spend_last_12_weeks',              desc: 'Total spend across all categories in the last 12 weeks',                                         scale: 'Min-Max'  },
      { name: 'weighted_log_aov',                       desc: 'Weighted average order value across spend categories',                                            scale: 'Min-Max'  },
      { name: 'has_failed_high_value_txn',              desc: 'Binary flag — user has any failed high-value transaction (risk signal)',                          scale: 'Min-Max'  },
      { name: 'spend_last_1_year_lending',              desc: 'Total spend on financial services transactions in the last 1 year',                               scale: 'Min-Max'  },
      { name: 'spend_last_24_weeks_lending',            desc: 'Total spend on financial services transactions in the last 24 weeks',                             scale: 'Min-Max'  },
      { name: 'spend_last_12_weeks_lending',            desc: 'Total spend on financial services transactions in the last 12 weeks',                             scale: 'Min-Max'  },
      { name: 'spend_last_1_year_fashion_and_lifestyle',desc: 'Total spend on fashion and lifestyle transactions in the last 1 year',                            scale: 'Min-Max'  },
      { name: 'spend_last_1_year_tours_and_travel',     desc: 'Total spend on travel transactions in the last 1 year',                                          scale: 'Min-Max'  },
      { name: 'spend_last_1_year_government',           desc: 'Total spend on government transactions in the last 1 year',                                      scale: 'Min-Max'  },
      { name: 'log_aov_gold',                           desc: 'Average order value for gold transactions',                                                       scale: 'Min-Max'  },
      { name: 'log_aov_utilities',                      desc: 'Average order value for utility transactions',                                                    scale: 'Min-Max'  },
      { name: 'log_aov_last_12_weeks_ecommerce',        desc: 'Average order value for e-commerce transactions in the last 12 weeks',                           scale: 'Min-Max'  },
      { name: 'log_aov_last_12_weeks_services',         desc: 'Average order value for services transactions in the last 12 weeks',                             scale: 'Min-Max'  },
      { name: 'log_aov_last_12_weeks_utilities',        desc: 'Average order value for utility transactions in the last 12 weeks',                              scale: 'Min-Max'  },
      { name: 'log_aov_last_24_weeks_ecommerce',        desc: 'Average order value for e-commerce transactions in the last 24 weeks',                           scale: 'Min-Max'  },
      { name: 'log_aov_last_24_weeks_utilities',        desc: 'Average order value for utility transactions in the last 24 weeks',                              scale: 'Min-Max'  },
      { name: 'l12m_aov_astrology',                     desc: 'Average transaction value in the astrology category in the last 12 months',                      scale: 'Decile'   },
      { name: 'l12m_spend_astrology',                   desc: 'Total spend in the astrology category in the last 12 months',                                    scale: 'Decile'   },
      { name: 'l12m_aov_real_estate',                   desc: 'Average order value for real estate-related transactions in the last 12 months',                 scale: 'Min-Max'  },
      { name: 'l12m_spend_micro_drama',                 desc: 'Total spend on micro drama content/platforms in the last 12 months',                             scale: 'Decile'   },
      { name: 'l3m_aov_astrology',                      desc: 'Average transaction value in the astrology category in the last 3 months',                       scale: 'Decile'   },
      { name: 'l3m_spend_astrology',                    desc: 'Total spend in the astrology category in the last 3 months',                                     scale: 'Decile'   },
      { name: 'l3m_spend_micro_drama',                  desc: 'Total spend on micro drama content/platforms in the last 3 months',                              scale: 'Decile'   },
      { name: 'vintage_education',                      desc: 'Months since first payment in education category',                                                scale: 'Min-Max'  },
      { name: 'vintage_investments',                    desc: 'Months since first payment in investments category',                                              scale: 'Min-Max'  },
      { name: 'vintage_services',                       desc: 'Months since first payment in services category',                                                 scale: 'Min-Max'  },
      { name: 'vintage_utilities',                      desc: 'Months since first payment in utilities category',                                                scale: 'Min-Max'  },
    ],
  },
  {
    key: 'demographic',
    icon: 'D',
    label: 'Demographic',
    desc: 'Network tenure and geographic spread',
    vars: [
      { name: 'max_vintage',           desc: 'Vintage across all digital payment channels (months)',      scale: 'Min-Max' },
      { name: 'unique_city_transacted',desc: 'Number of unique cities in which transactions were made',   scale: 'Min-Max' },
      { name: 'unique_state_transacted',desc: 'Number of unique states in which transactions were made',  scale: 'Min-Max' },
    ],
  },
  {
    key: 'credit_propensity',
    icon: 'CP',
    label: 'Credit Propensity',
    desc: 'Loan stacking and credit card usage signals',
    vars: [
      { name: 'count_issuer_cc',           desc: 'Count of distinct credit card issuers used for transactions in the last 5 years',           scale: 'Min-Max' },
      { name: 'loan_stacking_amount_l3m',  desc: 'Total payment volume towards financial services merchants in the last 3 months',            scale: 'Min-Max' },
      { name: 'loan_stacking_amount_l6m',  desc: 'Total payment volume towards financial services merchants in the last 6 months',            scale: 'Min-Max' },
      { name: 'unique_lenders_last_1_years',desc: 'Count of distinct financial services merchants transacted with in the last 1 year',        scale: 'Min-Max' },
    ],
  },
];

function LiveEnrichmentSection({ liveAttrs }) {
  // All categories collapsed by default
  const [openCats, setOpenCats] = useState(new Set());

  if (!liveAttrs) return null;

  const totalVars = TS2_LIVE_CATEGORIES.reduce((s, c) => s + c.vars.length, 0);
  const returnedCount = TS2_LIVE_CATEGORIES.reduce((s, c) =>
    s + c.vars.filter(v => liveAttrs[v.name] && liveAttrs[v.name] !== '').length, 0);

  function toggleCat(key) {
    setOpenCats(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="enrich-section">
      <div className="enrich-header">
        <span className="section-label" style={{ margin: 0 }}>LIVE ENRICHMENT VARIABLES</span>
        <span className="enrich-count">{returnedCount} / {totalVars} returned · compliance-approved · refreshed weekly</span>
      </div>

      {TS2_LIVE_CATEGORIES.map(cat => {
        const isOpen = openCats.has(cat.key);
        const catReturned = cat.vars.filter(v => liveAttrs[v.name] && liveAttrs[v.name] !== '').length;
        return (
          <div key={cat.key} className="enrich-cat">
            <button className="enrich-cat-head" onClick={() => toggleCat(cat.key)}>
              <span className="enrich-cat-icon">{cat.icon}</span>
              <span className="enrich-cat-info">
                <span className="enrich-cat-label">{cat.label}</span>
                <span className="enrich-cat-desc">{cat.desc}</span>
              </span>
              <span className="enrich-cat-count">{catReturned}/{cat.vars.length}</span>
              <span className={`enrich-arrow ${isOpen ? 'open' : ''}`}>›</span>
            </button>
            {isOpen && (
              <div className="enrich-cat-body">
                <div className="enrich-grid">
                  {cat.vars.map(v => {
                    const val = liveAttrs[v.name] || '';
                    const missing = !val;
                    const bi = val ? bandInfo(val) : null;
                    return (
                      <div key={v.name} className={`enrich-card ${missing ? 'enrich-card-missing' : ''}`}>
                        <div className="enrich-card-top">
                          <code className="enrich-var-name">{v.name}</code>
                          <span className="enrich-scale">{v.scale}</span>
                        </div>
                        <div
                          className="enrich-band"
                          style={bi ? { background: bi.bg, color: bi.color, border: `1px solid ${bi.border}` } : {}}
                        >
                          {val || '—'}
                        </div>
                        <div className="enrich-var-desc">{v.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="de-disclaimer" style={{ marginTop: 12 }}>
        <span className="de-disclaimer-icon">i</span>
        <span>
          <strong>Values are band codes</strong> — each letter-number pair (e.g. E4, B1) is a decile or min-max band.
          Actual underlying values are not disclosed for compliance reasons.
        </span>
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
        fetch(`/api/scan/${ph}`),
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

  return { result, loading, error, notFound, phone, setPhone };
}

// ── Trust Scan 1.0 view ───────────────────────────────────────────────────────
function TrustScan1View({ preselect, onScan }) {
  const { result, loading, error, notFound, phone, setPhone } = useScanState(preselect);
  const band = result?.ts1_band?.trim();

  return (
    <>
      <PhoneForm phone={phone} setPhone={setPhone} onSubmit={onScan} loading={loading} />
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

// ── SHA-256 hash strip (TS 2.0 only) ─────────────────────────────────────────
function ShaStrip({ phone }) {
  const [hash, setHash] = useState('');

  useEffect(() => {
    if (phone.length !== 10) { setHash(''); return; }
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(phone))
      .then(buf => setHash([...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')));
  }, [phone]);

  if (!hash) return null;
  return (
    <div className="sha-strip">
      <span className="sha-label">SHA-256</span>
      <code className="sha-value">{hash}</code>
      <span className="sha-note">TS 2.0 only sees the hash, not the raw number.</span>
    </div>
  );
}

// ── Trust Scan 2.0 view ───────────────────────────────────────────────────────
function TrustScan2View({ preselect, onScan }) {
  const { result, loading, error, notFound, phone, setPhone } = useScanState(preselect);

  return (
    <>
      <PhoneForm phone={phone} setPhone={setPhone} onSubmit={onScan} loading={loading} />
      <ShaStrip phone={phone} />
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
          <div className="section-label">CREDIT RISK PROFILE</div>
          <div className="cards-grid">
            {result.dpd30_band && <RiskCard title="30-Day Default Risk" band={result.dpd30_band} />}
            {result.dpd90_band && <RiskCard title="90-Day Default Risk" band={result.dpd90_band} />}
            {result.cd_band && <RiskCard title="Customer Durable Loans Score" band={result.cd_band} />}
          </div>

          {(result.predicted_income_bucket || result.thick_thin_data) && (
            <>
              <div className="section-label" style={{ marginTop: 24 }}>INCOME PROFILE</div>
              <div className="cards-grid">
                {result.predicted_income_bucket && (() => {
                  const code = (result.predicted_income_bucket || '').toUpperCase();
                  const label = INCOME_BUCKET_MAP[code] || code;
                  const info = incomeBandInfo(code);
                  return (
                    <div className="risk-card" style={{ borderTop: `4px solid ${info.border}` }}>
                      <div className="card-title">Predicted Income Band</div>
                      <div className="card-body-center">
                        <div className="band-badge" style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}`, fontSize: 22, fontWeight: 900, padding: '6px 18px' }}>
                          {code}
                        </div>
                        <div style={{ fontSize: 12, color: info.color, marginTop: 8, fontWeight: 500 }}>{label}</div>
                      </div>
                    </div>
                  );
                })()}
                {result.thick_thin_data && (() => {
                  const code = (result.thick_thin_data || '').toUpperCase();
                  const label = THICK_THIN_MAP[code] || code;
                  const info = thickThinBandInfo(code);
                  return (
                    <div className="risk-card" style={{ borderTop: `4px solid ${info.border}` }}>
                      <div className="card-title">Data Profile</div>
                      <div className="card-body-center">
                        <div className="band-badge" style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}`, fontSize: 22, fontWeight: 900, padding: '6px 18px' }}>
                          {code}
                        </div>
                        <div style={{ fontSize: 12, color: info.color, marginTop: 8, fontWeight: 500 }}>{label}</div>
                      </div>
                    </div>
                  );
                })()}
                {result.cohort && (
                  <div className="risk-card" style={{ borderTop: '4px solid #4f46e5' }}>
                    <div className="card-title">Customer Cohort</div>
                    <div className="card-body-center">
                      <div className="band-badge" style={{ background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', fontSize: 22, fontWeight: 900, padding: '6px 18px' }}>
                        {result.cohort}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <LiveEnrichmentSection liveAttrs={result.live_attrs} />
        </div>
      )}
    </>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tier,     setTier]   = useState('ts1');
  const [selected, setSelected] = useState(null);

  function handleScan(ph) {
    setSelected({ phone: ph, ts: Date.now() });
  }

  return (
    <div className="app">}

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
        <div className="content-layout">
          <SampleSidebar selected={selected?.phone} onSelect={handleScan} />

          <div className="content-main">
            <div className="content-hero">
              <div className="hero-eyebrow">CREDIT INTELLIGENCE</div>
              <h1 className="hero-title">Risk-profile any customer in real time</h1>
              <p className="hero-sub">ML-powered default risk, credit-demand bands, and income predictions — direct from the Razorpay TrustScan API.</p>
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

            <div style={{ display: tier === 'ts1' ? 'block' : 'none' }}>
              <TrustScan1View preselect={selected} onScan={handleScan} />
            </div>
            <div style={{ display: tier === 'ts2' ? 'block' : 'none' }}>
              <TrustScan2View preselect={selected} onScan={handleScan} />
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        <span>TrustScan Analytics · v1.0</span>
        <span className="footer-div" />
        <span>Live API · Razorpay TrustScan</span>
        <span className="footer-div" />
        <span>© Razorpay · Internal use only</span>
      </footer>
    </div>
  );
}
