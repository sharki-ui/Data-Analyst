"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const AnalystOS = require("../app/app.js");

const metrics = AnalystOS.computeMetrics();

assert.equal(AnalystOS.SCENARIO.opportunities.length, 13, "固定夹具必须有 13 条记录");
assert.equal(metrics.target, 1200000);
assert.equal(metrics.actual, 430000);
assert.equal(metrics.gap, 770000);
assert.equal(metrics.rawOpenPipeline, 1750000);
assert.equal(metrics.validPipeline, 1100000);
assert.equal(metrics.weightedPipeline, 552000);
assert.equal(metrics.forecast, 982000);
assert.equal(metrics.shortfall, 218000);
assert.ok(Math.abs(metrics.forecastAttainment - 0.8183333333) < 0.00001);
assert.deepEqual(metrics.validOpenOpportunityIds, ["OP-101", "OP-102", "OP-103", "OP-104", "OP-105", "OP-106"]);

assert.deepEqual(
  Object.keys(AnalystOS.SCENARIO.expectedIssueByRecordId),
  ["OP-104-D", "OP-107", "OP-108", "OP-109", "OP-110"],
);
assert.equal(AnalystOS.buildTrustedView().length, 8, "可信视图应含 2 条 Closed Won 与 6 条有效 Open");

const definition = AnalystOS.validateMetricDefinition(
  {
    gap: "Target - Actual",
    weighted: "SUM(机会金额 × 阶段概率)",
    coverage: "Weighted Pipeline / Gap",
  },
  AnalystOS.REQUIRED_SCOPE,
);
assert.equal(definition.pass, true, "正确公式与范围必须通过");
assert.equal(AnalystOS.validateFormula("coverage", "Weighted Pipeline / Target"), false, "Coverage 分母不能是 Target");

assert.equal(
  AnalystOS.validateQualitySelection(
    AnalystOS.CORRECT_QUALITY_ISSUES,
    Object.keys(AnalystOS.SCENARIO.expectedIssueByRecordId),
  ).pass,
  true,
);
assert.equal(
  AnalystOS.validateQualitySelection(["duplicate", "outside-quarter", "stale"], ["OP-104-D", "OP-107", "OP-110"]).pass,
  false,
);

assert.equal(AnalystOS.validateManualMetrics({ gap: "770", weighted: "552", coverage: "0.72" }).pass, true);
assert.equal(AnalystOS.validateManualMetrics({ gap: "770", weighted: "1100", coverage: "1.43" }).pass, false);
assert.equal(AnalystOS.validatePrioritySelection(["OP-102", "OP-101", "OP-104"]), true);

assert.equal(
  AnalystOS.validateAiAudit(["raw-vs-weighted", "outside-quarter", "certainty"]).pass,
  true,
);
assert.equal(
  AnalystOS.validateAiAudit(["raw-vs-weighted", "outside-quarter", "certainty", "target-correct"]).pass,
  false,
  "选择无证据的错误项必须失败",
);

const memo = {
  headline: "可信加权预测仅 $982K，Q3 目标存在达标风险，预计短缺 $218K。",
  findings: [
    "可信口径使用阶段概率，而不是 $1.75M 原始管道。",
    "优先机会为 OP-101、OP-104、OP-102。",
    "OP-108 缺少 Close Date，暂不纳入预测。",
  ],
  recommendation: "销售负责人本周优先推动 OP-101、OP-104、OP-102，并在周会前补齐 OP-108 Close Date。",
};
assert.equal(AnalystOS.evaluateMemo(memo).pass, true, "完整管理建议必须通过");

const state = AnalystOS.createInitialState();
state.answers.problemStatement = "为 Elena 判断 Q3 销售目标能否达标，并决定本周优先推动哪三笔机会。";
state.answers.formulas = { gap: "Target - Actual", weighted: "SUM(amount * probability)", coverage: "Weighted Pipeline / Gap" };
state.answers.scope = [...AnalystOS.REQUIRED_SCOPE];
state.answers.qualityIssues = [...AnalystOS.CORRECT_QUALITY_ISSUES];
state.answers.evidenceRecordIds = Object.keys(AnalystOS.SCENARIO.expectedIssueByRecordId);
state.answers.manualMetrics = { gap: "770", weighted: "552", coverage: "0.72" };
state.answers.priorities = ["OP-101", "OP-104", "OP-102"];
state.answers.aiAudit = ["raw-vs-weighted", "outside-quarter", "certainty"];
state.answers.memo = memo;
const evaluation = AnalystOS.scoreSession(state);
assert.equal(evaluation.passed, true);
assert.equal(evaluation.rawTotal, 14);

const source = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
for (const requiredToken of [
  "localStorage",
  "data-step-panel",
  "validateMetricDefinition",
  "validateQualitySelection",
  "validateAiAudit",
  "scoreSession",
  "window.innerWidth < 1100",
  "beforeunload",
]) {
  assert.ok(source.includes(requiredToken), `源码缺少关键能力：${requiredToken}`);
}

console.log("Analyst OS deterministic checks passed: 13 records, fixed metrics, gates, memo, and 7-dimension score.");
