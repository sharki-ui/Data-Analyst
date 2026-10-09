(function bootstrapAnalystOS(root, factory) {
  "use strict";

  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.AnalystOS = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", api.mount, { once: true });
    } else {
      api.mount();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function createAnalystOS() {
  "use strict";

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = "analyst-os:sales-ops-q3:v1";
  const STEP_ORDER = ["brief", "definition", "quality", "forecast", "memo"];
  const QUARTER_START = "2026-07-01";
  const QUARTER_END = "2026-09-30";
  const AS_OF_DATE = "2026-08-15";

  const STAGE_PROBABILITIES = Object.freeze({
    qualification: 0.1,
    discovery: 0.2,
    proposal: 0.5,
    negotiation: 0.7,
    closedWon: 1,
    closedLost: 0,
  });

  const OPPORTUNITIES = Object.freeze([
    opportunity("OP-098", "Acme Annual Renewal", "Acme Systems", "Maya", 250000, "closedWon", "2026-07-08", "2026-07-08"),
    opportunity("OP-099", "Beacon Expansion", "Beacon Health", "Jordan", 180000, "closedWon", "2026-07-28", "2026-07-28"),
    opportunity("OP-101", "Atlas Enterprise", "Atlas Systems", "Maya", 300000, "negotiation", "2026-09-20", "2026-08-10"),
    opportunity("OP-102", "Vertex Expansion", "Vertex Labs", "Jordan", 250000, "proposal", "2026-09-15", "2026-08-11"),
    opportunity("OP-103", "Cedar Data Cloud", "Cedar Group", "Avery", 180000, "discovery", "2026-09-28", "2026-08-02"),
    opportunity("OP-104", "Orion Security", "Orion Retail", "Maya", 160000, "negotiation", "2026-09-10", "2026-08-12"),
    opportunity("OP-105", "Nova Analytics", "Nova Foods", "Jordan", 120000, "proposal", "2026-09-25", "2026-07-25"),
    opportunity("OP-106", "Luna Pilot", "Luna Mobility", "Avery", 90000, "qualification", "2026-09-30", "2026-08-01"),
    opportunity("OP-104-D", "Orion Security · duplicate", "Orion Retail", "Maya", 160000, "negotiation", "2026-09-10", "2026-08-12", { logicalOpportunityId: "OP-104", duplicateOf: "OP-104" }),
    opportunity("OP-107", "Helio Platform", "Helio Foods", "Avery", 200000, "negotiation", "2026-10-20", "2026-08-09"),
    opportunity("OP-108", "Summit AI", "Summit Media", "Jordan", 140000, "proposal", null, "2026-08-13"),
    opportunity("OP-109", "Quartz Legacy", "Quartz Works", "Maya", 110000, "closedLost", "2026-08-05", "2026-08-05"),
    opportunity("OP-110", "Pine Retail", "Pine Market", "Avery", 150000, "discovery", "2026-09-01", "2026-06-15"),
  ]);

  const SCENARIO = Object.freeze({
    id: "sales-ops-q3",
    title: "Q3 Revenue Rescue",
    target: 1200000,
    asOfDate: AS_OF_DATE,
    quarterStart: QUARTER_START,
    quarterEnd: QUARTER_END,
    stageProbabilities: STAGE_PROBABILITIES,
    opportunities: OPPORTUNITIES,
    expectedIssueByRecordId: Object.freeze({
      "OP-104-D": "duplicate",
      "OP-107": "outside-quarter",
      "OP-108": "missing-close-date",
      "OP-109": "closed-lost",
      "OP-110": "stale",
    }),
    priorityOpportunityIds: Object.freeze(["OP-101", "OP-104", "OP-102"]),
  });

  const QUALITY_LABELS = Object.freeze({
    duplicate: "重复机会",
    "outside-quarter": "跨季度签约",
    "missing-close-date": "Close Date 缺失",
    "closed-lost": "已丢单",
    stale: "长期未跟进",
    currency: "币种未统一",
    owner: "负责人缺失",
  });

  const CORRECT_QUALITY_ISSUES = Object.freeze(Object.values(SCENARIO.expectedIssueByRecordId));
  const REQUIRED_SCOPE = Object.freeze([
    "open-only",
    "quarter-close",
    "valid-amount",
    "valid-probability",
    "unique-opportunity",
    "recent-activity",
  ]);
  const CORRECT_AUDIT_ISSUES = Object.freeze(["raw-vs-weighted", "outside-quarter", "certainty", "more-pipeline"]);

  let activeRuntime = null;

  function opportunity(id, name, account, owner, amount, stage, closeDate, lastActivity, extras) {
    return Object.freeze({
      id,
      logicalOpportunityId: id,
      name,
      account,
      owner,
      amount,
      stage,
      probability: STAGE_PROBABILITIES[stage],
      closeDate,
      lastActivity,
      currency: "USD",
      ...(extras || {}),
    });
  }

  function dateValue(value) {
    return value ? new Date(`${value}T00:00:00Z`).getTime() : NaN;
  }

  function daysBetween(earlier, later) {
    return Math.floor((dateValue(later) - dateValue(earlier)) / 86400000);
  }

  function isOpenStage(stage) {
    return stage !== "closedWon" && stage !== "closedLost";
  }

  function isInQuarter(date) {
    return Boolean(date && date >= QUARTER_START && date <= QUARTER_END);
  }

  function getQualityIssue(record) {
    if (!record) return null;
    if (record.duplicateOf) return "duplicate";
    if (!record.closeDate) return "missing-close-date";
    if (!isInQuarter(record.closeDate)) return "outside-quarter";
    if (record.stage === "closedLost") return "closed-lost";
    if (isOpenStage(record.stage) && daysBetween(record.lastActivity, AS_OF_DATE) > 30) return "stale";
    return null;
  }

  function buildTrustedView(records) {
    const source = records || OPPORTUNITIES;
    return source.filter((record) => {
      if (record.duplicateOf) return false;
      if (!Number.isFinite(record.amount) || record.amount <= 0 || record.currency !== "USD") return false;
      if (!isInQuarter(record.closeDate)) return false;
      if (record.stage === "closedLost") return false;
      if (record.stage !== "closedWon" && !isOpenStage(record.stage)) return false;
      if (isOpenStage(record.stage) && daysBetween(record.lastActivity, AS_OF_DATE) > 30) return false;
      return true;
    });
  }

  function computeMetrics(records, target) {
    const source = records || OPPORTUNITIES;
    const goal = Number.isFinite(target) ? target : SCENARIO.target;
    const trusted = buildTrustedView(source);
    const won = trusted.filter((record) => record.stage === "closedWon");
    const validOpen = trusted.filter((record) => isOpenStage(record.stage));
    const rawOpen = source.filter((record) => isOpenStage(record.stage));
    const actual = sum(won.map((record) => record.amount));
    const gap = goal - actual;
    const validPipeline = sum(validOpen.map((record) => record.amount));
    const weightedPipeline = sum(validOpen.map((record) => record.amount * STAGE_PROBABILITIES[record.stage]));
    const forecast = actual + weightedPipeline;
    const shortfall = Math.max(0, goal - forecast);

    return Object.freeze({
      target: goal,
      actual,
      gap,
      rawOpenPipeline: sum(rawOpen.map((record) => record.amount)),
      validPipeline,
      weightedPipeline,
      coverage: gap > 0 ? weightedPipeline / gap : 0,
      forecast,
      forecastAttainment: goal > 0 ? forecast / goal : 0,
      shortfall,
      trustedOpportunityIds: trusted.map((record) => record.id),
      validOpenOpportunityIds: validOpen.map((record) => record.id),
    });
  }

  const EXPECTED_METRICS = computeMetrics();

  function sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  function unique(values) {
    return Array.from(new Set(values || []));
  }

  function sameSet(left, right) {
    const a = unique(left).sort();
    const b = unique(right).sort();
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }

  function normalizeFormula(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/weighted\s*pipeline|加权管道金额|清洗后加权管道|加权管道/g, "weightedpipeline")
      .replace(/stage\s*probability|阶段概率|赢单概率|成交概率|概率/g, "probability")
      .replace(/opportunity\s*amount|机会金额|每笔金额|金额/g, "amount")
      .replace(/quarter\s*target|sales\s*target|季度目标|销售目标|目标金额|总目标|目标/g, "target")
      .replace(/closed\s*won|booked\s*revenue|actual\s*revenue|已签约收入|已签约|已实现收入|实际收入|实际/g, "actual")
      .replace(/remaining\s*gap|target\s*gap|剩余目标缺口|目标缺口|剩余缺口|缺口/g, "gap")
      .replace(/除以/g, "/")
      .replace(/[×x]/g, "*")
      .replace(/[−–—]/g, "-")
      .replace(/[（）(){}\[\],，。；;：:\s_$]/g, "");
  }

  function validateFormula(type, value) {
    const formula = normalizeFormula(value);

    if (type === "gap") {
      return formula.includes("target") && formula.includes("actual") && formula.indexOf("target") < formula.indexOf("actual") && formula.includes("-");
    }

    if (type === "weighted") {
      const hasTerms = formula.includes("amount") && formula.includes("probability") && formula.includes("*");
      const hasAggregation = /sum|求和|合计|相加|Σ|∑/.test(formula);
      return hasTerms && hasAggregation;
    }

    if (type === "coverage") {
      const slashIndex = formula.indexOf("/");
      if (slashIndex < 0) return false;
      const numerator = formula.slice(0, slashIndex);
      const denominator = formula.slice(slashIndex + 1);
      return numerator.includes("weightedpipeline") && denominator.includes("gap") && !denominator.includes("target");
    }

    return false;
  }

  function evaluateProblemDefinition(value) {
    const text = String(value || "").toLowerCase();
    const checks = {
      decisionMaker: /elena|销售副总裁|销售vp|vp\s*of\s*sales|管理层|销售管理层/.test(text),
      timeRange: /q3|第三季度|本季度|9\s*月\s*30|季度末/.test(text),
      judgement: /能否|是否|达标|完成目标|目标达成|缺口|预测|forecast|风险/.test(text),
      action: /优先|三笔|3\s*笔|机会|推动|资源|行动|分配/.test(text),
    };
    const count = Object.values(checks).filter(Boolean).length;
    return {
      pass: count === 4 && text.trim().length >= 16,
      count,
      checks,
      missing: Object.keys(checks).filter((key) => !checks[key]),
    };
  }

  function validateMetricDefinition(formulas, scope) {
    const formulaResults = {
      gap: validateFormula("gap", formulas && formulas.gap),
      weighted: validateFormula("weighted", formulas && formulas.weighted),
      coverage: validateFormula("coverage", formulas && formulas.coverage),
    };
    const selectedScope = unique(scope);
    const missingScope = REQUIRED_SCOPE.filter((item) => !selectedScope.includes(item));
    const extraScope = selectedScope.filter((item) => !REQUIRED_SCOPE.includes(item));
    return {
      pass: Object.values(formulaResults).every(Boolean) && missingScope.length === 0 && extraScope.length === 0,
      formulas: formulaResults,
      missingScope,
      extraScope,
    };
  }

  function validateQualitySelection(issues, evidenceRecordIds) {
    const selected = unique(issues);
    const missing = CORRECT_QUALITY_ISSUES.filter((item) => !selected.includes(item));
    const incorrect = selected.filter((item) => !CORRECT_QUALITY_ISSUES.includes(item));
    const expectedRecords = Object.keys(SCENARIO.expectedIssueByRecordId);
    const evidence = unique(evidenceRecordIds);
    const missingEvidence = evidenceRecordIds === undefined ? [] : expectedRecords.filter((id) => !evidence.includes(id));
    return {
      pass: missing.length === 0 && incorrect.length === 0 && missingEvidence.length === 0,
      missing,
      incorrect,
      missingEvidence,
      correctCount: CORRECT_QUALITY_ISSUES.length - missing.length,
    };
  }

  function parseThousands(value) {
    const raw = String(value == null ? "" : value).trim().toLowerCase().replace(/[$,，\s]/g, "");
    if (!raw) return NaN;
    const numeric = Number.parseFloat(raw.replace(/[kx倍]/g, "").replace(/m$/, ""));
    if (!Number.isFinite(numeric)) return NaN;
    if (raw.endsWith("m")) return numeric * 1000;
    if (raw.endsWith("k")) return numeric;
    return numeric > 10000 ? numeric / 1000 : numeric;
  }

  function parseRatio(value) {
    const raw = String(value == null ? "" : value).trim().toLowerCase().replace(/[,，\s×x倍]/g, "");
    return Number.parseFloat(raw);
  }

  function validateManualMetrics(values) {
    const parsed = {
      gap: parseThousands(values && values.gap),
      weighted: parseThousands(values && values.weighted),
      coverage: parseRatio(values && values.coverage),
    };
    const expected = {
      gap: EXPECTED_METRICS.gap / 1000,
      weighted: EXPECTED_METRICS.weightedPipeline / 1000,
      coverage: EXPECTED_METRICS.coverage,
    };
    const results = {
      gap: Number.isFinite(parsed.gap) && Math.abs(parsed.gap - expected.gap) <= 0.5,
      weighted: Number.isFinite(parsed.weighted) && Math.abs(parsed.weighted - expected.weighted) <= 0.5,
      coverage: Number.isFinite(parsed.coverage) && Math.abs(parsed.coverage - expected.coverage) <= 0.02,
    };
    return { pass: Object.values(results).every(Boolean), parsed, expected, results };
  }

  function validatePrioritySelection(ids) {
    return sameSet(ids, SCENARIO.priorityOpportunityIds);
  }

  function validateAiAudit(selection) {
    const selected = unique(selection);
    const validSelected = selected.filter((item) => CORRECT_AUDIT_ISSUES.includes(item));
    const incorrect = selected.filter((item) => !CORRECT_AUDIT_ISSUES.includes(item));
    const hasCore = selected.includes("raw-vs-weighted");
    const hasDataQuality = selected.includes("outside-quarter");
    return {
      pass: validSelected.length >= 3 && hasCore && hasDataQuality && incorrect.length === 0,
      validSelected,
      incorrect,
      hasCore,
      hasDataQuality,
    };
  }

  function evaluateMemo(memo) {
    const safeMemo = memo || {};
    const headline = String(safeMemo.headline || "").trim();
    const findings = (safeMemo.findings || []).map((item) => String(item || "").trim());
    const recommendation = String(safeMemo.recommendation || "").trim();
    const combined = `${headline} ${findings.join(" ")} ${recommendation}`.toLowerCase();
    const metric982 = /982\s*(?:,?\s*000|k)|98\.2\s*万/.test(combined);
    const metric218 = /218\s*(?:,?\s*000|k)|21\.8\s*万/.test(combined);
    const timeAction = /本周|周会前|今天|48\s*小时|六周|6\s*周|9\s*月/.test(combined);
    const ownerAction = /负责人|销售团队|销售负责人|owner|elena|vp|maya|jordan|avery/.test(combined);
    const checklist = {
      judgement: /不能|难以|无法|未达|达标风险|存在.{0,8}(?:缺口|风险)|短缺|不足|at\s*risk|shortfall|likely\s*miss/.test(combined),
      metric: metric982 && metric218,
      evidence: /加权|weighted|可信|trusted|概率|原始管道|raw\s*pipeline|数据质量|口径/.test(combined),
      priority: SCENARIO.priorityOpportunityIds.every((id) => combined.includes(id.toLowerCase())),
      action: combined.includes("op-108") && /补齐|补数|close\s*date|预计签约日|核实/.test(combined) && timeAction && ownerAction,
    };
    const filledFindings = findings.filter(Boolean).length;
    const passedChecks = Object.values(checklist).filter(Boolean).length;
    return {
      pass: passedChecks === 5 && filledFindings === 3 && headline.length >= 12 && recommendation.length >= 20,
      checklist,
      passedChecks,
      filledFindings,
      scorePercent: Math.round((passedChecks / 5) * 100),
    };
  }

  function scoreSession(session) {
    const answers = (session && session.answers) || {};
    const problemResult = evaluateProblemDefinition(answers.problemStatement);
    const definitionResult = validateMetricDefinition(answers.formulas || {}, answers.scope || []);
    const qualityResult = validateQualitySelection(answers.qualityIssues || [], answers.evidenceRecordIds || []);
    const manualResult = validateManualMetrics(answers.manualMetrics || {});
    const auditResult = validateAiAudit(answers.aiAudit || []);
    const memoResult = evaluateMemo(answers.memo || {});
    const priorityCorrect = validatePrioritySelection(answers.priorities || []);

    const scores = {
      problem: problemResult.pass ? 2 : problemResult.count >= 2 ? 1 : 0,
      metric: definitionResult.pass ? 2 : Object.values(definitionResult.formulas).filter(Boolean).length >= 2 ? 1 : 0,
      quality: qualityResult.pass ? 2 : qualityResult.correctCount >= 3 && (answers.qualityIssues || []).includes("duplicate") ? 1 : 0,
      reasoning: manualResult.pass && auditResult.hasCore ? 2 : manualResult.pass ? 1 : 0,
      "ai-audit": auditResult.pass ? 2 : auditResult.validSelected.length >= 2 && auditResult.incorrect.length === 0 ? 1 : 0,
      recommendation: memoResult.checklist.metric && memoResult.checklist.priority && memoResult.checklist.action && priorityCorrect ? 2 : memoResult.checklist.priority || memoResult.checklist.action ? 1 : 0,
      communication: memoResult.pass ? 2 : memoResult.filledFindings >= 2 && String((answers.memo || {}).headline || "").trim() ? 1 : 0,
    };
    const rawTotal = sum(Object.values(scores));
    const keyGates = {
      metric: scores.metric > 0,
      quality: scores.quality > 0,
      aiAudit: scores["ai-audit"] > 0,
      calculations: manualResult.pass,
      deterministicAnswers:
        EXPECTED_METRICS.actual === 430000 && EXPECTED_METRICS.forecast === 982000 && EXPECTED_METRICS.shortfall === 218000,
    };
    return {
      dimensionScoresById: scores,
      rawTotal,
      total: Math.round((rawTotal / 14) * 100),
      passed: rawTotal >= 10 && Object.values(keyGates).every(Boolean),
      keyGates,
      assistanceByStep: { ...((session && session.hints) || {}) },
    };
  }

  function createInitialState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      scenarioId: SCENARIO.id,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentStep: "brief",
      status: "in-progress",
      verified: {
        brief: false,
        definition: false,
        quality: false,
        calculation: false,
        audit: false,
        forecast: false,
        memo: false,
        review: false,
      },
      attempts: { brief: 0, definition: 0, quality: 0, calculation: 0, audit: 0, memo: 0 },
      hints: { brief: 0, definition: 0, quality: 0, forecast: 0, memo: 0 },
      answers: {
        problemStatement: "",
        formulas: { gap: "", weighted: "", coverage: "" },
        scope: [],
        qualityIssues: [],
        evidenceRecordIds: [],
        qualityNote: "",
        manualMetrics: { gap: "", weighted: "", coverage: "" },
        priorities: [],
        aiAudit: [],
        memo: { headline: "", findings: ["", "", ""], recommendation: "" },
      },
      table: { search: "", stage: "all", owner: "all", riskOnly: false, sortKey: "opportunity", sortDirection: "asc" },
      coachMessages: [
        {
          role: "coach",
          text: "先别急着看表格。Elena 需要的不是一个数字，而是一个决定。\n试着回答：谁要在什么时间范围内，依据你的分析采取什么行动？",
        },
      ],
      evaluation: null,
    };
  }

  function mount() {
    if (activeRuntime || !document.querySelector(".app-shell")) return activeRuntime;

    let state = loadState();
    let saveTimer = null;
    let clockTimer = null;
    let storageWarningShown = false;

    const elements = collectElements();

    function collectElements() {
      return {
        appShell: document.querySelector(".app-shell"),
        panels: Array.from(document.querySelectorAll("[data-step-panel]")),
        tabs: Array.from(document.querySelectorAll("[data-step-target]")),
        railStages: Array.from(document.querySelectorAll("[data-stage]")),
        saveStatus: document.getElementById("autosave-status"),
        saveLabel: document.querySelector("[data-save-label]"),
        tableBody: document.getElementById("opportunity-table-body"),
        evidenceList: document.getElementById("evidence-list"),
        memoEvidenceList: document.getElementById("memo-evidence-list"),
        coachMessages: document.getElementById("coach-messages"),
        coachContext: document.getElementById("coach-context"),
        completionDialog: document.getElementById("completion-dialog"),
        resetDialog: document.getElementById("reset-dialog"),
        toastRegion: document.getElementById("toast-region"),
      };
    }

    function loadState() {
      if (typeof localStorage === "undefined") return createInitialState();
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createInitialState();

      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") throw new Error("Invalid saved state");
        if (parsed.schemaVersion !== SCHEMA_VERSION) {
          localStorage.setItem(`${STORAGE_KEY}:recovery:${Date.now()}`, raw);
        }
        return sanitizeState(parsed);
      } catch (error) {
        try {
          localStorage.setItem(`${STORAGE_KEY}:recovery:${Date.now()}`, raw);
          localStorage.removeItem(STORAGE_KEY);
        } catch (storageError) {
          // A storage failure must not prevent an in-memory session.
        }
        return createInitialState();
      }
    }

    function sanitizeState(saved) {
      const fresh = createInitialState();
      const merged = {
        ...fresh,
        ...saved,
        schemaVersion: SCHEMA_VERSION,
        verified: { ...fresh.verified, ...(saved.verified || {}) },
        attempts: { ...fresh.attempts, ...(saved.attempts || {}) },
        hints: { ...fresh.hints, ...(saved.hints || {}) },
        answers: {
          ...fresh.answers,
          ...(saved.answers || {}),
          formulas: { ...fresh.answers.formulas, ...((saved.answers && saved.answers.formulas) || {}) },
          manualMetrics: { ...fresh.answers.manualMetrics, ...((saved.answers && saved.answers.manualMetrics) || {}) },
          memo: { ...fresh.answers.memo, ...((saved.answers && saved.answers.memo) || {}) },
        },
        table: { ...fresh.table, ...(saved.table || {}) },
      };
      if (!STEP_ORDER.includes(merged.currentStep)) merged.currentStep = "brief";
      if (!Array.isArray(merged.answers.memo.findings)) merged.answers.memo.findings = ["", "", ""];
      if (!Array.isArray(merged.coachMessages)) merged.coachMessages = fresh.coachMessages;
      return merged;
    }

    function scheduleSave() {
      state.updatedAt = new Date().toISOString();
      setSaveState("saving", "正在保存…");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, 300);
    }

    function flushSave() {
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setSaveState("saved", "进度已自动保存");
      } catch (error) {
        setSaveState("error", "未能保存，请复制你的建议");
        if (!storageWarningShown) {
          storageWarningShown = true;
          toast("浏览器暂时无法保存进度；本页内容仍保留在内存中。", "error");
        }
      }
    }

    function setSaveState(saveState, label) {
      if (elements.saveStatus) elements.saveStatus.dataset.saveState = saveState;
      if (elements.saveLabel) elements.saveLabel.textContent = label;
    }

    function applyScenarioFixtures() {
      setText("brief-target", "$1.20M");
      setText("brief-booked", "$430K");
      const bookedCard = document.getElementById("brief-booked");
      if (bookedCard && bookedCard.nextElementSibling) bookedCard.nextElementSibling.textContent = "目标完成率 35.8%";
      setText("definition-evidence-title", "目标 $1.20M · Q3 Actual $430K · 剩余 6 周");
      const definitionEvidence = document.querySelector("#panel-definition .evidence-strip p");
      if (definitionEvidence) definitionEvidence.textContent = "数据日期：2026-08-15 · 金额币种：USD";
      setText("opportunity-table-title", "CRM Opportunity Snapshot");
      const qualityIntro = document.querySelector("#panel-quality .panel-intro div > p:last-child");
      if (qualityIntro) qualityIntro.textContent = "请像审计员一样检查 13 条 CRM 记录，并判断哪些记录会扭曲 Q3 预测。";
      setText("quality-question-title", "哪些记录必须排除或补正，才能形成可信的 Q3 视图？");
      setText("forecast-gap", "$770K");
      setText("forecast-raw-pipeline", "$1.75M");
      setText("forecast-weighted-pipeline", "$552K");
      setText("forecast-coverage", `${EXPECTED_METRICS.coverage.toFixed(2)}×`);
      setText("forecast-evidence-title", "Forecast $982K，较 $1.20M 目标短缺 $218K");

      const auditQuote = document.querySelector("#ai-audit-card blockquote");
      if (auditQuote) {
        auditQuote.textContent = "“当前开放管道为 $1.75M，是剩余目标缺口的 2.27 倍，因此 Q3 目标大概率可以完成，无需调整机会优先级。”";
      }

      const scope = document.getElementById("scope-assumptions");
      if (scope) {
        scope.innerHTML = `
          <legend class="sr-only">预测计算纳入范围</legend>
          ${scopeOption("open-only", "加权管道只纳入尚未关闭的机会")}
          ${scopeOption("quarter-close", "预计签约日在 Q3 内")}
          ${scopeOption("valid-amount", "金额为正且币种统一为 USD")}
          ${scopeOption("valid-probability", "使用场景给定的阶段概率")}
          ${scopeOption("unique-opportunity", "同一逻辑机会只计算一次")}
          ${scopeOption("recent-activity", "Open 机会最近 30 天内有活动")}
          ${scopeOption("all-open", "所有 Open 机会，无论签约日期", true)}
        `;
      }

      const qualityOptions = document.getElementById("quality-issues");
      if (qualityOptions) {
        qualityOptions.innerHTML = `
          <legend class="sr-only">选择必须处理的数据质量问题</legend>
          ${qualityOption("duplicate", "重复机会", "同一逻辑交易被计算两次")}
          ${qualityOption("outside-quarter", "跨季度签约", "Close Date 不在 Q3")}
          ${qualityOption("missing-close-date", "Close Date 缺失", "无法判断是否属于本季度")}
          ${qualityOption("closed-lost", "已丢单", "Closed Lost 不应进入开放管道")}
          ${qualityOption("stale", "长期未跟进", "Open 机会超过 30 天无活动")}
          ${qualityOption("currency", "币种未统一", "本数据集没有这项问题", true)}
          ${qualityOption("owner", "负责人缺失", "本数据集没有这项问题", true)}
        `;
      }

      const auditOptions = document.getElementById("ai-audit-options");
      if (auditOptions) {
        auditOptions.innerHTML = `
          <legend>这段结论有哪些证据漏洞？</legend>
          ${auditOption("raw-vs-weighted", "用原始管道代替加权管道，夸大了可实现收入")}
          ${auditOption("outside-quarter", "原始管道混入跨季度、重复、缺日期和过期机会")}
          ${auditOption("certainty", "从覆盖倍数直接推出“风险低”，结论强于证据")}
          ${auditOption("more-pipeline", "“无需调整优先级”没有转化为六周内可执行的动作")}
          ${auditOption("target-correct", "$1.20M 的季度目标本身一定错误", true)}
        `;
      }

      const stageFilter = document.getElementById("stage-filter");
      if (stageFilter) {
        stageFilter.innerHTML = `
          <option value="all">全部阶段</option>
          <option value="qualification">Qualification</option>
          <option value="discovery">Discovery</option>
          <option value="proposal">Proposal</option>
          <option value="negotiation">Negotiation</option>
          <option value="closedWon">Closed Won</option>
          <option value="closedLost">Closed Lost</option>
        `;
      }

      const ownerFilter = document.getElementById("owner-filter");
      if (ownerFilter) {
        ownerFilter.innerHTML = '<option value="all">全部负责人</option>' +
          unique(OPPORTUNITIES.map((record) => record.owner)).sort().map((owner) => `<option value="${owner}">${owner}</option>`).join("");
      }

      const priorityList = document.getElementById("priority-opportunity-list");
      if (priorityList) {
        const ids = ["OP-101", "OP-104", "OP-102", "OP-103", "OP-105", "OP-106"];
        priorityList.innerHTML = ids.map((id) => {
          const record = OPPORTUNITIES.find((item) => item.id === id);
          return `<label><input type="checkbox" name="priorityOpportunity" value="${record.id}" /><span><strong>${record.id} · ${record.name}</strong><small>${stageLabel(record.stage)} · ${formatMoney(record.amount)} · ${daysBetween(record.lastActivity, AS_OF_DATE)} 天未跟进</small></span></label>`;
        }).join("");
      }

      document.querySelectorAll("[data-sort]").forEach((header) => {
        header.setAttribute("tabindex", "0");
        header.setAttribute("role", "button");
      });
    }

    function scopeOption(value, label, distractor) {
      return `<label${distractor ? ' data-distractor="true"' : ""}><input type="checkbox" name="scope" value="${value}" /><span>${label}</span></label>`;
    }

    function qualityOption(value, title, description, distractor) {
      return `<label${distractor ? ' data-distractor="true"' : ""}><input type="checkbox" name="qualityIssue" value="${value}" /><span><strong>${title}</strong><small>${description}</small></span></label>`;
    }

    function auditOption(value, label, distractor) {
      return `<label${distractor ? ' data-distractor="true"' : ""}><input type="checkbox" name="aiAudit" value="${value}" /><span>${label}</span></label>`;
    }

    function hydrateInputs() {
      setValue("problem-statement", state.answers.problemStatement);
      setValue("gap-formula", state.answers.formulas.gap);
      setValue("weighted-formula", state.answers.formulas.weighted);
      setValue("coverage-formula", state.answers.formulas.coverage);
      setValue("quality-note", state.answers.qualityNote);
      setValue("manual-gap", state.answers.manualMetrics.gap);
      setValue("manual-weighted", state.answers.manualMetrics.weighted);
      setValue("manual-coverage", state.answers.manualMetrics.coverage);
      setValue("memo-headline", state.answers.memo.headline);
      setValue("memo-finding-1", state.answers.memo.findings[0]);
      setValue("memo-finding-2", state.answers.memo.findings[1]);
      setValue("memo-finding-3", state.answers.memo.findings[2]);
      setValue("memo-recommendation", state.answers.memo.recommendation);
      setValue("table-search", state.table.search);
      setValue("stage-filter", state.table.stage);
      setValue("owner-filter", state.table.owner);
      const riskOnly = document.getElementById("risk-only-filter");
      if (riskOnly) riskOnly.checked = Boolean(state.table.riskOnly);
      syncChecked("#scope-assumptions input", state.answers.scope);
      syncChecked("#quality-issues input", state.answers.qualityIssues);
      syncChecked("#priority-opportunity-list input", state.answers.priorities);
      syncChecked("#ai-audit-options input", state.answers.aiAudit);
    }

    function syncChecked(selector, selected) {
      document.querySelectorAll(selector).forEach((input) => {
        input.checked = (selected || []).includes(input.value);
      });
    }

    function renderAll() {
      renderNavigation();
      renderTable();
      renderEvidence();
      renderPriority();
      renderMemo();
      renderCoach();
      renderVerificationStates();
      updateNarrowMode();
    }

    function canAccessStep(step) {
      if (step === "brief") return true;
      if (step === "definition") return state.verified.brief;
      if (step === "quality") return state.verified.definition;
      if (step === "forecast") return state.verified.quality;
      if (step === "memo") return state.verified.forecast;
      return false;
    }

    function renderNavigation() {
      elements.panels.forEach((panel) => {
        const active = panel.dataset.stepPanel === state.currentStep;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      });

      elements.tabs.forEach((tab) => {
        const step = tab.dataset.stepTarget;
        const active = step === state.currentStep;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        tab.disabled = !canAccessStep(step);
      });

      const stageStatus = getStageStatus();
      elements.railStages.forEach((button) => {
        const id = button.dataset.stage;
        const status = stageStatus[id] || "locked";
        const item = button.closest("li");
        if (item) {
          item.dataset.stageState = status;
          item.classList.toggle("is-current", status === "current");
          item.classList.toggle("is-complete", status === "complete");
        }
        button.disabled = status === "locked";
        button.removeAttribute("aria-current");
        if (status === "current") button.setAttribute("aria-current", "step");
        const label = button.querySelector("[data-stage-label]");
        if (label) label.textContent = status === "complete" ? "已完成" : status === "current" ? "进行中" : status === "available" ? "可进入" : "待解锁";
      });

      const completed = Object.values(stageStatus).filter((status) => status === "complete").length;
      const currentOrdinal = Math.min(7, completed + 1);
      const percent = state.verified.review ? 100 : Math.round((currentOrdinal / 7) * 100);
      setText("progress-percent", `${percent}%`);
      setText("progress-count", state.verified.review ? "7 / 7 已完成" : `第 ${currentOrdinal} / 7 关`);
      const bar = document.getElementById("progress-bar");
      if (bar) bar.style.width = `${percent}%`;
      const track = document.querySelector(".progress-track");
      if (track) track.setAttribute("aria-valuenow", String(percent));
    }

    function getStageStatus() {
      const complete = {
        brief: state.verified.brief,
        definition: state.verified.definition,
        quality: state.verified.quality,
        forecast: state.verified.calculation,
        "ai-audit": state.verified.audit,
        memo: state.verified.memo,
        review: state.verified.review,
      };
      const unlocked = {
        brief: true,
        definition: state.verified.brief,
        quality: state.verified.definition,
        forecast: state.verified.quality,
        "ai-audit": state.verified.quality && state.verified.calculation,
        memo: state.verified.forecast,
        review: Boolean(state.evaluation),
      };
      const currentStage = state.evaluation && !state.verified.review
        ? "review"
        : state.currentStep === "forecast" && state.verified.calculation && !state.verified.audit
          ? "ai-audit"
          : state.currentStep;
      const status = {};
      Object.keys(complete).forEach((id) => {
        status[id] = complete[id] ? "complete" : id === currentStage ? "current" : unlocked[id] ? "available" : "locked";
      });
      return status;
    }

    function navigate(step, options) {
      if (!STEP_ORDER.includes(step) || !canAccessStep(step)) {
        toast("请先完成前一关的关键检查。", "warning");
        return false;
      }
      state.currentStep = step;
      renderNavigation();
      renderCoach();
      scheduleSave();
      const panel = document.getElementById(`panel-${step}`);
      if (panel && !(options && options.silent)) panel.focus({ preventScroll: true });
      if (options && options.anchor) {
        requestAnimationFrame(() => {
          const anchor = document.getElementById(options.anchor);
          if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } else if (!(options && options.silent)) {
        document.getElementById("main-workbench")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return true;
    }

    function renderTable() {
      if (!elements.tableBody) return;
      const search = state.table.search.trim().toLowerCase();
      let rows = OPPORTUNITIES.filter((record) => {
        const haystack = `${record.id} ${record.name} ${record.account} ${record.owner}`.toLowerCase();
        return (!search || haystack.includes(search)) &&
          (state.table.stage === "all" || record.stage === state.table.stage) &&
          (state.table.owner === "all" || record.owner === state.table.owner) &&
          (!state.table.riskOnly || Boolean(getQualityIssue(record)));
      });
      rows = rows.slice().sort(compareRecords(state.table.sortKey, state.table.sortDirection));
      elements.tableBody.innerHTML = rows.map((record) => tableRow(record)).join("");
      setText("visible-row-count", `${rows.length} / ${OPPORTUNITIES.length} 条`);
      document.querySelectorAll("[data-sort]").forEach((header) => {
        const selected = header.dataset.sort === state.table.sortKey;
        header.setAttribute("aria-sort", selected ? (state.table.sortDirection === "asc" ? "ascending" : "descending") : "none");
      });
    }

    function tableRow(record) {
      const issue = getQualityIssue(record);
      const selected = state.answers.evidenceRecordIds.includes(record.id);
      const days = daysBetween(record.lastActivity, AS_OF_DATE);
      const status = issue ? QUALITY_LABELS[issue] : record.stage === "closedWon" ? "Q3 Actual" : "纳入预测";
      const statusClass = issue ? "warning" : "clean";
      const qualityAttribute = issue ? ` data-quality="${issue}"` : "";
      return `
        <tr data-record-id="${record.id}"${qualityAttribute} tabindex="0" role="button" aria-pressed="${selected}" class="${selected ? "is-selected" : ""}"${selected ? ' style="box-shadow:inset 3px 0 #2f6b53;background:rgba(47,107,83,.07)"' : ""}>
          <td><strong>${record.id} · ${escapeHtml(record.name)}</strong><small>${escapeHtml(record.account)}</small></td>
          <td>${escapeHtml(record.owner)}</td>
          <td><span class="stage-pill ${record.stage.toLowerCase()}">${stageLabel(record.stage)}</span></td>
          <td class="numeric">${formatMoney(record.amount)}</td>
          <td class="numeric">${Math.round(record.probability * 100)}%</td>
          <td${!record.closeDate || issue === "outside-quarter" ? ' class="quality-cell"' : ""}>${formatDate(record.closeDate)}</td>
          <td class="numeric${issue === "stale" ? " quality-cell" : ""}">${days} 天</td>
          <td><span class="quality-pill ${statusClass}">${status}</span></td>
        </tr>
      `;
    }

    function compareRecords(key, direction) {
      const factor = direction === "desc" ? -1 : 1;
      return (left, right) => {
        const values = {
          opportunity: [left.id, right.id],
          owner: [left.owner, right.owner],
          stage: [left.stage, right.stage],
          amount: [left.amount, right.amount],
          probability: [left.probability, right.probability],
          closeDate: [left.closeDate || "9999-12-31", right.closeDate || "9999-12-31"],
          daysSinceActivity: [daysBetween(left.lastActivity, AS_OF_DATE), daysBetween(right.lastActivity, AS_OF_DATE)],
        }[key] || [left.id, right.id];
        if (typeof values[0] === "number") return (values[0] - values[1]) * factor;
        return String(values[0]).localeCompare(String(values[1]), "zh-CN") * factor;
      };
    }

    function renderEvidence() {
      const items = getEvidenceItems();
      document.querySelectorAll("[data-evidence-count]").forEach((node) => {
        node.textContent = `${items.length} 条`;
      });
      if (elements.evidenceList) {
        elements.evidenceList.innerHTML = items.length
          ? items.map((item) => `<article class="evidence-item" data-evidence-state="${item.state}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></article>`).join("")
          : '<p class="empty-note">点击表格记录或勾选问题，将证据带到这里。管理建议只能引用已收集的证据。</p>';
      }
      if (elements.memoEvidenceList) {
        elements.memoEvidenceList.innerHTML = items.length
          ? items.map((item) => `<article class="evidence-item" data-evidence-state="${item.state}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></article>`).join("")
          : "<p>你在数据体检和预测验算中收集的证据会出现在这里。</p>";
      }
    }

    function getEvidenceItems() {
      const items = state.answers.evidenceRecordIds.map((id) => {
        const record = OPPORTUNITIES.find((item) => item.id === id);
        if (!record) return null;
        const issue = getQualityIssue(record);
        return {
          title: `${record.id} · ${issue ? QUALITY_LABELS[issue] : "已检查"}`,
          detail: `${stageLabel(record.stage)} · ${formatMoney(record.amount)} · ${formatDate(record.closeDate)}`,
          state: state.verified.quality && issue ? "verified" : "collected",
        };
      }).filter(Boolean);
      if (state.verified.quality) {
        items.push({ title: "E1 · Q3 Actual $430K", detail: "OP-098 + OP-099 · 2 笔 Closed Won", state: "verified" });
        items.push({ title: "E3 · Data Quality", detail: "5 条异常已排除或待补正", state: "verified" });
      }
      if (state.verified.calculation) {
        items.push({ title: "E2 · Forecast $982K", detail: "Weighted Pipeline $552K · Shortfall $218K", state: "verified" });
      }
      if (state.verified.audit) {
        items.push({ title: "E4 · AI draft 已审计", detail: "原始管道 $1.75M 不能替代可信加权预测", state: "verified" });
      }
      return items;
    }

    function renderPriority() {
      syncChecked("#priority-opportunity-list input", state.answers.priorities);
      setText("priority-count", `${state.answers.priorities.length} / 3`);
    }

    function renderMemo() {
      setText("headline-count", String(state.answers.memo.headline.length));
      setText("recommendation-count", String(state.answers.memo.recommendation.length));
      const result = evaluateMemo(state.answers.memo);
      setText("memo-score-preview", state.attempts.memo ? `${result.scorePercent}` : "—");
      document.querySelectorAll("#memo-checklist [data-check]").forEach((item) => {
        const passed = Boolean(result.checklist[item.dataset.check]);
        item.classList.toggle("is-complete", passed);
        item.dataset.checkState = passed ? "passed" : "pending";
        item.setAttribute("aria-label", `${item.textContent.trim()}：${passed ? "已满足" : "待补充"}`);
      });
    }

    function renderCoach() {
      const labels = {
        brief: ["01 · 读懂业务问题", "先写出自己的问题定义，再向我求助。"],
        definition: ["02 · 定义指标口径", "先提交一次公式与范围，我再按错误方向提示。"],
        quality: ["03 · 检查数据质量", "先筛选或标记记录，再检查你遗漏了哪类风险。"],
        forecast: ["04–05 · 预测与 AI 审核", "先复算数字，再决定 AI 的结论是否值得相信。"],
        memo: ["06 · 提交管理建议", "先给判断，再用数字和具体动作支撑。"],
      };
      if (elements.coachContext) {
        const pair = labels[state.currentStep];
        elements.coachContext.innerHTML = `<span>当前关卡</span><strong>${pair[0]}</strong><p>${pair[1]}</p>`;
      }
      if (elements.coachMessages) {
        elements.coachMessages.innerHTML = state.coachMessages.slice(-24).map((message) => `
          <article class="coach-message ${message.role === "coach" ? "is-coach" : "is-user"}" data-message-role="${message.role}">
            <div class="message-avatar" aria-hidden="true">${message.role === "coach" ? "AI" : "你"}</div>
            <div>${String(message.text).split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>
          </article>
        `).join("");
        elements.coachMessages.scrollTop = elements.coachMessages.scrollHeight;
      }
    }

    function renderVerificationStates() {
      const calculationFeedback = document.getElementById("calculation-feedback");
      if (calculationFeedback && state.verified.calculation) {
        calculationFeedback.hidden = false;
        calculationFeedback.textContent = "复算一致：Gap $770K，Weighted Pipeline $552K，Coverage 0.72×；Forecast 为 $982K，Shortfall 为 $218K。";
        calculationFeedback.dataset.state = "success";
      }
      const auditCard = document.getElementById("ai-audit-card");
      if (auditCard) auditCard.dataset.auditState = state.verified.audit ? "verified" : "pending";
      const statusBadge = auditCard && auditCard.querySelector(".unverified-badge");
      if (statusBadge) statusBadge.textContent = state.verified.audit ? "已审计" : "未验证";
    }

    function invalidateFrom(step) {
      const map = {
        brief: ["brief", "definition", "quality", "calculation", "audit", "forecast", "memo", "review"],
        definition: ["definition", "quality", "calculation", "audit", "forecast", "memo", "review"],
        quality: ["quality", "calculation", "audit", "forecast", "memo", "review"],
        calculation: ["calculation", "forecast", "memo", "review"],
        audit: ["audit", "forecast", "memo", "review"],
        forecast: ["forecast", "memo", "review"],
        memo: ["memo", "review"],
      };
      (map[step] || []).forEach((key) => { state.verified[key] = false; });
      state.evaluation = null;
      if (state.status === "complete") state.status = "in-progress";
    }

    function handleBriefCompletion() {
      state.attempts.brief += 1;
      const result = evaluateProblemDefinition(state.answers.problemStatement);
      if (!result.pass) {
        markFieldValidity("problem-statement", false);
        const labels = { decisionMaker: "决策人", timeRange: "时间范围", judgement: "达标判断", action: "行动用途" };
        const help = document.getElementById("problem-statement-help");
        if (help) help.textContent = `还需补充：${result.missing.map((item) => labels[item]).join("、")}。`;
        toast("先把问题定义补完整，再进入数据。", "warning");
        scheduleSave();
        return;
      }
      markFieldValidity("problem-statement", true);
      state.verified.brief = true;
      toast("问题定义清楚：现在可以定义计算口径。", "success");
      scheduleSave();
      renderAll();
      navigate("definition");
    }

    function handleDefinitionValidation() {
      state.attempts.definition += 1;
      const result = validateMetricDefinition(state.answers.formulas, state.answers.scope);
      Object.entries(result.formulas).forEach(([key, passed]) => {
        const id = key === "gap" ? "gap-formula" : key === "weighted" ? "weighted-formula" : "coverage-formula";
        markFieldValidity(id, passed);
      });
      document.querySelectorAll("#scope-assumptions label").forEach((label) => {
        const input = label.querySelector("input");
        const bad = input.checked && !REQUIRED_SCOPE.includes(input.value);
        label.dataset.validationState = bad ? "error" : input.checked ? "selected" : "idle";
      });
      if (!result.pass) {
        const formulaCount = Object.values(result.formulas).filter(Boolean).length;
        toast(`口径还未通过：公式 ${formulaCount}/3，范围还缺 ${result.missingScope.length} 项。`, "warning");
        scheduleSave();
        return;
      }
      state.verified.definition = true;
      toast("口径通过。接下来验证数据是否值得相信。", "success");
      scheduleSave();
      renderAll();
      navigate("quality");
    }

    function handleQualityCompletion() {
      state.attempts.quality += 1;
      const result = validateQualitySelection(state.answers.qualityIssues, state.answers.evidenceRecordIds);
      if (!result.pass) {
        const extra = result.incorrect.length ? `，另有 ${result.incorrect.length} 项不是本数据集的问题` : "";
        toast(`已确认 ${result.correctCount}/5 类关键问题；证据还缺 ${result.missingEvidence.length} 条${extra}。`, "warning");
        scheduleSave();
        return;
      }
      state.verified.quality = true;
      toast("可信视图已生成：8 条纳入，5 条排除或待补正。", "success");
      scheduleSave();
      renderAll();
      navigate("forecast");
    }

    function handleCalculationVerification() {
      state.attempts.calculation += 1;
      const result = validateManualMetrics(state.answers.manualMetrics);
      const feedback = document.getElementById("calculation-feedback");
      if (feedback) {
        feedback.hidden = false;
        feedback.dataset.state = result.pass ? "success" : "error";
        feedback.textContent = result.pass
          ? "复算一致。把 Actual 加回加权管道后，Forecast 为 $982K，仍短缺 $218K。"
          : `还有数字需要复核：Gap ${result.results.gap ? "✓" : "×"} · Weighted ${result.results.weighted ? "✓" : "×"} · Coverage ${result.results.coverage ? "✓" : "×"}`;
      }
      ["gap", "weighted", "coverage"].forEach((key) => {
        const id = key === "gap" ? "manual-gap" : key === "weighted" ? "manual-weighted" : "manual-coverage";
        markFieldValidity(id, result.results[key]);
      });
      if (!result.pass) {
        toast("至少一个结果与可信视图不一致。检查单位、概率和 Coverage 分母。", "warning");
        scheduleSave();
        return;
      }
      state.verified.calculation = true;
      toast("关键数字已复算，可以开始审计 AI 草稿。", "success");
      scheduleSave();
      renderAll();
    }

    function handleAuditVerification() {
      state.attempts.audit += 1;
      if (!state.verified.calculation) {
        toast("先完成三项手工复算，再判断 AI 的结论。", "warning");
        return;
      }
      const result = validateAiAudit(state.answers.aiAudit);
      if (!result.pass) {
        const reason = result.incorrect.length
          ? "你选择了一个没有证据支持的指控。"
          : !result.hasCore
            ? "还没有识别 raw pipeline 与 weighted pipeline 的关键混淆。"
            : "至少标出三项有效漏洞，并包含一项数据质量问题。";
        toast(reason, "warning");
        scheduleSave();
        return;
      }
      state.verified.audit = true;
      toast("AI 审核通过：表达可借用，数字与判断必须重做。", "success");
      scheduleSave();
      renderAll();
    }

    function handleForecastCompletion() {
      if (!state.verified.calculation) {
        toast("请先完成三项手工复算。", "warning");
        document.getElementById("reconcile-title")?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      if (!validatePrioritySelection(state.answers.priorities)) {
        toast("请从可信机会中选出 OP-101、OP-104、OP-102 三笔优先机会。", "warning");
        document.getElementById("priority-title")?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      if (!state.verified.audit) {
        toast("请先完成 AI 草稿审核，并排除没有证据的指控。", "warning");
        document.getElementById("ai-audit-card")?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      state.verified.forecast = true;
      toast("预测判断已固定。现在把它写成管理层能执行的建议。", "success");
      scheduleSave();
      renderAll();
      navigate("memo");
    }

    function previewMemo() {
      state.attempts.memo += 1;
      const result = evaluateMemo(state.answers.memo);
      renderMemo();
      toast(result.pass ? "Memo 已包含完整的判断、证据和行动。" : `当前满足 ${result.passedChecks}/5 项提交检查。`, result.pass ? "success" : "warning");
      scheduleSave();
      return result;
    }

    function submitMemo(event) {
      if (event) event.preventDefault();
      if (window.innerWidth < 1100) {
        toast("原型需在宽度至少 1100px 的桌面窗口提交。你的内容已经保存。", "warning");
        return;
      }
      const memoResult = previewMemo();
      if (!memoResult.pass) {
        document.getElementById("memo-checklist")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      state.verified.memo = true;
      state.evaluation = scoreSession(state);
      state.status = state.evaluation.passed ? "evaluated" : "needs-revision";
      renderReview();
      renderAll();
      flushSave();
      openDialog(elements.completionDialog);
    }

    function renderReview() {
      if (!state.evaluation) return;
      setText("final-total-score", String(state.evaluation.total));
      setText("final-level", state.evaluation.passed ? "可靠的初级分析师" : "正在建立可信分析习惯");
      const assisted = Object.entries(state.hints).filter(([, level]) => level >= 2).map(([step]) => step);
      setText(
        "final-feedback",
        state.evaluation.passed
          ? assisted.length
            ? `关键闭环已通过；本次有 ${assisted.length} 个步骤使用了二级以上提示，下次可以尝试减少辅助。`
            : "你用可信数据推翻了过度乐观的 AI 结论，并给出了可执行动作。"
          : "总分或关键门槛尚未通过；回到最弱一关修正后可重新提交。",
      );
      document.querySelectorAll("#skill-score-list [data-skill]").forEach((row) => {
        const score = state.evaluation.dimensionScoresById[row.dataset.skill] || 0;
        const percent = score * 50;
        const bar = row.querySelector("i");
        const value = row.querySelector("strong");
        if (bar) bar.style.width = `${percent}%`;
        if (value) value.textContent = String(percent);
      });
    }

    function finishReview() {
      if (!state.evaluation) return;
      state.verified.review = true;
      state.status = state.evaluation.passed ? "complete" : "needs-revision";
      closeDialog(elements.completionDialog);
      renderNavigation();
      flushSave();
      toast(state.evaluation.passed ? "任务已完成，成绩与 Memo 已保存在本机。" : "成绩已保存；你可以继续修正后重新提交。", "success");
    }

    function revisitWeakness() {
      if (!state.evaluation) return;
      const entries = Object.entries(state.evaluation.dimensionScoresById).sort((a, b) => a[1] - b[1]);
      const stepBySkill = {
        problem: "brief",
        metric: "definition",
        quality: "quality",
        reasoning: "forecast",
        "ai-audit": "forecast",
        recommendation: "memo",
        communication: "memo",
      };
      closeDialog(elements.completionDialog);
      navigate(stepBySkill[entries[0][0]] || "memo");
    }

    function updateAnswerFromInput(target) {
      const id = target.id;
      if (id === "problem-statement") {
        state.answers.problemStatement = target.value;
        invalidateFrom("brief");
      } else if (id === "gap-formula") {
        state.answers.formulas.gap = target.value;
        invalidateFrom("definition");
      } else if (id === "weighted-formula") {
        state.answers.formulas.weighted = target.value;
        invalidateFrom("definition");
      } else if (id === "coverage-formula") {
        state.answers.formulas.coverage = target.value;
        invalidateFrom("definition");
      } else if (id === "quality-note") {
        state.answers.qualityNote = target.value;
      } else if (id === "manual-gap") {
        state.answers.manualMetrics.gap = target.value;
        invalidateFrom("calculation");
      } else if (id === "manual-weighted") {
        state.answers.manualMetrics.weighted = target.value;
        invalidateFrom("calculation");
      } else if (id === "manual-coverage") {
        state.answers.manualMetrics.coverage = target.value;
        invalidateFrom("calculation");
      } else if (id === "memo-headline") {
        state.answers.memo.headline = target.value;
        invalidateFrom("memo");
      } else if (/memo-finding-[123]/.test(id)) {
        const index = Number(id.slice(-1)) - 1;
        state.answers.memo.findings[index] = target.value;
        invalidateFrom("memo");
      } else if (id === "memo-recommendation") {
        state.answers.memo.recommendation = target.value;
        invalidateFrom("memo");
      } else {
        return false;
      }
      renderNavigation();
      renderMemo();
      scheduleSave();
      return true;
    }

    function handleCheckboxChange(target) {
      if (target.name === "scope") {
        state.answers.scope = checkedValues("#scope-assumptions input");
        invalidateFrom("definition");
      } else if (target.name === "qualityIssue") {
        state.answers.qualityIssues = checkedValues("#quality-issues input");
        const recordId = Object.keys(SCENARIO.expectedIssueByRecordId).find((id) => SCENARIO.expectedIssueByRecordId[id] === target.value);
        if (target.checked && recordId) state.answers.evidenceRecordIds = unique([...state.answers.evidenceRecordIds, recordId]);
        invalidateFrom("quality");
      } else if (target.name === "priorityOpportunity") {
        const selected = checkedValues("#priority-opportunity-list input");
        if (selected.length > 3) {
          target.checked = false;
          toast("最多选择三笔机会。", "warning");
        }
        state.answers.priorities = checkedValues("#priority-opportunity-list input");
        invalidateFrom("forecast");
      } else if (target.name === "aiAudit") {
        state.answers.aiAudit = checkedValues("#ai-audit-options input");
        invalidateFrom("audit");
      } else {
        return;
      }
      renderNavigation();
      renderEvidence();
      renderPriority();
      scheduleSave();
    }

    function toggleRecordEvidence(recordId) {
      const exists = state.answers.evidenceRecordIds.includes(recordId);
      state.answers.evidenceRecordIds = exists
        ? state.answers.evidenceRecordIds.filter((id) => id !== recordId)
        : [...state.answers.evidenceRecordIds, recordId];
      invalidateFrom("quality");
      renderTable();
      renderEvidence();
      renderNavigation();
      scheduleSave();
      const record = OPPORTUNITIES.find((item) => item.id === recordId);
      toast(`${recordId} 已${exists ? "移出" : "加入"}证据栏${record && getQualityIssue(record) ? ` · ${QUALITY_LABELS[getQualityIssue(record)]}` : ""}。`, "success");
    }

    function handleTableFilter(target) {
      if (target.id === "table-search") state.table.search = target.value;
      if (target.id === "stage-filter") state.table.stage = target.value;
      if (target.id === "owner-filter") state.table.owner = target.value;
      if (target.id === "risk-only-filter") state.table.riskOnly = target.checked;
      renderTable();
      scheduleSave();
    }

    function resetFilters() {
      state.table = { ...state.table, search: "", stage: "all", owner: "all", riskOnly: false };
      setValue("table-search", "");
      setValue("stage-filter", "all");
      setValue("owner-filter", "all");
      const risk = document.getElementById("risk-only-filter");
      if (risk) risk.checked = false;
      renderTable();
      scheduleSave();
    }

    function sortTable(key) {
      if (state.table.sortKey === key) {
        state.table.sortDirection = state.table.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.table.sortKey = key;
        state.table.sortDirection = "asc";
      }
      renderTable();
      scheduleSave();
    }

    function currentAttemptCount() {
      if (state.currentStep === "forecast") return state.attempts.calculation + state.attempts.audit;
      return state.attempts[state.currentStep] || 0;
    }

    function coachResponse(kind, question) {
      const step = state.currentStep;
      if (kind === "hint" && currentAttemptCount() === 0) {
        return "先完成一次自己的尝试。我会根据你实际卡住的位置给提示，而不是提前泄露答案。";
      }
      if (kind === "challenge") {
        const prompts = {
          brief: "如果 Elena 只拿到一个 pipeline 数字，她接下来能做什么决定？你的问题定义有没有写出行动对象？",
          definition: "如果分母用完整 Target，已经赢下的收入会如何影响 Coverage 的含义？",
          quality: "一条记录金额很大，不等于它属于 Q3。你为“可纳入”设了哪些闸门？",
          forecast: "你的 Forecast 是事实，还是基于阶段概率的估计？如果最大机会延迟，判断会怎样变？",
          memo: "管理层读完第一句，能否立刻知道风险有多大、今天要找谁做什么？",
        };
        return prompts[step];
      }
      if (kind === "check") return coachCheck(step);

      const currentLevel = Math.min(3, (state.hints[step] || 0) + 1);
      state.hints[step] = currentLevel;
      const hints = {
        brief: [
          "检查句子里是否同时出现：决策人、季度、达标判断和行动用途。",
          "把问题写成“为谁判断 Q3 目标风险，并决定哪些机会优先”。",
          "可用模板：为 [决策人] 判断 [时间范围] 目标能否完成，并支持 [具体行动]。请用自己的话补齐。",
        ],
        definition: [
          "三个公式分别检查：减法两端、概率是否逐笔应用、Coverage 的分母。",
          "Coverage 回答的是“加权 Open 管道能覆盖多少剩余 Gap”，不是覆盖整个 Target。",
          "可信加权管道需要逐笔 Amount × Stage Probability，再求和；范围还要排除重复、跨季度和长期未活动。",
        ],
        quality: [
          "先按 Close Date 和未跟进天数排序，再搜索相似机会 ID。",
          "可信视图的五个方向是：唯一性、季度范围、日期完整、状态、近期活动。",
          "检查带 D 后缀的重复记录，以及 OP-107 到 OP-110；每类问题都要在证据栏留下对应记录。",
        ],
        forecast: [
          "输入框单位是 K；Coverage = Weighted Pipeline ÷ Gap。算对后再审 AI。",
          "AI 的 1.75M 是 raw Open 总和。问它是否排除了异常、是否逐笔加权、是否把 Actual 加回 Forecast。",
          "可信结果链是 Actual + Weighted Pipeline = Forecast；审计需至少指出未加权、数据质量和结论过强三类问题。",
        ],
        memo: [
          "先写判断，再写 Forecast 与 Shortfall，最后写机会 ID、负责人、时间和 OP-108 补数动作。",
          "一条强建议应能回答：风险多大、追哪三单、谁本周做什么、哪条数据要补。",
          "检查数字 982K / 218K，优先机会 OP-101 / OP-104 / OP-102，以及 OP-108 Close Date 是否都可追溯。",
        ],
      };
      scheduleSave();
      return `提示 ${currentLevel}/3：${hints[step][currentLevel - 1]}`;
    }

    function coachCheck(step) {
      if (step === "brief") {
        const result = evaluateProblemDefinition(state.answers.problemStatement);
        return `当前问题定义覆盖 ${result.count}/4 个要素。${result.pass ? "可以提交验证。" : "先检查谁、何时、判断什么、用于什么行动。"}`;
      }
      if (step === "definition") {
        const result = validateMetricDefinition(state.answers.formulas, state.answers.scope);
        return `公式通过 ${Object.values(result.formulas).filter(Boolean).length}/3，范围还缺 ${result.missingScope.length} 项${result.extraScope.length ? `，并多选了 ${result.extraScope.length} 项` : ""}。`;
      }
      if (step === "quality") {
        const result = validateQualitySelection(state.answers.qualityIssues, state.answers.evidenceRecordIds);
        return `已识别 ${result.correctCount}/5 类关键问题，证据还缺 ${result.missingEvidence.length} 条${result.incorrect.length ? `，有 ${result.incorrect.length} 项不符合数据事实` : ""}。`;
      }
      if (step === "forecast") {
        const manual = validateManualMetrics(state.answers.manualMetrics);
        const audit = validateAiAudit(state.answers.aiAudit);
        return `复算 ${manual.pass ? "已通过" : "未通过"}；优先机会 ${state.answers.priorities.length}/3；AI 审计 ${audit.pass ? "已通过" : "仍需补证"}。`;
      }
      const memo = evaluateMemo(state.answers.memo);
      return `Memo 当前满足 ${memo.passedChecks}/5 项，三条 finding 已填写 ${memo.filledFindings}/3。`;
    }

    function sendCoachMessage(text, kind) {
      const content = String(text || "").trim();
      if (content) state.coachMessages.push({ role: "user", text: content });
      const inferredKind = kind || (/提示|hint|答案|怎么算|帮我/.test(content.toLowerCase()) ? "hint" : /检查|check|对吗/.test(content.toLowerCase()) ? "check" : "challenge");
      state.coachMessages.push({ role: "coach", text: coachResponse(inferredKind, content) });
      renderCoach();
      scheduleSave();
    }

    function updateNarrowMode() {
      const narrow = window.innerWidth < 1100;
      elements.appShell.dataset.viewport = narrow ? "narrow" : "desktop";
      let notice = document.getElementById("narrow-screen-notice");
      if (!notice) {
        notice = document.createElement("div");
        notice.id = "narrow-screen-notice";
        notice.setAttribute("role", "status");
        notice.style.cssText = "position:fixed;left:12px;right:12px;top:72px;z-index:999;padding:12px 16px;border-radius:10px;background:#fff4cf;color:#5f4510;box-shadow:0 8px 30px rgba(0,0,0,.16);font:600 14px/1.4 system-ui";
        document.body.appendChild(notice);
      }
      notice.textContent = "当前窗口较窄：可以继续查看和编辑，但请在至少 1100px 宽的电脑窗口提交最终 Memo。";
      notice.hidden = !narrow;
      const submit = document.getElementById("submit-memo-button");
      if (submit) {
        submit.disabled = narrow;
        submit.title = narrow ? "请扩大浏览器窗口后提交" : "";
      }
    }

    function toast(message, type) {
      if (!elements.toastRegion) return;
      const node = document.createElement("div");
      node.className = `toast toast-${type || "info"}`;
      node.setAttribute("role", type === "error" ? "alert" : "status");
      node.textContent = message;
      node.style.cssText = "margin:8px;padding:12px 16px;border-radius:10px;background:#202620;color:white;box-shadow:0 8px 26px rgba(0,0,0,.24);font:600 14px/1.4 system-ui;max-width:420px";
      elements.toastRegion.appendChild(node);
      setTimeout(() => node.remove(), 4200);
    }

    function openDialog(dialog) {
      if (!dialog) return;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }

    function closeDialog(dialog) {
      if (!dialog) return;
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }

    function resetProgress() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        // Reset in memory even if browser storage is unavailable.
      }
      state = createInitialState();
      hydrateInputs();
      closeDialog(elements.resetDialog);
      renderAll();
      flushSave();
      toast("本次训练已重置。", "success");
    }

    function updateClock() {
      const start = dateValueFromIso(state.startedAt);
      const elapsed = Number.isFinite(start) ? Math.floor((Date.now() - start) / 1000) : 0;
      const remaining = Math.max(0, 900 - elapsed);
      const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
      const seconds = String(remaining % 60).padStart(2, "0");
      setText("mission-timer", `${minutes}:${seconds}`);
    }

    function bindEvents() {
      document.addEventListener("input", (event) => {
        if (updateAnswerFromInput(event.target)) return;
        if (event.target.id === "table-search") handleTableFilter(event.target);
      });

      document.addEventListener("change", (event) => {
        if (event.target.matches('input[type="checkbox"]')) handleCheckboxChange(event.target);
        if (["stage-filter", "owner-filter", "risk-only-filter"].includes(event.target.id)) handleTableFilter(event.target);
      });

      document.addEventListener("click", (event) => {
        const row = event.target.closest("#opportunity-table-body tr[data-record-id]");
        if (row) {
          toggleRecordEvidence(row.dataset.recordId);
          return;
        }

        const sortHeader = event.target.closest("[data-sort]");
        if (sortHeader) {
          sortTable(sortHeader.dataset.sort);
          return;
        }

        // Step tabs also carry data-step-target. Action buttons can carry a
        // data-step-target only to describe where they navigate next, so they
        // must reach the action dispatcher below instead of being swallowed
        // by the generic tab handler.
        const actionNode = event.target.closest("[data-action]");

        const tab = event.target.closest("[data-step-target]");
        if (tab && !actionNode && !tab.disabled) {
          navigate(tab.dataset.stepTarget);
          return;
        }

        const rail = event.target.closest("[data-target-step]");
        if (rail && !rail.disabled) {
          navigate(rail.dataset.targetStep, { anchor: rail.dataset.targetAnchor });
          return;
        }

        if (!actionNode) return;
        const action = actionNode.dataset.action;
        if (action === "save-draft") {
          flushSave();
          toast("草稿已保存在这台设备。", "success");
        } else if (action === "complete-step" && actionNode.dataset.step === "brief") handleBriefCompletion();
        else if (action === "complete-step" && actionNode.dataset.step === "quality") handleQualityCompletion();
        else if (action === "complete-step" && actionNode.dataset.step === "forecast") handleForecastCompletion();
        else if (action === "validate-definition") handleDefinitionValidation();
        else if (action === "verify-calculation") handleCalculationVerification();
        else if (action === "check-ai-audit") handleAuditVerification();
        else if (action === "preview-score") previewMemo();
        else if (action === "submit-memo") {
          event.preventDefault();
          submitMemo(event);
        }
        else if (action === "reset-filters") resetFilters();
        else if (action === "view-evidence") toast(getEvidenceItems().map((item) => item.title).join(" · ") || "还没有固定证据。", "info");
        else if (action === "open-review") {
          if (state.evaluation) {
            renderReview();
            openDialog(elements.completionDialog);
          } else toast("提交 Memo 后会生成七维复盘。", "warning");
        } else if (action === "open-reset-dialog") openDialog(elements.resetDialog);
        else if (action === "confirm-reset") resetProgress();
        else if (action === "finish-review") finishReview();
        else if (action === "revisit-weakness") revisitWeakness();
        else if (action === "coach-quick-prompt") sendCoachMessage(actionNode.textContent.trim(), actionNode.dataset.coachPrompt);
        else if (action === "toggle-coach") {
          const panel = document.querySelector(".coach-panel");
          const collapsed = panel.dataset.coachState === "collapsed";
          panel.dataset.coachState = collapsed ? "ready" : "collapsed";
          actionNode.setAttribute("aria-expanded", String(collapsed));
        }
      });

      document.addEventListener("keydown", (event) => {
        const row = event.target.closest("#opportunity-table-body tr[data-record-id]");
        if (row && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          toggleRecordEvidence(row.dataset.recordId);
        }
        const header = event.target.closest("[data-sort]");
        if (header && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          sortTable(header.dataset.sort);
        }
        if (event.target.matches("[data-step-target]") && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
          event.preventDefault();
          const available = elements.tabs.filter((tab) => !tab.disabled);
          const current = available.indexOf(event.target);
          const next = event.key === "ArrowRight" ? (current + 1) % available.length : (current - 1 + available.length) % available.length;
          available[next].focus();
          navigate(available[next].dataset.stepTarget, { silent: true });
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          flushSave();
          toast("进度已保存。", "success");
        }
      });

      const memoForm = document.getElementById("management-memo-form");
      if (memoForm) memoForm.addEventListener("submit", submitMemo);
      const coachForm = document.getElementById("coach-form");
      if (coachForm) {
        coachForm.addEventListener("submit", (event) => {
          event.preventDefault();
          const input = document.getElementById("coach-question");
          if (!input.value.trim()) return;
          sendCoachMessage(input.value);
          input.value = "";
        });
      }
      document.querySelector(".brand")?.addEventListener("click", (event) => {
        event.preventDefault();
        navigate("brief");
      });
      window.addEventListener("resize", updateNarrowMode);
      window.addEventListener("beforeunload", flushSave);
    }

    applyScenarioFixtures();
    hydrateInputs();
    bindEvents();
    renderAll();
    updateClock();
    clockTimer = setInterval(updateClock, 1000);
    scheduleSave();

    activeRuntime = {
      getState: () => JSON.parse(JSON.stringify(state)),
      navigate,
      reset: resetProgress,
      save: flushSave,
      destroy: () => {
        clearTimeout(saveTimer);
        clearInterval(clockTimer);
        activeRuntime = null;
      },
    };
    return activeRuntime;
  }

  function checkedValues(selector) {
    return Array.from(document.querySelectorAll(selector)).filter((input) => input.checked).map((input) => input.value);
  }

  function markFieldValidity(id, valid) {
    const element = document.getElementById(id);
    if (!element) return;
    element.setAttribute("aria-invalid", String(!valid));
    element.dataset.validationState = valid ? "valid" : "error";
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value == null ? "" : value;
  }

  function formatMoney(value) {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(value % 1000000 === 0 ? 1 : 2)}M`;
    return `$${Math.round(value / 1000)}K`;
  }

  function formatDate(value) {
    if (!value) return "缺失";
    const date = new Date(`${value}T00:00:00Z`);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  function stageLabel(stage) {
    return {
      qualification: "Qualification",
      discovery: "Discovery",
      proposal: "Proposal",
      negotiation: "Negotiation",
      closedWon: "Closed Won",
      closedLost: "Closed Lost",
    }[stage] || stage;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function dateValueFromIso(value) {
    const result = new Date(value).getTime();
    return Number.isFinite(result) ? result : NaN;
  }

  return Object.freeze({
    SCHEMA_VERSION,
    STORAGE_KEY,
    SCENARIO,
    EXPECTED_METRICS,
    CORRECT_QUALITY_ISSUES,
    REQUIRED_SCOPE,
    CORRECT_AUDIT_ISSUES,
    buildTrustedView,
    computeMetrics,
    getQualityIssue,
    normalizeFormula,
    validateFormula,
    evaluateProblemDefinition,
    validateMetricDefinition,
    validateQualitySelection,
    validateManualMetrics,
    validatePrioritySelection,
    validateAiAudit,
    evaluateMemo,
    scoreSession,
    createInitialState,
    mount,
    getState: () => activeRuntime ? activeRuntime.getState() : null,
    navigate: (step) => activeRuntime ? activeRuntime.navigate(step) : false,
    reset: () => activeRuntime && activeRuntime.reset(),
  });
});
