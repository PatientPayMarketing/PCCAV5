/**
 * PatientPay Senior Living Payment Readiness Assessment
 * CORE ENGINE - Version 5.0
 *
 * V5 REDESIGN: Dramatically reduce friction to maximize lead capture.
 * - 2 segments only: Senior Living (SL) | Skilled Nursing (SNF)
 *   - MC and CCRC merged into SL (same payment workflow)
 * - Email gate moved to END (after results, before PDF download)
 * - SL: 6 scored questions (under 2 minutes)
 * - SNF: 6 scored questions (under 90 seconds)
 * - No contact form upfront — facility type selection is the entry point
 * - Value delivered before asking for anything
 *
 * This file contains all business logic, calculations, and data.
 * It is UI-agnostic and can be used with any presentation layer.
 *
 * DO NOT MODIFY PDF generation functions below (downloadPDFReport and everything
 * below the PDF REPORT GENERATION header). That section belongs to pdf-report teammate.
 *
 * V5.0 Question IDs:
 *   SL Path (6 scored):
 *     1. family_experience     — 4-point scale (Resident Experience + Family Connection) → Family Experience
 *     2. multi_guarantor       — Yes/No/Unsure (Family Connection) → Operations 50% / Family Experience 50%
 *     3. statement_delivery    — Multi-select (Modernization) → Operations
 *     4. payment_methods       — Multi-select (Modernization + Experience) → Family Experience 70% / Competitive 30%
 *     5. staff_time            — Single-select (Operations) → Operations
 *     6. autopay_rate          — Slider 0-100% (Modernization + Operations) → Operations
 *
 *   SNF Path (6 scored):
 *     1. snf_family_experience  — 4-point scale → Family Experience
 *     2. snf_statement_delivery — Multi-select → Collection Efficiency
 *     3. snf_payment_methods    — Multi-select → Collection Efficiency 70% / Family Experience 30%
 *     4. snf_staff_time         — Single-select → Collection Efficiency
 *     5. snf_autopay            — Capability spectrum → Collection Efficiency
 *     6. snf_collection_rate    — Slider 0-100% → Collection Efficiency
 *
 * Scoring: 0-100 per question, weighted by category, overall = weighted average
 * SL Weights: Operations 30% / Family Experience 45% / Competitive 25%
 * SNF Weights: Collection Efficiency 60% / Family Experience 40%
 */

// ============================================
// FACILITY TYPES (SEGMENT ROUTING) — V5: Two segments only
// ============================================
const FacilityTypes = {
  // V5: SL now covers IL, AL, MC, and CCRC — same payment workflow questions
  SL: {
    id: 'SL',
    label: 'Senior Living',
    description: 'Independent Living, Assisted Living, Memory Care, or Life Plan Communities',
    // Category weights: [Operations, Family Experience, Competitive]
    categoryWeights: [0.30, 0.45, 0.25],
    categoryNames: ['Operational Readiness', 'Resident & Family Experience', 'Competitive Position'],
    characteristics: {
      payerMix: '66-95%+ private pay',
      arDaysRange: '30-60 days',
      complexity: 'Simple to Moderate',
      keyFocus: 'Multi-guarantor billing, payment flexibility, autopay adoption, family transparency'
    }
  },
  SNF: {
    id: 'SNF',
    label: 'Skilled Nursing',
    description: '24/7 clinical care including nursing, therapy, and rehabilitation',
    // V5: SNF uses TWO categories: Collection Efficiency (60%) + Family Experience (40%)
    categoryWeights: [0.60, 0.40, 0],
    categoryNames: ['Collection Efficiency', 'Family Experience'],
    useTwoCategories: true,
    characteristics: {
      payerMix: '~25% private pay, 60% Medicaid, 15% Medicare',
      arDaysRange: '56+ days (industry typical)',
      complexity: 'Complex (PatientPay focuses on patient responsibility only)',
      keyFocus: 'Patient responsibility collection, autopay, multi-guarantor billing'
    }
  }
};

// ============================================
// BRAND COLORS (shared across all UIs)
// ============================================
const AssessmentColors = {
  primary: '#072140',
  secondary: '#3c8fc7',
  accent: '#fcc93b',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',

  tempScale: {
    freezing: '#3B82F6',
    cold: '#06B6D4',
    cool: '#10B981',
    mild: '#84CC16',
    warm: '#EAB308',
    hot: '#F97316',
    burning: '#EF4444',
  },

  categories: {
    operational: '#3c8fc7',
    family: '#8B5CF6',
    competitive: '#F59E0B',
  },

  gray: {
    50: '#F8FAFC',
    100: '#F1F5F9',
    200: '#E2E8F0',
    300: '#CBD5E1',
    400: '#94A3B8',
    500: '#64748B',
    600: '#475569',
  }
};

// ============================================
// INDUSTRY STATISTICS (segment-aware) — V5: Two segments
// ============================================
const IndustryStats = {
  universal: {
    operational: [
      { stat: "96%", context: "Reduction in processing time with automation", source: "TransactCare/Oaks Senior Living", sourceRef: 2 },
      { stat: "42%", context: "Finance team time spent on manual payment management", source: "TransactCare", sourceRef: 2 },
      { stat: "10 min to 15 sec", context: "Statement processing time: manual vs. automated", source: "TransactCare", sourceRef: 2 },
    ],
    experience: [
      { stat: "63 million", context: "Americans serve as caregivers", source: "AARP", sourceRef: 4 },
      { stat: "72%", context: "Less likely to miss payments with unified billing", source: "Healthcare Payment Surveys", sourceRef: 9 },
      { stat: "37%", context: "Have missed bills due to payment complexity", source: "Healthcare Payment Surveys", sourceRef: 9 },
    ],
    competitive: [
      { stat: "75%", context: "Want card payment options for long-term care", source: "CareGrove/Visa Research", sourceRef: 11 },
      { stat: "67%", context: "Would choose a facility that accepts cards over one that does not", source: "CareGrove Research", sourceRef: 11 },
      { stat: "82%", context: "Of consumers prefer digital payments", source: "Industry Analysis", sourceRef: 2 },
    ]
  },
  SL: {
    operational: [
      { stat: "30-60 days", context: "Typical A/R days for Senior Living", source: "Industry Analysis", sourceRef: 1 },
      { stat: "66-95%+", context: "Private pay payer mix", source: "Industry Analysis", sourceRef: 1 },
      { stat: "87-90%", context: "Current occupancy rates", source: "NIC MAP", sourceRef: 5 },
    ],
    experience: [
      { stat: "75%", context: "Want credit/debit card options", source: "CareGrove/Visa", sourceRef: 11 },
      { stat: "~100%", context: "Would consider autopay enrollment", source: "CareGrove", sourceRef: 7 },
      { stat: "69%", context: "Willing to pay convenience fee for cards", source: "CareGrove/Visa", sourceRef: 11 },
    ]
  },
  SNF: {
    operational: [
      { stat: "56-100+ days", context: "Typical A/R days (target: 30-40)", source: "Richter Healthcare", sourceRef: 1 },
      { stat: "23%", context: "Private pay payer mix", source: "KFF", sourceRef: 1 },
      { stat: "83.3%", context: "Current occupancy rate", source: "NIC MAP", sourceRef: 5 },
    ],
    experience: [
      { stat: "63%", context: "Medicaid payer mix", source: "KFF", sourceRef: 1 },
      { stat: "14%", context: "Medicare payer mix", source: "KFF", sourceRef: 1 },
      { stat: "0.6%", context: "Median SNF operating margin", source: "Industry Analysis", sourceRef: 1 },
    ]
  }
};

// ============================================
// INDUSTRY BENCHMARKS — V5: Two segments
// ============================================
const IndustryBenchmarks = {
  SL: {
    overall: 58,
    operations: 55,
    family: 60,
    competitive: 58,
    label: 'Senior Living'
  },
  SNF: {
    overall: 48,
    operations: 45,
    family: 52,
    label: 'Skilled Nursing'
  }
};

/**
 * Get performance label comparing user score to industry benchmark
 */
function getPerformanceVsBenchmark(score, benchmark) {
  const diff = score - benchmark;
  if (diff >= 15) return 'significantly above';
  if (diff >= 5) return 'above';
  if (diff >= -5) return 'near';
  if (diff >= -15) return 'below';
  return 'significantly below';
}

// ============================================
// QUESTION DEFINITIONS — V5.0
//
// V5 PHILOSOPHY: Fewer questions, maximum value, email at the end
//
// SL PATH (6 scored questions):
//   1. family_experience     — 4-point scale → Family Experience
//   2. multi_guarantor       — Yes/No/Unsure → Operations 50% / Family Experience 50%
//   3. statement_delivery    — Multi-select → Operations
//   4. payment_methods       — Multi-select → Family Experience 70% / Competitive 30%
//   5. staff_time            — Single-select → Operations
//   6. autopay_rate          — Slider 0-100% → Operations
//
// SNF PATH (6 scored questions):
//   1. snf_family_experience  — 4-point scale → Family Experience
//   2. snf_statement_delivery — Multi-select → Collection Efficiency
//   3. snf_payment_methods    — Multi-select → Collection Efficiency 70% / Family Experience 30%
//   4. snf_staff_time         — Single-select → Collection Efficiency
//   5. snf_autopay            — Capability spectrum → Collection Efficiency
//   6. snf_collection_rate    — Slider 0-100% → Collection Efficiency
// ============================================
const Questions = [
  // ========================================
  // ROUTING QUESTION — V5: Two big buttons, no contact form
  // In V5, this is presented as two large buttons on the landing screen.
  // If facility_type is already set (e.g., from URL param), skip this.
  // ========================================
  {
    id: 'facility_type',
    category: null,
    categoryIndex: null,
    question: "Select your facility type",
    type: "single",
    isRoutingQuestion: true,
    options: [
      { label: "Senior Living", value: "SL", description: "Independent Living, Assisted Living, Memory Care, or Life Plan Communities" },
      { label: "Skilled Nursing", value: "SNF", description: "24/7 clinical care including nursing, therapy, and rehabilitation" }
    ]
  },

  // ========================================
  // SL PATH — 6 Scored Questions
  // Themes: Modernization, Resident Experience, Family Connection
  // ========================================

  // SL-Q1: Family Experience (Resident Experience + Family Connection)
  // Category: Family Experience
  {
    id: 'family_experience',
    category: "Family Experience",
    categoryIndex: 1,
    question: "In the last 90 days, how often has a family contacted your office with a billing question or complaint?",
    type: "single",
    segments: ['SL'],
    options: [
      { label: "Almost never", value: "excellent", score: 100 },
      { label: "A few times", value: "good", score: 75 },
      { label: "Monthly", value: "moderate", score: 45 },
      { label: "Weekly or more", value: "poor", score: 15 }
    ],
    insight: {
      trigger: (val) => val === 'moderate' || val === 'poor',
      message: "37% of families miss bills due to confusion, not inability to pay. Reducing billing complexity directly reduces inbound calls and improves satisfaction.",
      proofPoint: "70% of caregivers spend 2+ hours resolving billing errors"
    }
  },

  // SL-Q2: Multi-Guarantor Billing (Family Connection)
  // Category: Operations 50% / Family Experience 50%
  {
    id: 'multi_guarantor',
    category: "Operations",
    categoryIndex: 0,
    categoryWeights: [
      { index: 0, weight: 0.50 }, // Operations
      { index: 1, weight: 0.50 }  // Family Experience
    ],
    question: "Can your billing system send separate statements to multiple family members sharing the cost of one resident's care?",
    subtext: "62% of caregivers share financial responsibilities with other family members",
    type: "single",
    segments: ['SL'],
    options: [
      { label: "Yes", value: "Yes, automated", score: 100 },
      { label: "Yes, but it requires manual effort", value: "Yes, manually", score: 55 },
      { label: "No", value: "No", score: 15 },
      { label: "Not sure", value: "Unsure", score: 25 }
    ],
    insight: {
      trigger: (val) => val === 'No' || val === 'Unsure' || val === 'Yes, manually',
      message: "37% of families miss payments due to billing complexity. Multi-guarantor billing with individual statements eliminates 'who paid what?' confusion.",
      proofPoint: "72% less likely to miss payments with unified billing"
    }
  },

  // SL-Q3: Statement Delivery Methods (Modernization)
  // Category: Operations
  {
    id: 'statement_delivery',
    category: "Operations",
    categoryIndex: 0,
    question: "How does your community deliver billing statements to families?",
    subtext: "The average senior living community uses 2+ delivery channels",
    type: "multi",
    segments: ['SL'],
    options: [
      { label: "Paper mail", score: 10 },
      { label: "Email", score: 30 },
      { label: "Text or SMS", score: 30 },
      { label: "Online portal", score: 30 }
    ],
    maxScore: 100,
    exclusiveOption: {
      label: "Paper mail only",
      score: 10,
      insight: "82% of consumers prefer digital payment methods. Paper-only statements take 2-3 weeks longer to convert to cash."
    },
    insight: {
      trigger: (val) => Array.isArray(val) && val.length === 1 && val[0] === 'Paper mail',
      message: "98% text message open rate vs. 20% for direct mail. Digital delivery converts to payment 15-20 days faster than paper.",
      proofPoint: "Digital statements convert to cash 2-3 weeks faster"
    }
  },

  // SL-Q4: Payment Methods Accepted (Modernization + Experience)
  // Category: Family Experience 70% / Competitive 30%
  {
    id: 'payment_methods',
    category: "Family Experience",
    categoryIndex: 1,
    categoryWeights: [
      { index: 1, weight: 0.70 }, // Family Experience (primary)
      { index: 2, weight: 0.30 }  // Competitive Position (secondary)
    ],
    question: "Which payment methods does your community currently accept?",
    subtext: "Select all that apply. Communities offering 4+ payment options see faster collection.",
    type: "multi",
    segments: ['SL'],
    options: [
      { label: "Paper checks or money orders", score: 10 },
      { label: "ACH or bank transfer", score: 20 },
      { label: "Credit cards", score: 25 },
      { label: "Debit cards", score: 25 },
      { label: "Autopay or recurring payments", score: 20 }
    ],
    maxScore: 100,
    exclusiveOption: {
      label: "Paper checks only",
      score: 10,
      insight: "75% of long-term care bill payers want credit/debit card options. 67% would choose a facility that accepts cards over one that does not."
    }
  },

  // SL-Q5: Staff Time on Manual Billing (Operations)
  // Category: Operations
  {
    id: 'staff_time',
    category: "Operations",
    categoryIndex: 0,
    question: "How many hours per week does your billing team spend on manual payment tasks such as printing statements, processing checks, and following up on unpaid balances?",
    type: "single",
    segments: ['SL'],
    options: [
      { label: "Less than 5 hours", value: "minimal", score: 100 },
      { label: "5 to 15 hours", value: "moderate", score: 70 },
      { label: "15 to 30 hours", value: "significant", score: 40 },
      { label: "30+ hours", value: "excessive", score: 10 },
      { label: "Not sure", value: "unsure", score: 35 }
    ],
    insight: {
      trigger: (val) => val === 'significant' || val === 'excessive',
      message: "At an average billing staff cost of $25/hour, that manual effort represents significant annual cost that automation can recover.",
      proofPoint: "42% of finance team time is spent on manual payment processing"
    }
  },

  // SL-Q6: Autopay Rate (Modernization + Operations)
  // Category: Operations
  {
    id: 'autopay_rate',
    category: "Operations",
    categoryIndex: 0,
    question: "Approximately what percentage of families are enrolled in autopay or recurring payments?",
    type: "slider",
    segments: ['SL'],
    min: 0,
    max: 100,
    default: 20,
    unit: "%",
    benchmark: 50,
    benchmarkLabel: "High-performing communities: 50%+",
    scoring: (val) => {
      if (val >= 80) return 100;
      if (val >= 65) return 90;
      if (val >= 50) return 80;
      if (val >= 35) return 65;
      if (val >= 20) return 45;
      return 25;
    },
    insight: {
      trigger: (val) => val < 40,
      message: "Nearly 100% of card-paying families would consider autopay. Your {value}% enrollment represents significant untapped potential.",
      proofPoint: "Autopay reduces AR days and creates predictable monthly cash flow"
    }
  },

  // ========================================
  // SNF PATH — 6 Scored Questions
  // Focus: Patient responsibility collection
  // ========================================

  // SNF-Q1: Family Experience (opener)
  // Category: Family Experience
  {
    id: 'snf_family_experience',
    category: "Family Experience",
    categoryIndex: 1,
    question: "In the last 90 days, how often has a patient or family member contacted your office with a billing question or complaint?",
    type: "single",
    segments: ['SNF'],
    options: [
      { label: "Almost never", value: "excellent", score: 100 },
      { label: "A few times", value: "good", score: 75 },
      { label: "Monthly", value: "moderate", score: 45 },
      { label: "Weekly or more", value: "poor", score: 15 }
    ],
    insight: {
      trigger: (val) => val === 'moderate' || val === 'poor',
      message: "37% of families miss bills due to confusion, not inability to pay. Clear, modern billing directly reduces complaints.",
      proofPoint: "70% of caregivers spend 2+ hours resolving billing errors"
    }
  },

  // SNF-Q2: Statement Delivery Methods
  // Category: Collection Efficiency
  {
    id: 'snf_statement_delivery',
    category: "Collection Efficiency",
    categoryIndex: 0,
    question: "How does your facility deliver billing statements to patients and families?",
    subtext: "Select all that apply. Text-to-pay achieves 60% payment rate vs. 43% industry average.",
    type: "multi",
    segments: ['SNF'],
    options: [
      { label: "Paper mail", score: 10 },
      { label: "Email", score: 30 },
      { label: "Text or SMS", score: 30 },
      { label: "Online portal", score: 30 }
    ],
    maxScore: 100,
    exclusiveOption: {
      label: "Paper mail only",
      score: 10,
      insight: "98% text message open rate vs. 20% for direct mail. Text-to-pay achieves 60% payment rate vs. 43% industry average."
    }
  },

  // SNF-Q3: Payment Methods (cross-category)
  // Category: Collection Efficiency 70% / Family Experience 30%
  {
    id: 'snf_payment_methods',
    category: "Collection Efficiency",
    categoryIndex: 0,
    categoryWeights: [
      { index: 0, weight: 0.70 }, // Collection Efficiency (primary)
      { index: 1, weight: 0.30 }  // Family Experience (convenience)
    ],
    question: "Which payment methods does your facility currently accept for patient responsibility payments?",
    subtext: "Select all that apply",
    type: "multi",
    segments: ['SNF'],
    options: [
      { label: "Credit cards", value: "credit_cards", points: 25 },
      { label: "Debit cards", value: "debit_cards", points: 20 },
      { label: "ACH or bank transfer", value: "ach", points: 15 },
      { label: "Online payment portal", value: "portal", points: 15 },
      { label: "Text-to-pay", value: "text_to_pay", points: 20 },
      { label: "Paper checks", value: "checks", points: 5 },
      { label: "Money orders or cash", value: "cash", points: 0 }
    ],
    scoring: (selected) => {
      if (!selected || !Array.isArray(selected)) return 10;
      const pointsMap = {
        credit_cards: 25, debit_cards: 20, ach: 15,
        portal: 15, text_to_pay: 20, checks: 5, cash: 0
      };
      const total = selected.reduce((sum, opt) => sum + (pointsMap[opt] || 0), 0);
      return Math.min(100, total);
    },
    insight: {
      trigger: (selected) => !selected || !selected.includes('credit_cards'),
      message: "75% of bill payers want card payment options. 67% would choose a facility that accepts cards.",
      proofPoint: "82% of consumers prefer digital payments"
    }
  },

  // SNF-Q4: Staff Time on Manual Billing
  // Category: Collection Efficiency
  {
    id: 'snf_staff_time',
    category: "Collection Efficiency",
    categoryIndex: 0,
    question: "How many hours per week does your billing team spend on manual patient payment tasks such as printing statements, processing checks, and following up on balances?",
    type: "single",
    segments: ['SNF'],
    options: [
      { label: "Less than 5 hours", value: "minimal", score: 100 },
      { label: "5 to 15 hours", value: "moderate", score: 70 },
      { label: "15 to 30 hours", value: "significant", score: 40 },
      { label: "30+ hours", value: "excessive", score: 10 },
      { label: "Not sure", value: "unsure", score: 35 }
    ],
    insight: {
      trigger: (val) => val === 'significant' || val === 'excessive',
      message: "At $7.93 per manual transaction vs. $3.39 digital, the cost difference compounds across every patient balance.",
      proofPoint: "96% reduction in processing time with automation"
    }
  },

  // SNF-Q5: Autopay (Capability Spectrum)
  // Category: Collection Efficiency
  {
    id: 'snf_autopay',
    category: "Collection Efficiency",
    categoryIndex: 0,
    question: "Does your facility offer autopay or recurring payment options for patient responsibility balances?",
    type: "single",
    segments: ['SNF'],
    options: [
      { label: "Yes, fully automated enrollment", value: "automated", score: 100 },
      { label: "Yes, but enrollment is low", value: "low_enrollment", score: 55 },
      { label: "We offer it for some balance types", value: "partial", score: 40 },
      { label: "No, we do not offer autopay", value: "no", score: 10 },
      { label: "Not sure", value: "unsure", score: 20 }
    ],
    insight: {
      trigger: (val) => val === 'no' || val === 'unsure' || val === 'low_enrollment' || val === 'partial',
      message: "Nearly 100% of card-paying families say they would use autopay if offered. Even communities that offer autopay often see under 20% enrollment. Active campaigns can change that.",
      proofPoint: "80% of card payments happen without staff involvement with autopay"
    }
  },

  // SNF-Q6: Collection Rate
  // Category: Collection Efficiency
  {
    id: 'snf_collection_rate',
    category: "Collection Efficiency",
    categoryIndex: 0,
    question: "What percentage of patient responsibility balances does your facility typically collect?",
    subtext: "Patient responsibility includes private pay, copays, and coinsurance",
    type: "slider",
    segments: ['SNF'],
    min: 0,
    max: 100,
    default: 75,
    unit: "%",
    benchmark: 75,
    benchmarkLabel: "Industry average: 75%",
    scoring: (val) => {
      if (val >= 90) return 100;
      if (val >= 80) return 75;
      if (val >= 70) return 50;
      if (val >= 60) return 25;
      return 10;
    },
    insight: {
      trigger: (val) => val < 85,
      message: "At {value}% collection rate, the uncollected balance represents a meaningful revenue opportunity.",
      proofPoint: "PatientPay achieves 60% payment rate via text-to-pay vs. 43% industry average"
    },
    patientPayProjection: (currentRate) => Math.min(95, currentRate + 15)
  }
];

// ============================================
// CATEGORY NAMES — V5
// ============================================
const CategoryNames = ["Operational Readiness", "Resident & Family Experience", "Competitive Position"];
const SNFCategoryNames = ["Collection Efficiency", "Family Experience"];

/**
 * Get the appropriate category name based on segment
 */
function getCategoryName(categoryIndex, segment) {
  const names = segment === 'SNF' ? SNFCategoryNames : CategoryNames;
  return names[categoryIndex] || '';
}

// ============================================
// RESULTS FLOW — V5: Simplified for fewer questions
// ============================================
const ResultsFlow = {
  totalSlides: 4,

  slides: [
    {
      id: 0,
      type: 'overview',
      title: 'Your Payment Readiness Score',
      description: 'Overall score with category breakdown and benchmark comparison',
      content: ['overall_score_gauge', 'category_bars', 'benchmark_comparison']
    },
    {
      id: 1,
      type: 'insights',
      title: 'Key Insights',
      description: 'What your answers reveal',
      content: ['strengths', 'opportunities', 'recommendations']
    },
    {
      id: 2,
      type: 'improvements',
      title: 'Your Improvement Opportunities',
      description: 'Actionable steps with projected impact',
      content: ['top_recommendations', 'score_projections']
    },
    {
      id: 3,
      type: 'next-steps',
      title: 'Get Your Detailed Report',
      description: 'Enter email to download your personalized PDF report',
      content: ['email_gate', 'download_pdf', 'schedule_cta']
    }
  ],

  getSlide: function(index) {
    return this.slides[index] || null;
  },

  getStatsForCategory: function(categoryIndex, segment) {
    const statKeys = ['operational', 'experience', 'competitive'];
    const key = statKeys[categoryIndex];
    const universalStats = IndustryStats.universal[key] || [];
    const segmentStats = segment && IndustryStats[segment] ? (IndustryStats[segment][key] || []) : [];
    return [...segmentStats, ...universalStats].slice(0, 3);
  },

  getLowestCategories: function(scores, segment) {
    const categoryCount = scores.useTwoCategories ? 2 : 3;
    const names = segment === 'SNF' ? SNFCategoryNames : CategoryNames;
    const indexed = scores.categories.slice(0, categoryCount).map((score, i) => ({
      score, name: names[i], index: i
    }));
    return indexed.sort((a, b) => a.score - b.score).slice(0, 2);
  },

  getCategoryRecommendation: function(categoryIndex, segment) {
    const segmentRecommendations = {
      SL: [
        "Streamlined billing with digital delivery and autopay reduces A/R days and frees up finance team time.",
        "Multi-guarantor billing and flexible payment channels reduce family confusion and billing-related calls.",
        "Modern payment options signal a modern community. 67% of families would choose a card-accepting facility."
      ],
      SNF: [
        "Every percentage point improvement in collection rate directly increases private pay revenue.",
        "Even at 23% private pay, family experience affects satisfaction scores and referrals.",
        "Quality billing operations signal quality care."
      ]
    };

    const defaults = [
      "Streamlined billing with PCC integration can reduce A/R days and free up finance team time.",
      "Multi-guarantor billing and flexible payment channels reduce family confusion and billing-related calls.",
      "Your billing process is part of your tour. Modern payment options signal a modern community."
    ];

    const recs = segment && segmentRecommendations[segment] ? segmentRecommendations[segment] : defaults;
    return recs[categoryIndex] || defaults[categoryIndex];
  }
};

// ============================================
// ACTIONABLE RECOMMENDATIONS ENGINE — V5
// Simplified for fewer question inputs
// ============================================

const RecommendationDefinitions = [
  // SL RECOMMENDATIONS
  {
    id: 'add_digital_delivery',
    category: 'operations',
    title: 'Enable Digital Statement Delivery',
    trigger: (answers) => {
      const d = answers['statement_delivery'];
      return answers['facility_type'] === 'SL' &&
        (d === 'Paper mail only' || (Array.isArray(d) && d.length === 1 && d[0] === 'Paper mail'));
    },
    currentState: "Statements delivered by paper mail only. 2-3 week delivery cycle.",
    targetState: "Multi-channel delivery: email, text, portal, with paper as backup",
    impact: {
      description: "Faster delivery means faster payment and lower postage costs",
      metrics: [
        "82% of consumers prefer digital payment methods",
        "Digital statements convert to cash 2-3 weeks faster than paper",
        "98% text message open rate vs. 20% for direct mail"
      ]
    },
    patientPayConnection: "PatientPay delivers statements via email, text, and portal with automatic fallback to paper for families who prefer it.",
    scoreImpact: { category: 'operations', points: 20, overall: 6 },
    basePriority: 80
  },
  // SL: Add card payments
  {
    id: 'add_card_payments',
    category: 'competitive',
    title: 'Accept Credit and Debit Card Payments',
    trigger: (answers) => {
      const methods = answers['payment_methods'] || [];
      return answers['facility_type'] === 'SL' &&
        !methods.includes('Credit cards') && !methods.includes('Debit cards');
    },
    currentState: "No card payment options available for families",
    targetState: "Full payment flexibility including credit cards, debit cards, and digital payments",
    impact: {
      description: "Meet family expectations and remove a key objection during tours",
      metrics: [
        "75% of LTC bill payers want card payment options",
        "67% would choose a facility that accepts cards over one that does not",
        "69% are willing to pay a convenience fee for card payment"
      ]
    },
    patientPayConnection: "PatientPay enables card payments with optional convenience fee pass-through to protect your margins while giving families the flexibility they want.",
    scoreImpact: { category: 'competitive', points: 25, overall: 8 },
    basePriority: 85
  },
  // SL: Enable multi-guarantor
  {
    id: 'enable_multi_guarantor',
    category: 'operations',
    title: 'Enable Multi-Guarantor Billing',
    trigger: (answers) => {
      const mg = answers['multi_guarantor'];
      return answers['facility_type'] === 'SL' &&
        (mg === 'No' || mg === 'Unsure');
    },
    currentState: "No multi-guarantor billing. One person coordinates payment from the entire family.",
    targetState: "Each family member receives their own statement and pays their portion directly",
    impact: {
      description: "Eliminate the 'statement coordinator' bottleneck that delays payments",
      metrics: [
        "37% of families miss payments due to billing confusion, not inability to pay",
        "63 million Americans are caregivers. Families want to share the financial load.",
        "96% reduction in processing time with automated split billing"
      ]
    },
    patientPayConnection: "PatientPay automatically calculates splits, generates individual statements, and tracks payments per guarantor, turning hours of work into seconds.",
    scoreImpact: { category: 'operations', points: 20, overall: 8 },
    basePriority: 85
  },
  // SL: Increase autopay
  {
    id: 'increase_autopay',
    category: 'operations',
    title: 'Grow Autopay Enrollment',
    trigger: (answers) => {
      const rate = answers['autopay_rate'];
      return answers['facility_type'] === 'SL' && (rate === undefined || rate < 50);
    },
    currentState: (answers) => {
      const rate = answers['autopay_rate'] || 0;
      if (rate === 0) return "No autopay program in place. Every payment requires manual effort.";
      return `Only ${rate}% autopay enrollment, below the 50% high-performer benchmark.`;
    },
    targetState: "50%+ families on automated recurring payments for predictable cash flow",
    impact: {
      description: "Autopay creates predictable cash flow and eliminates monthly collection effort",
      metrics: [
        "Nearly 100% of card-paying families would consider autopay if offered",
        "Autopay families have near-zero late payment rates",
        "Each enrollment eliminates monthly collection touchpoints"
      ]
    },
    patientPayConnection: "PatientPay makes autopay enrollment easy with digital signup and helps you run enrollment campaigns to existing families.",
    scoreImpact: { category: 'operations', points: 15, overall: 5 },
    basePriority: 75
  },
  // SL: Improve family experience
  {
    id: 'improve_family_experience',
    category: 'family',
    title: 'Elevate Family Billing Experience',
    trigger: (answers) => {
      const exp = answers['family_experience'];
      return answers['facility_type'] === 'SL' &&
        (exp === 'poor' || exp === 'moderate');
    },
    currentState: (answers) => {
      const exp = answers['family_experience'];
      if (exp === 'poor') {
        return "Billing is a frequent source of family complaints, a significant pain point.";
      }
      return "Families experience occasional billing friction and confusion";
    },
    targetState: "Families regularly compliment the billing process as clear and easy",
    impact: {
      description: "Billing satisfaction directly affects overall satisfaction scores and referrals",
      metrics: [
        "38% of patients find medical bills confusing",
        "70% of caregivers spend 2+ hours resolving billing errors",
        "Billing experience influences facility recommendations to others"
      ]
    },
    patientPayConnection: "PatientPay's clear statements, flexible payment options, and family portal address the root causes of billing confusion and frustration.",
    scoreImpact: { category: 'family', points: 20, overall: 8 },
    basePriority: 70
  },
  // SL: Reduce manual billing
  {
    id: 'reduce_manual_billing',
    category: 'operations',
    title: 'Automate Manual Billing Processes',
    trigger: (answers) => {
      const time = answers['staff_time'];
      return answers['facility_type'] === 'SL' &&
        (time === 'significant' || time === 'excessive' || time === 'unsure');
    },
    currentState: (answers) => {
      const time = answers['staff_time'];
      if (time === 'excessive') return "30+ hours per week on manual billing, a major operational cost.";
      if (time === 'significant') return "15-30 hours per week on manual billing tasks.";
      return "Manual billing effort is unclear. Tracking this metric is the first step.";
    },
    targetState: "Automated billing workflow with minimal manual intervention",
    impact: {
      description: "Automating manual billing tasks frees staff for higher-value work",
      metrics: [
        "42% of finance team time spent on manual payment processing",
        "$7.93 per manual transaction vs. $3.39 digital",
        "96% reduction in processing time with automation"
      ]
    },
    patientPayConnection: "PatientPay automates statement delivery, payment processing, and reconciliation, eliminating the bulk of manual billing work.",
    scoreImpact: { category: 'operations', points: 20, overall: 6 },
    basePriority: 82
  },

  // ========================================
  // SNF RECOMMENDATIONS
  // ========================================

  // SNF: Add digital delivery
  {
    id: 'snf_add_digital_delivery',
    category: 'operations',
    title: 'Enable Digital Statement Delivery',
    trigger: (answers) => {
      const d = answers['snf_statement_delivery'];
      return answers['facility_type'] === 'SNF' &&
        (d === 'Paper mail only' || (Array.isArray(d) && d.length === 1 && d[0] === 'Paper mail'));
    },
    currentState: "Statements delivered by paper mail only. 2-3 week delivery cycle.",
    targetState: "Multi-channel delivery: email, text, portal, with paper as backup",
    impact: {
      description: "Faster delivery means faster payment and lower postage costs",
      metrics: [
        "82% of consumers prefer digital payment methods",
        "Digital statements convert to cash 2-3 weeks faster than paper",
        "98% text message open rate vs. 20% for direct mail"
      ]
    },
    patientPayConnection: "PatientPay delivers statements via email, text, and portal with automatic fallback to paper for families who prefer it.",
    scoreImpact: { category: 'operations', points: 20, overall: 12 },
    basePriority: 80,
    segmentSpecific: ['SNF']
  },
  // SNF: Expand payment methods
  {
    id: 'snf_expand_payment_methods',
    category: 'operations',
    title: 'Expand Digital Payment Options',
    trigger: (answers) => {
      const methods = answers['snf_payment_methods'] || [];
      return answers['facility_type'] === 'SNF' &&
        (!methods.includes('credit_cards') || !methods.includes('portal'));
    },
    currentState: (answers) => {
      const methods = answers['snf_payment_methods'] || [];
      if (methods.length === 0 || (methods.length === 1 && methods[0] === 'checks')) {
        return "Only accepting checks. No digital payment options.";
      }
      return "Limited digital payment options available";
    },
    targetState: "Full payment flexibility: cards, portal, text-to-pay, autopay",
    impact: {
      description: "Modern payment options dramatically improve collection velocity",
      metrics: [
        "75% of bill payers want card payment options",
        "PatientPay achieves 60% payment rate via text-to-pay vs. 43% industry average",
        "67% would choose a card-accepting facility over one that does not"
      ]
    },
    patientPayConnection: "PatientPay enables cards, text-to-pay, portal payments, and autopay, meeting families where they are.",
    scoreImpact: { category: 'operations', points: 25, overall: 12 },
    basePriority: 85,
    segmentSpecific: ['SNF']
  },
  // SNF: Improve collection rate
  {
    id: 'snf_improve_collection',
    category: 'operations',
    title: 'Increase Patient Responsibility Collection Rate',
    trigger: (answers) => {
      const rate = answers['snf_collection_rate'];
      return answers['facility_type'] === 'SNF' && rate !== undefined && rate < 85;
    },
    currentState: (answers) => {
      const rate = answers['snf_collection_rate'] || 75;
      return `Your collection rate is ${rate}%, below the 90% industry target.`;
    },
    targetState: "90%+ patient responsibility collection rate with modern payment tools",
    impact: {
      description: "Every percentage point improvement directly increases private pay revenue",
      metrics: [
        "PatientPay achieves 60% payment rate via text-to-pay vs. 43% industry average",
        "15+ percentage point improvement typical with modern payment tools",
        "Target: 90% collection rate (industry best practice)"
      ]
    },
    patientPayConnection: "PatientPay's text-to-pay, digital statements, and autopay enrollment drive significantly higher collection rates for patient responsibility portions.",
    scoreImpact: { category: 'operations', points: 25, overall: 15 },
    basePriority: 90,
    segmentSpecific: ['SNF']
  },
  // SNF: Enable autopay
  {
    id: 'snf_enable_autopay',
    category: 'operations',
    title: 'Offer Automated Recurring Payments',
    trigger: (answers) => {
      const autopay = answers['snf_autopay'];
      return answers['facility_type'] === 'SNF' &&
        (autopay === 'no' || autopay === 'low_enrollment' || autopay === 'partial' || autopay === 'unsure');
    },
    currentState: (answers) => {
      const autopay = answers['snf_autopay'];
      if (autopay === 'no') return "No autopay option. Families must manually pay each cycle.";
      if (autopay === 'low_enrollment') return "Autopay available but enrollment is low. Active campaigns needed.";
      if (autopay === 'partial') return "Autopay only available for some balance types, limiting adoption.";
      return "Autopay status unclear. Establishing this metric is the first step.";
    },
    targetState: "Automated recurring payments with active enrollment campaigns",
    impact: {
      description: "Autopay dramatically improves collection velocity and predictability",
      metrics: [
        "Nearly 100% of card users would use autopay if offered",
        "80% of card payments happen without staff involvement",
        "Autopay families effectively have 0 AR days"
      ]
    },
    patientPayConnection: "PatientPay makes autopay enrollment easy and runs campaigns to drive adoption. Typical customers see 25+ percentage point improvement.",
    scoreImpact: { category: 'operations', points: 20, overall: 12 },
    basePriority: 80,
    segmentSpecific: ['SNF']
  },
  // SNF: Reduce manual billing
  {
    id: 'snf_reduce_manual_billing',
    category: 'operations',
    title: 'Automate Manual Billing Processes',
    trigger: (answers) => {
      const time = answers['snf_staff_time'];
      return answers['facility_type'] === 'SNF' &&
        (time === 'significant' || time === 'excessive' || time === 'unsure');
    },
    currentState: (answers) => {
      const time = answers['snf_staff_time'];
      if (time === 'excessive') return "30+ hours per week on manual billing, a major operational cost.";
      if (time === 'significant') return "15-30 hours per week on manual billing tasks.";
      return "Manual billing effort is unclear. Tracking this metric is the first step.";
    },
    targetState: "Automated billing workflow with minimal manual intervention",
    impact: {
      description: "Automating manual billing tasks frees staff for higher-value work and reduces cost per transaction",
      metrics: [
        "$7.93 per manual transaction vs. $3.39 digital",
        "42% of finance team time spent on manual payment processing",
        "96% reduction in processing time with automation"
      ]
    },
    patientPayConnection: "PatientPay automates statement delivery, payment processing, and reconciliation, eliminating the bulk of manual billing work.",
    scoreImpact: { category: 'operations', points: 20, overall: 12 },
    basePriority: 82,
    segmentSpecific: ['SNF']
  },
  // SNF: Improve family experience
  {
    id: 'snf_improve_family_experience',
    category: 'family',
    title: 'Improve Patient and Family Billing Experience',
    trigger: (answers) => {
      const exp = answers['snf_family_experience'];
      return answers['facility_type'] === 'SNF' &&
        (exp === 'poor' || exp === 'moderate');
    },
    currentState: (answers) => {
      const exp = answers['snf_family_experience'];
      if (exp === 'poor') return "Billing generates weekly or more complaints, a significant operational and satisfaction burden.";
      return "Billing generates regular complaints, an opportunity to improve family satisfaction.";
    },
    targetState: "Clear, modern billing that families rarely need to call about",
    impact: {
      description: "Fewer billing complaints means less staff time on calls and higher patient satisfaction scores",
      metrics: [
        "37% of families miss payments due to billing confusion",
        "70% of caregivers spend 2+ hours resolving billing errors",
        "Clear billing correlates with higher satisfaction scores and referrals"
      ]
    },
    patientPayConnection: "PatientPay's clear statements, flexible payment options, and family portal eliminate the root causes of billing confusion.",
    scoreImpact: { category: 'family', points: 20, overall: 8 },
    basePriority: 75,
    segmentSpecific: ['SNF']
  }
];


// ============================================
// SOURCE CITATIONS
// ============================================
const SourceCitations = [
  { id: 1, name: "Industry Analysis / Senior Living Statistics 2024-2025" },
  { id: 2, name: "TransactCare" },
  { id: 3, name: "Aline Operations" },
  { id: 4, name: "AARP / Alzheimer's Association" },
  { id: 5, name: "NIC MAP Vision" },
  { id: 6, name: "Pew Research" },
  { id: 7, name: "CareGrove" },
  { id: 8, name: "Pew/AARP Research" },
  { id: 9, name: "Healthcare Payment Surveys" },
  { id: 10, name: "Richter Healthcare Consulting" },
  { id: 11, name: "CareGrove/Visa Research" }
];


// ============================================
// CORE CALCULATION FUNCTIONS — V5
// Simplified for 6 SL / 6 SNF questions
// No conditional logic, no sub-questions
// ============================================

/**
 * Get questions visible for a given segment
 * V5: Simplified — no conditional logic needed, just filter by segment
 * @param {Object} answers - Current answers including facility_type
 * @returns {Array} - Questions applicable to this segment
 */
function getVisibleQuestions(answers) {
  const segment = answers['facility_type'];

  return Questions.filter(q => {
    // Routing question only shown if no segment selected
    if (q.isRoutingQuestion) return !segment;
    // If no segment selected yet, only show routing
    if (!segment) return false;
    // Check segment applicability
    if (q.segments && !q.segments.includes(segment)) return false;
    return true;
  });
}

/**
 * Calculate individual question score
 * V5: Simplified — no diagnostic questions, no payer_mix type
 * @param {Object} question - Question definition
 * @param {*} answer - User's answer
 * @returns {number|null} - Score (0-100) or null if not scoreable
 */
function calculateQuestionScore(question, answer) {
  if (answer === undefined || answer === null) return null;
  if (question.isRoutingQuestion) return null;

  if (question.type === 'slider') {
    return question.scoring(answer);
  }

  if (question.type === 'single') {
    const option = question.options.find(o => o.label === answer || o.value === answer);
    return option ? (option.score !== undefined ? option.score : 0) : 0;
  }

  if (question.type === 'multi') {
    if (!Array.isArray(answer)) return 0;

    // Support custom scoring function
    if (typeof question.scoring === 'function') {
      return question.scoring(answer);
    }

    // Check if exclusive option is selected
    if (question.exclusiveOption && answer.includes(question.exclusiveOption.label)) {
      return question.exclusiveOption.score;
    }

    // Sum individual option scores
    const sum = answer.reduce((total, selection) => {
      const opt = question.options.find(o =>
        o.value === selection || o.label === selection
      );
      const points = opt ? (opt.points !== undefined ? opt.points : (opt.score || 0)) : 0;
      return total + points;
    }, 0);
    return Math.min(sum, question.maxScore || 100);
  }

  return 0;
}

/**
 * Calculate all scores with segment-specific weighting
 * V5: Simplified — no autoScore, no conditional skipping
 * SL: 3 categories (Operations 30%, Family Experience 45%, Competitive 25%)
 * SNF: 2 categories (Collection Efficiency 60%, Family Experience 40%)
 * @param {Object} answers - All user answers
 * @returns {Object} - { overall, categories, segment, weights, useTwoCategories }
 */
function calculateScores(answers) {
  const segment = answers['facility_type'];
  const visibleQuestions = getVisibleQuestions(answers);
  const facilityConfig = segment && FacilityTypes[segment] ? FacilityTypes[segment] : null;
  const useTwoCategories = facilityConfig && facilityConfig.useTwoCategories;

  // Track scores per category
  const categoryData = [
    { sum: 0, count: 0 },
    { sum: 0, count: 0 },
    { sum: 0, count: 0 }
  ];

  // Process each visible question
  visibleQuestions.forEach((q) => {
    if (q.isRoutingQuestion || q.categoryIndex === null || q.categoryIndex === undefined) return;

    const answer = answers[q.id];
    if (answer === undefined) return;

    const score = calculateQuestionScore(q, answer);
    if (score === null) return;

    // Cross-category scoring: distribute score based on weights
    if (q.categoryWeights && Array.isArray(q.categoryWeights)) {
      q.categoryWeights.forEach(cw => {
        // For SNF (2-category model), skip competitive category contributions
        if (useTwoCategories && cw.index === 2) return;
        categoryData[cw.index].sum += score * cw.weight;
        categoryData[cw.index].count += cw.weight;
      });
    } else {
      // Single category
      categoryData[q.categoryIndex].sum += score;
      categoryData[q.categoryIndex].count += 1;
    }
  });

  // Calculate category averages
  const categoryScores = categoryData.map(data =>
    data.count > 0 ? Math.round(data.sum / data.count) : 0
  );

  // Apply segment-specific weights
  let overallScore;
  let weights;

  if (facilityConfig) {
    weights = facilityConfig.categoryWeights;
    if (useTwoCategories) {
      // SNF: Collection Efficiency 60% + Family Experience 40%
      overallScore = Math.round(
        categoryScores[0] * 0.60 +
        categoryScores[1] * 0.40
      );
    } else {
      // SL: Operations 30% + Family Experience 45% + Competitive 25%
      overallScore = Math.round(
        categoryScores[0] * weights[0] +
        categoryScores[1] * weights[1] +
        categoryScores[2] * weights[2]
      );
    }
  } else {
    weights = [0.33, 0.34, 0.33];
    overallScore = Math.round(categoryScores.reduce((a, b) => a + b, 0) / 3);
  }

  return {
    overall: overallScore,
    categories: categoryScores,
    segment: segment,
    weights: weights,
    useTwoCategories: useTwoCategories || false
  };
}

/**
 * Get score level interpretation
 * @param {number} score - Score value (0-100)
 * @returns {string} - Level name
 */
function getScoreLevel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Progressing';
  if (score >= 40) return 'Developing';
  return 'Needs Attention';
}

/**
 * Get score color
 * @param {number} score - Score value (0-100)
 * @returns {string} - Hex color
 */
function getScoreColor(score) {
  if (score >= 90) return AssessmentColors.success;
  if (score >= 80) return '#84CC16';
  if (score >= 60) return AssessmentColors.warning;
  if (score >= 40) return '#F97316';
  return AssessmentColors.error;
}


// ============================================
// FINANCIAL INSIGHTS — V5
// Simplified: fewer inputs, estimation-based
// ============================================

/**
 * Calculate personalized financial insights
 * V5: No bedCount/avgMonthlyRate from form (no contact form upfront).
 * Uses industry averages and answer-derived estimates.
 * @param {Object} formData - May be empty in V5 (email captured at end)
 * @param {Object} answers - User answers
 * @returns {Object|null} - Insights object
 */
function calculateInsights(formData, answers) {
  const segment = answers['facility_type'];
  if (!segment) return null;

  const isSNF = segment === 'SNF';

  // V5: Use industry averages since we don't have bedCount/avgMonthlyRate upfront
  const bedCount = (formData && formData.bedCount) || (isSNF ? 120 : 80);
  const avgMonthlyRate = (formData && formData.avgMonthlyRate) || (isSNF ? 9150 : 5500);

  const occupancyRates = { SL: 0.88, SNF: 0.833 };
  const occupancyRate = occupancyRates[segment] || 0.85;
  const occupiedBeds = Math.round(bedCount * occupancyRate);

  const monthlyRevenue = occupiedBeds * avgMonthlyRate;
  const annualRevenue = monthlyRevenue * 12;
  const dailyRevenue = annualRevenue / 365;

  // AR days based on segment
  const arDays = isSNF ? 56 : 45;
  const targetArDays = isSNF ? 40 : 35;
  const cashInAR = Math.round(dailyRevenue * arDays);
  const potentialFreedCash = arDays > targetArDays ? Math.round(dailyRevenue * (arDays - targetArDays)) : 0;

  // Staff time calculations
  const billingFTEs = Math.max(1, Math.round(bedCount / 50));
  const timeOnPayments = Math.round(billingFTEs * 50000 * 0.42);

  // Staff time calculations from answers
  const staffTimeAnswer = isSNF ? answers['snf_staff_time'] : answers['staff_time'];
  const staffTimeMap = { minimal: 3, moderate: 10, significant: 22, excessive: 35, unsure: 15 };
  const staffHoursPerWeek = staffTimeMap[staffTimeAnswer] || (isSNF ? 15 : 15);
  const annualManualBillingCost = staffHoursPerWeek * 52 * 25;

  // Autopay calculations
  const autopayRate = isSNF
    ? (answers['snf_autopay'] === 'automated' ? 40 : answers['snf_autopay'] === 'low_enrollment' ? 15 : answers['snf_autopay'] === 'partial' ? 10 : 5)
    : (answers['autopay_rate'] || 0);
  const autopayPct = autopayRate / 100;
  const residentsOnAutopay = Math.round(occupiedBeds * autopayPct);
  const autopayOpportunity = Math.max(0, Math.round(occupiedBeds * 0.5) - residentsOnAutopay);

  // Payment methods insight
  const paymentMethods = isSNF ? (answers['snf_payment_methods'] || []) : (answers['payment_methods'] || []);
  const acceptsCards = isSNF
    ? (paymentMethods.includes('credit_cards') || paymentMethods.includes('debit_cards'))
    : (paymentMethods.includes('Credit cards') || paymentMethods.includes('Debit cards'));

  // Base insights
  const baseInsights = {
    segment,
    occupiedBeds,
    bedCount,
    monthlyRevenue,
    annualRevenue,
    dailyRevenue,
    cashInAR,
    potentialFreedCash,
    timeOnPayments,
    billingFTEs,
    arDays,
    targetArDays,
    residentsOnAutopay,
    autopayPct: Math.round(autopayPct * 100),
    autopayOpportunity,
    acceptsCards,
    staffHoursPerWeek,
    annualManualBillingCost
  };

  if (isSNF) {
    const collectionRate = answers['snf_collection_rate'] || 75;
    const privatePayPct = 25; // Industry average
    const privatePayRevenue = Math.round(annualRevenue * (privatePayPct / 100));
    const actualCollected = privatePayRevenue * (collectionRate / 100);
    const targetCollected = privatePayRevenue * 0.90;
    const collectionGap = Math.round(Math.max(0, targetCollected - actualCollected));

    return {
      ...baseInsights,
      privatePayPct,
      collectionRate,
      collectionGap,
      targetCollectionRate: 90,
      privatePayRevenue,
      totalFinancialOpportunity: potentialFreedCash + collectionGap,
      privatePayCollectionOpportunity: Math.round(privatePayRevenue * 0.15)
    };
  }

  // SL insights
  const multiGuarantor = answers['multi_guarantor'];
  const hasMultiGuarantorCapability = multiGuarantor === 'Yes, automated' || multiGuarantor === 'Yes, manually';

  return {
    ...baseInsights,
    hasMultiGuarantorCapability,
    multiGuarantorStatus: multiGuarantor || 'Unknown'
  };
}


// ============================================
// ACTIONABLE RECOMMENDATIONS ENGINE — V5
// Returns top 5 (reduced from 8 for shorter flow)
// ============================================

/**
 * Get actionable recommendations based on answers and scores
 * @param {Object} answers - User's answers
 * @param {Object} scores - Calculated scores
 * @param {Object} insights - Financial insights (may be null)
 * @returns {Array} - Prioritized array of recommendation objects
 */
function getActionableRecommendations(answers, scores, insights) {
  const segment = answers['facility_type'];
  const recommendations = [];

  RecommendationDefinitions.forEach(def => {
    // Check segment-specific
    if (def.segmentSpecific && !def.segmentSpecific.includes(segment)) return;
    // Skip competitive recommendations for SNF (2-category model)
    if (scores.useTwoCategories && def.category === 'competitive') return;

    // Check trigger
    let triggered = false;
    try { triggered = def.trigger(answers); } catch (e) { triggered = false; }
    if (!triggered) return;

    // Calculate priority
    let priority = def.basePriority;
    const categoryIndex = def.category === 'operations' ? 0 : def.category === 'family' ? 1 : 2;
    const categoryScore = scores.categories[categoryIndex] || 0;

    if (categoryScore < 40) priority += 15;
    else if (categoryScore < 60) priority += 10;
    else if (categoryScore < 80) priority += 5;

    recommendations.push({
      id: def.id,
      category: def.category,
      categoryLabel: def.category === 'operations'
        ? (scores.useTwoCategories ? 'Collection Efficiency' : 'Operational Readiness')
        : def.category === 'family' ? 'Resident & Family Experience'
        : 'Competitive Position',
      title: def.title,
      priority,
      priorityLabel: priority >= 80 ? 'High' : priority >= 60 ? 'Medium' : 'Ongoing',
      currentState: typeof def.currentState === 'function' ? def.currentState(answers) : def.currentState,
      targetState: def.targetState,
      impact: def.impact,
      patientPayConnection: def.patientPayConnection,
      scoreImpact: def.scoreImpact
    });
  });

  // Sort by priority, return top 5
  recommendations.sort((a, b) => b.priority - a.priority);
  return recommendations.slice(0, 5).map((rec, index) => ({
    ...rec,
    rank: index + 1
  }));
}


// ============================================
// GAP ANALYSIS — V5
// ============================================

/**
 * Get gap analysis comparing user scores to industry benchmarks
 * @param {Object} scores - Calculated scores
 * @returns {Object|null} - Gap analysis with benchmark comparisons
 */
function getGapAnalysis(scores) {
  const segment = scores.segment;
  const benchmarks = IndustryBenchmarks[segment];
  if (!benchmarks) return null;

  const analysis = {
    segment,
    segmentLabel: benchmarks.label,
    overall: {
      score: scores.overall,
      benchmark: benchmarks.overall,
      gap: scores.overall - benchmarks.overall,
      performance: getPerformanceVsBenchmark(scores.overall, benchmarks.overall)
    },
    categories: []
  };

  const facilityConfig = FacilityTypes[segment];
  if (!facilityConfig) return analysis;

  const categoryCount = scores.useTwoCategories ? 2 : 3;
  const benchmarkKeys = scores.useTwoCategories
    ? ['operations', 'family']
    : ['operations', 'family', 'competitive'];
  for (let i = 0; i < categoryCount; i++) {
    const catScore = scores.categories[i];
    const catBenchmark = benchmarks[benchmarkKeys[i]];
    analysis.categories.push({
      index: i,
      name: facilityConfig.categoryNames[i],
      score: catScore,
      benchmark: catBenchmark,
      gap: catScore - catBenchmark,
      performance: getPerformanceVsBenchmark(catScore, catBenchmark),
      weight: facilityConfig.categoryWeights[i]
    });
  }

  return analysis;
}


// ============================================
// RESULTS SUMMARY — V5
// ============================================

/**
 * Generate a results summary statement
 * @param {Object} scores - Calculated scores
 * @param {Object} gapAnalysis - From getGapAnalysis()
 * @param {Array} recommendations - From getActionableRecommendations()
 * @returns {Object} - Summary with headline, details, level
 */
function generateResultsSummary(scores, gapAnalysis, recommendations) {
  const level = getScoreLevel(scores.overall);
  const benchmarkLabel = gapAnalysis ? gapAnalysis.segmentLabel : 'industry';
  const gap = gapAnalysis ? gapAnalysis.overall.gap : 0;

  // Headline
  let headline;
  if (scores.overall >= 80) {
    headline = `Your payment readiness is strong at ${scores.overall}/100.`;
  } else if (scores.overall >= 60) {
    headline = `You are making progress at ${scores.overall}/100, with clear opportunities ahead.`;
  } else if (scores.overall >= 40) {
    headline = `At ${scores.overall}/100, there is significant room to modernize your payment operations.`;
  } else {
    headline = `At ${scores.overall}/100, your payment operations need immediate attention.`;
  }

  // Opportunity statement
  let opportunityStatement = '';
  if (gap < -10 && recommendations.length > 0) {
    opportunityStatement = `You are ${Math.abs(gap)} points below the ${benchmarkLabel} benchmark. Your top opportunity: ${recommendations[0].title}.`;
  } else if (gap < 0) {
    opportunityStatement = `You are ${Math.abs(gap)} points below the ${benchmarkLabel} benchmark, but targeted improvements can close the gap quickly.`;
  } else {
    opportunityStatement = `You are meeting or exceeding the ${benchmarkLabel} benchmark. Focus on maintaining your edge.`;
  }

  // Strength statement
  let strengthStatement = '';
  if (gapAnalysis && gapAnalysis.categories.length > 0) {
    const bestCategory = [...gapAnalysis.categories].sort((a, b) => b.gap - a.gap)[0];
    if (bestCategory.gap >= 0) {
      strengthStatement = `Your strongest area is ${bestCategory.name} at ${bestCategory.score}/100.`;
    }
  }

  // Top action
  let topActionStatement = '';
  if (recommendations.length > 0) {
    topActionStatement = `Recommended first step: ${recommendations[0].title}.`;
  }

  return {
    headline,
    opportunityStatement,
    strengthStatement,
    topActionStatement,
    level,
    levelDescription: level === 'Excellent' ? 'Industry-leading payment operations' :
                      level === 'Strong' ? 'Solid foundation with optimization opportunities' :
                      level === 'Progressing' ? 'Good progress with room for improvement' :
                      level === 'Developing' ? 'Significant opportunities to modernize' :
                      'Critical improvements needed'
  };
}


// ============================================
// STRENGTHS ANALYSIS — V5
// ============================================

/**
 * Get user's strengths for positive framing
 * @param {Object} scores - Calculated scores
 * @param {Object} answers - User's answers
 * @returns {Object} - { strongCategories, strongQuestions, hasStrengths, summaryStatement }
 */
function getStrengths(scores, answers) {
  const gapAnalysis = getGapAnalysis(scores);
  const segment = answers['facility_type'];
  const visibleQuestions = getVisibleQuestions(answers);

  // Categories at or above benchmark
  const strongCategories = gapAnalysis ? gapAnalysis.categories
    .filter(c => c.gap >= 0)
    .sort((a, b) => b.gap - a.gap)
    .map(c => ({
      ...c,
      color: c.index === 0 ? '#3c8fc7' : c.index === 1 ? '#8B5CF6' : '#fcc93b',
      celebrationText: c.gap >= 10 ? 'Excellent' : c.gap >= 5 ? 'Above average' : 'Meeting benchmark'
    })) : [];

  // Individual high-scoring questions (score >= 70)
  const strongQuestions = visibleQuestions
    .filter(q => !q.isRoutingQuestion && q.categoryIndex !== null && q.categoryIndex !== undefined)
    .map(q => {
      const score = calculateQuestionScore(q, answers[q.id]);
      return {
        id: q.id,
        question: q.question,
        answer: answers[q.id],
        score: score,
        categoryIndex: q.categoryIndex,
        categoryName: getCategoryName(q.categoryIndex, segment)
      };
    })
    .filter(q => q.score !== null && q.score >= 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const hasStrengths = strongCategories.length > 0 || strongQuestions.length > 0;

  // Fallback for early journey users
  let relativeStrength = null;
  let isEarlyJourney = false;

  if (!hasStrengths && gapAnalysis) {
    const sortedByGap = [...gapAnalysis.categories].sort((a, b) => b.gap - a.gap);
    if (sortedByGap.length > 0) {
      relativeStrength = {
        ...sortedByGap[0],
        color: sortedByGap[0].index === 0 ? '#3c8fc7' : sortedByGap[0].index === 1 ? '#8B5CF6' : '#fcc93b',
        isRelative: true
      };
    }
  }

  // Summary statement
  let summaryStatement = '';
  if (strongCategories.length > 0) {
    const topCategory = strongCategories[0];
    summaryStatement = topCategory.gap >= 10
      ? `You are excelling in ${topCategory.name}, scoring ${topCategory.gap} points above the industry benchmark.`
      : `You are performing well in ${topCategory.name}, meeting or exceeding industry standards.`;
  } else if (strongQuestions.length > 0) {
    summaryStatement = `You have ${strongQuestions.length} area${strongQuestions.length > 1 ? 's' : ''} scoring 70 or above.`;
  } else if (relativeStrength) {
    isEarlyJourney = true;
    summaryStatement = `You are early in your payment modernization journey. Your strongest area is ${relativeStrength.name} at ${relativeStrength.score}.`;
  } else {
    isEarlyJourney = true;
    summaryStatement = `You are early in your payment modernization journey, which means there is significant opportunity ahead.`;
  }

  return {
    strongCategories,
    strongQuestions,
    hasStrengths,
    summaryStatement,
    relativeStrength,
    isEarlyJourney
  };
}


// ============================================
// PATIENTPAY PROJECTIONS — V5
// Estimates improvement from PatientPay adoption
// Uses recommendations as projection basis
// ============================================

/**
 * Calculate projected improvements if PatientPay is adopted
 * V5: Uses triggered recommendations as the basis for projections
 * @param {Object} answers - User's answers
 * @param {Object} scores - Calculated scores
 * @returns {Object} - { projectedScore, improvements, delta }
 */
function calculatePatientPayProjections(answers, scores) {
  const recommendations = getActionableRecommendations(answers, scores, null);

  // Sum up projected category improvements from triggered recommendations
  const categoryImprovements = [0, 0, 0]; // [ops/collection, family, competitive]

  recommendations.forEach(rec => {
    if (rec.scoreImpact) {
      const catIndex = rec.category === 'operations' ? 0 : rec.category === 'family' ? 1 : 2;
      categoryImprovements[catIndex] += rec.scoreImpact.points || 0;
    }
  });

  // Project new category scores (capped at 100)
  const projectedCategories = scores.categories.map((score, i) =>
    Math.min(100, score + categoryImprovements[i])
  );

  // Calculate projected overall using same weights
  const facilityConfig = FacilityTypes[scores.segment];
  let projectedOverall;
  if (scores.useTwoCategories) {
    projectedOverall = Math.round(projectedCategories[0] * 0.60 + projectedCategories[1] * 0.40);
  } else if (facilityConfig) {
    const w = facilityConfig.categoryWeights;
    projectedOverall = Math.round(
      projectedCategories[0] * w[0] + projectedCategories[1] * w[1] + projectedCategories[2] * w[2]
    );
  } else {
    projectedOverall = Math.round(projectedCategories.reduce((a, b) => a + b, 0) / 3);
  }

  return {
    currentScore: scores.overall,
    projectedScore: Math.min(100, projectedOverall),
    delta: Math.min(100, projectedOverall) - scores.overall,
    currentCategories: scores.categories,
    projectedCategories,
    categoryImprovements,
    improvements: recommendations.map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
      overallImpact: r.scoreImpact ? r.scoreImpact.overall : 0
    })),
    recommendationCount: recommendations.length
  };
}


// ============================================
// V5 RESULTS FLOW CONFIG
// 4 slides: overview -> insights -> improvements -> email-gate
// (Reduced from V4's 6 slides)
// ============================================

const ResultsFlowV5 = {
  slides: [
    {
      id: 'overview',
      title: 'Your Payment Readiness Score',
      description: 'Overall score with category breakdown and benchmark comparison'
    },
    {
      id: 'insights',
      title: 'Key Insights',
      description: 'Strengths and opportunities based on your answers'
    },
    {
      id: 'improvements',
      title: 'Improvement Opportunities',
      description: 'Top recommendations with projected impact'
    },
    {
      id: 'email_gate',
      title: 'Get Your Detailed Report',
      description: 'Email submission to download the full PDF report'
    }
  ],
  totalSlides: 4
};


// ============================================
// EXPORT DATA & CSV — V5
// ============================================

/**
 * Prepare export data for PDF/CSV
 * V5: Updated for 2-segment model, no upfront contact form
 * @param {Object} formData - May include email (captured at end)
 * @param {Object} answers - User answers
 * @param {Object} scores - Calculated scores
 * @returns {Object} - Full export data
 */
function prepareExportData(formData, answers, scores) {
  const visibleQuestions = getVisibleQuestions(answers);
  const timestamp = new Date().toISOString();
  const segment = answers['facility_type'];
  const useTwoCategories = scores.useTwoCategories || false;

  // Map answers to readable format
  const answersReadable = {};
  visibleQuestions.forEach(q => {
    if (q.isRoutingQuestion) return;
    const answer = answers[q.id];
    if (answer !== undefined) {
      answersReadable[q.question] = Array.isArray(answer) ? answer.join(', ') : String(answer);
    }
  });

  const facilityConfig = FacilityTypes[segment];
  const categoryNames = facilityConfig ? facilityConfig.categoryNames : ['Category 1', 'Category 2', 'Category 3'];
  const categoryCount = useTwoCategories ? 2 : 3;
  const categories = [];
  for (let i = 0; i < categoryCount; i++) {
    categories.push({
      name: categoryNames[i],
      score: scores.categories[i],
      weight: facilityConfig ? facilityConfig.categoryWeights[i] : 0.33,
      level: getScoreLevel(scores.categories[i])
    });
  }

  const insights = calculateInsights(formData, answers);
  const gapAnalysis = getGapAnalysis(scores);
  const recommendations = getActionableRecommendations(answers, scores, insights);
  const projections = calculatePatientPayProjections(answers, scores);

  return {
    version: '5.0',
    timestamp,
    facility: {
      type: segment,
      typeLabel: facilityConfig ? facilityConfig.label : segment,
      name: formData.organizationName || '',
      email: formData.email || '',
      contactName: formData.name || ''
    },
    scores: {
      overall: scores.overall,
      level: getScoreLevel(scores.overall),
      categories,
      useTwoCategories
    },
    answers: answersReadable,
    insights,
    gapAnalysis,
    recommendations,
    projections,
    summary: generateResultsSummary(scores, gapAnalysis, recommendations)
  };
}

/**
 * Generate CSV from export data
 * @param {Object} data - From prepareExportData()
 * @returns {string} - CSV string
 */
function generateCSV(data) {
  const rows = [
    ['PatientPay Payment Readiness Assessment V5'],
    ['Generated', data.timestamp],
    [''],
    ['Facility Information'],
    ['Type', data.facility.typeLabel],
    ['Organization', data.facility.name || 'N/A'],
    ['Email', data.facility.email || 'N/A'],
    [''],
    ['Overall Score', data.scores.overall, data.scores.level],
    ['']
  ];

  // Category scores
  rows.push(['Category Scores']);
  data.scores.categories.forEach(cat => {
    rows.push([cat.name, cat.score, cat.level, `Weight: ${Math.round(cat.weight * 100)}%`]);
  });

  rows.push(['']);
  rows.push(['Answers']);
  Object.entries(data.answers).forEach(([q, a]) => {
    rows.push([q, a]);
  });

  rows.push(['']);
  rows.push(['Recommendations']);
  if (data.recommendations) {
    data.recommendations.forEach(rec => {
      rows.push([`#${rec.rank}`, rec.title, rec.priorityLabel, rec.categoryLabel]);
    });
  }

  return rows.map(row =>
    row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
}


// ============================================
// WEBHOOK — V5
// Fires at email submission (end of flow)
// ============================================

const WebhookConfig = {
  makeWebhookUrl: 'https://hook.us2.make.com/j3xqinfji1pjm8n4fgyu2ftqjb9r19ft',
  retryAttempts: 2,
  timeout: 10000
};

/**
 * Send assessment data to Make.com webhook
 * V5: Fires when user submits email at end (not start)
 * @param {Object} formData - { email, name, organizationName } captured at end
 * @param {Object} answers - User answers
 * @param {Object} scores - Calculated scores
 * @param {string} uiVersion - UI version identifier
 * @returns {Object} - { success, submissionId?, error? }
 */
async function sendWebhook(formData, answers, scores, uiVersion = 'v5') {
  const insights = calculateInsights(formData, answers);
  const recommendations = getActionableRecommendations(answers, scores, insights);
  const gapAnalysis = getGapAnalysis(scores);

  const payload = {
    submissionId: `v5_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    version: '5.0',
    uiVersion,
    timestamp: new Date().toISOString(),
    event: 'email_submitted',
    // Contact info (captured at end)
    contact: {
      email: formData.email || '',
      name: formData.name || '',
      organization: formData.organizationName || ''
    },
    // Assessment data
    segment: answers['facility_type'],
    segmentLabel: FacilityTypes[answers['facility_type']]?.label || answers['facility_type'],
    scores: {
      overall: scores.overall,
      level: getScoreLevel(scores.overall),
      categories: scores.categories,
      useTwoCategories: scores.useTwoCategories
    },
    // Answer summary
    answers: Object.fromEntries(
      Object.entries(answers).filter(([key]) => key !== 'facility_type')
    ),
    // Insights summary
    insightsSummary: insights ? {
      annualRevenue: insights.annualRevenue,
      potentialFreedCash: insights.potentialFreedCash,
      collectionGap: insights.collectionGap || 0,
      totalFinancialOpportunity: insights.totalFinancialOpportunity || insights.potentialFreedCash
    } : null,
    // Top recommendations
    topRecommendations: recommendations.slice(0, 3).map(r => ({
      id: r.id,
      title: r.title,
      priority: r.priorityLabel
    })),
    // Gap analysis summary
    benchmarkGap: gapAnalysis ? gapAnalysis.overall.gap : null
  };

  let lastError = null;
  for (let attempt = 0; attempt <= WebhookConfig.retryAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WebhookConfig.timeout);

      const response = await fetch(WebhookConfig.makeWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        console.log('Webhook sent successfully');
        return { success: true, submissionId: payload.submissionId };
      } else {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        console.warn(`Webhook attempt ${attempt + 1} failed:`, lastError);
      }
    } catch (err) {
      lastError = err.name === 'AbortError' ? 'Request timeout' : err.message;
      console.warn(`Webhook attempt ${attempt + 1} error:`, lastError);
    }

    if (attempt < WebhookConfig.retryAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  console.error('Webhook failed after all retries:', lastError);
  return { success: false, error: lastError };
}

// ============================================
// PDF REPORT GENERATION — V5
// ============================================
// V5 REDESIGN: Fewer inputs, richer insights via industry stats.
// SL: 6 pages with psychology arc VALIDATE -> DISRUPT -> QUANTIFY -> RESOLVE -> PROVE + ACT
// SNF: 5 pages (combined improvements + vision)
// Two segments only: SL and SNF. No MC, CCRC references.
//
// V5 Question IDs consumed by PDF:
//   SL: family_experience, multi_guarantor, statement_delivery, payment_methods, staff_time, autopay_rate
//   SNF: snf_family_experience, snf_statement_delivery, snf_payment_methods, snf_staff_time, snf_autopay, snf_collection_rate
// ============================================

// PatientPay logo as base64 (small optimized version for PDF)
const PATIENTPAY_LOGO_SVG = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMDAgNjAiPjx0ZXh0IHg9IjAiIHk9IjQ1IiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNDgiIGZvbnQtd2VpZ2h0PSJib2xkIj48dHNwYW4gZmlsbD0iIzA3MjE0MCI+UGF0aWVudDwvdHNwYW4+PHRzcGFuIGZpbGw9IiMzYzhmYzciPlBheTwvdHNwYW4+PC90ZXh0Pjwvc3ZnPg==`;

/**
 * Generate a professional PDF report using jsPDF
 * V5 Complete Rewrite:
 * - Adapted for V5 simplified questions (6 SL / 6 SNF)
 * - Industry stats enrich where direct user data is unavailable
 * - SL: 6 pages, SNF: 5 pages
 * - Psychology arc: VALIDATE -> DISRUPT -> QUANTIFY -> RESOLVE -> PROVE + ACT
 *
 * @param {Object} formData - Contact/facility info (email captured at end in V5)
 * @param {Object} answers - User answers (V5 question IDs)
 * @param {Object} scores - Calculated scores
 * @returns {Promise<Blob>} - PDF blob for download
 */
async function generatePDFReport(formData, answers, scores) {
  // Dynamically load jsPDF if not already loaded
  if (typeof window.jspdf === 'undefined') {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'pt', 'letter');

  const segment = answers['facility_type'];
  const isSNF = segment === 'SNF';
  const segmentLabel = segment && FacilityTypes[segment] ? FacilityTypes[segment].label : 'Senior Living';
  const visibleQuestions = getVisibleQuestions(answers);
  const insights = calculateInsights(formData, answers);
  const personTerm = isSNF ? 'patient' : 'resident';
  const familyTerm = isSNF ? 'patients and families' : 'families';

  // V5: Compute all data needed for PDF
  const strengthsData = getStrengths(scores, answers);
  const projectionsData = calculatePatientPayProjections(answers, scores);
  const recommendationsData = getActionableRecommendations(answers, scores, insights);

  // V5: Build gap analysis data locally to avoid engine dependency issues
  const benchmarks = IndustryBenchmarks[segment];
  const categoryCount = isSNF ? 2 : 3;
  const pdfCategoryLabels = isSNF ? SNFCategoryNames : CategoryNames;
  const benchmarkValues = isSNF
    ? [benchmarks ? benchmarks.operations || 45 : 45, benchmarks ? benchmarks.family || 52 : 52]
    : [benchmarks ? benchmarks.operations || 55 : 55, benchmarks ? benchmarks.family || 60 : 60, benchmarks ? benchmarks.competitive || 58 : 58];

  const gapAnalysisData = {
    segment,
    segmentLabel: benchmarks ? benchmarks.label : segmentLabel,
    overall: {
      score: scores.overall,
      benchmark: benchmarks ? benchmarks.overall : 58,
      gap: scores.overall - (benchmarks ? benchmarks.overall : 58)
    },
    categories: []
  };
  for (let ci = 0; ci < categoryCount; ci++) {
    const catScore = scores.categories[ci];
    const catBench = benchmarkValues[ci];
    gapAnalysisData.categories.push({
      index: ci,
      name: pdfCategoryLabels[ci],
      score: catScore,
      benchmark: catBench,
      gap: catScore - catBench,
      weight: scores.weights ? scores.weights[ci] : (isSNF ? [0.60, 0.40][ci] : [0.30, 0.45, 0.25][ci])
    });
  }

  // Brand colors
  const colors = {
    primary: [7, 33, 64],
    secondary: [60, 143, 199],
    accent: [252, 201, 59],
    success: [16, 185, 129],
    warning: [245, 158, 11],
    error: [239, 68, 68],
    textDark: [30, 41, 59],
    textMuted: [100, 116, 139],
    bgLight: [248, 250, 252],
    white: [255, 255, 255],
  };

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const contentWidth = pageWidth - (margin * 2);

  const spacing = { xs: 8, sm: 12, md: 18, lg: 25, xl: 35, section: 30 };
  const radius = { sm: 4, md: 6, lg: 8, xl: 10 };
  const fontSize = { xs: 8, sm: 9, body: 10, md: 11, lg: 12, xl: 14, h2: 16, h1: 20, display: 28 };

  const setColor = (color) => doc.setTextColor(color[0], color[1], color[2]);
  const setFillColor = (color) => doc.setFillColor(color[0], color[1], color[2]);
  const setDrawColor = (color) => doc.setDrawColor(color[0], color[1], color[2]);

  const formatCurrency = (num) => {
    if (!num) return 'N/A';
    return '$' + num.toLocaleString('en-US');
  };

  const getScoreColorArr = (score) => {
    if (score >= 80) return colors.success;
    if (score >= 60) return colors.secondary;
    if (score >= 40) return colors.warning;
    return colors.error;
  };

  const getScoreLevelText = (score) => {
    if (score >= 90) return { level: 'Excellent', desc: 'Your payment operations are industry-leading' };
    if (score >= 80) return { level: 'Strong', desc: 'Your payment operations are well-positioned' };
    if (score >= 60) return { level: 'Progressing', desc: 'Good foundation with room for optimization' };
    if (score >= 40) return { level: 'Developing', desc: 'Significant opportunities for improvement' };
    return { level: 'Needs Attention', desc: 'Meaningful improvements available across key areas' };
  };

  const drawLogo = (x, y, size = 'normal', onDarkBg = false) => {
    const logoFontSize = size === 'large' ? 28 : size === 'small' ? 12 : 18;
    doc.setFontSize(logoFontSize);
    doc.setFont('helvetica', 'bold');
    const patientWidth = doc.getTextWidth('Patient');
    const payWidth = doc.getTextWidth('Pay');
    const totalWidth = patientWidth + payWidth;
    if (onDarkBg) {
      setFillColor(colors.white);
      const padding = size === 'large' ? 10 : 6;
      doc.roundedRect(x - padding, y - logoFontSize + 2, totalWidth + (padding * 2), logoFontSize + padding, radius.sm, radius.sm, 'F');
    }
    setColor(colors.primary);
    doc.text('Patient', x, y);
    setColor(colors.secondary);
    doc.text('Pay', x + patientWidth, y);
  };

  // V5: SL=6 pages, SNF=5 pages
  let totalPages = isSNF ? 5 : 6;

  const addFooter = (pageNum) => {
    setDrawColor([220, 225, 230]);
    doc.setLineWidth(0.75);
    doc.line(margin, pageHeight - 45, pageWidth - margin, pageHeight - 45);
    setColor(colors.textMuted);
    doc.setFontSize(fontSize.xs);
    doc.setFont('helvetica', 'normal');
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth / 2, pageHeight - 28, { align: 'center' });
    doc.text('Payment Readiness Assessment', margin, pageHeight - 28);
    doc.text(new Date().toLocaleDateString(), pageWidth - margin, pageHeight - 28, { align: 'right' });
  };

  const addHeader = (title, showLogo = true) => {
    setFillColor(colors.primary);
    doc.rect(0, 0, pageWidth, 65, 'F');
    setFillColor(colors.secondary);
    doc.rect(0, 63, pageWidth, 2, 'F');
    setFillColor(colors.accent);
    doc.rect(margin, 63, 60, 2, 'F');
    if (showLogo) {
      const logoX = pageWidth - margin - 75;
      const logoY = 28;
      doc.setFontSize(fontSize.lg);
      doc.setFont('helvetica', 'bold');
      const pw = doc.getTextWidth('Patient');
      const ppw = doc.getTextWidth('Pay');
      setFillColor(colors.white);
      doc.roundedRect(logoX - 8, logoY - 11, pw + ppw + 16, 22, radius.sm, radius.sm, 'F');
      setColor(colors.primary);
      doc.text('Patient', logoX, logoY);
      setColor(colors.secondary);
      doc.text('Pay', logoX + pw, logoY);
    }
    setColor(colors.white);
    doc.setFontSize(fontSize.h1);
    doc.setFont('helvetica', 'bold');
    doc.text(title, margin, 40);
  };

  // ============================================
  // PAGE 1: COVER (VALIDATE)
  // ============================================
  setFillColor(colors.primary);
  doc.rect(0, 0, pageWidth, 305, 'F');

  // Accent bar
  setFillColor(colors.accent);
  doc.rect(0, 305, pageWidth, 6, 'F');
  setFillColor(colors.secondary);
  doc.rect(0, 311, pageWidth, 2, 'F');

  // Logo
  drawLogo(margin, 65, 'large', true);

  // Tagline
  setColor(colors.secondary);
  doc.setFontSize(fontSize.lg);
  doc.setFont('helvetica', 'normal');
  doc.text('PointClickCare Marketplace Partner', margin, 92);

  // Title
  setColor(colors.white);
  doc.setFontSize(36);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Readiness', margin, 155);
  doc.text('Assessment Report', margin, 198);

  // Segment badge
  doc.setFontSize(fontSize.xl);
  const badgeWidth = doc.getTextWidth(segmentLabel) + 28;
  setFillColor(colors.accent);
  doc.roundedRect(margin, 220, badgeWidth, 30, radius.md, radius.md, 'F');
  setColor(colors.primary);
  doc.setFont('helvetica', 'bold');
  doc.text(segmentLabel, margin + 14, 240);

  // Organization
  setColor(colors.white);
  doc.setFontSize(fontSize.h2);
  doc.setFont('helvetica', 'normal');
  const displayOrg = (formData.organization || formData.organizationName || 'Your Organization').substring(0, 45);
  doc.text(displayOrg, margin, 278);

  // Overall score box
  let y = 345;
  setFillColor(colors.bgLight);
  doc.roundedRect(margin, y, contentWidth, 165, radius.xl, radius.xl, 'F');
  setFillColor(colors.secondary);
  doc.roundedRect(margin, y, contentWidth, 4, radius.xl, radius.xl, 'F');

  setColor(colors.textDark);
  doc.setFontSize(fontSize.md);
  doc.setFont('helvetica', 'bold');
  doc.text('OVERALL PAYMENT READINESS SCORE', margin + spacing.lg, y + 35);

  const scoreColor = getScoreColorArr(scores.overall);
  const scoreLevelInfo = getScoreLevelText(scores.overall);

  // Score circle with outer ring
  setDrawColor(scoreColor);
  doc.setLineWidth(3);
  doc.circle(margin + 85, y + 100, 56, 'S');
  setFillColor(scoreColor);
  doc.circle(margin + 85, y + 100, 50, 'F');
  setColor(colors.white);
  doc.setFontSize(44);
  doc.setFont('helvetica', 'bold');
  doc.text(scores.overall.toString(), margin + 85, y + 110, { align: 'center' });
  doc.setFontSize(fontSize.sm);
  doc.setFont('helvetica', 'normal');
  doc.text('out of 100', margin + 85, y + 128, { align: 'center' });

  // Score level
  setColor(scoreColor);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(scoreLevelInfo.level, margin + 165, y + 90);

  setColor(colors.textMuted);
  doc.setFontSize(fontSize.md);
  doc.setFont('helvetica', 'normal');
  const descLines = doc.splitTextToSize(scoreLevelInfo.desc, 270);
  doc.text(descLines, margin + 165, y + 112);

  // Category bars
  y = 540;
  setColor(colors.textDark);
  doc.setFontSize(fontSize.md);
  doc.setFont('helvetica', 'bold');
  doc.text('CATEGORY SCORES', margin, y);
  y += spacing.lg;

  const weights = isSNF ? [0.60, 0.40] : (scores.weights || [0.30, 0.45, 0.25]);

  pdfCategoryLabels.slice(0, categoryCount).forEach((name, i) => {
    setColor(colors.textDark);
    doc.setFontSize(fontSize.body);
    doc.setFont('helvetica', 'normal');
    doc.text(name, margin, y + 11);

    setFillColor([225, 230, 235]);
    doc.roundedRect(margin + 155, y, 195, 16, radius.sm, radius.sm, 'F');

    const fillWidth = (scores.categories[i] / 100) * 195;
    if (fillWidth > 0) {
      setFillColor(getScoreColorArr(scores.categories[i]));
      doc.roundedRect(margin + 155, y, fillWidth, 16, radius.sm, radius.sm, 'F');
    }

    setColor(colors.textMuted);
    doc.setFontSize(fontSize.sm);
    doc.text(`${scores.categories[i]}/100 (${Math.round(weights[i] * 100)}% weight)`, margin + 362, y + 11);
    y += 30;
  });

  // Contact info box
  y = 665;
  setFillColor([245, 247, 250]);
  doc.roundedRect(margin, y, contentWidth, 72, radius.md, radius.md, 'F');

  setFillColor([220, 225, 230]);
  doc.rect(margin + 260, y + 12, 1, 48, 'F');

  setColor(colors.textMuted);
  doc.setFontSize(fontSize.xs);
  doc.setFont('helvetica', 'bold');
  doc.text('PREPARED FOR', margin + 18, y + 20);

  setColor(colors.textDark);
  doc.setFontSize(fontSize.md);
  doc.setFont('helvetica', 'bold');
  doc.text(formData.name || 'Assessment User', margin + 18, y + 38);
  doc.setFontSize(fontSize.body);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.email || '', margin + 18, y + 54);

  setColor(colors.textMuted);
  doc.setFontSize(fontSize.xs);
  doc.setFont('helvetica', 'bold');
  doc.text('SEGMENT', margin + 278, y + 20);
  setColor(colors.textDark);
  doc.setFontSize(fontSize.body);
  doc.setFont('helvetica', 'normal');
  doc.text(segmentLabel, margin + 278, y + 38);

  // Generation date
  setColor(colors.textMuted);
  doc.setFontSize(fontSize.xs);
  doc.setFont('helvetica', 'normal');
  doc.text('Generated: ' + new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  }), pageWidth - margin - 15, y + 60, { align: 'right' });

  addFooter(1);

  // ============================================
  // PAGE 2: YOUR PAYMENT READINESS (VALIDATE + DISRUPT)
  // Benchmark comparison + strengths + gaps
  // ============================================
  doc.addPage();
  addHeader('Your Payment Readiness');
  y = 95;

  // --- Benchmark Comparison ---
  setColor(colors.textDark);
  doc.setFontSize(fontSize.xl);
  doc.setFont('helvetica', 'bold');
  doc.text('Benchmark Comparison', margin, y);
  y += spacing.lg;

  const overallGap = gapAnalysisData.overall.gap;
  const overallGapColor = overallGap >= 0 ? colors.success : colors.warning;

  setFillColor(colors.bgLight);
  doc.roundedRect(margin, y, contentWidth, 65, radius.lg, radius.lg, 'F');

  // Left: Your Score
  setColor(colors.textMuted);
  doc.setFontSize(fontSize.xs);
  doc.setFont('helvetica', 'bold');
  doc.text('YOUR OVERALL SCORE', margin + spacing.lg, y + 16);
  setColor(colors.textDark);
  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  doc.text(`${scores.overall}`, margin + spacing.lg, y + 50);

  // Center: vs
  setColor(colors.textMuted);
  doc.setFontSize(fontSize.body);
  doc.setFont('helvetica', 'normal');
  doc.text('vs', margin + 135, y + 40);

  // Center-right: Benchmark
  setColor(colors.textMuted);
  doc.setFontSize(fontSize.xs);
  doc.setFont('helvetica', 'bold');
  doc.text(`${segmentLabel.toUpperCase()} BENCHMARK`, margin + 170, y + 16);
  setColor(colors.textDark);
  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  doc.text(`${gapAnalysisData.overall.benchmark}`, margin + 170, y + 50);

  // Right: Gap badge
  const gapBadgeLabel = overallGap >= 5 ? 'Above Benchmark' : overallGap >= 0 ? 'At Benchmark' : 'Below Benchmark';
  const gapBadgeWidth = 130;
  const gapBadgeX = margin + contentWidth - gapBadgeWidth - spacing.md;
  setFillColor(overallGapColor);
  doc.roundedRect(gapBadgeX, y + 18, gapBadgeWidth, 30, radius.md, radius.md, 'F');
  setColor(colors.white);
  doc.setFontSize(fontSize.md);
  doc.setFont('helvetica', 'bold');
  doc.text(gapBadgeLabel, gapBadgeX + gapBadgeWidth / 2, y + 38, { align: 'center' });

  y += 85;

  // Per-category comparison bars
  for (let ci = 0; ci < categoryCount; ci++) {
    const catData = gapAnalysisData.categories[ci];
    const catGapColor = catData.gap >= 0 ? colors.success : colors.warning;

    setFillColor(colors.bgLight);
    doc.roundedRect(margin, y, contentWidth, 58, radius.md, radius.md, 'F');

    setColor(colors.textDark);
    doc.setFontSize(fontSize.md);
    doc.setFont('helvetica', 'bold');
    doc.text(catData.name, margin + spacing.md, y + 16);

    setColor(colors.textMuted);
    doc.setFontSize(fontSize.xs);
    doc.setFont('helvetica', 'normal');
    doc.text(`${Math.round(catData.weight * 100)}% weight`, margin + spacing.md, y + 30);

    // Score bar
    const barX = margin + 230;
    const barWidth = 200;
    const barHeight = 14;
    const barY = y + 14;

    setFillColor([225, 230, 235]);
    doc.roundedRect(barX, barY, barWidth, barHeight, radius.sm, radius.sm, 'F');

    const fillW = Math.max(0, (catData.score / 100) * barWidth);
    if (fillW > 0) {
      setFillColor(getScoreColorArr(catData.score));
      doc.roundedRect(barX, barY, fillW, barHeight, radius.sm, radius.sm, 'F');
    }

    // Benchmark marker
    const benchmarkX = barX + (catData.benchmark / 100) * barWidth;
    setDrawColor(colors.primary);
    doc.setLineWidth(2);
    doc.line(benchmarkX, barY - 3, benchmarkX, barY + barHeight + 3);

    // Score label
    setColor(colors.textDark);
    doc.setFontSize(fontSize.sm);
    doc.setFont('helvetica', 'bold');
    doc.text(`${catData.score}`, barX + barWidth + 10, barY + 11);

    // Benchmark label
    setColor(colors.textMuted);
    doc.setFontSize(fontSize.xs);
    doc.text(`Benchmark: ${catData.benchmark}`, barX, y + 48);

    // Gap badge
    const catGapBadgeW = 75;
    const catGapBadgeX = margin + contentWidth - catGapBadgeW - spacing.sm;
    setFillColor(catGapColor);
    doc.roundedRect(catGapBadgeX, y + 34, catGapBadgeW, 20, radius.sm, radius.sm, 'F');
    setColor(colors.white);
    doc.setFontSize(fontSize.sm);
    doc.setFont('helvetica', 'bold');
    const catGapText = catData.gap >= 0 ? `+${catData.gap} above` : `${catData.gap} below`;
    doc.text(catGapText, catGapBadgeX + catGapBadgeW / 2, y + 48, { align: 'center' });

    y += 65;
  }

  y += spacing.section;

  // --- Your Strengths ---
  setColor(colors.success);
  doc.setFontSize(fontSize.xl);
  doc.setFont('helvetica', 'bold');
  doc.text('Your Strengths', margin, y);
  y += spacing.lg;

  if (strengthsData.strongCategories && strengthsData.strongCategories.length > 0) {
    strengthsData.strongCategories.forEach((cat) => {
      if (y + 50 > pageHeight - 60) return;
      setFillColor([240, 253, 244]);
      doc.roundedRect(margin, y, contentWidth, 42, radius.md, radius.md, 'F');
      setFillColor(colors.success);
      doc.roundedRect(margin, y, 5, 42, radius.sm, radius.sm, 'F');

      setColor(colors.textDark);
      doc.setFontSize(fontSize.lg);
      doc.setFont('helvetica', 'bold');
      doc.text(cat.name, margin + spacing.lg, y + 18);

      setColor(colors.success);
      doc.setFontSize(fontSize.md);
      doc.text(`${cat.score}/100`, margin + 260, y + 18);

      setFillColor(colors.success);
      doc.roundedRect(margin + 330, y + 8, 110, 22, radius.sm, radius.sm, 'F');
      setColor(colors.white);
      doc.setFontSize(fontSize.sm);
      doc.text('Above Benchmark', margin + 385, y + 22, { align: 'center' });

      setColor(colors.textMuted);
      doc.setFontSize(fontSize.sm);
      doc.setFont('helvetica', 'normal');
      doc.text(`+${cat.gap} points above industry average`, margin + spacing.lg, y + 36);
      y += 50;
    });
  } else if (strengthsData.relativeStrength) {
    setFillColor([255, 251, 235]);
    doc.roundedRect(margin, y, contentWidth, 68, radius.md, radius.md, 'F');
    setFillColor(colors.warning);
    doc.roundedRect(margin, y, 5, 68, radius.sm, radius.sm, 'F');

    setColor(colors.textMuted);
    doc.setFontSize(fontSize.xs);
    doc.setFont('helvetica', 'bold');
    doc.text('STRONGEST AREA', margin + spacing.lg, y + 16);

    setColor(colors.textDark);
    doc.setFontSize(fontSize.lg);
    doc.setFont('helvetica', 'bold');
    doc.text(strengthsData.relativeStrength.name, margin + spacing.lg, y + 36);

    setColor(colors.warning);
    doc.setFontSize(fontSize.md);
    doc.text(`${strengthsData.relativeStrength.score}/100`, margin + 280, y + 36);

    setColor(colors.textMuted);
    doc.setFontSize(fontSize.sm);
    doc.setFont('helvetica', 'normal');
    doc.text('Your closest category to reaching benchmark', margin + spacing.lg, y + 56);
    y += 80;
  } else {
    setFillColor([240, 249, 255]);
    doc.roundedRect(margin, y, contentWidth, 55, radius.md, radius.md, 'F');
    setFillColor(colors.secondary);
    doc.roundedRect(margin, y, 5, 55, radius.sm, radius.sm, 'F');

    setColor(colors.textDark);
    doc.setFontSize(fontSize.md);
    doc.setFont('helvetica', 'bold');
    doc.text('Early in Your Modernization Journey', margin + spacing.lg, y + 22);
    setColor(colors.textMuted);
    doc.setFontSize(fontSize.body);
    doc.setFont('helvetica', 'normal');
    doc.text('You have significant opportunity ahead. The pages that follow show how to get there.', margin + spacing.lg, y + 42);
  }

  addFooter(2);

  // ============================================
  // PAGE 3: WHAT FAMILIES EXPECT (DISRUPT)
  // Industry stats-driven — no direct user data needed
  // ============================================
  doc.addPage();
  if (isSNF) {
    addHeader('The Collection Opportunity');
  } else {
    addHeader("What Today's Families Expect");
  }
  y = 95;

  if (isSNF) {
    // --- SNF: Collection context ---
    setFillColor(colors.primary);
    doc.roundedRect(margin, y, contentWidth, 70, radius.lg, radius.lg, 'F');
    setColor(colors.accent);
    doc.setFontSize(fontSize.lg);
    doc.setFont('helvetica', 'bold');
    doc.text('THE PATIENT RESPONSIBILITY CHALLENGE', margin + spacing.lg, y + 22);
    setColor(colors.white);
    doc.setFontSize(fontSize.body);
    doc.setFont('helvetica', 'normal');
    const snfContextText = doc.splitTextToSize(
      'With margins at 0.6% and 47-59% of SNFs losing money, every dollar of patient responsibility collected directly impacts viability. Modern payment tools focus specifically on recovering this revenue.',
      contentWidth - (spacing.lg * 2)
    );
    doc.text(snfContextText, margin + spacing.lg, y + 40);
    y += 88;

    // SNF stat cards
    const snfStats = [
      { value: '56-100+', label: 'Typical AR days for patient responsibility', color: colors.error },
      { value: '23%', label: 'Private pay payer mix (industry avg)', color: colors.secondary },
      { value: '75%', label: 'Want card payment options', color: colors.success },
      { value: '60%', label: 'Text-to-pay response rate (vs 43% avg)', color: colors.success },
      { value: '0.6%', label: 'Median SNF operating margin', color: colors.warning },
      { value: '~100%', label: 'Card users would enroll in autopay', color: colors.secondary }
    ];

    setColor(colors.textDark);
    doc.setFontSize(fontSize.xl);
    doc.setFont('helvetica', 'bold');
    doc.text('Industry Context', margin, y);
    y += spacing.lg;

    const statCardWidth = (contentWidth - 16) / 3;
    const statCardHeight = 72;
    const statGap = 8;

    snfStats.forEach((stat, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const cardX = margin + col * (statCardWidth + statGap);
      const cardY = y + row * (statCardHeight + statGap);

      setFillColor(colors.bgLight);
      doc.roundedRect(cardX, cardY, statCardWidth, statCardHeight, radius.md, radius.md, 'F');
      setFillColor(stat.color);
      doc.roundedRect(cardX, cardY, statCardWidth, 3, radius.md, radius.md, 'F');

      setColor(stat.color);
      doc.setFontSize(28);
      doc.setFont('helvetica', 'bold');
      doc.text(stat.value, cardX + spacing.md, cardY + 32);

      setColor(colors.textDark);
      doc.setFontSize(fontSize.xs);
      doc.setFont('helvetica', 'normal');
      const labelLines = doc.splitTextToSize(stat.label, statCardWidth - (spacing.md * 2));
      doc.text(labelLines, cardX + spacing.md, cardY + 48);
    });

    y += (statCardHeight * 2) + statGap + spacing.section;

    // SNF Collection gap table
    const collectionRate = answers['snf_collection_rate'] || 75;
    const snfPayMethods = answers['snf_payment_methods'] || [];
    const snfAutopayAnswer = answers['snf_autopay'];
    const snfHasAutopay = snfAutopayAnswer === 'automated' || snfAutopayAnswer === 'low_enrollment' || snfAutopayAnswer === 'partial';

    setColor(colors.textDark);
    doc.setFontSize(fontSize.xl);
    doc.setFont('helvetica', 'bold');
    doc.text('Your Collection Gap', margin, y);
    y += spacing.lg;

    const snfGapRows = [];
    if (collectionRate < 90) {
      snfGapRows.push({ current: `Collection rate at ${collectionRate}%`, expected: 'Industry target: 90%+ with modern tools' });
    }
    const snfHasCards = snfPayMethods.includes('Credit cards') || snfPayMethods.includes('credit_cards');
    if (!snfHasCards) {
      snfGapRows.push({ current: 'No card payment options', expected: '75% of families want card payment options' });
    }
    if (snfAutopayAnswer === 'no' || snfAutopayAnswer === 'unsure') {
      snfGapRows.push({ current: snfAutopayAnswer === 'no' ? 'No autopay offered' : 'Autopay status unknown', expected: 'Autopay = near-zero AR days for enrolled families' });
    } else if (snfAutopayAnswer === 'low_enrollment') {
      snfGapRows.push({ current: 'Autopay offered but enrollment is low', expected: 'Active enrollment campaigns can reach 40%+' });
    } else if (snfAutopayAnswer === 'partial') {
      snfGapRows.push({ current: 'Autopay limited to some balance types', expected: 'Full autopay across all patient responsibility' });
    }
    const snfDelivery = answers['snf_statement_delivery'] || [];
    const snfHasDigital = Array.isArray(snfDelivery) && snfDelivery.some(d => d === 'Email' || d === 'Text or SMS' || d === 'Online portal');
    if (!snfHasDigital) {
      snfGapRows.push({ current: 'Paper-only statement delivery', expected: 'Text-to-pay: 60% response rate vs 43% average' });
    }

    // SNF family experience
    const snfFamilyExp = answers['snf_family_experience'];
    if (snfFamilyExp === 'moderate' || snfFamilyExp === 'poor') {
      snfGapRows.push({
        current: snfFamilyExp === 'poor' ? 'Weekly+ billing complaints' : 'Monthly billing inquiries',
        expected: '37% miss bills from confusion — clear billing reduces calls'
      });
    }

    // SNF staff time — personalized
    const snfStaffAnswer = answers['snf_staff_time'];
    if (snfStaffAnswer === 'significant' || snfStaffAnswer === 'excessive') {
      const snfStaffLabels = { significant: '15-30 hrs/week manual billing', excessive: '30+ hrs/week manual billing' };
      const snfStaffCostNote = insights.annualManualBillingCost ? ` (est. ${formatCurrency(insights.annualManualBillingCost)}/yr)` : '';
      snfGapRows.push({
        current: snfStaffLabels[snfStaffAnswer] + snfStaffCostNote,
        expected: '$3.39 digital vs $7.93 manual per transaction'
      });
    }

    if (snfGapRows.length > 0) {
      setFillColor(colors.primary);
      doc.roundedRect(margin, y, contentWidth, 26, radius.sm, radius.sm, 'F');
      setColor(colors.white);
      doc.setFontSize(fontSize.body);
      doc.setFont('helvetica', 'bold');
      doc.text('Where You Are Today', margin + 18, y + 17);
      doc.text('Where You Could Be', margin + contentWidth / 2 + 18, y + 17);
      y += 26;

      snfGapRows.slice(0, 6).forEach((row, i) => {
        const rowBg = i % 2 === 0 ? colors.bgLight : colors.white;
        setFillColor(rowBg);
        doc.rect(margin, y, contentWidth, 30, 'F');
        setDrawColor([220, 225, 230]);
        doc.setLineWidth(0.5);
        doc.line(margin + contentWidth / 2, y, margin + contentWidth / 2, y + 30);

        setColor(colors.error);
        doc.setFontSize(fontSize.body);
        doc.setFont('helvetica', 'normal');
        doc.text(doc.splitTextToSize(row.current, contentWidth / 2 - 30)[0], margin + 18, y + 19);

        setColor(colors.success);
        doc.text(doc.splitTextToSize(row.expected, contentWidth / 2 - 30)[0], margin + contentWidth / 2 + 18, y + 19);
        y += 30;
      });
    }

  } else {
    // --- SL: Family expectations (industry-driven) ---
    setFillColor(colors.primary);
    doc.roundedRect(margin, y, contentWidth, 70, radius.lg, radius.lg, 'F');
    setColor(colors.accent);
    doc.setFontSize(fontSize.lg);
    doc.setFont('helvetica', 'bold');
    doc.text('THE DEMOGRAPHIC SHIFT', margin + spacing.lg, y + 22);
    setColor(colors.white);
    doc.setFontSize(fontSize.body);
    doc.setFont('helvetica', 'normal');
    const demoText = doc.splitTextToSize(
      '11,200 Americans turn 65 every day. Their adult children grew up with digital payments, mobile banking, and instant transfers. They expect the same from your billing.',
      contentWidth - (spacing.lg * 2)
    );
    doc.text(demoText, margin + spacing.lg, y + 40);
    y += 88;

    // Family Expectations Dashboard (3x2 grid)
    setColor(colors.textDark);
    doc.setFontSize(fontSize.xl);
    doc.setFont('helvetica', 'bold');
    doc.text('Family Expectations Dashboard', margin, y);
    y += spacing.lg;

    const expectationStats = [
      { value: '67%', label: 'would choose a card-accepting facility', color: colors.accent },
      { value: '78%', label: 'of seniors 65+ own smartphones', color: colors.secondary },
      { value: '75%', label: 'want card payment options', color: colors.secondary },
      { value: '82%', label: 'prefer digital payments', color: colors.success },
      { value: '37%', label: 'miss bills due to payment complexity', color: colors.warning },
      { value: '72%', label: 'less likely to miss with unified billing', color: colors.success }
    ];

    const statCardWidth = (contentWidth - 16) / 3;
    const statCardHeight = 72;
    const statGap = 8;

    expectationStats.forEach((stat, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const cardX = margin + col * (statCardWidth + statGap);
      const cardY = y + row * (statCardHeight + statGap);

      setFillColor(colors.bgLight);
      doc.roundedRect(cardX, cardY, statCardWidth, statCardHeight, radius.md, radius.md, 'F');
      setFillColor(stat.color);
      doc.roundedRect(cardX, cardY, statCardWidth, 3, radius.md, radius.md, 'F');

      setColor(stat.color);
      doc.setFontSize(28);
      doc.setFont('helvetica', 'bold');
      doc.text(stat.value, cardX + spacing.md, cardY + 32);

      setColor(colors.textDark);
      doc.setFontSize(fontSize.xs);
      doc.setFont('helvetica', 'normal');
      const labelLines = doc.splitTextToSize(stat.label, statCardWidth - (spacing.md * 2));
      doc.text(labelLines, cardX + spacing.md, cardY + 48);
    });

    y += (statCardHeight * 2) + statGap + spacing.section;

    // Your Gap table (derived from V5 SL answers)
    setColor(colors.textDark);
    doc.setFontSize(fontSize.xl);
    doc.setFont('helvetica', 'bold');
    doc.text('Your Gap', margin, y);
    y += spacing.lg;

    const gapRows = [];
    const stmtDelivery = answers['statement_delivery'];
    if (stmtDelivery) {
      const isDigital = Array.isArray(stmtDelivery) && stmtDelivery.some(d => d === 'Email' || d === 'Text or SMS' || d === 'Online portal');
      if (!isDigital) {
        gapRows.push({ current: 'Paper-only statement delivery', expected: 'Digital delivery (email, text, portal)' });
      }
    }

    const payMethods = answers['payment_methods'] || [];
    const hasCards = Array.isArray(payMethods) && (payMethods.includes('Credit cards') || payMethods.includes('Debit cards'));
    if (!hasCards) {
      gapRows.push({ current: 'No credit/debit card acceptance', expected: '75% of families want card options' });
    }

    const multiGuarantor = answers['multi_guarantor'];
    if (multiGuarantor === 'No' || multiGuarantor === 'Unsure') {
      gapRows.push({ current: 'Single-payer billing only', expected: 'Automated split billing (62% share costs)' });
    } else if (multiGuarantor === 'Yes, manually') {
      gapRows.push({ current: 'Manual multi-guarantor process', expected: 'Automated split billing with individual statements' });
    }

    const autopayRate = answers['autopay_rate'];
    if (autopayRate !== undefined && autopayRate < 30) {
      gapRows.push({ current: `Autopay enrollment at ${autopayRate}%`, expected: 'Industry target: 40-50% autopay adoption' });
    }

    const familyExp = answers['family_experience'];
    if (familyExp === 'moderate' || familyExp === 'poor' || familyExp === 'We get occasional friction or confusion from families' || familyExp === 'Billing is a frequent source of complaints or calls') {
      gapRows.push({
        current: (familyExp === 'poor' || familyExp === 'Billing is a frequent source of complaints or calls') ? 'Frequent billing complaints' : 'Occasional billing frustrations',
        expected: 'Clear, transparent billing experience'
      });
    }

    if (gapRows.length > 0) {
      const displayRows = gapRows.slice(0, 5);
      setFillColor(colors.primary);
      doc.roundedRect(margin, y, contentWidth, 26, radius.sm, radius.sm, 'F');
      setColor(colors.white);
      doc.setFontSize(fontSize.body);
      doc.setFont('helvetica', 'bold');
      doc.text('What You Offer Today', margin + 18, y + 17);
      doc.text('What Families Expect', margin + contentWidth / 2 + 18, y + 17);
      setDrawColor(colors.white);
      doc.setLineWidth(0.5);
      doc.line(margin + contentWidth / 2, y + 4, margin + contentWidth / 2, y + 22);
      y += 26;

      displayRows.forEach((row, i) => {
        const rowBg = i % 2 === 0 ? colors.bgLight : colors.white;
        setFillColor(rowBg);
        doc.rect(margin, y, contentWidth, 30, 'F');
        setDrawColor([220, 225, 230]);
        doc.setLineWidth(0.5);
        doc.line(margin + contentWidth / 2, y, margin + contentWidth / 2, y + 30);

        setColor(colors.error);
        doc.setFontSize(fontSize.body);
        doc.setFont('helvetica', 'normal');
        doc.text(doc.splitTextToSize(row.current, contentWidth / 2 - 30)[0], margin + 18, y + 19);

        setColor(colors.success);
        doc.text(doc.splitTextToSize(row.expected, contentWidth / 2 - 30)[0], margin + contentWidth / 2 + 18, y + 19);
        y += 30;
      });

      setDrawColor([220, 225, 230]);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, y - (displayRows.length * 30), contentWidth, displayRows.length * 30, radius.sm, radius.sm, 'S');
    } else {
      setFillColor([240, 253, 244]);
      doc.roundedRect(margin, y, contentWidth, 55, radius.lg, radius.lg, 'F');
      setFillColor(colors.success);
      doc.roundedRect(margin, y, 5, 55, radius.sm, radius.sm, 'F');
      setColor(colors.success);
      doc.setFontSize(fontSize.lg);
      doc.setFont('helvetica', 'bold');
      doc.text("You Are Ahead of Most Facilities", margin + spacing.lg, y + 22);
      setColor(colors.textDark);
      doc.setFontSize(fontSize.body);
      doc.setFont('helvetica', 'normal');
      doc.text('Your current offerings align well with what families expect. Keep building on this foundation.', margin + spacing.lg, y + 42);
    }
  }

  addFooter(3);

  // ============================================
  // PAGE 4: FINANCIAL IMPACT (QUANTIFY)
  // Uses estimation-based insights since V5 has no bedCount/rate inputs
  // ============================================
  doc.addPage();
  addHeader(isSNF ? 'The Cost of Inaction' : 'The Cost of Manual Operations');
  y = 95;

  // --- Financial context (estimation-based) ---
  if (insights) {
    setColor(colors.textDark);
    doc.setFontSize(fontSize.xl);
    doc.setFont('helvetica', 'bold');
    doc.text(isSNF ? 'Your Collection Economics' : 'Your Financial Snapshot', margin, y);
    y += spacing.lg;

    if (isSNF) {
      // SNF: Collection-focused financial cards
      const snfFinancials = [
        { label: 'Est. Annual Revenue', value: formatCurrency(insights.annualRevenue), sublabel: `Based on ${insights.bedCount} beds x occupancy`, color: colors.primary },
        { label: 'Collection Gap', value: formatCurrency(insights.collectionGap || 0), sublabel: `From ${insights.collectionRate || 75}% to 90% target`, color: colors.error },
        { label: 'Cash Tied in A/R', value: formatCurrency(insights.potentialFreedCash), sublabel: `If reduced from ${insights.arDays} to ${insights.targetArDays} days`, color: colors.warning }
      ];

      const boxW = (contentWidth - 24) / 3;
      snfFinancials.forEach((stat, i) => {
        const bx = margin + (i * (boxW + 12));
        setFillColor(colors.bgLight);
        doc.roundedRect(bx, y, boxW, 100, radius.lg, radius.lg, 'F');
        setFillColor(stat.color);
        doc.roundedRect(bx, y, boxW, 4, radius.lg, radius.lg, 'F');

        setColor(colors.textMuted);
        doc.setFontSize(fontSize.sm);
        doc.setFont('helvetica', 'bold');
        doc.text(stat.label.toUpperCase(), bx + spacing.md, y + 24);

        setColor(stat.color);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text(stat.value, bx + spacing.md, y + 56);

        setColor(colors.textMuted);
        doc.setFontSize(fontSize.xs);
        doc.setFont('helvetica', 'normal');
        const subLines = doc.splitTextToSize(stat.sublabel, boxW - 28);
        doc.text(subLines, bx + spacing.md, y + 78);
      });
      y += 125;

      // SNF: Personalized staff cost insight (uses snf_staff_time + annualManualBillingCost)
      if (insights.annualManualBillingCost && insights.staffHoursPerWeek) {
        setFillColor([255, 251, 235]);
        doc.roundedRect(margin, y, contentWidth, 62, radius.lg, radius.lg, 'F');
        setFillColor(colors.warning);
        doc.roundedRect(margin, y, 5, 62, radius.sm, radius.sm, 'F');

        setColor(colors.textMuted);
        doc.setFontSize(fontSize.xs);
        doc.setFont('helvetica', 'bold');
        doc.text('MANUAL BILLING COST', margin + spacing.lg, y + 16);

        setColor(colors.textDark);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(formatCurrency(insights.annualManualBillingCost) + '/year', margin + spacing.lg, y + 40);

        setColor(colors.textMuted);
        doc.setFontSize(fontSize.sm);
        doc.setFont('helvetica', 'normal');
        doc.text(`Based on ${insights.staffHoursPerWeek} hours/week at $25/hr, recoverable through automation`, margin + spacing.lg, y + 55);
        y += 78;
      }

    } else {
      // SL: Today vs PatientPay comparison
      setColor(colors.textDark);
      doc.setFontSize(fontSize.lg);
      doc.setFont('helvetica', 'bold');
      doc.text('Today vs. With PatientPay', margin, y);
      y += spacing.lg;

      const colLeftX = margin;
      const colRightX = margin + contentWidth / 2 + 6;
      const colWidth = contentWidth / 2 - 6;

      // TODAY header
      setFillColor(colors.error);
      doc.roundedRect(colLeftX, y, colWidth, 26, radius.sm, radius.sm, 'F');
      setColor(colors.white);
      doc.setFontSize(fontSize.md);
      doc.setFont('helvetica', 'bold');
      doc.text('TODAY', colLeftX + colWidth / 2, y + 17, { align: 'center' });

      // WITH PATIENTPAY header
      setFillColor(colors.success);
      doc.roundedRect(colRightX, y, colWidth, 26, radius.sm, radius.sm, 'F');
      setColor(colors.white);
      doc.text('WITH MODERN TOOLS', colRightX + colWidth / 2, y + 17, { align: 'center' });
      y += 34;

      // Build comparison rows from V5 answers (re-read from answers[] — different block scope from Page 3)
      const comparisonRows = [];
      const stmtDelivery = answers['statement_delivery'];
      const payMethods = answers['payment_methods'] || [];
      const multiGuarantor = answers['multi_guarantor'];
      const autopayRate = answers['autopay_rate'];

      // Statement delivery
      if (stmtDelivery) {
        const deliveryText = Array.isArray(stmtDelivery) ? stmtDelivery.join(', ') : stmtDelivery;
        comparisonRows.push({ label: 'Statement Delivery', today: deliveryText, optimized: 'Multi-channel digital (email, text, portal)' });
      }

      // Payment methods
      if (payMethods && payMethods.length > 0) {
        const methodText = Array.isArray(payMethods) ? payMethods.join(', ') : String(payMethods);
        comparisonRows.push({ label: 'Payment Options', today: methodText, optimized: 'Cards, ACH, portal, autopay' });
      }

      // Multi-guarantor
      if (multiGuarantor) {
        let mgLabel = multiGuarantor;
        if (multiGuarantor === 'No') mgLabel = 'Single-payer billing only';
        else if (multiGuarantor === 'Yes, manually') mgLabel = 'Manual split billing process';
        else if (multiGuarantor === 'Yes, automated') mgLabel = 'Automated split billing';
        else if (multiGuarantor === 'Unsure') mgLabel = 'Split billing not available or unknown';
        comparisonRows.push({ label: 'Split Billing', today: mgLabel, optimized: 'Automated multi-guarantor billing' });
      }

      // Autopay
      if (autopayRate !== undefined) {
        comparisonRows.push({ label: 'Autopay Enrollment', today: `${autopayRate}% enrolled`, optimized: '50%+ with enrollment campaigns' });
      }

      // Staff time — use personalized data from answers
      const slStaffAnswer = answers['staff_time'];
      const slStaffLabels = { minimal: 'Under 5 hours/week', moderate: '5-15 hours/week', significant: '15-30 hours/week', excessive: '30+ hours/week', unsure: 'Unknown staff hours' };
      const slStaffLabel = slStaffLabels[slStaffAnswer] || '42% of finance time on manual tasks';
      const slStaffCostText = insights.annualManualBillingCost
        ? `${slStaffLabel} (est. ${formatCurrency(insights.annualManualBillingCost)}/yr)`
        : slStaffLabel;
      comparisonRows.push({ label: 'Staff Billing Time', today: slStaffCostText, optimized: '96% reduction with automation' });

      comparisonRows.slice(0, 5).forEach((row, i) => {
        const rowHeight = 48;
        const rowBg = i % 2 === 0 ? colors.bgLight : [252, 253, 254];
        setFillColor(rowBg);
        doc.rect(colLeftX, y, colWidth, rowHeight, 'F');
        doc.rect(colRightX, y, colWidth, rowHeight, 'F');

        setColor(colors.textMuted);
        doc.setFontSize(fontSize.xs);
        doc.setFont('helvetica', 'bold');
        doc.text(row.label.toUpperCase(), colLeftX + spacing.sm, y + 14);
        doc.text(row.label.toUpperCase(), colRightX + spacing.sm, y + 14);

        setColor(colors.error);
        doc.setFontSize(fontSize.sm);
        doc.setFont('helvetica', 'normal');
        const todayLines = doc.splitTextToSize(row.today, colWidth - (spacing.sm * 2));
        doc.text(todayLines[0], colLeftX + spacing.sm, y + 30);
        if (todayLines[1]) doc.text(todayLines[1], colLeftX + spacing.sm, y + 42);

        setColor(colors.success);
        doc.setFontSize(fontSize.sm);
        const optLines = doc.splitTextToSize(row.optimized, colWidth - (spacing.sm * 2));
        doc.text(optLines[0], colRightX + spacing.sm, y + 30);
        if (optLines[1]) doc.text(optLines[1], colRightX + spacing.sm, y + 42);

        y += rowHeight;
      });

      y += spacing.md;

      // SL: Personalized annual cost callout (uses staff_time + annualManualBillingCost)
      if (insights.annualManualBillingCost && insights.staffHoursPerWeek && y + 62 <= pageHeight - 160) {
        setFillColor([255, 251, 235]);
        doc.roundedRect(margin, y, contentWidth, 58, radius.lg, radius.lg, 'F');
        setFillColor(colors.warning);
        doc.roundedRect(margin, y, 5, 58, radius.sm, radius.sm, 'F');

        setColor(colors.textMuted);
        doc.setFontSize(fontSize.xs);
        doc.setFont('helvetica', 'bold');
        doc.text('YOUR ESTIMATED ANNUAL MANUAL BILLING COST', margin + spacing.lg, y + 16);

        setColor(colors.textDark);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(formatCurrency(insights.annualManualBillingCost), margin + spacing.lg, y + 38);

        setColor(colors.textMuted);
        doc.setFontSize(fontSize.sm);
        doc.setFont('helvetica', 'normal');
        doc.text(`${insights.staffHoursPerWeek} hours/week x 52 weeks x $25/hr avg billing staff cost`, margin + spacing.lg, y + 52);
        y += 68;
      }
    }

    // --- Industry Benchmark Box (both segments) ---
    if (y + 100 <= pageHeight - 60) {
      setFillColor(colors.primary);
      doc.roundedRect(margin, y, contentWidth, 90, radius.lg, radius.lg, 'F');

      setColor(colors.accent);
      doc.setFontSize(fontSize.md);
      doc.setFont('helvetica', 'bold');
      doc.text(isSNF ? 'COLLECTION IMPROVEMENT POTENTIAL' : 'ANNUAL EFFICIENCY GAINS WITH PATIENTPAY', margin + spacing.lg, y + 26);

      let lineY = y + 48;
      const impactItems = isSNF ? [
        { label: 'Collection Rate Improvement:', value: '15+ percentage points (industry avg)' },
        { label: 'AR Days Reduction:', value: `From ${insights.arDays} to ${insights.targetArDays} day target` },
        { label: 'Staff Time Recaptured:', value: '60%+ reduction in billing inquiries' }
      ] : [
        { label: 'Processing Time:', value: '96% reduction (10 min to 15 sec per statement)' },
        { label: 'Cash Flow Acceleration:', value: '15-20 days faster with digital delivery' },
        { label: 'Staff Time Recaptured:', value: '60%+ reduction in billing inquiries' }
      ];

      impactItems.forEach(item => {
        setColor(colors.white);
        doc.setFontSize(fontSize.body);
        doc.setFont('helvetica', 'normal');
        doc.text(item.label, margin + spacing.lg, lineY);
        setColor(colors.accent);
        doc.setFont('helvetica', 'bold');
        doc.text(item.value, margin + 220, lineY);
        lineY += 18;
      });
    }
  }

  addFooter(isSNF ? 4 : 4);

  // ============================================
  // PAGE 5 (SL) / PAGE 4-5 (SNF): YOUR PATH FORWARD (RESOLVE)
  // Projections + Top improvements
  // ============================================
  doc.addPage();
  addHeader('Your Path Forward');
  y = 95;

  // --- Score Projection ---
  setColor(colors.textDark);
  doc.setFontSize(fontSize.xl);
  doc.setFont('helvetica', 'bold');
  doc.text('Score Projection', margin, y);
  y += spacing.lg;

  setFillColor([240, 249, 255]);
  doc.roundedRect(margin, y, contentWidth, 95, radius.lg, radius.lg, 'F');
  setFillColor(colors.secondary);
  doc.roundedRect(margin, y, 5, 95, radius.sm, radius.sm, 'F');

  // Current score
  setColor(colors.textMuted);
  doc.setFontSize(fontSize.xs);
  doc.setFont('helvetica', 'bold');
  doc.text('CURRENT SCORE', margin + 40, y + 18);
  const currentScoreColor = getScoreColorArr(projectionsData.currentScore);
  setColor(currentScoreColor);
  doc.setFontSize(38);
  doc.setFont('helvetica', 'bold');
  doc.text(`${projectionsData.currentScore}`, margin + 40, y + 58);
  const currentLevel = getScoreLevelText(projectionsData.currentScore);
  setColor(colors.textMuted);
  doc.setFontSize(fontSize.sm);
  doc.setFont('helvetica', 'normal');
  doc.text(currentLevel.level, margin + 40, y + 78);

  // Arrow
  setColor(colors.secondary);
  doc.setLineWidth(3);
  setDrawColor(colors.secondary);
  const arrowX = margin + 180;
  const arrowY = y + 48;
  doc.line(arrowX, arrowY, arrowX + 40, arrowY);
  doc.line(arrowX + 30, arrowY - 10, arrowX + 40, arrowY);
  doc.line(arrowX + 30, arrowY + 10, arrowX + 40, arrowY);

  // Projected score
  setColor(colors.textMuted);
  doc.setFontSize(fontSize.xs);
  doc.setFont('helvetica', 'bold');
  doc.text('WITH RECOMMENDED IMPROVEMENTS', margin + 260, y + 18);
  setColor(colors.success);
  doc.setFontSize(38);
  doc.setFont('helvetica', 'bold');
  doc.text(`${projectionsData.projectedScore}`, margin + 260, y + 58);
  const projectedLevel = getScoreLevelText(projectionsData.projectedScore);
  setColor(colors.textMuted);
  doc.setFontSize(fontSize.sm);
  doc.setFont('helvetica', 'normal');
  doc.text(projectedLevel.level, margin + 260, y + 78);

  // Improvement badge
  const p5ImprovePct = projectionsData.currentScore > 0
    ? Math.round((projectionsData.delta / projectionsData.currentScore) * 100)
    : 0;
  setFillColor(colors.success);
  doc.roundedRect(margin + 410, y + 20, 80, 52, radius.md, radius.md, 'F');
  setColor(colors.white);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(`+${projectionsData.delta}`, margin + 450, y + 46, { align: 'center' });
  doc.setFontSize(fontSize.sm);
  doc.text(`${p5ImprovePct}% up`, margin + 450, y + 62, { align: 'center' });

  y += 115;

  // --- Top Improvements ---
  setColor(colors.textDark);
  doc.setFontSize(fontSize.lg);
  doc.setFont('helvetica', 'bold');
  doc.text('Top Improvements', margin, y);
  y += spacing.lg;

  if (projectionsData.improvements && projectionsData.improvements.length > 0) {
    let runningScore = projectionsData.currentScore;
    const topImps = projectionsData.improvements.slice(0, 5);

    topImps.forEach((imp, i) => {
      if (y + 50 > pageHeight - 60) return;
      const prevRunning = runningScore;
      runningScore = Math.min(100, runningScore + imp.overallImpact);

      setFillColor(colors.bgLight);
      doc.roundedRect(margin, y, contentWidth, 44, radius.sm, radius.sm, 'F');

      // Rank circle
      setFillColor(colors.secondary);
      doc.circle(margin + 20, y + 22, 12, 'F');
      setColor(colors.white);
      doc.setFontSize(fontSize.lg);
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}`, margin + 20, y + 27, { align: 'center' });

      // Points badge
      setFillColor([240, 253, 244]);
      doc.roundedRect(margin + 42, y + 8, 56, 22, radius.sm, radius.sm, 'F');
      setColor(colors.success);
      doc.setFontSize(fontSize.lg);
      doc.setFont('helvetica', 'bold');
      doc.text(`+${imp.overallImpact} pts`, margin + 70, y + 23, { align: 'center' });

      // Description
      setColor(colors.textDark);
      doc.setFontSize(fontSize.body);
      doc.setFont('helvetica', 'bold');
      const dLines = doc.splitTextToSize(imp.title, 260);
      doc.text(dLines[0], margin + 110, y + 20);

      // Cumulative score
      setColor(colors.textMuted);
      doc.setFontSize(fontSize.sm);
      doc.setFont('helvetica', 'normal');
      doc.text(`Score: ${prevRunning} -> ${runningScore}`, margin + 110, y + 36);

      // Mini bar
      const miniBarX = margin + 420;
      const miniBarW = 70;
      setFillColor([225, 230, 235]);
      doc.roundedRect(miniBarX, y + 10, miniBarW, 12, radius.sm, radius.sm, 'F');
      const miniBarFillW = (runningScore / 100) * miniBarW;
      setFillColor(getScoreColorArr(runningScore));
      doc.roundedRect(miniBarX, y + 10, miniBarFillW, 12, radius.sm, radius.sm, 'F');
      setColor(colors.textDark);
      doc.setFontSize(fontSize.xs);
      doc.setFont('helvetica', 'bold');
      doc.text(`${runningScore}`, miniBarX + miniBarW + 6, y + 20);

      y += 50;
    });
  }

  y += spacing.md;

  // --- Category Transformation (compact) ---
  if (y + 120 <= pageHeight - 60 && projectionsData.categoryImprovements) {
    setColor(colors.textDark);
    doc.setFontSize(fontSize.lg);
    doc.setFont('helvetica', 'bold');
    doc.text('Category Transformation', margin, y);
    y += spacing.lg;

    for (let ci = 0; ci < categoryCount; ci++) {
      if (y + 42 > pageHeight - 60) break;

      const catCurrent = scores.categories[ci];
      const catImprovement = projectionsData.categoryImprovements[ci] || 0;
      const catProjected = Math.min(100, catCurrent + catImprovement);

      setFillColor(colors.bgLight);
      doc.roundedRect(margin, y, contentWidth, 38, radius.sm, radius.sm, 'F');

      setColor(colors.textDark);
      doc.setFontSize(fontSize.md);
      doc.setFont('helvetica', 'bold');
      doc.text(pdfCategoryLabels[ci], margin + spacing.md, y + 16);

      // Current bar
      const cBarX = margin + 220;
      const cBarW = 90;
      setFillColor([225, 230, 235]);
      doc.roundedRect(cBarX, y + 6, cBarW, 10, radius.sm, radius.sm, 'F');
      const cFillW = (catCurrent / 100) * cBarW;
      if (cFillW > 0) {
        setFillColor(getScoreColorArr(catCurrent));
        doc.roundedRect(cBarX, y + 6, cFillW, 10, radius.sm, radius.sm, 'F');
      }
      setColor(colors.textMuted);
      doc.setFontSize(fontSize.xs);
      doc.setFont('helvetica', 'normal');
      doc.text(`Now: ${catCurrent}`, cBarX, y + 32);

      // Projected bar
      const pBarX = margin + 340;
      setFillColor([225, 230, 235]);
      doc.roundedRect(pBarX, y + 6, cBarW, 10, radius.sm, radius.sm, 'F');
      const pFillW = (catProjected / 100) * cBarW;
      if (pFillW > 0) {
        setFillColor(colors.success);
        doc.roundedRect(pBarX, y + 6, pFillW, 10, radius.sm, radius.sm, 'F');
      }
      setColor(colors.success);
      doc.setFontSize(fontSize.xs);
      doc.setFont('helvetica', 'bold');
      doc.text(`Projected: ${catProjected}`, pBarX, y + 32);

      // Improvement badge
      if (catImprovement > 0) {
        setFillColor(colors.success);
        doc.roundedRect(margin + 460, y + 8, 40, 20, radius.sm, radius.sm, 'F');
        setColor(colors.white);
        doc.setFontSize(fontSize.sm);
        doc.setFont('helvetica', 'bold');
        doc.text(`+${catImprovement}`, margin + 480, y + 22, { align: 'center' });
      }

      y += 44;
    }
  }

  addFooter(isSNF ? 4 : 5);

  // ============================================
  // FINAL PAGE: PROOF + TAKE ACTION (PROVE + ACT)
  // SL: page 6, SNF: page 5
  // ============================================
  doc.addPage();
  addHeader('Take Action');
  y = 95;

  // --- Your Personalized Recommendations ---
  setColor(colors.textDark);
  doc.setFontSize(fontSize.xl);
  doc.setFont('helvetica', 'bold');
  doc.text('Your Personalized Action Plan', margin, y);
  y += spacing.lg;

  if (recommendationsData && recommendationsData.length > 0) {
    recommendationsData.slice(0, 4).forEach((rec) => {
      if (y + 70 > pageHeight - 160) return;

      setFillColor(colors.bgLight);
      doc.roundedRect(margin, y, contentWidth, 60, radius.md, radius.md, 'F');

      // Priority badge
      const priorityColor = rec.priorityLabel === 'High' ? colors.error : rec.priorityLabel === 'Medium' ? colors.warning : colors.secondary;
      setFillColor(priorityColor);
      doc.roundedRect(margin + spacing.sm, y + 12, 55, 22, radius.sm, radius.sm, 'F');
      setColor(colors.white);
      doc.setFontSize(fontSize.sm);
      doc.setFont('helvetica', 'bold');
      doc.text(rec.priorityLabel, margin + 40, y + 27, { align: 'center' });

      // Title
      setColor(colors.textDark);
      doc.setFontSize(fontSize.body);
      doc.setFont('helvetica', 'bold');
      const titleLines = doc.splitTextToSize(rec.title, contentWidth - 95);
      doc.text(titleLines[0], margin + 78, y + 22);

      // Current state
      if (rec.currentState) {
        setColor(colors.textMuted);
        doc.setFontSize(fontSize.xs);
        doc.setFont('helvetica', 'normal');
        const stateLines = doc.splitTextToSize('Current: ' + rec.currentState, contentWidth - 95);
        doc.text(stateLines[0], margin + 78, y + 38);
      }

      // Impact
      if (rec.impact && rec.impact.metrics && rec.impact.metrics.length > 0) {
        setColor(colors.secondary);
        doc.setFontSize(fontSize.xs);
        doc.setFont('helvetica', 'bold');
        doc.text(rec.impact.metrics[0], margin + 78, y + 52);
      }

      y += 68;
    });
  }

  y += spacing.md;

  // --- Industry Context Proof Points ---
  if (y + 90 <= pageHeight - 160) {
    setColor(colors.textDark);
    doc.setFontSize(fontSize.lg);
    doc.setFont('helvetica', 'bold');
    doc.text('Industry Proof Points', margin, y);
    y += spacing.lg;

    setFillColor(colors.bgLight);
    doc.roundedRect(margin, y, contentWidth, 85, radius.md, radius.md, 'F');

    const proofPoints = isSNF ? [
      { stat: '60%', label: 'text-to-pay response rate' },
      { stat: '96%', label: 'reduction in processing time' },
      { stat: '75%', label: 'want card payment options' },
      { stat: '~100%', label: 'would use autopay if offered' }
    ] : [
      { stat: '67%', label: 'choose card-accepting facility' },
      { stat: '96%', label: 'reduction in processing time' },
      { stat: '37%', label: 'miss bills from confusion' },
      { stat: '~100%', label: 'would use autopay if offered' }
    ];

    const proofWidth = contentWidth / 4;
    proofPoints.forEach((p, i) => {
      const px = margin + (i * proofWidth);
      if (i > 0) {
        setFillColor([220, 225, 230]);
        doc.rect(px, y + 15, 1, 55, 'F');
      }
      setColor(colors.secondary);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text(p.stat, px + proofWidth / 2, y + 35, { align: 'center' });
      setColor(colors.textMuted);
      doc.setFontSize(fontSize.xs);
      doc.setFont('helvetica', 'normal');
      const labelLines = doc.splitTextToSize(p.label, proofWidth - 20);
      doc.text(labelLines, px + proofWidth / 2, y + 55, { align: 'center' });
    });

    y += 100;
  }

  // --- CTA Box ---
  y = Math.max(y + spacing.lg, pageHeight - 165);
  setFillColor(colors.primary);
  doc.roundedRect(margin, y, contentWidth, 115, radius.xl, radius.xl, 'F');

  setFillColor(colors.accent);
  doc.roundedRect(margin, y, contentWidth, 4, radius.xl, radius.xl, 'F');

  // Logo
  setColor(colors.white);
  doc.setFontSize(fontSize.h2);
  doc.setFont('helvetica', 'bold');
  doc.text('Patient', margin + spacing.lg, y + 28);
  setColor(colors.secondary);
  doc.text('Pay', margin + spacing.lg + doc.getTextWidth('Patient'), y + 28);

  // Personalized headline based on score
  const ctaHeadline = scores.overall < 50
    ? 'Your Score Reveals Significant Opportunity'
    : scores.overall < 70
    ? 'Close the Gap in Your Payment Operations'
    : 'Strengthen What You Have Already Built';
  setColor(colors.white);
  doc.setFontSize(fontSize.h1);
  doc.setFont('helvetica', 'bold');
  doc.text(ctaHeadline, margin + spacing.lg, y + 52);

  doc.setFontSize(fontSize.md);
  doc.setFont('helvetica', 'normal');
  doc.text('Schedule a 15-minute walkthrough to see how PatientPay integrates with PointClickCare.', margin + spacing.lg, y + 72);

  // Score delta callout
  if (projectionsData.delta > 0) {
    setColor(colors.accent);
    doc.setFontSize(fontSize.sm);
    doc.setFont('helvetica', 'bold');
    doc.text(`Your projected improvement: +${projectionsData.delta} points (${projectionsData.currentScore} to ${projectionsData.projectedScore})`, margin + spacing.lg, y + 88);
  }

  setFillColor(colors.accent);
  doc.roundedRect(margin + spacing.lg - 5, y + 94, 290, 18, radius.sm, radius.sm, 'F');
  setColor(colors.primary);
  doc.setFontSize(fontSize.md);
  doc.setFont('helvetica', 'bold');
  doc.text('marketplace.pointclickcare.com/patientpay', margin + spacing.lg, y + 106);

  addFooter(totalPages);

  return doc.output('blob');
}

/**
 * Download PDF report
 * @param {Object} formData - Contact/facility info
 * @param {Object} answers - User answers
 * @param {Object} scores - Calculated scores
 */
async function downloadPDFReport(formData, answers, scores) {
  try {
    const blob = await generatePDFReport(formData, answers, scores);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    const segment = answers['facility_type'] || '';
    const orgName = (formData.organization || 'Assessment')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .substring(0, 30);
    link.download = `PatientPay_Assessment_${segment}_${orgName}_${new Date().toISOString().split('T')[0]}.pdf`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { success: true };
  } catch (error) {
    console.error('PDF generation error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Interpolate between two hex colors
 */
function interpolateColor(color1, color2, factor) {
  const hex = (c) => parseInt(c.slice(1), 16);
  const r1 = (hex(color1) >> 16) & 255;
  const g1 = (hex(color1) >> 8) & 255;
  const b1 = hex(color1) & 255;
  const r2 = (hex(color2) >> 16) & 255;
  const g2 = (hex(color2) >> 8) & 255;
  const b2 = hex(color2) & 255;

  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Get gradient color based on percentage
 */
function getGradientColor(percentage, inverted = false) {
  const p = inverted ? 100 - percentage : percentage;
  const scale = AssessmentColors.tempScale;

  if (p >= 80) {
    const t = (p - 80) / 20;
    return interpolateColor(scale.cool, scale.freezing, t);
  } else if (p >= 60) {
    const t = (p - 60) / 20;
    return interpolateColor(scale.mild, scale.cool, t);
  } else if (p >= 40) {
    const t = (p - 40) / 20;
    return interpolateColor(scale.warm, scale.mild, t);
  } else if (p >= 20) {
    const t = (p - 20) / 20;
    return interpolateColor(scale.hot, scale.warm, t);
  } else {
    const t = p / 20;
    return interpolateColor(scale.burning, scale.hot, t);
  }
}

// ============================================

// ============================================
// EXPORTS — V5
// ============================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AssessmentColors,
    FacilityTypes,
    IndustryStats,
    IndustryBenchmarks,
    Questions,
    CategoryNames,
    SNFCategoryNames,
    getCategoryName,
    ResultsFlow,
    ResultsFlowV5,
    SourceCitations,
    WebhookConfig,
    getVisibleQuestions,
    calculateQuestionScore,
    calculateScores,
    getScoreLevel,
    getScoreColor,
    calculateInsights,
    getActionableRecommendations,
    getGapAnalysis,
    generateResultsSummary,
    getPerformanceVsBenchmark,
    getStrengths,
    calculatePatientPayProjections,
    prepareExportData,
    generateCSV,
    generatePDFReport,
    downloadPDFReport,
    interpolateColor,
    getGradientColor,
    sendWebhook,
  };
}

// For browser global access
if (typeof window !== 'undefined') {
  window.AssessmentEngine = {
    // Data
    facilityTypes: FacilityTypes,
    colors: AssessmentColors,
    stats: IndustryStats,
    industryBenchmarks: IndustryBenchmarks,
    questions: Questions,
    categoryNames: CategoryNames,
    snfCategoryNames: SNFCategoryNames,
    getCategoryName,
    resultsFlow: ResultsFlow,
    resultsFlowV5: ResultsFlowV5,
    sources: SourceCitations,
    webhookConfig: WebhookConfig,
    // Core calculations
    getVisibleQuestions,
    calculateQuestionScore,
    calculateScores,
    getScoreLevel,
    getScoreColor,
    calculateInsights,
    // Recommendations engine
    getActionableRecommendations,
    getGapAnalysis,
    generateResultsSummary,
    getPerformanceVsBenchmark,
    // Strengths and projections
    getStrengths,
    calculatePatientPayProjections,
    // Export functions
    prepareExportData,
    generateCSV,
    generatePDFReport,
    downloadPDFReport,
    // Utilities
    interpolateColor,
    getGradientColor,
    sendWebhook,
  };
}
