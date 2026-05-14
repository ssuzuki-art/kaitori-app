import { supabase } from "./supabase";
import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
 
/* =========================================================================================
   みんなの買取 / 事業インパクト ダッシュボード
   - Vite + React + TypeScript / 単一ファイル / Tailwind想定（なくてもそれなりに動きます）
   - localStorage永続化 / CSV import-export
   ========================================================================================= */
 
/* ---------- 型 ---------- */
type Status = "active" | "scheduled" | "suspended" | "withdrawn";
type ChangeType =
  | "withdraw"
  | "suspend"
  | "resume"
  | "activate"
  | "reduce"
  | "category_stop"
  | "area_reduce"
  | "brand_stop"
  | "cross_sell"
  | "up_sell"
  | "down_sell"
  | "category_change"
  | "area_change";
  
type RecoveryPossibility = "high" | "medium" | "low" | "none" | "unknown";

type ViewKey =
  | "dashboard"
  | "clients"
  | "input-choice"
  | "register"
  | "change"
  | "metrics"
  | "cup-analysis"
  | "masters";
 
interface CategoryBudgets {
  [category: string]: number;
}
type EditableCategoryBudgets = {
  [category: string]: number | undefined;
};
interface BrandSelection {
  category: string;
  selectionType: "all" | "partial";
  selectedBrandIds: string[];
}
interface Client {
  billingId: string;
  companyName: string;
  salesOwnerId: string;
  acquisitionDate: string;
  startDate: string;
  monthlyBudget: number;
  leadUnitPrice: number;
  categories: string[];
  categoryBudgets: CategoryBudgets;
  brandSelections: BrandSelection[];
  areas: string[];
  status: Status;
  note: string;
}
interface ChangeLog {
  changeId: string;
  billingId: string;
  salesOwnerId: string;
  changeType: ChangeType;
  declaredDate: string;
  effectiveDate: string;
  endDate?: string;
  affectedCategories: string[];
  affectedBrands: string[];
  affectedAreas: string[];
  previousMonthlyBudget: number;
  newMonthlyBudget: number;
  decreasedBudget: number;
  decreasedByCategory?: CategoryBudgets;
  reason: string;
  recoveryPossibility: RecoveryPossibility;
  action: string;
  newCategories?: string[];
  newAreas?: string[];
  newCategoryBudgets?: CategoryBudgets;
  newBrandSelections?: BrandSelection[];
}
interface BusinessMetric {
  month: string;
  category: string;
  revenue: number;
  grossProfit: number;
  adCost: number;
  cv: number;
  validUsers: number;
  targetRevenue?: number;
  targetGrossProfit?: number;
  targetCUP?: number;
}
interface SalesOwner {
  ownerId: string;
  ownerName: string;
  isActive: boolean;
}
interface BrandMaster {
  brandId: string;
  category: string;
  brandName: string;
  isActive: boolean;
}
 
/* ---------- 定数 ---------- */
const CATEGORIES = ["時計", "バッグ", "宝石", "骨董", "カメラ", "楽器", "貴金属", "酒"] as const;
const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県",
  "埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県",
  "岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
  "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県",
];
const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  withdraw: "退会",
  suspend: "停止",
  resume: "再開",
  activate: "配信中に変更",
  reduce: "減額",
  category_stop: "商材停止",
  area_reduce: "エリア縮小",
  brand_stop: "ブランド停止",
  cross_sell: "クロスセル",
  up_sell: "アップセル",
  down_sell: "ダウンセル",
  category_change: "商材変更",
  area_change: "エリア変更",
};
const RECOVERY_LABEL: Record<RecoveryPossibility, string> = {
  high: "高",
  medium: "中",
  low: "低",
  none: "なし",
  unknown: "未定",
};
 
/* ---------- 共通CSSクラス ---------- */
const css = {
  card: "bg-white rounded-lg border border-slate-200 shadow-sm",
  cardHeader: "px-4 py-3 border-b border-slate-200 font-semibold",
  cardBody: "p-4",
  btn: "inline-flex items-center px-3 py-1.5 rounded border border-slate-900 bg-slate-900 text-white text-sm hover:opacity-90 disabled:opacity-50",
  btnOutline:
    "inline-flex items-center px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-900 text-sm hover:bg-slate-50",
  btnGhost:
    "inline-flex items-center px-3 py-1.5 rounded text-slate-900 text-sm hover:bg-slate-100",
  input:
    "border border-slate-300 rounded px-2 py-1 text-sm w-full bg-white outline-none focus:border-slate-500",
  label: "text-sm text-slate-700",
  table: "w-full text-sm border-collapse",
  th: "text-left p-2 border-b border-slate-200 font-medium text-slate-600 bg-slate-50",
  td: "p-2 border-b border-slate-100 align-top",
  badge: "inline-block text-xs px-2 py-0.5 rounded border border-slate-300 bg-white",
};
 
/* ---------- ヘルパ ---------- */
const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString();
const yenSigned = (n: number) => {
  if (n >= 0) return "+" + yen(n);
  return "−" + yen(Math.abs(n));
};
const pct = (n: number) => (isFinite(n) ? (n * 100).toFixed(1) + "%" : "—");
const prev3Months = (targetMonth: string) => {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const arr: string[] = [];
  for (let i = 3; i >= 1; i--) {
    const d = new Date(year, month - 1 - i, 1);
    arr.push(monthKeyOfDate(d));
  }
  return arr;
};
const prevMonth = (targetMonth: string) => {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const d = new Date(year, month - 2, 1);
  return monthKeyOfDate(d);
};
const todayMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const daysInMonth = (year: number, month1: number) =>
  new Date(year, month1, 0).getDate();
const parseD = (s?: string) => (s ? new Date(s + "T00:00:00") : null);
const monthKeyOfDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const uid = () => Math.random().toString(36).slice(2, 10);

interface WeeklyForecastSnapshot {
  revenue: number;
  grossProfit: number;
  validUsers: number;
  cup: number | null;
}
interface WeeklyForecastEntry {
  id: string;
  month: string;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  updatedAt: string;
  overall: WeeklyForecastSnapshot;
  byCategory: Record<string, WeeklyForecastSnapshot>;
  impact: {
    newAcq: number;
    withdraw: number;
    suspendLoss: number;
    otherDec: number;
    net: number;
  };
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function getMonthWeeks(targetMonth: string) {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const dim = daysInMonth(year, month);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month - 1, dim);
  const weeks: { weekLabel: string; start: Date; end: Date }[] = [];

  const firstWeekEnd = new Date(monthStart);
  const offset = (7 - monthStart.getDay()) % 7;
  firstWeekEnd.setDate(monthStart.getDate() + offset);
  if (firstWeekEnd > monthEnd) firstWeekEnd.setTime(monthEnd.getTime());
  weeks.push({ weekLabel: "第1週", start: monthStart, end: firstWeekEnd });

  let nextStart = new Date(firstWeekEnd);
  nextStart.setDate(firstWeekEnd.getDate() + 1);
  let weekIndex = 2;
  while (nextStart <= monthEnd) {
    const nextEnd = new Date(nextStart);
    nextEnd.setDate(nextStart.getDate() + 6);
    if (nextEnd > monthEnd) nextEnd.setTime(monthEnd.getTime());
    weeks.push({
      weekLabel: `第${weekIndex}週`,
      start: new Date(nextStart),
      end: nextEnd,
    });
    weekIndex++;
    nextStart = new Date(nextEnd);
    nextStart.setDate(nextEnd.getDate() + 1);
  }

  return weeks;
}

function getWeekForDate(date: Date, targetMonth: string) {
  const weeks = getMonthWeeks(targetMonth);
  const t = new Date(date);
  t.setHours(0, 0, 0, 0);
  const found = weeks.find((w) => {
    const start = new Date(w.start);
    const end = new Date(w.end);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return start <= t && t <= end;
  });
  return found ?? weeks[weeks.length - 1];
}

const initCatRecord = () =>
  CATEGORIES.reduce((acc, c) => {
    acc[c] = 0;
    return acc;
  }, {} as Record<string, number>);

function calcSuspendDecreaseForMonth(
  log: ChangeLog,
  targetMonth: string,
  budgets: CategoryBudgets
) {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const dim = daysInMonth(year, month);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month - 1, dim);
  const eff = parseD(log.effectiveDate);
  if (!eff) return initCatRecord();

  const endSus = parseD(log.endDate || "") || null;
  const effMonthKey = monthKeyOfDate(eff);
  const next = new Date(eff.getFullYear(), eff.getMonth() + 1, 1);
  const nextKey = monthKeyOfDate(next);
  const cats = log.affectedCategories?.length
    ? log.affectedCategories
    : [...CATEGORIES];
  const result = initCatRecord();

  if (effMonthKey === targetMonth) {
    if (eff.getDate() === dim) return result;
    const cappedEnd = endSus && endSus < monthEnd ? endSus : monthEnd;
    const days = Math.max(
      0,
      Math.floor((cappedEnd.getTime() - eff.getTime()) / 86400000)
    );
    const ratio = days / dim;
    if (ratio <= 0) return result;
    for (const cat of cats) {
      result[cat] += (budgets[cat] ?? 0) * ratio;
    }
  } else if (nextKey === targetMonth) {
    if (!endSus || endSus >= monthStart) {
      for (const cat of cats) {
        result[cat] += budgets[cat] ?? 0;
      }
    }
  }

  return result;
}

function shouldCountNewStartImpact(
  client: Client,
  changeLogs: ChangeLog[],
  sd: Date
) {
  return !changeLogs.some((log) => {
    if (log.billingId !== client.billingId) return false;
    if (log.changeType !== "withdraw" && log.changeType !== "suspend") return false;
    const eff = parseD(log.effectiveDate);
    return eff ? eff <= sd : false;
  });
}


 
/* ---------- CSV ---------- */
function toCSV(rows: any[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(
    rows.reduce<Set<string>>((s, r) => {
      Object.keys(r).forEach((k) => s.add(k));
      return s;
    }, new Set())
  );
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    headers.join(",") +
    "\n" +
    rows.map((r) => headers.map((h) => escape(r[h])).join(",")).join("\n")
  );
}
function parseCSV(text: string): any[] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === ",") {
          out.push(cur);
          cur = "";
        } else if (c === '"') inQ = true;
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseLine(l);
    const obj: any = {};
    headers.forEach((h, i) => {
      let v: any = cells[i];
      if (v === "") v = "";
      else if (v && (v.startsWith("{") || v.startsWith("["))) {
        try {
          v = JSON.parse(v);
        } catch {}
      } else if (v && !isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) {
        v = Number(v);
      }
      obj[h] = v;
    });
    return obj;
  });
}
function downloadCSV(filename: string, rows: any[]) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
 
/* ---------- 月次状態スナップショット計算 ---------- */
interface MonthlySnapshot {
  totalBudget: number;
  totalBudgetByCat: Record<string, number>;
  activeClients: Client[];
  newAcq: Record<string, number>;
  withdraw: Record<string, number>;
  suspendLoss: Record<string, number>;
  otherDec: Record<string, number>;
}
function calcMonthlySnapshot(
  targetMonth: string,
  clients: Client[],
  changeLogs: ChangeLog[]
): MonthlySnapshot {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const dim = daysInMonth(year, month);
  const monthEnd = new Date(year, month - 1, dim);

  const activeClients: Client[] = [];

  for (const c of clients) {
    if (c.status !== "active") continue;
    const sd = parseD(c.startDate);
    if (!sd || sd > monthEnd) continue;

    // 退会チェック
    let withdrawn = false;
    for (const log of changeLogs) {
      if (log.billingId !== c.billingId) continue;
      if (log.changeType === "withdraw") {
        const eff = parseD(log.effectiveDate);
        if (eff && eff <= monthEnd) {
          withdrawn = true;
          break;
        }
      }
    }
    if (withdrawn) continue;

    // 停止チェック（当月中に停止していないか）
    let suspended = false;
    for (const log of changeLogs) {
      if (log.billingId !== c.billingId) continue;
      if (log.changeType === "suspend") {
        const eff = parseD(log.effectiveDate);
        if (eff && eff <= monthEnd) {
          suspended = true;
          break;
        }
      }
    }
    if (suspended) continue;

    activeClients.push(c);
  }

  const totalBudgetByCat = initCatRecord();
  let totalBudget = 0;
  for (const c of activeClients) {
    for (const cat of CATEGORIES) {
      const b = c.categoryBudgets?.[cat] ?? 0;
      totalBudgetByCat[cat] += b;
      totalBudget += b;
    }
  }

  // ── インパクト計算 ──
  const newAcq = initCatRecord();
  const withdraw = initCatRecord();
  const suspendLoss = initCatRecord();
  const otherDec = initCatRecord();

  // 新規
  for (const c of clients) {
    if (c.status !== "active") continue;
    const sd = parseD(c.startDate);
    if (!sd || sd.getFullYear() !== year || sd.getMonth() + 1 !== month) continue;
    for (const cat of CATEGORIES) {
      newAcq[cat] += c.categoryBudgets?.[cat] ?? 0;
    }
  }

  // 退会・停止・減額
  for (const log of changeLogs) {
    const eff = parseD(log.effectiveDate);
    if (!eff || eff.getFullYear() !== year || eff.getMonth() + 1 !== month) continue;
    const c = clients.find((x) => x.billingId === log.billingId);
    if (!c) continue;
    if (log.changeType === "withdraw") {
      for (const cat of CATEGORIES) {
        withdraw[cat] += c.categoryBudgets?.[cat] ?? 0;
      }
    } else if (log.changeType === "suspend") {
      for (const cat of CATEGORIES) {
        suspendLoss[cat] += c.categoryBudgets?.[cat] ?? 0;
      }
    } else if (log.changeType === "reduce") {
      // 減額の場合、影響カテゴリとブランドで絞る
      const affectedCats = log.affectedCategories?.length ? log.affectedCategories : c.categories;
      for (const cat of affectedCats) {
        otherDec[cat] += c.categoryBudgets?.[cat] ?? 0;
      }
    }
  }

  return { totalBudget, totalBudgetByCat, activeClients, newAcq, withdraw, suspendLoss, otherDec };
}

/* ---------- 今月着地予想 ---------- */
interface MonthlyForecast {
  currentRevenue: number;
  baseForecastRevenue: number;
  additionalImpact: number;
  newStartImpact: number;
  resumeImpact: number;
  stopRevenue: number;
  withdrawRevenue: number;
  reduceRevenue: number;
  revenue: number;
  grossProfit: number;
  cup: number | null;
  grossRate: number;
  expectedVU: number;
}

function calcMonthlyForecast(
  targetMonth: string,
  clients: Client[],
  changeLogs: ChangeLog[],
  metrics: BusinessMetric[],
  targetCategories: string[]
): MonthlyForecast {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const dim = daysInMonth(year, month);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isCurrentMonth = targetMonth === todayMonth();
  // 事業数字は「前日締め」で入力される想定。
  // 例：5/8に見る数字は5/7時点実績なので、経過日数は7日。
  const elapsedDays = isCurrentMonth
    ? Math.min(Math.max(today.getDate() - 1, 1), dim)
    : dim;

  // 当月の場合、実績締め日 = 今日の前日、未反映開始日 = 今日
  const unreflectedStartDate = isCurrentMonth ? today : null;

  const monthMetrics = metrics.filter(
    (m) => m.month === targetMonth && targetCategories.includes(m.category)
  );

  const currentRevenue = monthMetrics.reduce((s, m) => s + m.revenue, 0);
  const currentVU = monthMetrics.reduce((s, m) => s + m.validUsers, 0);

  const metricsWithGross = monthMetrics.filter(
    (m) => m.revenue > 0 && m.grossProfit > 0
  );

  const currentGrossRate =
    metricsWithGross.length > 0
      ? metricsWithGross.reduce((s, m) => s + m.grossProfit, 0) /
        metricsWithGross.reduce((s, m) => s + m.revenue, 0)
      : null;

  const grossRate =
    currentGrossRate ??
    calcAvgGrossRate(targetMonth, targetCategories, metrics) ??
    0.3;

  const baseForecastRevenue =
    currentRevenue > 0 ? (currentRevenue / elapsedDays) * dim : 0;

  const expectedVU =
    currentVU > 0
      ? isCurrentMonth
        ? (currentVU / elapsedDays) * dim
        : currentVU
      : targetCategories.reduce(
          (s, cat) => s + (calcMonthlyOrAvgValidUsers(targetMonth, cat, metrics) || 0),
          0
        );

  const sumBudget = (client: Client) =>
    Object.entries(client.categoryBudgets || {})
      .filter(([cat]) => targetCategories.includes(cat))
      .reduce((s, [, v]) => s + Number(v || 0), 0);

  // 日割り計算：当月の場合は未反映期間のみを対象にする
  const prorateFrom = (dateStr: string, amount: number) => {
    const d = parseD(dateStr);
    if (!d) return 0;
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) return 0;

    if (isCurrentMonth && unreflectedStartDate) {
      // 有効日が未反映開始日より前なら、未反映開始日から計算
      const effectiveDate = new Date(d);
      const startDateForProration =
        effectiveDate < unreflectedStartDate ? unreflectedStartDate : effectiveDate;

      // 開始日が月末以降なら、日割りなし
      if (startDateForProration.getDate() > dim) return 0;

      const activeDays = dim - startDateForProration.getDate() + 1;
      return amount * (activeDays / dim);
    } else {
      // 過去月・未来月の場合は既存の動作
      const activeDays = dim - d.getDate() + 1;
      return amount * (activeDays / dim);
    }
  };

  let newStartImpact = 0;
  let resumeImpact = 0;
  let stopRevenue = 0;
  let withdrawRevenue = 0;
  let reduceRevenue = 0;

  for (const client of clients) {
    const monthlyBudget = sumBudget(client);
    if (monthlyBudget <= 0) continue;

    const sd = parseD(client.startDate);
    if (
      sd &&
      sd.getFullYear() === year &&
      sd.getMonth() + 1 === month &&
      shouldCountNewStartImpact(client, changeLogs, sd)
    ) {
      newStartImpact += prorateFrom(client.startDate, monthlyBudget);
    }

    for (const log of changeLogs.filter((l) => l.billingId === client.billingId)) {
      const eff = parseD(log.effectiveDate);
      if (!eff) continue;
      if (eff.getFullYear() !== year || eff.getMonth() + 1 !== month) continue;

      if (log.changeType === "resume" || log.changeType === "activate") {
        resumeImpact += prorateFrom(log.effectiveDate, monthlyBudget);
      }

      if (log.changeType === "suspend") {
        stopRevenue += prorateFrom(log.effectiveDate, monthlyBudget);
      }

      if (log.changeType === "withdraw") {
        withdrawRevenue += prorateFrom(log.effectiveDate, monthlyBudget);
      }

      if (
        log.changeType === "reduce" ||
        log.changeType === "down_sell" ||
        log.changeType === "category_stop" ||
        log.changeType === "area_reduce" ||
        log.changeType === "brand_stop"
      ) {
        const decreased = Object.entries(log.decreasedByCategory || {})
          .filter(([cat]) => targetCategories.includes(cat))
          .reduce((s, [, v]) => s + Number(v || 0), 0);

        reduceRevenue += prorateFrom(
          log.effectiveDate,
          decreased || log.decreasedBudget || 0
        );
      }
    }
  }

  const additionalImpact =
    newStartImpact + resumeImpact - stopRevenue - withdrawRevenue - reduceRevenue;

  const forecastRevenue = baseForecastRevenue + additionalImpact;
  const forecastGrossProfit = forecastRevenue * grossRate;
  const forecastUnitPrice = expectedVU > 0 ? forecastRevenue / expectedVU : null;

  return {
    currentRevenue,
    baseForecastRevenue,
    additionalImpact,
    newStartImpact,
    resumeImpact,
    stopRevenue,
    withdrawRevenue,
    reduceRevenue,
    revenue: forecastRevenue,
    grossProfit: forecastGrossProfit,
    cup: forecastUnitPrice,
    grossRate,
    expectedVU,
  };
}

function calcMonthlyForecastByCategory(
  targetMonth: string,
  clients: Client[],
  changeLogs: ChangeLog[],
  metrics: BusinessMetric[],
  targetCategories: string[]
): Record<string, MonthlyForecast> {
  const result: Record<string, MonthlyForecast> = {};
  for (const cat of targetCategories) {
    result[cat] = calcMonthlyForecast(
      targetMonth,
      clients,
      changeLogs,
      metrics,
      [cat]
    );
  }
  return result;
}

/* ---------- 来月ストック予測 ---------- */
interface MonthlyStockForecast {
  thisMonthStock: number;
  nextMonthStock: number;
  stockDiff: number;
  revenue: number;
  grossProfit: number;
  cup: number | null;
}
function calcNextMonthForecast(
  targetMonth: string,
  clients: Client[],
  changeLogs: ChangeLog[],
  metrics: BusinessMetric[],
  targetCategories: string[],
  currentForecast: MonthlyForecast
): MonthlyStockForecast {
  const nextMonth = monthKeyOfDate(
    new Date(
      +targetMonth.split("-")[0],
      +targetMonth.split("-")[1] - 1 + 1,
      1
    )
  );

  const thisMonthStock = calcMonthlyStockBudget(
    targetMonth,
    clients,
    changeLogs,
    targetCategories
  ).stockBudget;
  const nextMonthStock = calcMonthlyStockBudget(
    nextMonth,
    clients,
    changeLogs,
    targetCategories
  ).stockBudget;

  const landing = calcMonthlyForecast(
    targetMonth,
    clients,
    changeLogs,
    metrics,
    targetCategories
  );

  const stockDiff = nextMonthStock - thisMonthStock;
  const forecastRevenue = landing.revenue + stockDiff;
  const finalVU = currentForecast.expectedVU;
  const grossRate = calcAvgGrossRate(nextMonth, targetCategories, metrics) ?? 0.3;

  return {
    thisMonthStock,
    nextMonthStock,
    stockDiff,
    revenue: forecastRevenue,
    grossProfit: forecastRevenue * grossRate,
    cup: finalVU > 0 ? forecastRevenue / finalVU : null,
  };
}

interface ClientImpact {
  billingId: string;
  companyName: string;
  status: Status;
  categories: string[];
  newAcq: number;
  withdraw: number;
  suspendLoss: number;
  otherDec: number;
  net: number;
  detail: string;
}

function calcClientImpact(
  targetMonth: string,
  client: Client,
  changeLogs: ChangeLog[]
): ClientImpact {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const dim = daysInMonth(year, month);
  const budgets = client.categoryBudgets || {};

  let newAcq = 0;
  let withdraw = 0;
  let suspendLoss = 0;
  let otherDec = 0;

  const sd = parseD(client.startDate);
  if (
    sd &&
    sd.getFullYear() === year &&
    sd.getMonth() + 1 === month &&
    shouldCountNewStartImpact(client, changeLogs, sd)
  ) {
    const ratio = (dim - sd.getDate() + 1) / dim;
    for (const cat of CATEGORIES) {
      newAcq += (budgets[cat] ?? 0) * ratio;
    }
  }

  for (const log of changeLogs.filter((l) => l.billingId === client.billingId)) {
    const eff = parseD(log.effectiveDate);
    if (!eff) continue;
    const effMonthKey = monthKeyOfDate(eff);
    const isLastDay =
      eff.getDate() === daysInMonth(eff.getFullYear(), eff.getMonth() + 1);
    const next = new Date(eff.getFullYear(), eff.getMonth() + 1, 1);
    const nextKey = monthKeyOfDate(next);

    if (log.changeType === "withdraw") {
      if (effMonthKey === targetMonth) {
        if (!isLastDay) {
          const remaining = dim - eff.getDate();
          const ratio = remaining / dim;
          for (const cat of CATEGORIES) {
            withdraw += (budgets[cat] ?? 0) * ratio;
          }
        }
      } else if (nextKey === targetMonth) {
        for (const cat of CATEGORIES) {
          withdraw += budgets[cat] ?? 0;
        }
      }
    } else if (log.changeType === "suspend") {
      const save = calcSuspendDecreaseForMonth(log, targetMonth, budgets);
      suspendLoss += Object.values(save).reduce((sum, v) => sum + v, 0);
    } else {
      if (effMonthKey === targetMonth) {
        const ratio = (dim - eff.getDate()) / dim;
        if (log.decreasedByCategory) {
          for (const [, v] of Object.entries(log.decreasedByCategory)) {
            otherDec += (v as number) * ratio;
          }
        } else {
          const cats = log.affectedCategories?.length
            ? log.affectedCategories
            : [...CATEGORIES];
          const per = log.decreasedBudget / Math.max(1, cats.length);
          for (const _cat of cats) otherDec += per * ratio;
        }
      } else if (nextKey === targetMonth) {
        if (log.decreasedByCategory) {
          for (const [, v] of Object.entries(log.decreasedByCategory)) {
            otherDec += v as number;
          }
        } else {
          const cats = log.affectedCategories?.length
            ? log.affectedCategories
            : [...CATEGORIES];
          const per = log.decreasedBudget / Math.max(1, cats.length);
          for (const _cat of cats) otherDec += per;
        }
      }
    }
  }

  const net = newAcq - withdraw - suspendLoss - otherDec;
  const details: string[] = [];
  if (newAcq > 0) details.push(`新規 +${yen(newAcq)}`);
  if (withdraw > 0) details.push(`退会 -${yen(withdraw)}`);
  if (suspendLoss > 0) details.push(`停止 -${yen(suspendLoss)}`);
  if (otherDec > 0) details.push(`減額 -${yen(otherDec)}`);

  return {
    billingId: client.billingId,
    companyName: client.companyName,
    status: client.status,
    categories: client.categories,
    newAcq,
    withdraw,
    suspendLoss,
    otherDec,
    net,
    detail: details.join(" / ") || "—",
  };
}
/* ---------- 営業別サマリー ---------- */
interface OwnerSummary {
  ownerId: string;
  ownerName: string;
  newCount: number;
  newBudget: number;
  withdrawCount: number;
  withdrawBudget: number;
  suspendCount: number;
  suspendLossBudget: number;
  suspendLossGross: number;
  otherDec: number;
  net: number;
  stockBudget: number;
  activeClients: number;
  scheduledWithdraw: number;
  suspendWithRecovery: number;
  suspendNoRecovery: number;
  topClients: string[];
}
function calcOwnerSummary(
  targetMonth: string,
  clients: Client[],
  changeLogs: ChangeLog[],
  owners: SalesOwner[],
  metrics: BusinessMetric[]
): OwnerSummary[] {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const dim = daysInMonth(year, month);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month - 1, dim);

  const monthMetrics = metrics.filter((m) => m.month === targetMonth);
  const totalRev = monthMetrics.reduce((s, m) => s + m.revenue, 0);
  const totalGP = monthMetrics.reduce((s, m) => s + m.grossProfit, 0);
  const grossRate = totalRev > 0 ? totalGP / totalRev : 0.3;

  const result: OwnerSummary[] = owners.map((o) => ({
    ownerId: o.ownerId,
    ownerName: o.ownerName,
    newCount: 0,
    newBudget: 0,
    withdrawCount: 0,
    withdrawBudget: 0,
    suspendCount: 0,
    suspendLossBudget: 0,
    suspendLossGross: 0,
    otherDec: 0,
    net: 0,
    stockBudget: 0,
    activeClients: 0,
    scheduledWithdraw: 0,
    suspendWithRecovery: 0,
    suspendNoRecovery: 0,
    topClients: [],
  }));
  const idx: Record<string, OwnerSummary> = {};
  result.forEach((r) => (idx[r.ownerId] = r));

  // 新規（active の加盟店のみ）
  for (const c of clients) {
    if (c.status !== "active") continue;
    const sd = parseD(c.startDate);
    if (!sd) continue;
    const o = idx[c.salesOwnerId];
    if (!o) continue;
    if (sd.getFullYear() === year && sd.getMonth() + 1 === month) {
      const day = sd.getDate();
      const ratio = (dim - day + 1) / dim;
      const total = Object.values(c.categoryBudgets || {}).reduce(
        (s, v) => s + (v as number),
        0
      );
      o.newCount += 1;
      o.newBudget += total * ratio;
      o.topClients.push(c.companyName);
    }
  }

  // 保持（active の加盟店のみ）
  for (const c of clients) {
    if (c.status !== "active") continue;
    const sd = parseD(c.startDate);
    if (!sd) continue;
    if (sd > monthEnd) continue;
    const o = idx[c.salesOwnerId];
    if (!o) continue;
    let withdrawnBefore = false;
    for (const log of changeLogs) {
      if (log.billingId !== c.billingId) continue;
      if (log.changeType === "withdraw") {
        const eff = parseD(log.effectiveDate);
        if (eff && eff < monthStart) {
          withdrawnBefore = true;
          break;
        }
      }
    }
    if (withdrawnBefore) continue;
    const total = Object.values(c.categoryBudgets || {}).reduce(
      (s, v) => s + (v as number),
      0
    );
    o.stockBudget += total;
    o.activeClients += 1;
  }

  // 変更ログ
  for (const log of changeLogs) {
    const o = idx[log.salesOwnerId];
    if (!o) continue;
    const eff = parseD(log.effectiveDate);
    if (!eff) continue;
    const effMonthKey = monthKeyOfDate(eff);
    const cl = clients.find((c) => c.billingId === log.billingId);
    const budgets = cl?.categoryBudgets ?? {};
    const totalBudget = Object.values(budgets).reduce(
      (s, v) => s + (v as number),
      0
    );
    const isLastDay =
      eff.getDate() === daysInMonth(eff.getFullYear(), eff.getMonth() + 1);
    const next = new Date(eff.getFullYear(), eff.getMonth() + 1, 1);
    const nextKey = monthKeyOfDate(next);

    if (log.changeType === "withdraw") {
      if (eff >= monthStart) o.scheduledWithdraw += 1;
      // 退会：当月日割り or 翌月満額のみ
      if (effMonthKey === targetMonth) {
        if (!isLastDay) {
          const remaining = dim - eff.getDate();
          o.withdrawCount += 1;
          o.withdrawBudget += totalBudget * (remaining / dim);
        }
      } else if (nextKey === targetMonth) {
        o.withdrawCount += 1;
        o.withdrawBudget += totalBudget;
      }
    } else if (log.changeType === "suspend") {
      const save = calcSuspendDecreaseForMonth(log, targetMonth, budgets);
      const lostBudget = Object.values(save).reduce((sum, v) => sum + v, 0);
      if (lostBudget > 0) {
        o.suspendCount += 1;
        o.suspendLossBudget += lostBudget;
        o.suspendLossGross += lostBudget * grossRate;
        if (
          log.recoveryPossibility === "high" ||
          log.recoveryPossibility === "medium"
        )
          o.suspendWithRecovery += 1;
        else o.suspendNoRecovery += 1;
      }
    } else {
      // 減額系：当月日割り or 翌月満額のみ
      let dec = 0;
      if (effMonthKey === targetMonth) {
        const days = dim - eff.getDate();
        const ratio = days / dim;
        dec = log.decreasedBudget * ratio;
      } else if (nextKey === targetMonth) {
        dec = log.decreasedBudget;
      }
      o.otherDec += dec;
    }
  }

  for (const o of result) {
    o.net = o.newBudget - o.withdrawBudget - o.suspendLossBudget - o.otherDec;
    o.topClients = o.topClients.slice(0, 3);
  }
  return result;
}

/* ---------- 直近3ヶ月平均：有効ユーザー数 / 顧客単価 ---------- */
function calcAvgValidUsers(
  targetMonth: string,
  category: string | null,
  metrics: BusinessMetric[]
): number | null {
  const months = prev3Months(targetMonth);
  const vals: number[] = [];
  for (const k of months) {
    const m = metrics.find(
      (x) => x.month === k && (category === null || x.category === category)
    );
    if (m && m.validUsers > 0) vals.push(m.validUsers);
  }
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function calcAvgCUP(
  targetMonth: string,
  category: string | null,
  metrics: BusinessMetric[]
): number | null {
  const months = prev3Months(targetMonth);
  let sumRev = 0;
  let sumVU = 0;
  for (const k of months) {
    const m = metrics.find(
      (x) => x.month === k && (category === null || x.category === category)
    );
    if (m && m.validUsers > 0) {
      sumRev += m.revenue;
      sumVU += m.validUsers;
    }
  }
  if (sumVU === 0) return null;
  return sumRev / sumVU;
}

function calcMonthlyValidUsers(
  targetMonth: string,
  category: string | null,
  metrics: BusinessMetric[]
): number | null {
  const monthMetrics = metrics.filter(
    (m) => m.month === targetMonth && (category === null || m.category === category)
  );
  if (monthMetrics.length === 0) return null;
  return monthMetrics.reduce((s, m) => s + m.validUsers, 0);
}

function calcMonthlyCUP(
  targetMonth: string,
  category: string | null,
  metrics: BusinessMetric[]
): number | null {
  const monthMetrics = metrics.filter(
    (m) => m.month === targetMonth && (category === null || m.category === category)
  );
  if (monthMetrics.length === 0) return null;
  const totalRev = monthMetrics.reduce((s, m) => s + m.revenue, 0);
  const totalVU = monthMetrics.reduce((s, m) => s + m.validUsers, 0);
  return totalVU > 0 ? totalRev / totalVU : null;
}

function calcMonthlyCUPByCategories(
  targetMonth: string,
  categories: string[],
  metrics: BusinessMetric[]
): number | null {
  const monthMetrics = metrics.filter(
    (m) => m.month === targetMonth && categories.includes(m.category)
  );
  if (monthMetrics.length === 0) return null;
  const totalRev = monthMetrics.reduce((s, m) => s + m.revenue, 0);
  const totalVU = monthMetrics.reduce((s, m) => s + m.validUsers, 0);
  return totalVU > 0 ? totalRev / totalVU : null;
}

function calcMonthlyStockBudget(
  targetMonth: string,
  clients: Client[],
  changeLogs: ChangeLog[],
  targetCategories: string[]
): { stockBudget: number; stockBudgetByCat: Record<string, number> } {
  const [yStr, mStr] = targetMonth.split("-");
  const year = +yStr;
  const month = +mStr;
  const dim = daysInMonth(year, month);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month - 1, dim);

  const stockBudgetByCat = initCatRecord();
  let stockBudget = 0;

  for (const client of clients) {
    const budgets = Object.entries(client.categoryBudgets || {})
      .filter(([cat]) => targetCategories.includes(cat))
      .reduce((s, [, v]) => s + (v as number), 0);
    if (budgets <= 0) continue;

    const sd = parseD(client.startDate);
    if (!sd || sd > monthEnd) continue;

    const logs = changeLogs
      .filter((l) => l.billingId === client.billingId)
      .map((l) => ({
        ...l,
        eff: parseD(l.effectiveDate),
      }))
      .filter((l) => l.eff && l.eff <= monthEnd)
      .sort((a, b) => a.eff!.getTime() - b.eff!.getTime());

    const budgetByDay = Array(dim + 1).fill(0);
    const startDay = sd < monthStart ? 1 : sd.getDate();
    const startReference = sd < monthStart ? monthStart : sd;
    const stopBeforeStart = logs.some(
      (log) =>
        (log.changeType === "withdraw" || log.changeType === "suspend") &&
        log.eff! <= startReference
    );
    if (!stopBeforeStart) {
      for (let d = startDay; d <= dim; d++) {
        budgetByDay[d] = budgets;
      }
    }

    for (const log of logs) {
      if (!log.eff) continue;
      const effDay = log.eff < monthStart ? 1 : log.eff.getDate();
      if (log.changeType === "withdraw" || log.changeType === "suspend") {
        for (let d = effDay; d <= dim; d++) {
          budgetByDay[d] = 0;
        }
      } else if (log.changeType === "resume" || log.changeType === "activate") {
        for (let d = effDay; d <= dim; d++) {
          budgetByDay[d] = budgets;
        }
      } else if (log.changeType === "reduce") {
        const decreased = Object.entries(log.decreasedByCategory || {})
          .filter(([cat]) => targetCategories.includes(cat))
          .reduce((s, [, v]) => s + (v as number), 0);
        const reducedBudget = decreased || log.decreasedBudget || 0;
        for (let d = effDay; d <= dim; d++) {
          budgetByDay[d] = Math.max(0, budgetByDay[d] - reducedBudget);
        }
      }
    }

    const monthlyTotal = budgetByDay.slice(1).reduce((s, v) => s + v, 0) / dim;
    stockBudget += monthlyTotal;
    for (const [cat, b] of Object.entries(client.categoryBudgets || {})) {
      if (!targetCategories.includes(cat)) continue;
      const ratio = budgets > 0 ? (b as number) / budgets : 0;
      stockBudgetByCat[cat] += monthlyTotal * ratio;
    }
  }

  return { stockBudget, stockBudgetByCat };
}

function calcMonthlyOrAvgValidUsers(
  targetMonth: string,
  category: string | null,
  metrics: BusinessMetric[]
): number | null {
  return (
    calcMonthlyValidUsers(targetMonth, category, metrics) ||
    calcAvgValidUsers(targetMonth, category, metrics)
  );
}

function calcMonthlyOrAvgCUP(
  targetMonth: string,
  category: string | null,
  metrics: BusinessMetric[]
): number | null {
  return (
    calcMonthlyCUP(targetMonth, category, metrics) ||
    calcAvgCUP(targetMonth, category, metrics)
  );
}

function calcAvgGrossRate(
  targetMonth: string,
  categories: string[],
  metrics: BusinessMetric[]
): number | null {
  const months = prev3Months(targetMonth);
  let totalRev = 0;
  let totalGP = 0;
  for (const k of months) {
    for (const cat of categories) {
      const m = metrics.find((x) => x.month === k && x.category === cat);
      if (m && m.revenue > 0) {
        totalRev += m.revenue;
        totalGP += m.grossProfit;
      }
    }
  }
  return totalRev > 0 ? totalGP / totalRev : null;
}

/* ---------- 未来12ヶ月の商材別 顧客単価インパクト ---------- */
interface FutureMonth {
  month: string;
  newAcq: number;
  decrease: number;
  net: number;
  cupDelta: number | null;
  expectedCUP: number | null;
  drivers: string[]; // 主な要因加盟店（会社名）
  comment: string;
}
interface FutureSummary {
  cat: string;
  avgVU: number | null;
  avgCUP: number | null;
  nextChangeMonth: string | null;
  nextCUPDelta: number | null;
  fullEffectMonth: string | null;
  fullCUPDelta: number | null;
  fullExpectedCUP: number | null;
  topDrivers: string[];
  judge: "攻める" | "維持" | "抑制" | "要営業補填" | "—";
  months: FutureMonth[];
}
function calcFutureCUPSummary(
  cat: string,
  targetMonth: string,
  clients: Client[],
  changeLogs: ChangeLog[],
  metrics: BusinessMetric[]
): FutureSummary {
  const avgVU = calcMonthlyOrAvgValidUsers(targetMonth, cat, metrics);
  const avgCUP = calcMonthlyOrAvgCUP(targetMonth, cat, metrics);
  const [yStr, mStr] = targetMonth.split("-");
  const baseY = +yStr;
  const baseM = +mStr;

  const months: FutureMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(baseY, baseM - 1 + i, 1);
    const k = monthKeyOfDate(d);
    const im = calcMonthlySnapshot(k, clients, changeLogs);
    const newAcq = im.newAcq[cat] || 0;
    const dec =
      (im.withdraw[cat] || 0) +
      (im.suspendLoss[cat] || 0) +
      (im.otherDec[cat] || 0);
    const net = newAcq - dec;
    const cupDelta = avgVU !== null && avgVU > 0 ? net / avgVU : null;
    const expectedCUP =
      avgCUP !== null && cupDelta !== null ? avgCUP + cupDelta : null;

    // 主要要因加盟店：その月のstartDateを持つ＆この商材を扱う
    const driverList: { name: string; budget: number }[] = [];
    for (const c of clients) {
      if (!c.startDate) continue;
      if (!c.categories.includes(cat)) continue;
      const sd = parseD(c.startDate);
      if (!sd) continue;
      if (
        sd.getFullYear() === d.getFullYear() &&
        sd.getMonth() === d.getMonth()
      ) {
        const b = c.categoryBudgets[cat] || 0;
        if (b > 0) driverList.push({ name: c.companyName, budget: b });
      }
    }
    // 退会・停止系も要因として記録
    for (const log of changeLogs) {
      const eff = parseD(log.effectiveDate);
      if (!eff) continue;
      if (
        eff.getFullYear() === d.getFullYear() &&
        eff.getMonth() === d.getMonth() &&
        (log.changeType === "withdraw" ||
          log.changeType === "suspend" ||
          log.changeType === "category_stop")
      ) {
        const cl = clients.find((c) => c.billingId === log.billingId);
        if (cl && cl.categories.includes(cat)) {
          driverList.push({
            name: `${cl.companyName}(${CHANGE_TYPE_LABEL[log.changeType]})`,
            budget: -(cl.categoryBudgets[cat] || 0),
          });
        }
      }
    }
    driverList.sort((a, b) => Math.abs(b.budget) - Math.abs(a.budget));
    const drivers = driverList.slice(0, 3).map((x) => x.name);

    let comment = "";
    if (cupDelta === null) {
      comment = "算出不可";
    } else if (Math.abs(cupDelta) < 1) {
      comment = "変化なし";
    } else if (cupDelta > 0) {
      comment = `${drivers[0] || "新規獲得"}により${yenSigned(cupDelta)}上昇`;
    } else {
      comment = `${drivers[0] || "減少要因"}により${yenSigned(cupDelta)}低下`;
    }

    months.push({
      month: k,
      newAcq,
      decrease: dec,
      net,
      cupDelta,
      expectedCUP,
      drivers,
      comment,
    });
  }

  // 次に変動する月：cupDeltaが0でない（1円以上）最初の月
  const next = months.find(
    (m) => m.cupDelta !== null && Math.abs(m.cupDelta) >= 1
  );
  // 満額反映月：累積純増が最大化する月（単純化：12ヶ月内で最も絶対値が大きいcupDeltaの月）
  let full: FutureMonth | undefined;
  let maxAbs = 0;
  for (const m of months) {
    if (m.cupDelta !== null && Math.abs(m.cupDelta) > maxAbs) {
      maxAbs = Math.abs(m.cupDelta);
      full = m;
    }
  }

  // 主要ドライバー集約
  const driverFreq: Record<string, number> = {};
  for (const m of months) {
    for (const d of m.drivers) driverFreq[d] = (driverFreq[d] || 0) + 1;
  }
  const topDrivers = Object.entries(driverFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((x) => x[0]);

  // 判定（次回変動の方向で簡易判断）
  let judge: FutureSummary["judge"] = "維持";
  if (next && next.cupDelta !== null) {
    if (next.cupDelta >= 1) judge = "攻める";
    else if (next.cupDelta <= -1) {
      // 退会・停止が要因なら要営業補填
      const totalDec = months.reduce((s, m) => s + m.decrease, 0);
      const totalNew = months.reduce((s, m) => s + m.newAcq, 0);
      judge = totalDec > totalNew ? "要営業補填" : "抑制";
    }
  } else {
    judge = "維持";
  }
  if (avgVU === null) judge = "—";

  return {
    cat,
    avgVU,
    avgCUP,
    nextChangeMonth: next?.month ?? null,
    nextCUPDelta: next?.cupDelta ?? null,
    fullEffectMonth: full?.month ?? null,
    fullCUPDelta: full?.cupDelta ?? null,
    fullExpectedCUP: full?.expectedCUP ?? null,
    topDrivers,
    judge,
    months,
  };
}

/* =========================================================================================
   メインアプリ
   ========================================================================================= */
export default function App() {
  
  const [clients, setClients] = useState<Client[]>([]);
  const [changeLogs, setChangeLogs] = useState<ChangeLog[]>([]);
  const [metrics, setMetrics] = useState<BusinessMetric[]>([]);
  const [owners, setOwners] = useState<SalesOwner[]>([]);
  const [brands, setBrands] = useState<BrandMaster[]>([]);
  const [weeklyForecasts, setWeeklyForecasts] = useState<WeeklyForecastEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
  const load = async () => {
    const { data } = await supabase
      .from("app_state")
      .select("data")
      .eq("id", "main")
      .single();

    if (!data?.data) {
      setLoaded(true);
      return;
    }

    const d = data.data;

    setClients(d.clients || []);
    setChangeLogs(d.changeLogs || []);
    setMetrics(d.metrics || []);
    setOwners(d.owners || []);
    setBrands(d.brands || []);
    setWeeklyForecasts(d.weeklyForecasts || []);

    setLoaded(true);
  };

  load();
}, []);
useEffect(() => {
  if (!loaded) return;
  const save = async () => {
    await supabase.from("app_state").upsert({
      id: "main",
      data: {
        clients,
        changeLogs,
        metrics,
        owners,
        brands,
        weeklyForecasts,
      },
    });
  };

  save();
}, [loaded, clients, changeLogs, metrics, owners, brands, weeklyForecasts]);

useEffect(() => {
  const today = new Date();
  let changed = false;

  const updatedClients = clients.map((c) => {
    if (c.status === "suspended") {
      const match = c.note?.match(/再開予定日：(\d{4}-\d{2}-\d{2})/);
      if (!match) return c;
      const resumeDate = parseD(match[1]);
      if (!resumeDate) return c;
      if (resumeDate <= today) {
        changed = true;
        return {
          ...c,
          status: "active" as Status,
          note: c.note.replace(/再開予定日：\d{4}-\d{2}-\d{2}/, "").trim(),
        };
      }
      return c;
    }

    if (c.status === "scheduled") {
      const sd = parseD(c.startDate);
      if (sd && sd <= today) {
        changed = true;
        return {
          ...c,
          status: "active" as Status,
        };
      }
    }

    return c;
  });

  if (changed) {
    setClients(updatedClients);
  }
}, [clients, setClients]);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [targetMonth, setTargetMonth] = useState<string>(todayMonth());
  const [filterCats, setFilterCats] = useState<string[]>([]); // 空=全選択
  const [filterOwners, setFilterOwners] = useState<string[]>([]); // 空=全選択

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    set.add(targetMonth);
    set.add(todayMonth());
    clients.forEach((c) => c.startDate && set.add(c.startDate.substring(0, 7)));
    changeLogs.forEach(
      (l) => l.effectiveDate && set.add(l.effectiveDate.substring(0, 7))
    );
    metrics.forEach((m) => m.month && set.add(m.month));
    const d = new Date();
    for (let i = -3; i <= 12; i++) {
      const x = new Date(d.getFullYear(), d.getMonth() + i, 1);
      set.add(monthKeyOfDate(x));
    }
    return Array.from(set).sort();
  }, [clients, changeLogs, metrics, targetMonth]);

  const sidebarItems: { key: ViewKey; label: string; icon: string }[] = [
    { key: "dashboard", label: "ダッシュボード", icon: "■" },
    { key: "clients", label: "加盟店一覧", icon: "▤" },
    { key: "input-choice", label: "入力", icon: "+" },
    { key: "metrics", label: "事業数字", icon: "¥" },
    { key: "cup-analysis", label: "顧客単価分析", icon: "◐" },
    { key: "masters", label: "マスタ", icon: "⚙" },
  ];

  // 営業/商材フィルター適用済みのデータ
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      if (filterOwners.length > 0 && !filterOwners.includes(c.salesOwnerId))
        return false;
      if (
        filterCats.length > 0 &&
        !c.categories.some((cat) => filterCats.includes(cat))
      )
        return false;
      return true;
    });
  }, [clients, filterOwners, filterCats]);

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* サイドバー */}
      <aside className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-200 flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-slate-900 text-white grid place-items-center text-sm font-bold">
            MK
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">みんなの買取</div>
            <div className="text-[10px] text-slate-500">
              事業インパクト ダッシュボード
            </div>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {sidebarItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition ${
                view === item.key ||
                (item.key === "input-choice" &&
                  (view === "register" || view === "change"))
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className="w-4 text-center">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-200 text-[10px] text-slate-400">
          {todayMonth()} 時点
        </div>
      </aside>

      {/* メイン */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 上部フィルターバー */}
        {(view === "dashboard" ||
          view === "clients" ||
          view === "cup-analysis") && (
          <header className="bg-white border-b border-slate-200 px-6 py-3">
            <div className="flex items-center gap-4 flex-wrap">
              <FilterField label="対象月">
                <select
                  className={`${css.input} w-32`}
                  value={targetMonth}
                  onChange={(e) => setTargetMonth(e.target.value)}
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="商材">
                <MultiPicker
                  items={CATEGORIES.map((c) => ({ id: c, name: c }))}
                  selected={filterCats}
                  setSelected={setFilterCats}
                  placeholderAll="全商材"
                />
              </FilterField>
              <FilterField label="営業担当">
                <MultiPicker
                  items={owners.map((o) => ({
                    id: o.ownerId,
                    name: o.ownerName,
                  }))}
                  selected={filterOwners}
                  setSelected={setFilterOwners}
                  placeholderAll="全営業"
                />
              </FilterField>
              {(filterCats.length > 0 || filterOwners.length > 0) && (
                <button
                  className="text-xs text-slate-500 hover:underline"
                  onClick={() => {
                    setFilterCats([]);
                    setFilterOwners([]);
                  }}
                >
                  フィルタークリア
                </button>
              )}
            </div>
          </header>
        )}

        <main className="flex-1 px-6 py-6 max-w-[1400px] w-full">
          {view === "dashboard" && (
            <Dashboard
              targetMonth={targetMonth}
              clients={filteredClients}
              changeLogs={changeLogs}
              metrics={metrics}
              owners={owners}
              filterCats={filterCats}
              filterOwners={filterOwners}
              weeklyForecasts={weeklyForecasts}
              setWeeklyForecasts={setWeeklyForecasts}
            />
          )}
          {view === "clients" && (
            <ClientsList
            　metrics={metrics}
              targetMonth={targetMonth}
              clients={filteredClients}
              owners={owners}
              changeLogs={changeLogs}
              setClients={setClients}
   　　　　　　　setChangeLogs={setChangeLogs}
              setView={setView}
            />
          )}
          {view === "input-choice" && <InputChoice setView={setView} />}
          {view === "register" && (
            <RegisterClient
              clients={clients}
              setClients={setClients}
              owners={owners}
              brands={brands}
              onDone={() => setView("dashboard")}
            />
          )}
          {view === "change" && (
            <ChangeForm
              clients={clients}
              owners={owners}
              brands={brands}
              changeLogs={changeLogs}
              setChangeLogs={setChangeLogs}
              setClients={setClients}
              onDone={() => setView("dashboard")}
            />
          )}
          {view === "metrics" && (
            <MetricsForm
              metrics={metrics}
              setMetrics={setMetrics}
              targetMonth={targetMonth}
            />
          )}
          {view === "cup-analysis" && (
            <CUPAnalysis
              targetMonth={targetMonth}
              clients={filteredClients}
              changeLogs={changeLogs}
              metrics={metrics}
              filterCats={filterCats}
              owners={owners}
            />
          )}
          {view === "masters" && (
            <Masters
              owners={owners}
              setOwners={setOwners}
              brands={brands}
              setBrands={setBrands}
              clients={clients}
              setClients={setClients}
              changeLogs={changeLogs}
              setChangeLogs={setChangeLogs}
              metrics={metrics}
              setMetrics={setMetrics}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------- 上部フィルター用パーツ ---------- */
function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function MultiPicker({
  items,
  selected,
  setSelected,
  placeholderAll,
}: {
  items: { id: string; name: string }[];
  selected: string[];
  setSelected: (s: string[]) => void;
  placeholderAll: string;
}) {
  const [open, setOpen] = useState(false);
  const label =
    selected.length === 0
      ? placeholderAll
      : selected.length === 1
      ? items.find((i) => i.id === selected[0])?.name ?? "1件"
      : `${selected.length}件選択`;
  return (
    <div className="relative">
      <button
        className={`${css.btnOutline} text-xs`}
        onClick={() => setOpen(!open)}
      >
        {label} ▾
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-slate-200 rounded shadow-md p-2 min-w-[180px] max-h-64 overflow-auto">
            {items.map((it) => (
              <label
                key={it.id}
                className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-slate-50 cursor-pointer rounded"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(it.id)}
                  onChange={() =>
                    setSelected(
                      selected.includes(it.id)
                        ? selected.filter((x) => x !== it.id)
                        : [...selected, it.id]
                    )
                  }
                />
                {it.name}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
 
/* ---------- 入力選択 ---------- */
function InputChoice({ setView }: { setView: (v: any) => void }) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div
        className={`${css.card} cursor-pointer hover:shadow-md transition`}
        onClick={() => setView("register")}
      >
        <div className={css.cardHeader}>1. 加盟店登録</div>
        <div className={css.cardBody}>
          <div className="text-sm text-slate-600">
            新規獲得した加盟店の請求ID・予算・商材・配信開始日を登録します。
          </div>
          <button className={`${css.btn} mt-4 w-full justify-center`}>
            加盟店登録に進む
          </button>
        </div>
      </div>
      <div
        className={`${css.card} cursor-pointer hover:shadow-md transition`}
        onClick={() => setView("change")}
      >
        <div className={css.cardHeader}>2. 退会・停止・変更登録</div>
        <div className={css.cardBody}>
          <div className="text-sm text-slate-600">
            既存加盟店の退会 / 停止 / 減額 / 商材停止 / エリア縮小 / ブランド停止を登録します。
          </div>
          <button className={`${css.btn} mt-4 w-full justify-center`}>
            変更登録に進む
          </button>
        </div>
      </div>
    </div>
  );
}
 
/* ---------- 加盟店登録 ---------- */
function RegisterClient({
  clients,
  setClients,
  owners,
  brands,
  onDone,
}: {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  owners: SalesOwner[];
  brands: BrandMaster[];
  onDone: () => void;
}) {
  const [billingId, setBillingId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [salesOwnerId, setSalesOwnerId] = useState<string>(
    owners[0]?.ownerId ?? ""
  );
  const [monthlyBudget, setMonthlyBudget] = useState<string>("");
  const [leadUnitPrice, setLeadUnitPrice] = useState<string>("");
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryBudgets, setCategoryBudgets] = useState<EditableCategoryBudgets>({});
  const [brandSelections, setBrandSelections] = useState<BrandSelection[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [acquisitionDate, setAcquisitionDate] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [status, setStatus] = useState<Status>("scheduled");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string>("");
 
  const parsedMonthlyBudget =
    monthlyBudget === "" ? undefined : Number(monthlyBudget);
  const parsedLeadUnitPrice =
    leadUnitPrice === "" ? 0 : Number(leadUnitPrice);
  const catSum = useMemo(
    () => categories.reduce((s, c) => s + (Number(categoryBudgets[c]) || 0), 0),
    [categories, categoryBudgets]
  );
  const diff = (parsedMonthlyBudget ?? 0) - catSum;
 
  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
    setBrandSelections((prev) =>
      prev.find((b) => b.category === cat)
        ? prev.filter((b) => b.category !== cat)
        : [...prev, { category: cat, selectionType: "all", selectedBrandIds: [] }]
    );
  };
  const toggleArea = (a: string) => {
    setAreas((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  };
 
  const submit = () => {
    setError("");
    if (!billingId) return setError("請求IDは必須です");
    if (clients.find((c) => c.billingId === billingId))
      return setError("請求IDが重複しています");
    if (!companyName) return setError("会社名は必須です");
    if (!salesOwnerId) return setError("営業担当を選択してください");
    if (categories.length === 0)
      return setError("商材を1つ以上選択してください");
    if (parsedMonthlyBudget === undefined)
      return setError("月間予算は必須です");
    if (catSum !== parsedMonthlyBudget)
      return setError("商材ごとの配信予算の合計が月間予算と一致していません");
    if (!startDate) return setError("配信開始予定日は必須です");
 
    const c: Client = {
      billingId,
      companyName,
      salesOwnerId,
      acquisitionDate,
      startDate,
      monthlyBudget: parsedMonthlyBudget,
      leadUnitPrice: parsedLeadUnitPrice,
      categories,
      categoryBudgets: Object.fromEntries(
        categories.map((cat) => [cat, Number(categoryBudgets[cat]) || 0])
      ),
      brandSelections,
      areas,
      status,
      note,
    };
    setClients([...clients, c]);
    onDone();
  };
 
  return (
    <div className={css.card}>
      <div className={css.cardHeader}>加盟店登録</div>
      <div className={`${css.cardBody} space-y-4`}>
        {error && (
          <div className="border border-red-300 bg-red-50 text-red-700 rounded p-3 text-sm">
            <b>登録エラー:</b> {error}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="1. 請求ID（必須・重複不可）">
            <input
              className={css.input}
              value={billingId}
              onChange={(e) => setBillingId(e.target.value)}
            />
          </Field>
          <Field label="2. 会社名">
            <input
              className={css.input}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field label="3. 営業担当">
            <select
              className={css.input}
              value={salesOwnerId}
              onChange={(e) => setSalesOwnerId(e.target.value)}
            >
              {owners.map((o) => (
                <option key={o.ownerId} value={o.ownerId}>
                  {o.ownerName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="4. 月間予算">
            <input
              className={css.input}
              type="number"
              value={monthlyBudget}
              onChange={(e) => setMonthlyBudget(e.target.value)}
            />
          </Field>
          <Field label="5. 送客単価">
            <input
              className={css.input}
              type="number"
              value={leadUnitPrice}
              onChange={(e) => setLeadUnitPrice(e.target.value)}
            />
          </Field>
        </div>
 
        <div>
          <div className={css.label}>6. 商材選択（複数可）</div>
          <div className="flex flex-wrap gap-2 mt-2">
            {CATEGORIES.map((cat) => (
              <label
                key={cat}
                className={`px-3 py-1 rounded border cursor-pointer text-sm ${
                  categories.includes(cat)
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white border-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={categories.includes(cat)}
                  onChange={() => toggleCategory(cat)}
                />
                {cat}
              </label>
            ))}
          </div>
        </div>
 
        {categories.length > 0 && (
          <div>
            <div className={css.label}>7. 商材ごとの配信予算</div>
            <div className="grid md:grid-cols-2 gap-3 mt-2">
              {categories.map((cat) => (
                <div key={cat} className="flex items-center gap-2">
                  <span className="w-20 text-sm">{cat}</span>
                  <input
                    className={css.input}
                    type="number"
                    value={categoryBudgets[cat] ?? ""}
                    onChange={(e) =>
                      setCategoryBudgets({
                        ...categoryBudgets,
                        [cat]: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-sm flex-wrap">
              <div>
                月間予算: <b>{monthlyBudget === "" ? "—" : yen(Number(monthlyBudget))}</b>
              </div>
              <div>
                商材別合計: <b>{yen(catSum)}</b>
              </div>
              <div className={diff === 0 ? "text-emerald-600" : "text-red-600"}>
                差額: <b>{yen(diff)}</b>
              </div>
            </div>
          </div>
        )}
 
        {categories.length > 0 && (
          <div>
            <div className={css.label}>8. ブランド選択</div>
            <div className="space-y-2 mt-2">
              {categories.map((cat) => {
                const sel = brandSelections.find((b) => b.category === cat);
                if (!sel) return null;
                const catBrands = brands.filter(
                  (b) => b.category === cat && b.isActive
                );
                return (
                  <div
                    key={cat}
                    className="border border-slate-200 rounded p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{cat}</div>
                      <select
                        className={`${css.input} w-32`}
                        value={sel.selectionType}
                        onChange={(e) => {
                          const v = e.target.value as "all" | "partial";
                          setBrandSelections(
                            brandSelections.map((b) =>
                              b.category === cat
                                ? {
                                    ...b,
                                    selectionType: v,
                                    selectedBrandIds:
                                      v === "all" ? [] : b.selectedBrandIds,
                                  }
                                : b
                            )
                          );
                        }}
                      >
                        <option value="all">全選択</option>
                        <option value="partial">個別選択</option>
                      </select>
                    </div>
                    {sel.selectionType === "partial" && (
                      <div className="flex flex-wrap gap-3 mt-2">
                        {catBrands.length === 0 && (
                          <span className="text-xs text-slate-500">
                            ブランドマスタ未登録（マスタ画面から追加してください）
                          </span>
                        )}
                        {catBrands.map((b) => (
                          <label
                            key={b.brandId}
                            className="text-sm flex items-center gap-1"
                          >
                            <input
                              type="checkbox"
                              checked={sel.selectedBrandIds.includes(b.brandId)}
                              onChange={() => {
                                setBrandSelections(
                                  brandSelections.map((bs) =>
                                    bs.category === cat
                                      ? {
                                          ...bs,
                                          selectedBrandIds:
                                            bs.selectedBrandIds.includes(
                                              b.brandId
                                            )
                                              ? bs.selectedBrandIds.filter(
                                                  (x) => x !== b.brandId
                                                )
                                              : [
                                                  ...bs.selectedBrandIds,
                                                  b.brandId,
                                                ],
                                        }
                                      : bs
                                  )
                                );
                              }}
                            />
                            {b.brandName}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
 
        <div>
          <div className={css.label}>9. エリア（都道府県）</div>
          <div className="flex flex-wrap gap-1 mt-2 max-h-44 overflow-auto border border-slate-200 rounded p-2">
            {PREFECTURES.map((p) => (
              <label
                key={p}
                className={`px-2 py-0.5 rounded border cursor-pointer text-xs ${
                  areas.includes(p)
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white border-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={areas.includes(p)}
                  onChange={() => toggleArea(p)}
                />
                {p}
              </label>
            ))}
          </div>
        </div>
 
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="10. 獲得日">
            <input
              className={css.input}
              type="date"
              value={acquisitionDate}
              onChange={(e) => setAcquisitionDate(e.target.value)}
            />
          </Field>
          <Field label="11. 配信開始予定日">
            <input
              className={css.input}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="12. ステータス">
            <select
              className={css.input}
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              <option value="scheduled">配信予定</option>
              <option value="active">配信中</option>
              <option value="suspended">停止中</option>
              <option value="withdrawn">退会</option>
            </select>
          </Field>
        </div>
        <Field label="13. 備考">
          <textarea
            className={css.input}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
 
        <div className="flex gap-2 justify-end">
          <button className={css.btnOutline} onClick={onDone}>
            キャンセル
          </button>
          <button className={css.btn} onClick={submit}>
            登録
          </button>
        </div>
      </div>
    </div>
  );
}
 
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm text-slate-700">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
 
/* ---------- 退会・停止・変更 ---------- */
function ChangeForm({
  clients,
  owners,
  brands,
  changeLogs,
  setChangeLogs,
  setClients,
  onDone,
}: {
  clients: Client[];
  owners: SalesOwner[];
  brands: BrandMaster[];
  changeLogs: ChangeLog[];
  setChangeLogs: React.Dispatch<React.SetStateAction<ChangeLog[]>>;
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  onDone: () => void;
}) {
  const [billingIdInput, setBillingIdInput] = useState("");
  const [target, setTarget] = useState<Client | null>(null);
  const [changeType, setChangeType] = useState<ChangeType>("withdraw");
  const [declaredDate, setDeclaredDate] = useState<string>(
    new Date().toISOString().substring(0, 10)
  );
  const [effectiveDate, setEffectiveDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [affectedCategories, setAffectedCategories] = useState<string[]>([]);
  const [affectedBrands, setAffectedBrands] = useState<string[]>([]);
  const [affectedAreas, setAffectedAreas] = useState<string[]>([]);
  const [decreasedByCategory, setDecreasedByCategory] =
    useState<EditableCategoryBudgets>({});
  const [decreasedBudget] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [recovery, setRecovery] = useState<RecoveryPossibility>("unknown");
  const [action, setAction] = useState<string>("");
  const [error, setError] = useState("");
  const [newCategories, setNewCategories] = useState<string[]>([]);
  const [newAreas, setNewAreas] = useState<string[]>([]);
  const [newCategoryBudgets, setNewCategoryBudgets] = useState<EditableCategoryBudgets>({});
  const [newBrandSelections, setNewBrandSelections] = useState<BrandSelection[]>([]);


  const fetchClient = () => {
    const c = clients.find((x) => x.billingId === billingIdInput);
    if (!c) {
      setError("該当する加盟店が見つかりません");
      setTarget(null);
      return;
    }
    setError("");
    setTarget(c);
    setAffectedCategories([]);
    setAffectedBrands([]);
    setAffectedAreas([]);
    setDecreasedByCategory({});
    setNewCategories(c.categories);
　　 setNewAreas(c.areas);
    setNewCategoryBudgets({ ...c.categoryBudgets });
    setNewBrandSelections(
      c.brandSelections?.length
    ? c.brandSelections
    : c.categories.map((cat) => ({
        category: cat,
        selectionType: "all",
        selectedBrandIds: [],
      }))
);

  };

  const totalDecByCat = useMemo<number>(
    () =>
      Object.values(decreasedByCategory).reduce<number>(
        (s, v) => s + (v ?? 0),
        0
      ),
    [decreasedByCategory]
  );

 const newCategoryBudgetTotal = useMemo(
  () =>
    newCategories.reduce(
      (s, cat) => s + (Number(newCategoryBudgets[cat]) || 0),
      0
    ),
   [newCategories, newCategoryBudgets]
   );

  const toggleNewCategory = (cat: string) => {
   setNewCategories((prev) => {
    const exists = prev.includes(cat);
    const next = exists ? prev.filter((c) => c !== cat) : [...prev, cat];

    setNewCategoryBudgets((cur) => {
      const copy = { ...cur };
      if (exists) delete copy[cat];
      else copy[cat] = target?.categoryBudgets?.[cat] ?? 0;
      return copy;
     });

    setNewBrandSelections((cur) => {
      if (exists) return cur.filter((b) => b.category !== cat);
      const existing = target?.brandSelections?.find((b) => b.category === cat);
      return [
        ...cur,
        existing || {
          category: cat,
          selectionType: "all",
          selectedBrandIds: [],
        },
      ];
    });

    return next;
  });
 };

 const toggleNewArea = (area: string) => {
  setNewAreas((prev) =>
    prev.includes(area) ? prev.filter((x) => x !== area) : [...prev, area]
  );
 };


  const submit = () => {
    if (!target) return;
    if (!effectiveDate) {
      setError("発生日（effectiveDate）を入力してください");
      return;
    }
    let dec = decreasedBudget;
    let decByCat: CategoryBudgets | undefined = undefined;

    if (changeType === "category_change") {
  if (newCategories.length === 0) {
    setError("変更後の商材を1つ以上選択してください");
    return;
  }
 }

 if (changeType === "area_change") {
  if (newAreas.length === 0) {
    setError("変更後のエリアを1つ以上選択してください");
    return;
  }
 }


    if (changeType === "category_stop") {
      decByCat = {};
      for (const cat of affectedCategories) {
        decByCat[cat] = target.categoryBudgets[cat] ?? 0;
      }
      dec = Object.values(decByCat).reduce((s, v) => s + (v as number), 0);
    } else if (changeType === "withdraw") {
      decByCat = { ...target.categoryBudgets };
      dec = Object.values(target.categoryBudgets).reduce(
        (s, v) => s + (v as number),
        0
      );
    } else if (changeType === "cross_sell" || changeType === "up_sell") {
      decByCat = {};
      let added = 0;
      for (const [cat, value] of Object.entries(decreasedByCategory)) {
        const amount = Number(value) || 0;
        if (amount > 0) {
          decByCat[cat] = -amount;
          added += amount;
        }
      }
      dec = -added;
    } else if (changeType === "down_sell") {
      if (Object.keys(decreasedByCategory).length > 0) {
        decByCat = Object.fromEntries(
          Object.entries(decreasedByCategory).map(([cat, value]) => [cat, value ?? 0])
        ) as CategoryBudgets;
        dec = totalDecByCat;
      }
    } else if (
      changeType === "reduce" ||
      changeType === "brand_stop" ||
      changeType === "area_reduce"
    ) {
      if (Object.keys(decreasedByCategory).length > 0) {
        decByCat = Object.fromEntries(
          Object.entries(decreasedByCategory).map(([cat, value]) => [cat, value ?? 0])
        ) as CategoryBudgets;
        dec = totalDecByCat;
      }
    }

    if (
      changeType === "cross_sell" &&
      (!decByCat || Object.values(decByCat).every((v) => v === 0))
    ) {
      setError("クロスセルの追加予算を1つ以上入力してください");
      return;
    }
    if (
      changeType === "up_sell" &&
      (!decByCat || Object.values(decByCat).every((v) => v === 0))
    ) {
      setError("アップセルの追加予算を1つ以上入力してください");
      return;
    }
    if (
      changeType === "down_sell" &&
      (!decByCat || Object.values(decByCat).every((v) => v === 0))
    ) {
      setError("ダウンセルの減額を1つ以上入力してください");
      return;
    }

    const finalAffectedCategories =
      changeType === "cross_sell" ||
      changeType === "up_sell" ||
      changeType === "down_sell"
        ? Object.entries(decreasedByCategory)
            .filter(([, v]) => Number(v) !== 0)
            .map(([cat]) => cat)
        : affectedCategories;

    const newLog: ChangeLog = {
      changeId: uid(),
      billingId: target.billingId,
      salesOwnerId: target.salesOwnerId,
      changeType,
      declaredDate,
      effectiveDate,
      endDate: (changeType === "withdraw" || changeType === "suspend") ? endDate || undefined : undefined,
      affectedCategories: finalAffectedCategories,
      affectedBrands,
      affectedAreas,
      previousMonthlyBudget: target.monthlyBudget,
      newMonthlyBudget:
        changeType === "category_change"
          ? newCategoryBudgetTotal
          : changeType === "activate"
          ? target.monthlyBudget
          : target.monthlyBudget - dec,
      decreasedBudget:
        changeType === "category_change"
          ? Math.max(0, target.monthlyBudget - newCategoryBudgetTotal)
          : changeType === "activate"
          ? 0
          : dec,
      decreasedByCategory: decByCat,
      newCategories: changeType === "category_change" ? newCategories : undefined,
      newAreas: changeType === "area_change" ? newAreas : undefined,
      newCategoryBudgets:
        changeType === "category_change"
          ? (Object.fromEntries(
              Object.entries(newCategoryBudgets).map(([cat, value]) => [cat, value ?? 0])
            ) as CategoryBudgets)
          : undefined,
      newBrandSelections:
        changeType === "category_change" ? newBrandSelections : undefined,
      reason,
      recoveryPossibility: recovery,
      action,
    };
    // ===== 再開処理（安全版） =====
    let finalLogs = [...changeLogs];

    if (changeType === "resume") {
      const resumeDate = parseD(effectiveDate);

      if (resumeDate) {
        const dayBefore = new Date(resumeDate.getTime() - 86400000);

        const dayBeforeStr =
          dayBefore.getFullYear() +
          "-" +
          String(dayBefore.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(dayBefore.getDate()).padStart(2, "0");

        finalLogs = finalLogs.map((log) => {
          if (
            log.billingId === target.billingId &&
            (log.changeType === "suspend" || log.changeType === "withdraw") &&
            !log.endDate
          ) {
            return { ...log, endDate: dayBeforeStr };
          }
          return log;
        });
      }
    }

    setChangeLogs([...finalLogs, newLog]);

    if (changeType === "withdraw") {
      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? { ...c, status: "withdrawn" }
            : c
        )
      );
    } else if (changeType === "suspend") {
      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? { ...c, status: "suspended" }
            : c
        )
      );
    } else if (changeType === "resume") {
      const resumeDate = parseD(effectiveDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? {
                ...c,
                status:
                  resumeDate && resumeDate <= today ? "active" : "suspended",
                note:
                  resumeDate && resumeDate > today
                    ? `再開予定日：${effectiveDate}`
                    : "",
              }
            : c
        )
      );
    } else if (changeType === "activate") {
      const activeDate = parseD(effectiveDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? {
                ...c,
                status:
                  activeDate && activeDate > today ? "scheduled" : "active",
              }
            : c
        )
      );
    } else if (changeType === "cross_sell") {
      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? {
                ...c,
                categories: [
                  ...new Set([
                    ...c.categories,
                    ...Object.keys(decreasedByCategory).filter(
                      (cat) => (decreasedByCategory[cat] || 0) > 0
                    ),
                  ]),
                ],
                categoryBudgets: {
                  ...c.categoryBudgets,
                  ...Object.fromEntries(
                    Object.entries(decreasedByCategory)
                      .filter(([, v]) => Number(v) > 0)
                      .map(([cat, v]) => [
                        cat,
                        (c.categoryBudgets[cat] || 0) + Number(v),
                      ])
                  ),
                },
                monthlyBudget: c.monthlyBudget - dec,
              }
            : c
        )
      );
    } else if (changeType === "up_sell") {
      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? {
                ...c,
                categoryBudgets: {
                  ...c.categoryBudgets,
                  ...Object.fromEntries(
                    Object.entries(decreasedByCategory)
                      .filter(([, v]) => Number(v) > 0)
                      .map(([cat, v]) => [
                        cat,
                        (c.categoryBudgets[cat] || 0) + Number(v),
                      ])
                  ),
                },
                monthlyBudget: c.monthlyBudget - dec,
              }
            : c
        )
      );
    } else if (changeType === "down_sell") {
      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? {
                ...c,
                categoryBudgets: {
                  ...c.categoryBudgets,
                  ...Object.fromEntries(
                    Object.entries(decreasedByCategory)
                      .filter(([, v]) => Number(v) > 0)
                      .map(([cat, v]) => [
                        cat,
                        Math.max(
                          0,
                          (c.categoryBudgets[cat] || 0) - Number(v)
                        ),
                      ])
                  ),
                },
                monthlyBudget: c.monthlyBudget - dec,
              }
            : c
        )
      );
    } else if (changeType === "category_change") {
      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? {
                ...c,
                categories: newCategories,
              }
            : c
        )
      );
    } else if (changeType === "area_change") {
      setClients(
        clients.map((c) =>
          c.billingId === target.billingId
            ? {
                ...c,
                areas: newAreas,
              }
            : c
        )
      );
    }
    onDone();
  };

  return (
    <div className={css.card}>
      <div className={css.cardHeader}>退会・停止・変更登録</div>
      <div className={`${css.cardBody} space-y-4`}>
        {error && (
          <div className="border border-red-300 bg-red-50 text-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className={css.input}
            placeholder="請求IDを入力"
            value={billingIdInput}
            onChange={(e) => setBillingIdInput(e.target.value)}
          />
          <button className={css.btn} onClick={fetchClient}>
            取得
          </button>
        </div>

        {target && (
          <>
            {/* 現在の登録内容 */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  現在の登録内容
                </span>
                <StatusBadge status={target.status} />
              </div>
              <div className="p-3 grid md:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <span className="text-slate-500 mr-1">会社名:</span>
                  <b>{target.companyName}</b>
                </div>
                <div>
                  <span className="text-slate-500 mr-1">請求ID:</span>
                  <b>{target.billingId}</b>
                </div>
                <div>
                  <span className="text-slate-500 mr-1">営業担当:</span>
                  <b>
                    {
                      owners.find((o) => o.ownerId === target.salesOwnerId)
                        ?.ownerName
                    }
                  </b>
                </div>
                <div>
                  <span className="text-slate-500 mr-1">配信開始予定日:</span>
                  <b>{target.startDate || "—"}</b>
                </div>
                <div>
                  <span className="text-slate-500 mr-1">月間予算:</span>
                  <b>{yen(target.monthlyBudget)}</b>
                </div>
                <div>
                  <span className="text-slate-500 mr-1">送客単価:</span>
                  <b>{yen(target.leadUnitPrice)}</b>
                </div>
                <div className="md:col-span-2">
                  <span className="text-slate-500 mr-1">商材別予算:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(target.categoryBudgets).map(([k, v]) => (
                      <span
                        key={k}
                        className="text-xs px-2 py-0.5 rounded border border-slate-300 bg-white"
                      >
                        {k}: {yen(v)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <span className="text-slate-500 mr-1">配信エリア:</span>
                  <span className="text-xs">
                    {target.areas.length > 0
                      ? target.areas.join(" / ")
                      : "—"}
                  </span>
                </div>
                <div className="md:col-span-2">
                  <span className="text-slate-500 mr-1">ブランド選択:</span>
                  <span className="text-xs">
                    {target.brandSelections.length > 0
                      ? target.brandSelections
                          .map(
                            (b) =>
                              `${b.category}: ${
                                b.selectionType === "all"
                                  ? "全選択"
                                  : `${b.selectedBrandIds.length}件選択`
                              }`
                          )
                          .join(" / ")
                      : "—"}
                  </span>
                </div>
                {target.note && (
                  <div className="md:col-span-2">
                    <span className="text-slate-500 mr-1">備考:</span>
                    <span className="text-xs">{target.note}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 変更内容入力 */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-900 text-white px-3 py-2 text-sm font-semibold">
                変更内容入力
              </div>
              <div className="p-4 space-y-4">
                <div className="grid md:grid-cols-3 gap-3">
                  <Field label="変更種別">
                    <select
                      className={css.input}
                      value={changeType}
                      onChange={(e) =>
                        setChangeType(e.target.value as ChangeType)
                      }
                    >
                      {(Object.keys(CHANGE_TYPE_LABEL) as ChangeType[]).map(
                        (k) => (
                          <option key={k} value={k}>
                            {CHANGE_TYPE_LABEL[k]}
                          </option>
                        )
                      )}
                    </select>
                  </Field>
                  <Field label="申告日">
                    <input
                      className={css.input}
                      type="date"
                      value={declaredDate}
                      onChange={(e) => setDeclaredDate(e.target.value)}
                    />
                  </Field>
                  <Field label="発生日（effectiveDate）">
                    <input
                      className={css.input}
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                    />
                  </Field>
                  {(changeType === "withdraw" || changeType === "suspend") && (
                    <Field
                      label={
                        changeType === "suspend"
                          ? "再開予定日（未定なら空）"
                          : "退会予定日（未定なら空）"
                      }
                    >
                      <input
                        className={css.input}
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </Field>
                  )}
                </div>

                {(changeType === "cross_sell" ||
                  changeType === "up_sell" ||
                  changeType === "down_sell") && (
                  <div>
                    <div className={css.label}>
                      {changeType === "cross_sell"
                        ? "追加する商材と追加予算"
                        : changeType === "up_sell"
                        ? "既存商材への追加予算"
                        : "既存商材の減額"}
                    </div>
                    <div className="grid md:grid-cols-2 gap-2 mt-2">
                      {(changeType === "cross_sell"
                        ? CATEGORIES.filter(
                            (cat) => !target.categories.includes(cat)
                          )
                        : target.categories
                      ).map((cat) => (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="w-20 text-sm">{cat}</span>
                          <input
                            className={css.input}
                            type="number"
                            placeholder={
                              changeType === "cross_sell"
                                ? "追加予算"
                                : `現状: ${yen(
                                    target.categoryBudgets[cat] ?? 0
                                  )}`
                            }
                            value={decreasedByCategory[cat] ?? ""}
                            onChange={(e) =>
                              setDecreasedByCategory({
                                ...decreasedByCategory,
                                [cat]:
                                  e.target.value === ""
                                    ? undefined
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                    {changeType === "cross_sell" &&
                      CATEGORIES.filter(
                        (cat) => !target.categories.includes(cat)
                      ).length === 0 && (
                        <div className="text-sm text-slate-500 mt-2">
                          追加できる商材がありません。
                        </div>
                      )}
                    {(changeType === "up_sell" ||
                      changeType === "down_sell") && (
                      <div className="mt-2 text-sm">
                        合計額: <b>{yen(totalDecByCat)}</b>
                      </div>
                    )}
                  </div>
                )}

                {(changeType === "category_stop" ||
                  changeType === "suspend") && (
                  <div>
                    <div className={css.label}>対象商材</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {target.categories.map((cat) => (
                        <label
                          key={cat}
                          className={`px-3 py-1 rounded border cursor-pointer text-sm ${
                            affectedCategories.includes(cat)
                              ? "bg-slate-900 text-white border-slate-900"
                              : "bg-white border-slate-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={affectedCategories.includes(cat)}
                            onChange={() =>
                              setAffectedCategories((p) =>
                                p.includes(cat)
                                  ? p.filter((x) => x !== cat)
                                  : [...p, cat]
                              )
                            }
                          />
                          {cat}（{yen(target.categoryBudgets[cat] ?? 0)}）
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {(changeType === "reduce" ||
                  changeType === "brand_stop" ||
                  changeType === "area_reduce") && (
                  <div>
                    <div className={css.label}>商材別の減少額（手動入力）</div>
                    <div className="grid md:grid-cols-2 gap-2 mt-2">
                      {target.categories.map((cat) => (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="w-20 text-sm">{cat}</span>
                          <input
                            className={css.input}
                            type="number"
                            placeholder={`現状: ${yen(
                              target.categoryBudgets[cat] ?? 0
                            )}`}
                            value={decreasedByCategory[cat] ?? ""}
                            onChange={(e) =>
                              setDecreasedByCategory({
                                ...decreasedByCategory,
                                [cat]:
                                  e.target.value === ""
                                    ? undefined
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-sm">
                      合計減少額: <b>{yen(totalDecByCat)}</b>
                    </div>
                  </div>
                )}

                {changeType === "brand_stop" && (
                  <div>
                    <div className={css.label}>停止ブランド</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {brands
                        .filter(
                          (b) =>
                            target.categories.includes(b.category) &&
                            b.isActive
                        )
                        .map((b) => (
                          <label
                            key={b.brandId}
                            className={`px-3 py-1 rounded border cursor-pointer text-sm ${
                              affectedBrands.includes(b.brandId)
                                ? "bg-slate-900 text-white border-slate-900"
                                : "bg-white border-slate-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={affectedBrands.includes(b.brandId)}
                              onChange={() =>
                                setAffectedBrands((p) =>
                                  p.includes(b.brandId)
                                    ? p.filter((x) => x !== b.brandId)
                                    : [...p, b.brandId]
                                )
                              }
                            />
                            {b.category}/{b.brandName}
                          </label>
                        ))}
                    </div>
                  </div>
                )}

                {changeType === "area_reduce" && (
                  <div>
                    <div className={css.label}>縮小エリア</div>
                    <div className="flex flex-wrap gap-1 mt-2 max-h-32 overflow-auto border border-slate-200 rounded p-2">
                      {target.areas.map((p) => (
                        <label
                          key={p}
                          className={`px-2 py-0.5 rounded border cursor-pointer text-xs ${
                            affectedAreas.includes(p)
                              ? "bg-slate-900 text-white border-slate-900"
                              : "bg-white border-slate-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={affectedAreas.includes(p)}
                            onChange={() =>
                              setAffectedAreas((cur) =>
                                cur.includes(p)
                                  ? cur.filter((x) => x !== p)
                                  : [...cur, p]
                              )
                            }
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
　　　　　　　　　　
　　　　　　　　　　{changeType === "category_change" && (
  <div className="space-y-4">
    <div>
      <div className={css.label}>変更後の商材</div>
      <div className="flex flex-wrap gap-2 mt-2">
        {CATEGORIES.map((cat) => (
          <label
            key={cat}
            className={`px-3 py-1 rounded border cursor-pointer text-sm ${
              newCategories.includes(cat)
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white border-slate-300"
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={newCategories.includes(cat)}
              onChange={() => toggleNewCategory(cat)}
            />
            {cat}
          </label>
        ))}
      </div>
    </div>

    {newCategories.length > 0 && (
      <div>
        <div className={css.label}>変更後の商材別予算</div>
        <div className="grid md:grid-cols-2 gap-2 mt-2">
          {newCategories.map((cat) => (
            <div key={cat} className="flex items-center gap-2">
              <span className="w-20 text-sm">{cat}</span>
              <input
                className={css.input}
                type="number"
                value={newCategoryBudgets[cat] ?? ""}
                onChange={(e) =>
                  setNewCategoryBudgets({
                    ...newCategoryBudgets,
                    [cat]:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </div>
          ))}
        </div>
        <div className="mt-2 text-sm">
          変更後の月間予算: <b>{yen(newCategoryBudgetTotal)}</b>
        </div>
      </div>
    )}
  </div>
)}

{changeType === "area_change" && (
  <div>
    <div className={css.label}>変更後のエリア</div>
    <div className="flex gap-2 mt-2 mb-2">
      <button
        type="button"
        className={css.btnOutline}
        onClick={() => setNewAreas([...PREFECTURES])}
      >
        全国を選択
      </button>
      <button
        type="button"
        className={css.btnOutline}
        onClick={() => setNewAreas([])}
      >
        すべて解除
      </button>
      <span className="text-xs text-slate-500 self-center">
        {newAreas.length}都道府県選択中
      </span>
    </div>

    <div className="flex flex-wrap gap-1 mt-2 max-h-44 overflow-auto border border-slate-200 rounded p-2">
      {PREFECTURES.map((p) => (
        <label
          key={p}
          className={`px-2 py-0.5 rounded border cursor-pointer text-xs ${
            newAreas.includes(p)
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white border-slate-300"
          }`}
        >
          <input
            type="checkbox"
            className="hidden"
            checked={newAreas.includes(p)}
            onChange={() => toggleNewArea(p)}
          />
          {p}
        </label>
      ))}
    </div>
  </div>
　)}


                <div className="grid md:grid-cols-3 gap-3">
                  <Field label="復活見込み">
                    <select
                      className={css.input}
                      value={recovery}
                      onChange={(e) =>
                        setRecovery(e.target.value as RecoveryPossibility)
                      }
                    >
                      {(
                        Object.keys(RECOVERY_LABEL) as RecoveryPossibility[]
                      ).map((k) => (
                        <option key={k} value={k}>
                          {RECOVERY_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="対応アクション">
                    <input
                      className={css.input}
                      placeholder="例：営業フォロー、CS連絡"
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="理由">
                  <textarea
                    className={css.input}
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>

                <div className="flex gap-2 justify-end">
                  <button className={css.btnOutline} onClick={onDone}>
                    キャンセル
                  </button>
                  <button className={css.btn} onClick={submit}>
                    登録
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
 
/* ---------- 事業数字入力 ---------- */
function MetricsForm({
  metrics,
  setMetrics,
  targetMonth,
}: {
  metrics: BusinessMetric[];
  setMetrics: React.Dispatch<React.SetStateAction<BusinessMetric[]>>;
  targetMonth: string;
}) {
  const [month, setMonth] = useState<string>(targetMonth);
  const [draft, setDraft] = useState<Record<string, Partial<BusinessMetric>>>({});
 
  useEffect(() => {
    const d: Record<string, Partial<BusinessMetric>> = {};
    const rows = ["全体", ...CATEGORIES];
    for (const cat of rows) {
      const found = metrics.find((m) => m.month === month && m.category === cat);
      d[cat] = found
        ? {
            revenue: found.revenue,
            grossProfit: found.grossProfit,
            adCost: found.adCost,
            cv: found.cv,
            validUsers: found.validUsers,
          }
        : {};
    }
    setDraft(d);
  }, [month, metrics]);
 
  const save = () => {
    const updated = metrics.filter((m) => m.month !== month);
    const rows = ["全体", ...CATEGORIES];
    for (const cat of rows) {
      const d = draft[cat] || {};
     const revenue = Number(d.revenue) || 0;
const adCost = Number(d.adCost) || 0;
const grossProfit = revenue - adCost;

updated.push({
  month,
  category: cat,
  revenue,
  grossProfit,
  adCost,

  // CV数は入力しない。既存値があれば保持、なければ0
  cv: Number(d.cv) || 0,

  validUsers: Number(d.validUsers) || 0,
});
    }
    setMetrics(updated);
  };
 
  return (
    <div className={css.card}>
      <div className={css.cardHeader}>事業数字入力</div>
      <div className={`${css.cardBody} space-y-4`}>
        <div className="flex gap-2 items-center">
          <div className={css.label}>対象月</div>
          <input
            className={`${css.input} w-40`}
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className={css.table}>
            <thead>
              <tr>
                {[
                  "商材",
                  "売上",
                  "粗利",
                  "粗利率",
                  "広告費",
                  "CV数",
                  "CPA",
                  "有効ユーザー",
                  "顧客単価",
                ].map((h) => (
                  <th key={h} className={css.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              { ["全体", ...CATEGORIES].map((cat) => {
                const d = draft[cat] || {};
                const rev = Number(d.revenue) || 0;
　　　　　　　　　　const ad = Number(d.adCost) || 0;
　　　　　　　　　　const gp = rev - ad;
　　　　　　　　　　const cv = Number(d.cv) || 0;
　　　　　　　　　　const vu = Number(d.validUsers) || 0;
                return (
                  <tr key={cat} className={cat === "全体" ? "bg-slate-50" : ""}>
                    <td className={`${css.td} font-medium`}>{cat}</td>
                    <td className={css.td}>
                      <input
                        className={css.input}
                        type="number"
                        value={d.revenue ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [cat]: {
                              ...d,
                              revenue:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={`${css.td} font-medium`}>
  {yen(gp)}
</td>
                   <td className={css.td}>
  {cv > 0 ? cv.toLocaleString() : "—"}
</td>
                    <td className={css.td}>
                      <input
                        className={css.input}
                        type="number"
                        value={d.cv ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [cat]: {
                              ...d,
                              cv:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={css.td}>{cv > 0 ? yen(ad / cv) : "—"}</td>
                    <td className={css.td}>
                      <input
                        className={css.input}
                        type="number"
                        value={d.validUsers ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [cat]: {
                              ...d,
                              validUsers:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={css.td}>
                      {vu > 0 ? yen(rev / vu) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-right">
          <button className={css.btn} onClick={save}>
            {month} の事業数字を保存
          </button>
        </div>
      </div>
    </div>
  );
}
 
/* ---------- マスタ / CSV ---------- */
function Masters({
  owners,
  setOwners,
  brands,
  setBrands,
  clients,
  setClients,
  changeLogs,
  setChangeLogs,
  metrics,
  setMetrics,
}: {
  owners: SalesOwner[];
  setOwners: React.Dispatch<React.SetStateAction<SalesOwner[]>>;
  brands: BrandMaster[];
  setBrands: React.Dispatch<React.SetStateAction<BrandMaster[]>>;
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  changeLogs: ChangeLog[];
  setChangeLogs: React.Dispatch<React.SetStateAction<ChangeLog[]>>;
  metrics: BusinessMetric[];
  setMetrics: React.Dispatch<React.SetStateAction<BusinessMetric[]>>;
}) {
  const [tab, setTab] = useState<"owners" | "brands" | "csv">("owners");
  const [newOwner, setNewOwner] = useState("");
  const [newBrandCat, setNewBrandCat] = useState<string>(CATEGORIES[0]);
  const [newBrandName, setNewBrandName] = useState("");
 
  const onImport = (kind: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(String(reader.result));
      if (kind === "clients") setClients(rows as Client[]);
      else if (kind === "changeLogs") setChangeLogs(rows as ChangeLog[]);
      else if (kind === "metrics") setMetrics(rows as BusinessMetric[]);
      else if (kind === "owners") setOwners(rows as SalesOwner[]);
      else if (kind === "brands") setBrands(rows as BrandMaster[]);
    };
    reader.readAsText(file);
  };
 
  const tabBtn = (key: typeof tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      className={tab === key ? css.btn : css.btnOutline}
    >
      {label}
    </button>
  );
 
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {tabBtn("owners", "営業担当")}
        {tabBtn("brands", "ブランドマスタ")}
        {tabBtn("csv", "CSV import / export")}
      </div>
 
      {tab === "owners" && (
        <div className={css.card}>
          <div className={css.cardHeader}>営業担当マスタ</div>
          <div className={`${css.cardBody} space-y-3`}>
            <div className="flex gap-2">
              <input
                className={css.input}
                placeholder="担当者名"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
              />
              <button
                className={css.btn}
                onClick={() => {
                  if (!newOwner) return;
                  setOwners([
                    ...owners,
                    {
                      ownerId: "OW" + uid(),
                      ownerName: newOwner,
                      isActive: true,
                    },
                  ]);
                  setNewOwner("");
                }}
              >
                追加
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className={css.table}>
                <thead>
                  <tr>
                    <th className={css.th}>ownerId</th>
                    <th className={css.th}>担当者名</th>
                    <th className={css.th}>有効</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.map((o) => (
                    <tr key={o.ownerId}>
                      <td className={`${css.td} text-xs`}>{o.ownerId}</td>
                      <td className={css.td}>
                        <input
                          className={css.input}
                          value={o.ownerName}
                          onChange={(e) =>
                            setOwners(
                              owners.map((x) =>
                                x.ownerId === o.ownerId
                                  ? { ...x, ownerName: e.target.value }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className={css.td}>
                        <input
                          type="checkbox"
                          checked={o.isActive}
                          onChange={(e) =>
                            setOwners(
                              owners.map((x) =>
                                x.ownerId === o.ownerId
                                  ? { ...x, isActive: e.target.checked }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
 
      {tab === "brands" && (
        <div className={css.card}>
          <div className={css.cardHeader}>ブランドマスタ</div>
          <div className={`${css.cardBody} space-y-3`}>
            <div className="flex gap-2 flex-wrap">
              <select
                className={`${css.input} w-32`}
                value={newBrandCat}
                onChange={(e) => setNewBrandCat(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                className={css.input}
                placeholder="ブランド名"
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
              />
              <button
                className={css.btn}
                onClick={() => {
                  if (!newBrandName) return;
                  setBrands([
                    ...brands,
                    {
                      brandId: "BR" + uid(),
                      category: newBrandCat,
                      brandName: newBrandName,
                      isActive: true,
                    },
                  ]);
                  setNewBrandName("");
                }}
              >
                追加
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className={css.table}>
                <thead>
                  <tr>
                    <th className={css.th}>商材</th>
                    <th className={css.th}>ブランド名</th>
                    <th className={css.th}>有効</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b) => (
                    <tr key={b.brandId}>
                      <td className={css.td}>{b.category}</td>
                      <td className={css.td}>{b.brandName}</td>
                      <td className={css.td}>
                        <input
                          type="checkbox"
                          checked={b.isActive}
                          onChange={(e) =>
                            setBrands(
                              brands.map((x) =>
                                x.brandId === b.brandId
                                  ? { ...x, isActive: e.target.checked }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
 
      {tab === "csv" && (
        <div className={css.card}>
          <div className={css.cardHeader}>CSV import / export</div>
          <div className={`${css.cardBody} space-y-3`}>
            {[
              { key: "clients", data: clients, label: "加盟店 (clients)" },
              {
                key: "changeLogs",
                data: changeLogs,
                label: "変更履歴 (changeLogs)",
              },
              {
                key: "metrics",
                data: metrics,
                label: "事業数字 (businessMetrics)",
              },
              {
                key: "owners",
                data: owners,
                label: "営業担当 (salesOwners)",
              },
              {
                key: "brands",
                data: brands,
                label: "ブランド (brandMasters)",
              },
            ].map((g) => (
              <div
                key={g.key}
                className="flex items-center gap-2 border-b border-slate-200 py-2 flex-wrap"
              >
                <div className="w-60 text-sm">{g.label}</div>
                <button
                  className={css.btnOutline}
                  onClick={() => downloadCSV(`${g.key}.csv`, g.data)}
                >
                  Export
                </button>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onImport(g.key, f);
                  }}
                />
                <span className="text-xs text-slate-500">
                  {g.data.length}件
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
 
/* =========================================================================================
   ★ ダッシュボード（中心）
   ========================================================================================= */
function Dashboard({
  targetMonth,
  clients,
  changeLogs,
  metrics,
  owners,
  filterCats,
  filterOwners,
  weeklyForecasts,
  setWeeklyForecasts,
}: {
  targetMonth: string;
  clients: Client[];
  changeLogs: ChangeLog[];
  metrics: BusinessMetric[];
  owners: SalesOwner[];
  filterCats: string[];
  filterOwners: string[];
  weeklyForecasts: WeeklyForecastEntry[];
  setWeeklyForecasts: React.Dispatch<React.SetStateAction<WeeklyForecastEntry[]>>;
}) {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [storeBreakdownOpen, setStoreBreakdownOpen] = useState(false);
  const [forecastByCatOpen, setForecastByCatOpen] = useState(false);

  // 商材フィルターを反映した数字
  const targetCategories =
    filterCats.length > 0 ? filterCats : ([...CATEGORIES] as string[]);
  const monthMetrics = metrics
    .filter((m) => m.month === targetMonth)
    .filter((m) =>
      filterCats.length > 0 ? filterCats.includes(m.category) : true
    );

  const totalRev = monthMetrics.reduce((s, m) => s + m.revenue, 0);
  const totalGP = monthMetrics.reduce((s, m) => s + m.grossProfit, 0);
  const totalVU = monthMetrics.reduce((s, m) => s + m.validUsers, 0);
  const overallMetric = metrics.find(
    (m) => m.month === targetMonth && m.category === "全体"
  );
  const totalTargetRevenue =
    overallMetric?.category === "全体" && overallMetric.revenue > 0
      ? overallMetric.revenue
      : monthMetrics.reduce((s, m) => s + (m.targetRevenue || 0), 0);
  const totalTargetGP =
    overallMetric?.category === "全体" && overallMetric.grossProfit > 0
      ? overallMetric.grossProfit
      : monthMetrics.reduce((s, m) => s + (m.targetGrossProfit || 0), 0);
  const avgTargetCUP =
    overallMetric?.category === "全体" && overallMetric.validUsers > 0
      ? overallMetric.revenue / overallMetric.validUsers
      : (() => {
          const targetCUPs = monthMetrics
            .map((m) => m.targetCUP)
            .filter((v): v is number => typeof v === "number" && v > 0);
          return targetCUPs.length > 0
            ? targetCUPs.reduce((s, v) => s + v, 0) / targetCUPs.length
            : null;
        })();
  const grossRate = totalRev > 0 ? totalGP / totalRev : 0;

  // 今月想定
  const thisMonthForecast = useMemo(
    () => calcMonthlyForecast(targetMonth, clients, changeLogs, metrics, targetCategories),
    [targetMonth, clients, changeLogs, metrics, targetCategories]
  );

  // 来月想定
  const nextMonthForecast = useMemo(
    () => calcNextMonthForecast(
      targetMonth,
      clients,
      changeLogs,
      metrics,
      targetCategories,
      thisMonthForecast
    ),
    [targetMonth, clients, changeLogs, metrics, targetCategories, thisMonthForecast]
  );

  const thisMonthForecastByCat = useMemo(
    () => calcMonthlyForecastByCategory(
      targetMonth,
      clients,
      changeLogs,
      metrics,
      targetCategories
    ),
    [targetMonth, clients, changeLogs, metrics, targetCategories]
  );

  const nextMonth = monthKeyOfDate(
    new Date(
      +targetMonth.split("-")[0],
      +targetMonth.split("-")[1] - 1 + 1,
      1
    )
  );
  const nextMonthAvgVU = targetCategories.reduce(
    (s, cat) => s + (calcMonthlyOrAvgValidUsers(nextMonth, cat, metrics) || 0),
    0
  );
  const nextMonthGrossRate = calcAvgGrossRate(nextMonth, targetCategories, metrics) ?? 0.3;

  // 差分
  const nextDiffRev = nextMonthForecast.revenue - thisMonthForecast.revenue;
  const nextDiffGP = nextMonthForecast.grossProfit - thisMonthForecast.grossProfit;
  const nextDiffCup = nextMonthForecast.cup !== null && thisMonthForecast.cup !== null ? nextMonthForecast.cup - thisMonthForecast.cup : null;

  // 純増予算・顧客単価インパクト（サブ）
  const impact = useMemo(
    () => calcMonthlySnapshot(targetMonth, clients, changeLogs),
    [targetMonth, clients, changeLogs]
  );
  const sumImp = (obj: Record<string, number>) =>
    targetCategories.reduce((s, c) => s + (obj[c] || 0), 0);
  const totalNew = sumImp(impact.newAcq);
  const totalDecAll =
    sumImp(impact.withdraw) + sumImp(impact.suspendLoss) + sumImp(impact.otherDec);
  const totalNet = totalNew - totalDecAll;

  const totalAvgVU = targetCategories.reduce(
    (s, cat) => s + (calcMonthlyOrAvgValidUsers(targetMonth, cat, metrics) || 0),
    0
  );
  const overallNetCUP = totalAvgVU > 0 ? totalNet / totalAvgVU : null;

  const thisMonthStock = calcMonthlyStockBudget(
    targetMonth,
    clients,
    changeLogs,
    targetCategories
  ).stockBudget;

  const catRows = targetCategories.map((cat) => {
    const m = monthMetrics.find((x) => x.category === cat);
    const rev = m?.revenue ?? 0;
    const gp = m?.grossProfit ?? 0;
    const ad = m?.adCost ?? 0;
    const cv = m?.cv ?? 0;
    const gpRate = rev > 0 ? gp / rev : 0;
    const cpaCat = cv > 0 ? ad / cv : 0;
    const newAcq = impact.newAcq[cat] || 0;
    const wd = impact.withdraw[cat] || 0;
    const sl = impact.suspendLoss[cat] || 0;
    const od = impact.otherDec[cat] || 0;
    const net = newAcq - wd - sl - od;
    const headroom = net * gpRate;
    const accCPA = gpRate > 0 && cv > 0 ? (rev * gpRate) / cv : 0;

    // ── 顧客単価インパクト計算 ──
    const avgVU = calcMonthlyOrAvgValidUsers(targetMonth, cat, metrics);
    const avgCUP = calcMonthlyOrAvgCUP(targetMonth, cat, metrics);
    const newAcqCUP =
      avgVU !== null && avgVU > 0 ? newAcq / avgVU : null;
    const withdrawCUP =
      avgVU !== null && avgVU > 0 ? wd / avgVU : null;
    const suspendCUP =
      avgVU !== null && avgVU > 0 ? sl / avgVU : null;
    const otherCUP =
      avgVU !== null && avgVU > 0 ? od / avgVU : null;
    const netCUP =
      avgVU !== null && avgVU > 0 ? net / avgVU : null;
    const expectedCUP =
      avgCUP !== null && netCUP !== null ? avgCUP + netCUP : null;

    // ── 広告判断（顧客単価インパクト優先・CPA許容で補完） ──
    let judge: string;
    if (netCUP !== null && avgCUP !== null) {
      const lossDriverNeg =
        (withdrawCUP || 0) + (suspendCUP || 0) > (newAcqCUP || 0);
      const isBigDrop = avgCUP > 0 && Math.abs(netCUP) >= avgCUP * 0.05;
      if (
        net > 0 &&
        netCUP > 0 &&
        (cpaCat === 0 || accCPA >= cpaCat)
      )
        judge = "攻める";
      else if (netCUP > 0) judge = "維持";
      else if (netCUP < 0 && isBigDrop && lossDriverNeg) judge = "要営業補填";
      else if (netCUP < 0) judge = "抑制";
      else judge = "維持";
    } else {
      // 顧客単価が算出不可の場合は予算ベースで暫定判断
      if (net > 0 && (cpaCat === 0 || accCPA >= cpaCat)) judge = "攻める";
      else if (net > 0) judge = "維持";
      else if (net < 0 && wd + sl + od > newAcq * 1.2) judge = "要営業補填";
      else judge = "抑制";
    }

    // ── コメント自動生成 ──
    let comment = "";
    if (netCUP === null) {
      comment = `${cat}は有効ユーザーデータ不足のため顧客単価インパクト算出不可（予算ベースで判定）`;
    } else if (judge === "攻める") {
      comment = `${cat}は新規により顧客単価${yenSigned(netCUP)}上昇見込み`;
    } else if (judge === "維持") {
      comment =
        netCUP > 0
          ? `${cat}は顧客単価${yenSigned(netCUP)}でわずかに上昇。現状維持`
          : `${cat}は顧客単価ほぼ横ばい。現状維持`;
    } else if (judge === "抑制") {
      const items: [string, number][] = [
        ["停止", suspendCUP || 0],
        ["退会", withdrawCUP || 0],
        ["減額", otherCUP || 0],
      ];
      items.sort((a, b) => b[1] - a[1]);
      const top = items[0];
      if (top[1] > 0) {
        comment = `${cat}は${top[0]}影響で顧客単価${yenSigned(netCUP)}低下見込み。広告抑制を検討`;
      } else {
        comment = `${cat}は純増がマイナスのため広告抑制を検討`;
      }
    } else if (judge === "要営業補填") {
      const causes: string[] = [];
      if ((withdrawCUP || 0) > 0) causes.push("退会");
      if ((suspendCUP || 0) > 0) causes.push("停止");
      const cause = causes.join("・") || "減少要因";
      comment = `${cat}は${cause}影響大のため営業補填必要（顧客単価${yenSigned(netCUP)}）`;
    }

    return {
      cat,
      rev,
      gp,
      gpRate,
      ad,
      cv,
      cpaCat,
      newAcq,
      wd,
      sl,
      od,
      net,
      headroom,
      accCPA,
      judge,
      comment,
      avgVU,
      avgCUP,
      newAcqCUP,
      withdrawCUP,
      suspendCUP,
      otherCUP,
      netCUP,
      expectedCUP,
    };
  });

  // ── 全社平均（加重平均） ──
  const totalAvgVU_dashboard = catRows.reduce(
    (s, r) => s + (r.avgVU !== null ? r.avgVU : 0),
    0
  );

  const clientImpactRows = useMemo(() => {
    const rows = clients
      .map((c) => {
        const impact = calcClientImpact(targetMonth, c, changeLogs);
        return {
          ...impact,
          cupImpact: totalAvgVU_dashboard > 0 ? impact.net / totalAvgVU_dashboard : null,
        };
      })
      .filter(
        (r) =>
          Math.abs(Math.round(r.net)) > 0 ||
          r.newAcq > 0 ||
          r.withdraw > 0 ||
          r.suspendLoss > 0 ||
          r.otherDec > 0
      )
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 20);
    return rows;
  }, [clients, changeLogs, targetMonth, totalAvgVU_dashboard]);

  // ── ダッシュボード顧客単価 ──
  const monthlyCUP = calcMonthlyCUPByCategories(targetMonth, targetCategories, metrics);
  const prevM = prevMonth(targetMonth);
  const prevMonthlyCUP = calcMonthlyCUPByCategories(prevM, targetCategories, metrics);
  const prevMonthMetrics = metrics.filter(
    (m) => m.month === prevM && targetCategories.includes(m.category)
  );
  const prevVU = prevMonthMetrics.reduce((s, m) => s + m.validUsers, 0);

  let displayCUP = monthlyCUP;
  if (displayCUP === null) {
    // 予測
    if (prevMonthlyCUP !== null && prevVU > 0) {
      displayCUP = prevMonthlyCUP + totalNet / prevVU;
    } else {
      displayCUP = null;
    }
  }
  // 当月の日割り
  if (targetMonth === todayMonth() && displayCUP !== null) {
    const scheduled = clients.filter(c => c.status === 'scheduled' && c.startDate.startsWith(targetMonth));
    if (scheduled.length > 0) {
      const [y, m] = targetMonth.split('-').map(Number);
      const dim = daysInMonth(y, m);
      let additionalRev = 0;
      for (const c of scheduled) {
        const startDay = parseInt(c.startDate.split('-')[2]);
        const days = dim - startDay + 1;
        additionalRev += c.monthlyBudget * (days / dim);
      }
      if (prevMonthlyCUP !== null) {
        const additionalVU = additionalRev / prevMonthlyCUP;
        displayCUP = (totalRev + additionalRev) / (totalVU + additionalVU);
      }
    }
  }
 
  const suspendList = useMemo(() => {
    const [yStr, mStr] = targetMonth.split("-");
    const year = +yStr;
    const month = +mStr;
    const dim = daysInMonth(year, month);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month - 1, dim);
    return changeLogs
      .filter((l) => l.changeType === "suspend")
      .map((l) => {
        const eff = parseD(l.effectiveDate);
        const end = parseD(l.endDate || "") || monthEnd;
        if (!eff) return null;
        const ovStart = eff > monthStart ? eff : monthStart;
        const ovEnd = end < monthEnd ? end : monthEnd;
        if (ovEnd < ovStart) return null;
        const days =
          Math.floor((ovEnd.getTime() - ovStart.getTime()) / 86400000) + 1;
        const cl = clients.find((c) => c.billingId === l.billingId);
        if (!cl) return null;
        const cats = l.affectedCategories?.length
          ? l.affectedCategories
          : cl.categories;
        const monthlySuspendBudget = cats.reduce(
          (s, c) => s + (cl.categoryBudgets[c] ?? 0),
          0
        );
        const lossBudget = monthlySuspendBudget * (days / dim);
        const lossGP = lossBudget * grossRate;
        return {
          billingId: cl.billingId,
          companyName: cl.companyName,
          ownerName:
            owners.find((o) => o.ownerId === cl.salesOwnerId)?.ownerName ??
            "—",
          effectiveDate: l.effectiveDate,
          endDate: l.endDate || "未定",
          cats: cats.join(" / "),
          brands: l.affectedBrands.join(" / "),
          areas: l.affectedAreas.join(" / "),
          monthlySuspendBudget,
          lossBudget,
          lossGP,
          reason: l.reason,
          recovery: RECOVERY_LABEL[l.recoveryPossibility],
          action: l.action,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }, [targetMonth, clients, changeLogs, owners, grossRate]);

  const totalSuspendGP = suspendList.reduce((s, x) => s + x.lossGP, 0);

  const ownerSummary = useMemo(
    () => calcOwnerSummary(targetMonth, clients, changeLogs, owners, metrics),
    [targetMonth, clients, changeLogs, owners, metrics]
  );
 
  const rankNew = [...ownerSummary]
    .sort((a, b) => b.newBudget - a.newBudget)
    .slice(0, 10);
  const rankStock = [...ownerSummary]
    .sort((a, b) => b.stockBudget - a.stockBudget)
    .slice(0, 10);
 


  // 新グラフ用データ
  const netGraph = catRows.map((r) => ({
    cat: r.cat,
    value: Math.round(r.net),
  }));
  const cupImpactGraph = catRows.map((r) => ({
    cat: r.cat,
    value: r.netCUP === null ? null : Math.round(r.netCUP),
  }));
  const cupTrend = useMemo(() => {
    const [yStr, mStr] = targetMonth.split("-");
    const baseY = +yStr;
    const baseM = +mStr;
    const arr: any[] = [];
    for (let i = -11; i <= 0; i++) {
      const d = new Date(baseY, baseM - 1 + i, 1);
      const k = monthKeyOfDate(d);
      // 各商材の対象月時点の基準/想定を加重平均
      let sumVU = 0;
      let sumBase = 0;
      let sumImpact = 0;
      for (const cat of targetCategories) {
        const vu = calcMonthlyOrAvgValidUsers(k, cat, metrics);
        const cup = calcMonthlyOrAvgCUP(k, cat, metrics);
        if (vu !== null && cup !== null) {
          sumVU += vu;
          sumBase += vu * cup;
          const im = calcMonthlySnapshot(k, clients, changeLogs);
          const net =
            (im.newAcq[cat] || 0) -
            (im.withdraw[cat] || 0) -
            (im.suspendLoss[cat] || 0) -
            (im.otherDec[cat] || 0);
          sumImpact += net;
        }
      }
      const baseCUP = sumVU > 0 ? sumBase / sumVU : null;
      const impactCUP = sumVU > 0 ? sumImpact / sumVU : null;
      const expectedCUP =
        baseCUP !== null && impactCUP !== null ? baseCUP + impactCUP : null;
      arr.push({
        month: k,
        基準: baseCUP !== null ? Math.round(baseCUP) : null,
        想定: expectedCUP !== null ? Math.round(expectedCUP) : null,
      });
    }
    return arr;
  }, [targetMonth, clients, changeLogs, metrics, targetCategories]);

  // アラート生成
  const alertItems = useMemo(() => {
    const arr: {
      tone: "red" | "amber" | "green";
      title: string;
      detail: string;
    }[] = [];
    // 攻めるべき商材
    catRows
      .filter((r) => r.judge === "攻める")
      .forEach((r) => {
        arr.push({
          tone: "green",
          title: `${r.cat} は攻めどき`,
          detail: r.comment,
        });
      });
    // 要営業補填
    catRows
      .filter((r) => r.judge === "要営業補填")
      .forEach((r) => {
        arr.push({
          tone: "red",
          title: `${r.cat} は営業補填が必要`,
          detail: r.comment,
        });
      });
    // 顧客単価が低下している商材（要営業補填以外）
    catRows
      .filter(
        (r) =>
          r.judge !== "要営業補填" &&
          r.netCUP !== null &&
          r.netCUP < 0
      )
      .sort((a, b) => (a.netCUP || 0) - (b.netCUP || 0))
      .slice(0, 5)
      .forEach((r) => {
        arr.push({
          tone: "amber",
          title: `${r.cat} 顧客単価が低下`,
          detail: `想定顧客単価 ${yen(r.expectedCUP || 0)}（${yenSigned(
            r.netCUP || 0
          )}）`,
        });
      });
    // 停止損失が大きい商材
    const totalSL = catRows.reduce((s, r) => s + r.sl, 0);
    if (totalSL > 0) {
      catRows
        .filter((r) => r.sl > 0 && r.sl >= totalSL * 0.25)
        .sort((a, b) => b.sl - a.sl)
        .slice(0, 3)
        .forEach((r) => {
          arr.push({
            tone: "amber",
            title: `${r.cat} 停止損失が大きい`,
            detail: `停止損失予算 ${yen(r.sl)}（全体の${pct(r.sl / totalSL)}）`,
          });
        });
    }
    return arr;
  }, [catRows]);

  const weeklyForecastsForMonth = useMemo(
    () =>
      weeklyForecasts
        .filter((entry) => entry.month === targetMonth)
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    [weeklyForecasts, targetMonth]
  );

  const formatProgress = (actual: number, target: number | null) =>
    target && target > 0
      ? `${Math.round((actual / target) * 100)}%`
      : "";

  const today = new Date();
  const isMonday = today.getDay() === 1;
  const weekRange = getWeekForDate(today, targetMonth);

  const handleWeeklyUpdate = () => {
    const overall: WeeklyForecastSnapshot = {
      revenue: Math.round(thisMonthForecast.revenue),
      grossProfit: Math.round(thisMonthForecast.grossProfit),
      validUsers: Math.round(thisMonthForecast.expectedVU),
      cup: thisMonthForecast.cup,
    };

    const byCategory = targetCategories.reduce(
      (acc, cat) => {
        const f = thisMonthForecastByCat[cat];
        acc[cat] = {
          revenue: Math.round(f.revenue),
          grossProfit: Math.round(f.grossProfit),
          validUsers: Math.round(f.expectedVU),
          cup: f.cup,
        };
        return acc;
      },
      {} as Record<string, WeeklyForecastSnapshot>
    );

    const impactTotals = {
      newAcq: sumImp(impact.newAcq),
      withdraw: sumImp(impact.withdraw),
      suspendLoss: sumImp(impact.suspendLoss),
      otherDec: sumImp(impact.otherDec),
    };

    const entry: WeeklyForecastEntry = {
      id: uid(),
      month: targetMonth,
      weekLabel: weekRange.weekLabel,
      weekStart: dateKey(weekRange.start),
      weekEnd: dateKey(weekRange.end),
      updatedAt: new Date().toISOString(),
      overall,
      byCategory,
      impact: {
        ...impactTotals,
        net:
          impactTotals.newAcq -
          impactTotals.withdraw -
          impactTotals.suspendLoss -
          impactTotals.otherDec,
      },
    };

    setWeeklyForecasts((prev) => {
      const filtered = prev.filter(
        (item) =>
          !(item.month === targetMonth && item.weekLabel === weekRange.weekLabel)
      );
      return [...filtered, entry].sort((a, b) =>
        a.weekStart.localeCompare(b.weekStart)
      );
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs text-slate-500">{targetMonth}</div>
          <h1 className="text-2xl font-bold tracking-tight">事業ダッシュボード</h1>
          <p className="text-sm text-slate-500 mt-1">
            {filterCats.length === 0 && filterOwners.length === 0
              ? "対象月の事業数字を一目で判断"
              : `フィルター適用中：${[
                  ...(filterCats.length ? [`商材${filterCats.length}件`] : []),
                  ...(filterOwners.length ? [`営業${filterOwners.length}名`] : []),
                ].join(" / ")}`}
          </p>
        </div>
        <div className="text-xs text-slate-500">
          加盟店 <b>{clients.length}</b>件 / 変更履歴 <b>{changeLogs.length}</b>件 / 営業 <b>{owners.length}</b>名
        </div>
      </div>
 
      <div className="space-y-4">
        <div>
          <div className="text-sm font-semibold text-slate-700">今月着地予想</div>
          <div className="text-xs text-slate-500">現在実績 + 月末までの追加日割り - 月末までの停止/減額影響</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <BigKPI
            label="今月着地予想売上"
            value={yen(Math.round(thisMonthForecast.revenue))}
            sub={`粗利率 ${pct(thisMonthForecast.grossRate)}`}
            target={
              totalTargetRevenue > 0
                ? `目標 ${yen(Math.round(totalTargetRevenue))}`
                : undefined
            }
            progress={
              totalTargetRevenue > 0
                ? `進捗 ${formatProgress(
                    thisMonthForecast.revenue,
                    totalTargetRevenue
                  )}`
                : undefined
            }
            logic={
              <>
                <div>ランレート予測売上: {yen(Math.round(thisMonthForecast.baseForecastRevenue))}</div>
                <div className="text-xs text-slate-500 mb-1">前日締め実績を月末まで伸ばしたもの</div>
                <div>未反映期間の開始/再開追加: {yen(Math.round(thisMonthForecast.newStartImpact + thisMonthForecast.resumeImpact))}</div>
                <div>未反映期間の停止/退会影響: −{yen(Math.round(thisMonthForecast.stopRevenue + thisMonthForecast.withdrawRevenue))}</div>
                <div>未反映期間の減額影響: −{yen(Math.round(thisMonthForecast.reduceRevenue))}</div>
                <div className="font-semibold">合計着地予想売上: {yen(Math.round(thisMonthForecast.revenue))}</div>
              </>
            }
          />
          <BigKPI
            label="今月着地予想粗利"
            value={yen(Math.round(thisMonthForecast.grossProfit))}
            sub={`売上 ${yen(Math.round(thisMonthForecast.revenue))}`}
            target={
              totalTargetGP > 0
                ? `目標 ${yen(Math.round(totalTargetGP))}`
                : undefined
            }
            progress={
              totalTargetGP > 0
                ? `進捗 ${formatProgress(
                    thisMonthForecast.grossProfit,
                    totalTargetGP
                  )}`
                : undefined
            }
            logic={
              <>
                <div>着地予想売上: {yen(Math.round(thisMonthForecast.revenue))}</div>
                <div>粗利率: {pct(thisMonthForecast.grossRate)}</div>
                <div className="font-semibold">着地予想粗利: {yen(Math.round(thisMonthForecast.grossProfit))}</div>
              </>
            }
          />
          <BigKPI
            label="今月着地予想顧客単価"
            value={thisMonthForecast.cup !== null ? yen(Math.round(thisMonthForecast.cup)) : "—"}
            sub={`有効ユーザー ${Math.round(thisMonthForecast.expectedVU)}`}
            target={
              avgTargetCUP !== null
                ? `目標 ${yen(Math.round(avgTargetCUP))}`
                : undefined
            }
            progress={
              avgTargetCUP !== null && thisMonthForecast.cup !== null
                ? `進捗 ${formatProgress(
                    thisMonthForecast.cup,
                    avgTargetCUP
                  )}`
                : undefined
            }
            logic={
              <>
                <div>着地予想売上: {yen(Math.round(thisMonthForecast.revenue))}</div>
                <div>想定有効ユーザー: {Math.round(thisMonthForecast.expectedVU)}</div>
                <div className="font-semibold">着地予想顧客単価: {thisMonthForecast.cup !== null ? yen(Math.round(thisMonthForecast.cup)) : "—"}</div>
              </>
            }
          />
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-sm font-semibold text-slate-700">来月予測（ストック）</div>
          <div className="text-xs text-slate-500">対象月時点の有効加盟店ストックを基準に算出</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <BigKPI
            label="今月ストック"
            value={yen(Math.round(thisMonthStock))}
            sub="今月時点のストック"
            logic={
              <>
                <div>対象月: {targetMonth}</div>
                <div>有効加盟店数: {clients.filter(c => c.status === 'active').length}件</div>
                <div>ストック予算合計: {yen(Math.round(thisMonthStock))}</div>
              </>
            }
          />
          <BigKPI
            label="来月ストック"
            value={yen(Math.round(nextMonthForecast.nextMonthStock))}
            sub="翌月時点のストック"
            logic={
              <>
                <div>対象月: {nextMonth}</div>
                <div>有効加盟店数: {clients.filter(c => c.status === 'active').length}件（変更適用後）</div>
                <div>ストック予算合計: {yen(Math.round(nextMonthForecast.nextMonthStock))}</div>
              </>
            }
          />
          <BigKPI
            label="ストック差分"
            value={yenSigned(nextMonthForecast.stockDiff)}
            tone={
              nextMonthForecast.stockDiff > 0
                ? "up"
                : nextMonthForecast.stockDiff < 0
                ? "down"
                : "flat"
            }
            sub="翌月 − 当月"
            logic={
              <>
                <div>来月ストック: {yen(Math.round(nextMonthForecast.nextMonthStock))}</div>
                <div>今月ストック: {yen(Math.round(thisMonthStock))}</div>
                <div className="font-semibold">差分: {yenSigned(nextMonthForecast.stockDiff)}</div>
              </>
            }
          />
          <BigKPI
            label="来月予測売上"
            value={yen(Math.round(nextMonthForecast.revenue))}
            sub={`前月差分 ${yenSigned(nextDiffRev)}`}
            logic={
              <>
                <div>今月着地予想売上: {yen(Math.round(thisMonthForecast.revenue))}</div>
                <div>ストック差分: {yenSigned(nextMonthForecast.stockDiff)}</div>
                <div className="font-semibold">来月予測売上: {yen(Math.round(nextMonthForecast.revenue))}</div>
              </>
            }
          />
          <BigKPI
            label="来月予測粗利"
            value={yen(Math.round(nextMonthForecast.grossProfit))}
            sub={`前月差分 ${yenSigned(nextDiffGP)}`}
            logic={
              <>
                <div>来月予測売上: {yen(Math.round(nextMonthForecast.revenue))}</div>
                <div>想定粗利率: {pct(nextMonthGrossRate)}</div>
                <div className="font-semibold">来月予測粗利: {yen(Math.round(nextMonthForecast.grossProfit))}</div>
              </>
            }
          />
          <BigKPI
            label="来月予測顧客単価"
            value={nextMonthForecast.cup !== null ? yen(Math.round(nextMonthForecast.cup)) : "—"}
            sub={nextDiffCup !== null ? `前月差分 ${yenSigned(nextDiffCup)}` : ""}
            logic={
              <>
                <div>来月予測売上: {yen(Math.round(nextMonthForecast.revenue))}</div>
                <div>想定有効ユーザー: {Math.round(nextMonthAvgVU)}</div>
                <div className="font-semibold">来月予測顧客単価: {nextMonthForecast.cup !== null ? yen(Math.round(nextMonthForecast.cup)) : "—"}</div>
              </>
            }
          />
        </div>
      </div>

      {/* ② 週次着地予想 */}
      <div className="space-y-4">
        <div>
          <div className="text-sm font-semibold text-slate-700">週次着地予想</div>
          <div className="text-xs text-slate-500">
            毎週月曜日に「週予測を更新」を押すと、その週の進捗と着地予想が履歴として残ります。
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            className={`inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold text-white transition ${
              isMonday
                ? "bg-slate-900 hover:bg-slate-700"
                : "bg-slate-400 cursor-not-allowed"
            }`}
            onClick={handleWeeklyUpdate}
            disabled={!isMonday}
          >
            週予測を更新
          </button>
          <div className="text-xs text-slate-500">
            {isMonday
              ? "本日は週予測更新日です。"
              : "毎週月曜日に週予測を更新してください。"}
          </div>
        </div>

        {weeklyForecastsForMonth.length === 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            週次予測の履歴がありません。週予測を更新すると「第1週」から順に記録されます。
          </div>
        ) : (
          weeklyForecastsForMonth.map((entry, index) => {
            const prevEntry = index > 0 ? weeklyForecastsForMonth[index - 1] : null;
            const revDiff = prevEntry
              ? entry.overall.revenue - prevEntry.overall.revenue
              : 0;
            const gpDiff = prevEntry
              ? entry.overall.grossProfit - prevEntry.overall.grossProfit
              : 0;
            const userDiff = prevEntry
              ? entry.overall.validUsers - prevEntry.overall.validUsers
              : 0;
            const diffClass = (val: number) =>
              val > 0
                ? "text-emerald-600"
                : val < 0
                ? "text-rose-600"
                : "text-slate-600";

            return (
              <details
                key={entry.id}
                className={css.card}
                open={index === weeklyForecastsForMonth.length - 1}
              >
                <summary
                  className={`${css.cardHeader} cursor-pointer select-none flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}
                >
                  <div>
                    <div className="font-semibold">
                      {entry.weekLabel} ({entry.weekStart}〜{entry.weekEnd})
                    </div>
                    <div className="text-xs text-slate-500">
                      更新: {new Date(entry.updatedAt).toLocaleDateString("ja-JP")}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <div className={diffClass(revDiff)}>
                      売上 {yen(Math.round(entry.overall.revenue))}
                      {prevEntry ? ` (${revDiff >= 0 ? "+" : ""}${yenSigned(revDiff)})` : ""}
                    </div>
                    <div className={diffClass(gpDiff)}>
                      粗利 {yen(Math.round(entry.overall.grossProfit))}
                      {prevEntry ? ` (${gpDiff >= 0 ? "+" : ""}${yenSigned(gpDiff)})` : ""}
                    </div>
                    <div className={diffClass(userDiff)}>
                      有効ユーザー {Math.round(entry.overall.validUsers)}
                      {prevEntry ? ` (${userDiff >= 0 ? "+" : ""}${userDiff})` : ""}
                    </div>
                  </div>
                </summary>
                <div className={css.cardBody}>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-3">
                      <div className="text-sm font-semibold text-slate-700">全体着地予想</div>
                      <div className="grid grid-cols-2 gap-2 text-sm text-slate-700">
                        <div>売上</div>
                        <div className="text-right">{yen(Math.round(entry.overall.revenue))}</div>
                        <div>粗利</div>
                        <div className="text-right">{yen(Math.round(entry.overall.grossProfit))}</div>
                        <div>有効ユーザー</div>
                        <div className="text-right">{Math.round(entry.overall.validUsers)}</div>
                        <div>顧客単価</div>
                        <div className="text-right">
                          {entry.overall.cup !== null
                            ? yen(Math.round(entry.overall.cup))
                            : "—"}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-slate-700">増減内訳</div>
                      <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                        <div>新規</div>
                        <div className="text-right">{yen(entry.impact.newAcq)}</div>
                        <div>退会</div>
                        <div className="text-right">−{yen(entry.impact.withdraw)}</div>
                        <div>停止</div>
                        <div className="text-right">−{yen(entry.impact.suspendLoss)}</div>
                        <div>減額</div>
                        <div className="text-right">−{yen(entry.impact.otherDec)}</div>
                        <div className="font-semibold">純増</div>
                        <div className="text-right font-semibold">
                          {yenSigned(entry.impact.net)}
                        </div>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <div className="text-sm font-semibold text-slate-700 mb-2">
                        商材別着地予想
                      </div>
                      <table className="min-w-[640px] w-full text-sm border-collapse">
                        <thead>
                          <tr>
                            {[
                              "商材",
                              "売上",
                              "粗利",
                              "顧客単価",
                              "有効ユーザー",
                            ].map((h) => (
                              <th key={h} className={`${css.th} text-left`}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {targetCategories.map((cat) => {
                            const row =
                              entry.byCategory[cat] ?? {
                                revenue: 0,
                                grossProfit: 0,
                                validUsers: 0,
                                cup: null,
                              };
                            return (
                              <tr key={cat} className="hover:bg-slate-50">
                                <td className={css.td}>{cat}</td>
                                <td className={`${css.td} text-right`}>
                                  {yen(Math.round(row.revenue))}
                                </td>
                                <td className={`${css.td} text-right`}>
                                  {yen(Math.round(row.grossProfit))}
                                </td>
                                <td className={`${css.td} text-right`}>
                                  {row.cup !== null ? yen(Math.round(row.cup)) : "—"}
                                </td>
                                <td className={`${css.td} text-right`}>
                                  {Math.round(row.validUsers)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </details>
            );
          })
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <BigKPI
          label="純増予算"
          value={yenSigned(totalNet)}
          tone={totalNet > 0 ? "up" : totalNet < 0 ? "down" : "flat"}
          sub="新規 − 減少"
          onClick={() => setStoreBreakdownOpen((v) => !v)}
          logic={
            <>
              <div>新規獲得予算: {yen(Math.round(totalNew))}</div>
              <div>退会予算: −{yen(Math.round(sumImp(impact.withdraw)))}</div>
              <div>停止損失予算: −{yen(Math.round(sumImp(impact.suspendLoss)))}</div>
              <div>減額予算: −{yen(Math.round(sumImp(impact.otherDec)))}</div>
              <div className="font-semibold">純増予算: {yenSigned(totalNet)}</div>
            </>
          }
        />
        <BigKPI
          label="顧客単価インパクト"
          value={overallNetCUP !== null ? yenSigned(overallNetCUP) : "—"}
          tone={
            overallNetCUP === null
              ? undefined
              : overallNetCUP > 0
              ? "up"
              : overallNetCUP < 0
              ? "down"
              : "flat"
          }
          sub="純増による顧客単価変動"
          onClick={() => setStoreBreakdownOpen((v) => !v)}
          logic={
            <>
              <div>純増予算: {yenSigned(totalNet)}</div>
              <div>平均有効ユーザー数: {Math.round(totalAvgVU)}</div>
              <div className="font-semibold">顧客単価インパクト: {overallNetCUP !== null ? yenSigned(overallNetCUP) : "—"}</div>
            </>
          }
        />
      </div>

      <details
        className={css.card}
        open={forecastByCatOpen}
        onToggle={(e) => setForecastByCatOpen(e.currentTarget.open)}
      >
        <summary
          className={`${css.cardHeader} cursor-pointer select-none flex items-center justify-between`}
        >
          <span>今月着地予想（商材別）</span>
          <span className="text-xs text-slate-400">▾ クリックで展開</span>
        </summary>
        <div className={css.cardBody}>
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full text-sm border-collapse">
              <thead>
                <tr>
                  {[
                    "商材",
                    "着地予想売上",
                    "着地予想粗利",
                    "着地予想顧客単価",
                    "想定有効ユーザー",
                  ].map((h) => (
                    <th key={h} className={`${css.th} text-left`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targetCategories.map((cat) => {
                  const f = thisMonthForecastByCat[cat];
                  return (
                    <tr key={cat} className="hover:bg-slate-50">
                      <td className={css.td}>{cat}</td>
                      <td className={`${css.td} text-right`}>{yen(Math.round(f.revenue))}</td>
                      <td className={`${css.td} text-right`}>{yen(Math.round(f.grossProfit))}</td>
                      <td className={`${css.td} text-right`}>
                        {f.cup !== null ? yen(Math.round(f.cup)) : "—"}
                      </td>
                      <td className={`${css.td} text-right`}>{Math.round(f.expectedVU)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details
        className={css.card}
        open={storeBreakdownOpen}
        onToggle={(e) => setStoreBreakdownOpen(e.currentTarget.open)}
      >
        <summary
          className={`${css.cardHeader} cursor-pointer select-none flex items-center justify-between`}
        >
          <span>店舗内訳：純増予算 / 顧客単価インパクト</span>
          <span className="text-xs text-slate-400">▾ クリックで展開</span>
        </summary>
        <div className={css.cardBody}>
          <div className="text-sm text-slate-500 mb-3">
            影響の大きい店舗を上位20件まで表示しています。顧客単価インパクトは全体の平均有効ユーザー数で推定しています。
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm border-collapse">
              <thead>
                <tr>
                  {[
                    "請求ID",
                    "会社名",
                    "商材",
                    "ステータス",
                    "純増予算",
                    "顧客単価影響",
                    "内訳",
                  ].map((h) => (
                    <th key={h} className={`${css.th} text-left`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientImpactRows.map((r) => (
                  <tr key={r.billingId} className="hover:bg-slate-50">
                    <td className={`${css.td} font-medium`}>{r.billingId}</td>
                    <td className={css.td}>{r.companyName}</td>
                    <td className={css.td}>{r.categories.join(" / ")}</td>
                    <td className={css.td}>{r.status}</td>
                    <td className={`${css.td} text-right`}>{signedCell(r.net)}</td>
                    <td className={`${css.td} text-right`}>
                      {r.cupImpact !== null ? signedCell(r.cupImpact) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={css.td}>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {/* ④ アラートセクション */}
      <AlertsCard alerts={alertItems} />

      {/* ⑤ グラフ */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ChartCard title="商材別 純増予算">
          <BarChart data={netGraph}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="cat" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: any) => yen(Number(v))} />
            <Bar dataKey="value">
              {netGraph.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.value >= 0 ? "#10b981" : "#ef4444"}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>
        <ChartCard title="商材別 顧客単価インパクト">
          <BarChart data={cupImpactGraph}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="cat" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v: any) =>
                v === null ? "算出不可" : yen(Number(v))
              }
            />
            <Bar dataKey="value">
              {cupImpactGraph.map((d, i) => (
                <Cell
                  key={i}
                  fill={
                    d.value === null
                      ? "#cbd5e1"
                      : d.value >= 0
                      ? "#10b981"
                      : "#ef4444"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>
        <ChartCard title="月別 顧客単価推移">
          <LineChart data={cupTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v: any) =>
                v === null || v === undefined ? "—" : yen(Number(v))
              }
            />
            <Legend />
            <Line dataKey="基準" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            <Line
              dataKey="想定"
              stroke="#10b981"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ChartCard>
      </div>

      {/* 今後の顧客単価インパクト要約カード */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-slate-700">
            今後の顧客単価インパクト（商材別）
          </div>
          <div className="text-xs text-slate-500">
            カードをクリックで未来12ヶ月の詳細を表示
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {catRows.map((r) => {
            const summary = calcFutureCUPSummary(
              r.cat,
              targetMonth,
              clients,
              changeLogs,
              metrics
            );
            return (
              <CategorySummaryCard
                key={r.cat}
                summary={summary}
                onClick={() => setSelectedCat(r.cat)}
              />
            );
          })}
        </div>
      </div>

      {/* 詳細モーダル */}
      {selectedCat && (
        <CategoryDetailModal
          cat={selectedCat}
          targetMonth={targetMonth}
          clients={clients}
          changeLogs={changeLogs}
          metrics={metrics}
          owners={owners}
          onClose={() => setSelectedCat(null)}
        />
      )}

      {/* ⑥ 詳細テーブル（折りたたみ） */}
      <details className={css.card}>
        <summary
          className={`${css.cardHeader} cursor-pointer select-none flex items-center justify-between`}
        >
          <span>詳細：商材別インパクト表</span>
          <span className="text-xs text-slate-400">▾ クリックで展開</span>
        </summary>
        <div className={css.cardBody}>
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th
                    className={`${css.th} sticky left-0 bg-slate-50 z-10 text-left`}
                  >
                    商材
                  </th>
                  {[
                    "売上",
                    "粗利",
                    "粗利率",
                    "CPA",
                    "新規",
                    "退会",
                    "停止",
                    "他減",
                    "純増",
                    "顧客単価Δ",
                    "判断",
                  ].map((h) => (
                    <th key={h} className={`${css.th} text-right`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catRows.map((r) => (
                  <tr key={r.cat} className="hover:bg-slate-50">
                    <td
                      className={`${css.td} font-medium sticky left-0 bg-white`}
                    >
                      {r.cat}
                    </td>
                    <td className={`${css.td} text-right`}>{numCell(r.rev)}</td>
                    <td className={`${css.td} text-right`}>{numCell(r.gp)}</td>
                    <td className={`${css.td} text-right text-slate-600`}>
                      {r.rev > 0 ? pct(r.gpRate) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`${css.td} text-right`}>
                      {r.cv > 0 ? (
                        yen(r.cpaCat)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`${css.td} text-right`}>{posCell(r.newAcq)}</td>
                    <td className={`${css.td} text-right`}>{negCell(r.wd)}</td>
                    <td className={`${css.td} text-right`}>{negCell(r.sl)}</td>
                    <td className={`${css.td} text-right`}>{negCell(r.od)}</td>
                    <td className={`${css.td} text-right font-semibold`}>
                      {signedCell(r.net)}
                    </td>
                    <td className={`${css.td} text-right`}>
                      {r.netCUP === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        signedCell(r.netCUP)
                      )}
                    </td>
                    <td className={css.td}>
                      <JudgeBadge judge={r.judge} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {/* 詳細：営業担当別サマリー（折りたたみ） */}
      <details className={css.card}>
        <summary
          className={`${css.cardHeader} cursor-pointer select-none flex items-center justify-between`}
        >
          <span>詳細：営業担当別サマリー / ランキング</span>
          <span className="text-xs text-slate-400">▾ クリックで展開</span>
        </summary>
        <div className={`${css.cardBody} space-y-4`}>
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th
                    className={`${css.th} sticky left-0 bg-slate-50 z-10 text-left`}
                  >
                    担当
                  </th>
                  {[
                    "新規社数",
                    "新規予算",
                    "退会社数",
                    "退会減少",
                    "停止社数",
                    "停止損失",
                    "他減",
                    "純増",
                    "保持",
                    "配信中",
                  ].map((h) => (
                    <th key={h} className={`${css.th} text-right`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ownerSummary.map((o) => (
                  <tr key={o.ownerId} className="hover:bg-slate-50">
                    <td
                      className={`${css.td} font-medium sticky left-0 bg-white`}
                    >
                      {o.ownerName}
                    </td>
                    <td className={`${css.td} text-right`}>{o.newCount}</td>
                    <td className={`${css.td} text-right`}>
                      {posCell(o.newBudget)}
                    </td>
                    <td className={`${css.td} text-right`}>{o.withdrawCount}</td>
                    <td className={`${css.td} text-right`}>
                      {negCell(o.withdrawBudget)}
                    </td>
                    <td className={`${css.td} text-right`}>{o.suspendCount}</td>
                    <td className={`${css.td} text-right`}>
                      {negCell(o.suspendLossBudget)}
                    </td>
                    <td className={`${css.td} text-right`}>
                      {negCell(o.otherDec)}
                    </td>
                    <td
                      className={`${css.td} text-right font-semibold`}
                    >
                      {signedCell(o.net)}
                    </td>
                    <td className={`${css.td} text-right font-semibold`}>
                      {numCell(o.stockBudget)}
                    </td>
                    <td className={`${css.td} text-right`}>{o.activeClients}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-semibold mb-1">獲得予算ランキング</div>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={css.th}>順位</th>
                    <th className={css.th}>担当</th>
                    <th className={`${css.th} text-right`}>新規社数</th>
                    <th className={`${css.th} text-right`}>新規予算</th>
                  </tr>
                </thead>
                <tbody>
                  {rankNew.map((o, i) => (
                    <tr key={o.ownerId}>
                      <td className={css.td}>{i + 1}</td>
                      <td className={css.td}>{o.ownerName}</td>
                      <td className={`${css.td} text-right`}>{o.newCount}</td>
                      <td className={`${css.td} text-right`}>
                        {posCell(o.newBudget)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-sm font-semibold mb-1">保持予算ランキング</div>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={css.th}>順位</th>
                    <th className={css.th}>担当</th>
                    <th className={`${css.th} text-right`}>配信中</th>
                    <th className={`${css.th} text-right`}>保持予算</th>
                  </tr>
                </thead>
                <tbody>
                  {rankStock.map((o, i) => (
                    <tr key={o.ownerId}>
                      <td className={css.td}>{i + 1}</td>
                      <td className={css.td}>{o.ownerName}</td>
                      <td className={`${css.td} text-right`}>
                        {o.activeClients}
                      </td>
                      <td className={`${css.td} text-right`}>
                        {numCell(o.stockBudget)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </details>

      {/* 詳細：停止中クライアント（折りたたみ） */}
      <details className={css.card}>
        <summary
          className={`${css.cardHeader} cursor-pointer select-none flex items-center justify-between`}
        >
          <span>
            詳細：停止中クライアント（{suspendList.length}件 / 損失粗利{" "}
            {yen(totalSuspendGP)}）
          </span>
          <span className="text-xs text-slate-400">▾ クリックで展開</span>
        </summary>
        <div className={css.cardBody}>
          {suspendList.length === 0 ? (
            <div className="text-sm text-slate-500">該当なし</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1100px] w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th
                      className={`${css.th} sticky left-0 bg-slate-50 z-10 text-left`}
                    >
                      会社名
                    </th>
                    {[
                      "営業",
                      "停止日",
                      "再開予定",
                      "停止商材",
                      "月間停止予算",
                      "損失予算",
                      "損失粗利",
                      "復活見込",
                    ].map((h) => (
                      <th key={h} className={css.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suspendList.map((s, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td
                        className={`${css.td} font-medium sticky left-0 bg-white`}
                      >
                        {s.companyName}
                      </td>
                      <td className={css.td}>{s.ownerName}</td>
                      <td className={`${css.td} text-xs`}>{s.effectiveDate}</td>
                      <td className={`${css.td} text-xs`}>{s.endDate}</td>
                      <td className={`${css.td} text-xs`}>{s.cats}</td>
                      <td className={`${css.td} text-right`}>
                        {numCell(s.monthlySuspendBudget)}
                      </td>
                      <td className={`${css.td} text-right`}>
                        {negCell(s.lossBudget)}
                      </td>
                      <td className={`${css.td} text-right`}>
                        {negCell(s.lossGP)}
                      </td>
                      <td className={`${css.td} text-xs`}>{s.recovery}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

 
function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactElement;
}) {
  return (
    <div className={css.card}>
      <div className={css.cardHeader}>{title}</div>
      <div className={css.cardBody} style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
 
function JudgeBadge({ judge }: { judge: string }) {
  const map: Record<string, string> = {
    攻める: "bg-emerald-100 text-emerald-700 border-emerald-300",
    維持: "bg-slate-100 text-slate-700 border-slate-300",
    抑制: "bg-amber-100 text-amber-700 border-amber-300",
    要営業補填: "bg-red-100 text-red-700 border-red-300",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded border ${map[judge] || ""}`}
    >
      {judge}
    </span>
  );
}

/**
 * 顧客単価インパクト表示セル
 * - sign="pos": 加算インパクト（新規） → 緑 + 表記
 * - sign="neg": 減算インパクト（退会・停止・その他、入力値はプラスだが意味的にマイナス） → 赤 − 表記
 * - sign="auto": 純増（実際の符号通り）
 * - v=null: 算出不可（グレー）
 */
/* =========================================================================================
   意思決定UI 用の新コンポーネント
   ========================================================================================= */

/* ---------- BigKPI（大きめKPIカード） ---------- */
function BigKPI({
  label,
  value,
  sub,
  tone,
  onClick,
  target,
  progress,
  logic,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "flat";
  onClick?: () => void;
  target?: string;
  progress?: string;
  logic?: React.ReactNode;
}) {
  const color =
    tone === "up"
      ? "text-emerald-600"
      : tone === "down"
      ? "text-red-600"
      : tone === "flat"
      ? "text-slate-500"
      : "text-slate-900";
  const [logicOpen, setLogicOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div
        className={`bg-white rounded-lg border border-slate-200 p-4 transition ${
          onClick ? "cursor-pointer hover:shadow-sm" : ""
        }`}
        onClick={onClick}
      >
        <div className="text-[11px] text-slate-500">{label}</div>
        <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
        {(sub || target || progress) && (
          <div className="mt-2 space-y-1 text-[10px] text-slate-500">
            {sub && <div className="truncate">{sub}</div>}
            {(target || progress) && (
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                <div>{target}</div>
                <div>{progress}</div>
              </div>
            )}
          </div>
        )}
      </div>
      {logic && (
        <details
          className="bg-slate-50 rounded-lg border border-slate-200"
          open={logicOpen}
          onToggle={(e) => setLogicOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer select-none p-2 text-xs text-slate-600 hover:bg-slate-100 rounded-t-lg">
            計算ロジック ▾
          </summary>
          <div className="p-3 text-xs text-slate-700 space-y-1">
            {logic}
          </div>
        </details>
      )}
    </div>
  );
}

/* ---------- 数値セル（右寄せ・¥フォーマット・0はグレー） ---------- */
function numCell(v: number) {
  if (Math.round(v) === 0) return <span className="text-slate-400">¥0</span>;
  return <span className="tabular-nums">{yen(v)}</span>;
}
function posCell(v: number) {
  if (Math.round(v) === 0) return <span className="text-slate-400">¥0</span>;
  return <span className="text-emerald-600 tabular-nums">+{yen(v)}</span>;
}
function negCell(v: number) {
  if (Math.round(v) === 0) return <span className="text-slate-400">¥0</span>;
  return <span className="text-red-600 tabular-nums">−{yen(v)}</span>;
}
function signedCell(v: number) {
  if (Math.round(v) === 0) return <span className="text-slate-400">¥0</span>;
  if (v > 0)
    return <span className="text-emerald-600 tabular-nums">+{yen(v)}</span>;
  return (
    <span className="text-red-600 tabular-nums">−{yen(Math.abs(v))}</span>
  );
}

/* ---------- アラートカード ---------- */
function AlertsCard({
  alerts,
}: {
  alerts: { tone: "red" | "amber" | "green"; title: string; detail: string }[];
}) {
  return (
    <div className={css.card}>
      <div className={`${css.cardHeader} flex items-center justify-between`}>
        <span>意思決定アラート</span>
        <span className="text-xs text-slate-400">
          {alerts.length}件 / 優先度高い順
        </span>
      </div>
      <div className={css.cardBody}>
        {alerts.length === 0 ? (
          <div className="text-sm text-slate-500">
            特筆すべきアラートはありません
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <AlertRow key={i} {...a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function AlertRow({
  tone,
  title,
  detail,
}: {
  tone: "red" | "amber" | "green";
  title: string;
  detail: string;
}) {
  const styles =
    tone === "red"
      ? "bg-red-50 border-red-200 text-red-800"
      : tone === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-emerald-50 border-emerald-200 text-emerald-800";
  const icon = tone === "red" ? "!" : tone === "amber" ? "△" : "↑";
  return (
    <div className={`flex gap-3 border rounded-md p-3 ${styles}`}>
      <div className="text-lg leading-none font-bold w-5 text-center">
        {icon}
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs mt-0.5 opacity-80">{detail}</div>
      </div>
    </div>
  );
}

/* ---------- 商材別 顧客単価インパクト要約カード ---------- */
function CategorySummaryCard({
  summary,
  onClick,
}: {
  summary: FutureSummary;
  onClick: () => void;
}) {
  const next = summary.nextChangeMonth;
  const nextDelta = summary.nextCUPDelta;
  const full = summary.fullEffectMonth;
  const fullDelta = summary.fullCUPDelta;
  const judgeBadgeColor: Record<string, string> = {
    攻める: "bg-emerald-100 text-emerald-700 border-emerald-300",
    維持: "bg-slate-100 text-slate-700 border-slate-300",
    抑制: "bg-amber-100 text-amber-700 border-amber-300",
    要営業補填: "bg-red-100 text-red-700 border-red-300",
    "—": "bg-slate-100 text-slate-400 border-slate-200",
  };
  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-lg border border-slate-200 p-4 hover:shadow-md hover:border-slate-400 transition w-full"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-base font-bold">{summary.cat}</div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded border ${
            judgeBadgeColor[summary.judge]
          }`}
        >
          {summary.judge}
        </span>
      </div>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">次回変動</span>
          <span className="font-medium">
            {next ? (
              <>
                {next}{" "}
                <span
                  className={
                    nextDelta && nextDelta > 0
                      ? "text-emerald-600"
                      : nextDelta && nextDelta < 0
                      ? "text-red-600"
                      : "text-slate-400"
                  }
                >
                  {nextDelta !== null ? yenSigned(nextDelta) : "—"}
                </span>
              </>
            ) : (
              <span className="text-slate-400">変動なし</span>
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">満額反映</span>
          <span className="font-medium">
            {full ? (
              <>
                {full}{" "}
                <span
                  className={
                    fullDelta && fullDelta > 0
                      ? "text-emerald-600"
                      : fullDelta && fullDelta < 0
                      ? "text-red-600"
                      : "text-slate-400"
                  }
                >
                  {fullDelta !== null ? yenSigned(fullDelta) : "—"}
                </span>
              </>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">主な要因</span>
          <span className="font-medium truncate ml-2 max-w-[140px]">
            {summary.topDrivers.length > 0
              ? summary.topDrivers.join(", ")
              : "—"}
          </span>
        </div>
      </div>
      <div className="text-[10px] text-slate-400 mt-2 text-right">
        クリックで詳細 →
      </div>
    </button>
  );
}

/* ---------- 商材詳細モーダル ---------- */
function CategoryDetailModal({
  cat,
  targetMonth,
  clients,
  changeLogs,
  metrics,
  owners,
  onClose,
}: {
  cat: string;
  targetMonth: string;
  clients: Client[];
  changeLogs: ChangeLog[];
  metrics: BusinessMetric[];
  owners: SalesOwner[];
  onClose: () => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const summary = useMemo(
    () => calcFutureCUPSummary(cat, targetMonth, clients, changeLogs, metrics),
    [cat, targetMonth, clients, changeLogs, metrics]
  );
  const avgVU = summary.avgVU;
  const avgCUP = summary.avgCUP;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-auto my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <div className="text-xs text-slate-500">商材詳細</div>
            <div className="text-xl font-bold">{cat}</div>
          </div>
          <button
            onClick={onClose}
            className="text-2xl text-slate-400 hover:text-slate-600 leading-none px-2"
          >
            ×
          </button>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <BigKPI
              label="直近3ヶ月平均 有効ユーザー"
              value={avgVU !== null ? Math.round(avgVU).toLocaleString() : "—"}
            />
            <BigKPI
              label="基準顧客単価"
              value={avgCUP !== null ? yen(avgCUP) : "—"}
            />
            <BigKPI
              label="次回変動"
              value={
                summary.nextCUPDelta !== null
                  ? yenSigned(summary.nextCUPDelta)
                  : "—"
              }
              sub={summary.nextChangeMonth || "変動なし"}
              tone={
                summary.nextCUPDelta === null
                  ? undefined
                  : summary.nextCUPDelta > 0
                  ? "up"
                  : summary.nextCUPDelta < 0
                  ? "down"
                  : "flat"
              }
            />
            <BigKPI
              label="満額反映"
              value={
                summary.fullCUPDelta !== null
                  ? yenSigned(summary.fullCUPDelta)
                  : "—"
              }
              sub={summary.fullEffectMonth || "—"}
              tone={
                summary.fullCUPDelta === null
                  ? undefined
                  : summary.fullCUPDelta > 0
                  ? "up"
                  : summary.fullCUPDelta < 0
                  ? "down"
                  : "flat"
              }
            />
          </div>

          <div>
            <div className="text-sm font-semibold mb-2">未来12ヶ月の月別推移</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th
                      className={`${css.th} sticky left-0 bg-slate-50 z-10 text-left`}
                    >
                      月
                    </th>
                    {[
                      "新規増加",
                      "減少（退会/停止/減額）",
                      "純増",
                      "顧客単価変化",
                      "想定顧客単価",
                      "主な要因加盟店",
                      "コメント",
                    ].map((h) => (
                      <th
                        key={h}
                        className={`${css.th} ${
                          h === "コメント" ||
                          h === "主な要因加盟店"
                            ? "text-left"
                            : "text-right"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.months.map((m, i) => (
                    <tr
                      key={m.month}
                      className={
                        i === 0
                          ? "bg-slate-50 font-medium"
                          : "hover:bg-slate-50"
                      }
                    >
                      <td
                        className={`${css.td} font-medium sticky left-0 bg-white`}
                      >
                        {m.month}
                      </td>
                      <td className={`${css.td} text-right`}>
                        {posCell(m.newAcq)}
                      </td>
                      <td className={`${css.td} text-right`}>
                        {negCell(m.decrease)}
                      </td>
                      <td className={`${css.td} text-right font-semibold`}>
                        {signedCell(m.net)}
                      </td>
                      <td className={`${css.td} text-right`}>
                        {m.cupDelta === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          signedCell(m.cupDelta)
                        )}
                      </td>
                      <td className={`${css.td} text-right`}>
                        {m.expectedCUP !== null ? (
                          yen(m.expectedCUP)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={`${css.td} text-xs`}>
                        {m.drivers.length > 0 ? m.drivers.join(", ") : "—"}
                      </td>
                      <td className={`${css.td} text-xs text-slate-600`}>
                        {m.comment}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <button
              className={css.btnOutline}
              onClick={() => setShowBreakdown(!showBreakdown)}
            >
              {showBreakdown
                ? "加盟店別内訳を閉じる"
                : "加盟店別内訳を見る ▾"}
            </button>
          </div>

          {showBreakdown && (
            <ClientBreakdownTable
              cat={cat}
              targetMonth={targetMonth}
              clients={clients}
              owners={owners}
              metrics={metrics}
              avgVU={avgVU}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- 加盟店別内訳テーブル ---------- */
function ClientBreakdownTable({
  cat,
  targetMonth,
  clients,
  owners,
  avgVU,
}: {
  cat: string;
  targetMonth: string;
  clients: Client[];
  owners: SalesOwner[];
  metrics: BusinessMetric[];
  avgVU: number | null;
}) {
  // 対象商材を扱う加盟店のみ
  const rows = clients
    .filter((c) => c.categories.includes(cat))
    .map((c) => {
      const sd = parseD(c.startDate);
      const monthlyBudget = c.categoryBudgets[cat] || 0;
      let startMonthIncrease = 0;
      let startMonthCUP: number | null = null;
      let nextMonthCUP: number | null = null;
      if (sd) {
        const dim = daysInMonth(sd.getFullYear(), sd.getMonth() + 1);
        const day = sd.getDate();
        const ratio = (dim - day + 1) / dim;
        startMonthIncrease = monthlyBudget * ratio;
        if (avgVU !== null && avgVU > 0) {
          startMonthCUP = startMonthIncrease / avgVU;
          nextMonthCUP = monthlyBudget / avgVU;
        }
      }
      const ownerName =
        owners.find((o) => o.ownerId === c.salesOwnerId)?.ownerName ?? "—";
      return {
        billingId: c.billingId,
        companyName: c.companyName,
        ownerName,
        startDate: c.startDate,
        monthlyBudget,
        startMonthIncrease,
        startMonthCUP,
        nextMonthCUP,
        status: c.status,
      };
    })
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));

  return (
    <div>
      <div className="text-sm font-semibold mb-2">
        加盟店別内訳（{cat}）
        <span className="text-xs text-slate-400 ml-2">
          {rows.length}件 / 対象月：{targetMonth}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th
                className={`${css.th} sticky left-0 bg-slate-50 z-10 text-left`}
              >
                請求ID
              </th>
              {[
                "会社名",
                "営業",
                "開始予定日",
                "月間予算",
                "開始月の増加",
                "開始月の単価上昇",
                "翌月以降の単価上昇",
                "状態",
              ].map((h) => (
                <th
                  key={h}
                  className={`${css.th} ${
                    h === "会社名" || h === "営業" || h === "状態"
                      ? "text-left"
                      : "text-right"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-3 text-sm text-slate-500">
                  該当する加盟店なし
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.billingId} className="hover:bg-slate-50">
                  <td
                    className={`${css.td} text-xs font-medium sticky left-0 bg-white`}
                  >
                    {r.billingId}
                  </td>
                  <td className={css.td}>{r.companyName}</td>
                  <td className={css.td}>{r.ownerName}</td>
                  <td className={`${css.td} text-xs`}>{r.startDate || "—"}</td>
                  <td className={`${css.td} text-right`}>
                    {numCell(r.monthlyBudget)}
                  </td>
                  <td className={`${css.td} text-right`}>
                    {posCell(r.startMonthIncrease)}
                  </td>
                  <td className={`${css.td} text-right`}>
                    {r.startMonthCUP === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="text-emerald-600 tabular-nums">
                        +{yen(r.startMonthCUP)}
                      </span>
                    )}
                  </td>
                  <td className={`${css.td} text-right`}>
                    {r.nextMonthCUP === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="text-emerald-600 tabular-nums font-semibold">
                        +{yen(r.nextMonthCUP)}
                      </span>
                    )}
                  </td>
                  <td className={css.td}>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    active: {
      label: "配信中",
      cls: "bg-emerald-100 text-emerald-700 border-emerald-300",
    },
    scheduled: {
      label: "予定",
      cls: "bg-sky-100 text-sky-700 border-sky-300",
    },
    suspended: {
      label: "停止中",
      cls: "bg-amber-100 text-amber-700 border-amber-300",
    },
    withdrawn: {
      label: "退会",
      cls: "bg-slate-200 text-slate-600 border-slate-300",
    },
  };
  const m = map[status];
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border ${m.cls}`}>
      {m.label}
    </span>
  );
}

function getLatestEndDate(changeLogs: ChangeLog[], billingId: string) {
  const logs = changeLogs
    .filter((log) => log.billingId === billingId)
    .sort(
      (a, b) =>
        new Date(b.effectiveDate).getTime() -
        new Date(a.effectiveDate).getTime()
    );
  return logs[0]?.endDate;
}

/* ---------- 加盟店一覧 ---------- */
function ClientsList({
  clients,
  owners,
  changeLogs,
  metrics,
  targetMonth,
  setClients,
  setChangeLogs,
  setView,
}: {
  clients: Client[];
  owners: SalesOwner[];
  changeLogs: ChangeLog[];
  metrics: BusinessMetric[];
  targetMonth: string;
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  setChangeLogs: React.Dispatch<React.SetStateAction<ChangeLog[]>>;
  setView: React.Dispatch<React.SetStateAction<ViewKey>>;
}) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 商材別 直近3ヶ月平均ユーザー数 / 粗利率を事前計算
  const avgVUByCat = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const cat of CATEGORIES) {
      map[cat] = calcAvgValidUsers(targetMonth, cat, metrics);
    }
    return map;
  }, [targetMonth, metrics]);

  const avgGrossRateOverall = useMemo(() => {
    return calcAvgGrossRate(targetMonth, [...CATEGORIES], metrics) ?? 0.3;
  }, [targetMonth, metrics]);

  const list = clients
    .filter((c) => {
      if (q && !c.companyName.includes(q) && !c.billingId.includes(q))
        return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">加盟店一覧</h1>
          <p className="text-sm text-slate-500 mt-1">
            {list.length}件 / 全{clients.length}件 / 対象月：{targetMonth}
          </p>
        </div>
        <div className="flex gap-2">
          <button className={css.btnOutline} onClick={() => setView("change")}>
            退会・停止登録
          </button>
          <button className={css.btn} onClick={() => setView("register")}>
            ＋ 新規登録
          </button>
        </div>
      </div>

      <div className={css.card}>
        <div className={`${css.cardBody} flex items-center gap-3 flex-wrap`}>
          <input
            className={`${css.input} max-w-xs`}
            placeholder="会社名 / 請求ID で検索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className={`${css.input} w-32`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">全ステータス</option>
            <option value="active">配信中</option>
            <option value="scheduled">予定</option>
            <option value="suspended">停止中</option>
            <option value="withdrawn">退会</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((c) => {
          const ownerName =
            owners.find((o) => o.ownerId === c.salesOwnerId)?.ownerName ?? "—";
          const totalBudget = Object.values(c.categoryBudgets).reduce(
            (s, v) => s + (v as number),
            0
          );

          // 商材別 顧客単価インパクト
          const cupByCat: Record<string, number | null> = {};
          let totalCUP = 0;
          let cupComputable = c.categories.length > 0;
          for (const cat of c.categories) {
            const budget = c.categoryBudgets[cat] ?? 0;
            const vu = avgVUByCat[cat];
            if (vu !== null && vu > 0) {
              const impact = budget / vu;
              cupByCat[cat] = impact;
              totalCUP += impact;
            } else {
              cupByCat[cat] = null;
              cupComputable = false;
            }
          }

          const monthlyGP = totalBudget * avgGrossRateOverall;

          // 開始月の日割り
          let startMonthBudget: number | null = null;
          let startMonthCUP: number | null = null;
          let startMonthGP: number | null = null;
          let startMonthLabel = "";
          let isFutureStart = false;
          if (c.startDate) {
            const sd = parseD(c.startDate);
            if (sd) {
              const sdim = daysInMonth(sd.getFullYear(), sd.getMonth() + 1);
              const day = sd.getDate();
              const ratio = (sdim - day + 1) / sdim;
              startMonthLabel = monthKeyOfDate(sd);
              if (ratio < 1) {
                startMonthBudget = totalBudget * ratio;
                startMonthCUP = cupComputable ? totalCUP * ratio : null;
                startMonthGP = startMonthBudget * avgGrossRateOverall;
              }
              const today = new Date();
              isFutureStart = sd > today;
            }
          }

          const recentLog = changeLogs
            .filter((l) => l.billingId === c.billingId)
            .sort((a, b) =>
              (b.declaredDate || "").localeCompare(a.declaredDate || "")
            )[0];

          // 対象月の影響計算
          const impact = calcClientImpact(targetMonth, c, changeLogs);

          const isExpanded = expandedId === c.billingId;

          return (
            <div
              key={c.billingId}
              className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition cursor-pointer"
              onClick={() =>
                setExpandedId(isExpanded ? null : c.billingId)
              }
            >
             <div className="flex items-center justify-between mb-2 gap-2">
  <div className="font-semibold truncate">{c.companyName}</div>
  <div className="flex items-center gap-2">
    <StatusBadge status={c.status} />
    {c.status !== "active" && (
      <div className="text-xs text-slate-500">
        終了予定: {getLatestEndDate(changeLogs, c.billingId) || "未定"}
      </div>
    )}
    <button
      className="text-[10px] px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50"
      onClick={(e) => {
        e.stopPropagation();

        const ok = window.confirm(
          `${c.companyName}を削除しますか？\nこの加盟店の変更履歴も削除され、数字にも反映されなくなります。`
        );

        if (!ok) return;

        setClients((prev) =>
          prev.filter((x) => x.billingId !== c.billingId)
        );

        setChangeLogs((prev) =>
          prev.filter((x) => x.billingId !== c.billingId)
        );
      }}
    >
      削除
    </button>
  </div>
</div>
              <div className="text-xs text-slate-500 space-y-1">
                <div>請求ID: {c.billingId}</div>
                <div>営業: {ownerName}</div>
                <div>開始予定: {c.startDate || "—"}</div>
                {c.status === "suspended" && c.note?.includes("再開予定日") && (
  <div className="text-amber-700 font-medium">
    {c.note}
  </div>
)}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                  <span>月間予算</span>
                  <span className="font-semibold text-slate-900">
                    {yen(totalBudget)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.categories.map((cat) => (
                    <span
                      key={cat}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 bg-slate-50"
                    >
                      {cat} {yen(c.categoryBudgets[cat] || 0)}
                    </span>
                  ))}
                </div>

                {/* 事業インパクト */}
                {(c.status === "active" || c.status === "scheduled") && (
                  <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                    <div className="font-semibold text-slate-700 text-[11px]">
                      事業インパクト（対象月 {targetMonth}）
                    </div>
                    {startMonthBudget !== null && isFutureStart && (
                      <>
                        <div className="flex justify-between">
                          <span>{startMonthLabel} 日割り売上</span>
                          <span className="text-emerald-600 font-medium tabular-nums">
                            +{yen(startMonthBudget)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{startMonthLabel} 日割り粗利</span>
                          <span className="text-emerald-600 font-medium tabular-nums">
                            +{yen(startMonthGP || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{startMonthLabel} 顧客単価</span>
                          <span
                            className={
                              startMonthCUP !== null
                                ? "text-emerald-600 font-medium tabular-nums"
                                : "text-slate-400"
                            }
                          >
                            {startMonthCUP !== null
                              ? `+${yen(startMonthCUP)}`
                              : "算出不可"}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between">
                      <span>満額月の売上</span>
                      <span className="text-emerald-600 font-medium tabular-nums">
                        +{yen(totalBudget)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>満額月の粗利</span>
                      <span className="text-emerald-600 font-medium tabular-nums">
                        +{yen(monthlyGP)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>満額月の顧客単価</span>
                      <span
                        className={
                          cupComputable
                            ? "text-emerald-600 font-medium tabular-nums"
                            : "text-slate-400"
                        }
                      >
                        {cupComputable ? `+${yen(totalCUP)}` : "算出不可"}
                      </span>
                    </div>
                  </div>
                )}

                {c.status === "suspended" && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="text-amber-700 font-medium">
                      停止中：月 −{yen(totalBudget)} の損失
                    </div>
                    <div className="text-amber-700 text-[10px]">
                      想定粗利損失 −{yen(monthlyGP)}
                    </div>
                  </div>
                )}

                {c.status === "withdrawn" && (
                  <div className="mt-2 pt-2 border-t border-slate-100 text-slate-400">
                    {impact.withdraw > 0
                      ? `退会済み：対象月影響 −${yen(impact.withdraw)}`
                      : "退会済み（対象月への追加影響なし）"}
                  </div>
                )}

                {/* 商材別内訳（展開時） */}
                {isExpanded &&
                  (c.status === "active" || c.status === "scheduled") && (
                    <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                      <div className="font-semibold text-slate-700 text-[11px]">
                        商材別 顧客単価インパクト
                      </div>
                      {c.categories.map((cat) => (
                        <div
                          key={cat}
                          className="flex justify-between"
                        >
                          <span>
                            {cat}（VU{" "}
                            {avgVUByCat[cat] !== null
                              ? Math.round(
                                  avgVUByCat[cat]!
                                ).toLocaleString()
                              : "—"}
                            ）
                          </span>
                          <span
                            className={
                              cupByCat[cat] !== null
                                ? "text-emerald-600 font-medium tabular-nums"
                                : "text-slate-400"
                            }
                          >
                            {cupByCat[cat] !== null
                              ? `+${yen(cupByCat[cat]!)}`
                              : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                {recentLog && (
                  <div className="mt-2 pt-2 border-t border-slate-100 text-[10px]">
                    最終変更: {recentLog.declaredDate}{" "}
                    {CHANGE_TYPE_LABEL[recentLog.changeType]}
                  </div>
                )}

                <div className="text-[10px] text-slate-400 text-right mt-1">
                  {isExpanded ? "クリックで閉じる" : "クリックで商材別を表示"}
                </div>
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="col-span-full text-center text-sm text-slate-500 py-8">
            該当する加盟店がありません
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- 顧客単価分析 ---------- */
function CUPAnalysis({
  targetMonth,
  clients,
  changeLogs,
  metrics,
  filterCats,
  owners,
}: {
  targetMonth: string;
  clients: Client[];
  changeLogs: ChangeLog[];
  metrics: BusinessMetric[];
  filterCats: string[];
  owners: SalesOwner[];
}) {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const cats = filterCats.length > 0 ? filterCats : [...CATEGORIES];
  const summaries = cats.map((c) =>
    calcFutureCUPSummary(c, targetMonth, clients, changeLogs, metrics)
  );
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-slate-500">{targetMonth}</div>
        <h1 className="text-2xl font-bold tracking-tight">顧客単価分析</h1>
        <p className="text-sm text-slate-500 mt-1">
          商材別の未来12ヶ月の顧客単価変化を要約・カードクリックで詳細表示
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {summaries.map((s) => (
          <CategorySummaryCard
            key={s.cat}
            summary={s}
            onClick={() => setSelectedCat(s.cat)}
          />
        ))}
      </div>

      {selectedCat && (
        <CategoryDetailModal
          cat={selectedCat}
          targetMonth={targetMonth}
          clients={clients}
          changeLogs={changeLogs}
          metrics={metrics}
          owners={owners}
          onClose={() => setSelectedCat(null)}
        />
      )}
    </div>
  );
}