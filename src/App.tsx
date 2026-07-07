import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  BadgeCheck,
  Brain,
  CalendarDays,
  Check,
  ChevronRight,
  Database,
  FileJson,
  Fingerprint,
  Gauge,
  HeartPulse,
  LineChart as LineChartIcon,
  Link2,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  Zap,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'

type DailyRecord = {
  day: string
  sleepScore?: number
  readinessScore?: number
  activityScore?: number
  totalSleepHours?: number
  sleepNeedHours?: number
  deepSleepHours?: number
  remSleepHours?: number
  hrv?: number
  restingHeartRate?: number
  steps?: number
  activeCalories?: number
  inactiveHours?: number
  tempDeviation?: number
  bedtimeMinutes?: number
  wakeMinutes?: number
  stressHighMinutes?: number
  stressRecoveryMinutes?: number
  tags?: string[]
  sources: string[]
}

type DatasetState = {
  label: string
  mode: 'demo' | 'file' | 'oura-api'
  records: DailyRecord[]
  notes: string[]
}

type Insight = {
  label: string
  value: string
  evidence: string
  action: string
  severity: 'good' | 'watch' | 'risk'
}

type ConsentState = {
  localAnalysis: true
  productTelemetry: boolean
  aggregateResearch: boolean
  commercialLicense: boolean
}

type MetricKey =
  | 'sleepScore'
  | 'readinessScore'
  | 'activityScore'
  | 'totalSleepHours'
  | 'hrv'
  | 'restingHeartRate'
  | 'steps'
  | 'tempDeviation'

const endpointList = [
  'daily_sleep',
  'sleep',
  'daily_readiness',
  'daily_activity',
  'daily_stress',
  'daily_spo2',
  'workout',
]

const colors = {
  ink: '#17191c',
  green: '#00b86b',
  cyan: '#0097a7',
  coral: '#ff5a4f',
  amber: '#c58a00',
  blue: '#365dff',
  violet: '#7252ff',
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function compactNumber(value?: number, digits = 0) {
  if (value === undefined || Number.isNaN(value)) return 'n/a'
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

function average(values: Array<number | undefined>) {
  const clean = values.filter((value): value is number => Number.isFinite(value))
  if (!clean.length) return undefined
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function sum(values: Array<number | undefined>) {
  return values
    .filter((value): value is number => Number.isFinite(value))
    .reduce((total, value) => total + value, 0)
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').trim()
  if (!cleaned || cleaned.toLowerCase() === 'null') return undefined
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseDurationHours(value: unknown) {
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map((part) => Number(part))
    if (parts.every(Number.isFinite)) {
      const [hours = 0, minutes = 0, seconds = 0] = parts
      return hours + minutes / 60 + seconds / 3600
    }
  }

  const numeric = parseNumber(value)
  if (numeric === undefined) return undefined
  if (numeric > 1200) return numeric / 3600
  if (numeric > 24) return numeric / 60
  return numeric
}

function parseDurationMinutes(value: unknown) {
  const hours = parseDurationHours(value)
  return hours === undefined ? undefined : hours * 60
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function keyMap(row: Record<string, unknown>) {
  const pairs = Object.entries(row)
  return new Map(pairs.map(([key, value]) => [normalizeKey(key), value]))
}

function readAlias(
  row: Record<string, unknown>,
  aliases: string[],
): unknown | undefined {
  const map = keyMap(row)
  for (const alias of aliases) {
    const found = map.get(normalizeKey(alias))
    if (found !== undefined && found !== null && found !== '') return found
  }
  return undefined
}

function readNumber(row: Record<string, unknown>, aliases: string[]) {
  return parseNumber(readAlias(row, aliases))
}

function readDuration(row: Record<string, unknown>, aliases: string[]) {
  return parseDurationHours(readAlias(row, aliases))
}

function readMinutes(row: Record<string, unknown>, aliases: string[]) {
  return parseDurationMinutes(readAlias(row, aliases))
}

function toIsoDay(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value).trim()
  if (!raw) return undefined
  const direct = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (direct) return direct
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString().slice(0, 10)
}

function minutesFromTime(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value).trim()
  if (!raw) return undefined

  const date = new Date(raw)
  if (!Number.isNaN(date.getTime()) && raw.includes('T')) {
    return date.getHours() * 60 + date.getMinutes()
  }

  const match = raw.match(/(\d{1,2}):(\d{2})/)
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined
  return ((hours % 24) * 60 + minutes) % 1440
}

function formatClock(minutes?: number) {
  if (minutes === undefined || Number.isNaN(minutes)) return 'n/a'
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const mins = normalized % 60
  const suffix = hours >= 12 ? 'p' : 'a'
  const hour12 = hours % 12 || 12
  return `${hour12}:${String(mins).padStart(2, '0')}${suffix}`
}

function mergeRecord(map: Map<string, DailyRecord>, patch: Partial<DailyRecord>) {
  if (!patch.day) return
  const existing = map.get(patch.day) ?? { day: patch.day, sources: [] }
  const merged: DailyRecord = {
    ...existing,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
    sources: Array.from(
      new Set([...(existing.sources ?? []), ...(patch.sources ?? [])]),
    ),
    tags: Array.from(new Set([...(existing.tags ?? []), ...(patch.tags ?? [])])),
  }
  map.set(patch.day, merged)
}

function csvRecordFromRow(
  row: Record<string, unknown>,
  source: string,
): Partial<DailyRecord> | undefined {
  const day =
    toIsoDay(
      readAlias(row, [
        'day',
        'date',
        'summary_date',
        'sleep date',
        'calendar date',
        'timestamp',
      ]),
    ) ?? undefined

  if (!day) return undefined

  const sourceHint = source.toLowerCase()
  const genericScore = readNumber(row, ['score'])
  const patch: Partial<DailyRecord> = {
    day,
    sources: [source],
    sleepScore: readNumber(row, ['sleep score', 'sleep_score', 'sleep']),
    readinessScore: readNumber(row, [
      'readiness score',
      'readiness_score',
      'readiness',
    ]),
    activityScore: readNumber(row, [
      'activity score',
      'activity_score',
      'activity',
    ]),
    totalSleepHours: readDuration(row, [
      'total sleep duration',
      'total_sleep_duration',
      'total sleep time',
      'asleep time',
      'sleep duration',
      'sleep_hours',
      'total sleep',
    ]),
    sleepNeedHours: readDuration(row, [
      'sleep need',
      'sleep_need',
      'needed sleep',
      'recommended sleep',
    ]),
    deepSleepHours: readDuration(row, [
      'deep sleep duration',
      'deep_sleep_duration',
      'deep sleep',
    ]),
    remSleepHours: readDuration(row, [
      'rem sleep duration',
      'rem_sleep_duration',
      'rem sleep',
    ]),
    hrv: readNumber(row, [
      'average hrv',
      'average_hrv',
      'hrv',
      'rmssd',
      'average rmssd',
    ]),
    restingHeartRate: readNumber(row, [
      'resting heart rate',
      'resting_heart_rate',
      'lowest heart rate',
      'lowest_heart_rate',
      'rhr',
      'average heart rate',
    ]),
    steps: readNumber(row, ['steps', 'step count']),
    activeCalories: readNumber(row, [
      'active calories',
      'active_calories',
      'calories active',
      'activity burn',
    ]),
    inactiveHours: readDuration(row, [
      'inactive time',
      'inactive_time',
      'sedentary time',
    ]),
    tempDeviation: readNumber(row, [
      'temperature deviation',
      'temperature_deviation',
      'body temperature',
      'temp deviation',
    ]),
    bedtimeMinutes: minutesFromTime(
      readAlias(row, ['bedtime start', 'bedtime_start', 'bedtime']),
    ),
    wakeMinutes: minutesFromTime(
      readAlias(row, ['bedtime end', 'bedtime_end', 'wake time', 'wake']),
    ),
    stressHighMinutes: readMinutes(row, [
      'stress high',
      'stress_high',
      'high stress duration',
    ]),
    stressRecoveryMinutes: readMinutes(row, [
      'stress recovery',
      'stress_recovery',
      'recovery duration',
    ]),
  }

  if (genericScore !== undefined) {
    if (sourceHint.includes('readiness')) patch.readinessScore ??= genericScore
    if (sourceHint.includes('activity')) patch.activityScore ??= genericScore
    if (sourceHint.includes('sleep')) patch.sleepScore ??= genericScore
  }

  const tags = readAlias(row, ['tags', 'tag', 'comment'])
  if (typeof tags === 'string' && tags.trim()) {
    patch.tags = tags
      .split(/[;,|]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  }

  return patch
}

function parseCsv(text: string, source: string) {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  })
  const map = new Map<string, DailyRecord>()
  for (const row of result.data) {
    mergeRecord(map, csvRecordFromRow(row, source) ?? {})
  }
  return Array.from(map.values())
}

function rowFromOuraCollection(
  collectionName: string,
  row: Record<string, unknown>,
): Partial<DailyRecord> | undefined {
  const day =
    toIsoDay(readAlias(row, ['day', 'date', 'timestamp', 'bedtime_start'])) ??
    undefined
  if (!day) return undefined

  const patch: Partial<DailyRecord> = { day, sources: [collectionName] }
  const score = readNumber(row, ['score'])

  if (collectionName.includes('daily_sleep')) {
    patch.sleepScore = score
    patch.totalSleepHours = readDuration(row, [
      'total_sleep_duration',
      'sleep_duration',
      'time_in_bed',
    ])
    patch.sleepNeedHours = readDuration(row, ['sleep_need'])
  }

  if (collectionName === 'sleep' || collectionName.includes('/sleep')) {
    patch.totalSleepHours = readDuration(row, ['total_sleep_duration'])
    patch.deepSleepHours = readDuration(row, ['deep_sleep_duration'])
    patch.remSleepHours = readDuration(row, ['rem_sleep_duration'])
    patch.hrv = readNumber(row, ['average_hrv', 'hrv'])
    patch.restingHeartRate = readNumber(row, [
      'lowest_heart_rate',
      'average_heart_rate',
    ])
    patch.tempDeviation = readNumber(row, ['temperature_deviation'])
    patch.bedtimeMinutes = minutesFromTime(readAlias(row, ['bedtime_start']))
    patch.wakeMinutes = minutesFromTime(readAlias(row, ['bedtime_end']))
  }

  if (collectionName.includes('daily_readiness')) {
    patch.readinessScore = score
    patch.tempDeviation = readNumber(row, [
      'temperature_deviation',
      'temperature_trend_deviation',
    ])
  }

  if (collectionName.includes('daily_activity')) {
    patch.activityScore = score
    patch.steps = readNumber(row, ['steps'])
    patch.activeCalories = readNumber(row, ['active_calories'])
    patch.inactiveHours = readDuration(row, ['inactive_time'])
  }

  if (collectionName.includes('daily_stress')) {
    patch.stressHighMinutes = readMinutes(row, ['stress_high', 'high'])
    patch.stressRecoveryMinutes = readMinutes(row, ['recovery_high', 'recovery'])
  }

  if (collectionName.includes('tag')) {
    const tag = readAlias(row, ['tag_type_code', 'name', 'comment'])
    if (typeof tag === 'string' && tag.trim()) patch.tags = [tag.trim()]
  }

  if (!Object.values(patch).some((value) => value !== undefined)) return undefined
  return patch
}

function parseJson(text: string, source: string) {
  const bundle = JSON.parse(text) as unknown
  const map = new Map<string, DailyRecord>()

  const ingestRows = (name: string, rows: unknown[]) => {
    rows.forEach((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        mergeRecord(
          map,
          rowFromOuraCollection(name, entry as Record<string, unknown>) ??
            csvRecordFromRow(entry as Record<string, unknown>, source) ??
            {},
        )
      }
    })
  }

  const visit = (value: unknown, nameHint: string) => {
    if (Array.isArray(value)) {
      ingestRows(nameHint || source, value)
      value.forEach((item) => visit(item, nameHint))
      return
    }

    if (!value || typeof value !== 'object') return
    const objectValue = value as Record<string, unknown>

    if (Array.isArray(objectValue.data)) {
      ingestRows(nameHint || source, objectValue.data)
    }

    for (const [key, child] of Object.entries(objectValue)) {
      const normalized = key.toLowerCase()
      const nextHint =
        endpointList.find((endpoint) => normalized.includes(endpoint)) ??
        nameHint
      visit(child, nextHint)
    }
  }

  visit(bundle, source)
  return Array.from(map.values())
}

function mergeRecords(records: DailyRecord[]) {
  const map = new Map<string, DailyRecord>()
  for (const record of records) mergeRecord(map, record)
  return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))
}

function generateDemoData(): DailyRecord[] {
  let seed = 43
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  const today = new Date()
  const records: DailyRecord[] = []

  for (let i = 119; i >= 0; i -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - i)
    const wave = Math.sin((120 - i) / 8)
    const travel = i > 63 && i < 71 ? -1 : 0
    const heavyTraining = i > 23 && i < 35 ? 1 : 0
    const noise = (random() - 0.5) * 2
    const sleepHours = clamp(7.45 + wave * 0.48 + travel * 1.15 + noise * 0.52, 4.8, 9.4)
    const bedtime = 23 * 60 + 18 + wave * 22 + travel * 54 + noise * 18
    const hrv = clamp(56 + sleepHours * 4.4 - heavyTraining * 6 + noise * 8, 24, 92)
    const rhr = clamp(61 - (hrv - 52) * 0.16 + heavyTraining * 3 + travel * 2 + noise * 2, 47, 75)
    const steps = Math.round(
      clamp(8400 + wave * 1800 + heavyTraining * 5200 + noise * 2600, 2100, 19700),
    )
    const readiness = clamp(
      65 + (sleepHours - 7) * 8 + (hrv - 50) * 0.35 - (rhr - 58) * 1.2 - heavyTraining * 8 + noise * 6,
      28,
      98,
    )
    const sleepScore = clamp(70 + (sleepHours - 7) * 9 - Math.abs(bedtime - 1395) * 0.07 + noise * 5, 35, 99)
    const activityScore = clamp(74 + (steps - 8000) / 450 - heavyTraining * 2 + noise * 6, 31, 99)
    const stressHigh = clamp(74 + heavyTraining * 38 - sleepHours * 4 + noise * 20, 12, 185)

    records.push({
      day: date.toISOString().slice(0, 10),
      sleepScore: Math.round(sleepScore),
      readinessScore: Math.round(readiness),
      activityScore: Math.round(activityScore),
      totalSleepHours: Number(sleepHours.toFixed(2)),
      sleepNeedHours: 8,
      deepSleepHours: Number(clamp(sleepHours * 0.19 + noise * 0.12, 0.5, 2.2).toFixed(2)),
      remSleepHours: Number(clamp(sleepHours * 0.23 - noise * 0.08, 0.7, 2.4).toFixed(2)),
      hrv: Math.round(hrv),
      restingHeartRate: Math.round(rhr),
      steps,
      activeCalories: Math.round(360 + steps * 0.044 + heavyTraining * 180),
      inactiveHours: Number(clamp(9.4 - steps / 5000 + random(), 4.8, 12).toFixed(2)),
      tempDeviation: Number(clamp(travel * 0.32 + heavyTraining * 0.14 + noise * 0.12, -0.45, 0.7).toFixed(2)),
      bedtimeMinutes: Math.round(bedtime),
      wakeMinutes: Math.round((bedtime + sleepHours * 60 + 31) % 1440),
      stressHighMinutes: Math.round(stressHigh),
      stressRecoveryMinutes: Math.round(clamp(96 - stressHigh * 0.22 + sleepHours * 7, 22, 160)),
      tags: i === 67 ? ['travel'] : i === 29 ? ['intervals'] : [],
      sources: ['demo'],
    })
  }

  return records
}

function rollingAverage(
  records: DailyRecord[],
  index: number,
  key: MetricKey,
  windowSize: number,
) {
  const start = Math.max(0, index - windowSize + 1)
  return average(records.slice(start, index + 1).map((record) => record[key]))
}

function pearson(
  pairs: Array<[number | undefined, number | undefined]>,
): number | undefined {
  const clean = pairs.filter(
    (pair): pair is [number, number] =>
      Number.isFinite(pair[0]) && Number.isFinite(pair[1]),
  )
  if (clean.length < 4) return undefined
  const xs = clean.map(([x]) => x)
  const ys = clean.map(([, y]) => y)
  const meanX = average(xs) ?? 0
  const meanY = average(ys) ?? 0
  const numerator = clean.reduce(
    (total, [x, y]) => total + (x - meanX) * (y - meanY),
    0,
  )
  const denominator = Math.sqrt(
    clean.reduce((total, [x]) => total + (x - meanX) ** 2, 0) *
      clean.reduce((total, [, y]) => total + (y - meanY) ** 2, 0),
  )
  if (!denominator) return undefined
  return numerator / denominator
}

function trendDelta(records: DailyRecord[], key: MetricKey) {
  const recent = records.slice(-7)
  const prior = records.slice(-35, -7)
  const recentAvg = average(recent.map((record) => record[key]))
  const priorAvg = average(prior.map((record) => record[key]))
  if (recentAvg === undefined || priorAvg === undefined) return undefined
  return recentAvg - priorAvg
}

function circularStdMinutes(values: Array<number | undefined>) {
  const clean = values.filter((value): value is number => Number.isFinite(value))
  if (clean.length < 2) return undefined
  const angles = clean.map((minute) => (minute / 1440) * 2 * Math.PI)
  const sin = average(angles.map(Math.sin)) ?? 0
  const cos = average(angles.map(Math.cos)) ?? 0
  const radius = Math.sqrt(sin ** 2 + cos ** 2)
  if (radius <= 0) return undefined
  return Math.sqrt(-2 * Math.log(radius)) * (1440 / (2 * Math.PI))
}

function recoveryScore(record: DailyRecord, baseline: DailyRecord[]) {
  const hrvBase = average(baseline.map((item) => item.hrv))
  const rhrBase = average(baseline.map((item) => item.restingHeartRate))
  const tempPenalty = Math.abs(record.tempDeviation ?? 0) * 14
  const score = average([
    record.readinessScore,
    record.sleepScore,
    record.hrv !== undefined && hrvBase ? 72 + (record.hrv - hrvBase) * 0.8 : undefined,
    record.restingHeartRate !== undefined && rhrBase
      ? 72 - (record.restingHeartRate - rhrBase) * 2.1
      : undefined,
  ])
  return clamp((score ?? 70) - tempPenalty, 0, 100)
}

function buildSeries(records: DailyRecord[]) {
  return records.map((record, index) => {
    const baseline = records.slice(Math.max(0, index - 28), index)
    return {
      ...record,
      dateLabel: record.day.slice(5),
      sleep7: rollingAverage(records, index, 'totalSleepHours', 7),
      readiness7: rollingAverage(records, index, 'readinessScore', 7),
      strainGap:
        record.readinessScore !== undefined && record.activityScore !== undefined
          ? record.readinessScore - record.activityScore
          : undefined,
      recovery: recoveryScore(record, baseline),
      sleepDebt:
        record.totalSleepHours !== undefined
          ? Math.max(0, (record.sleepNeedHours ?? 8) - record.totalSleepHours)
          : undefined,
    }
  })
}

function buildInsights(records: DailyRecord[]): Insight[] {
  const last = records.at(-1)
  const recent = records.slice(-14)
  const last28 = records.slice(-28)
  const last56 = records.slice(-56, -28)
  const sleepDebt14 = sum(
    recent.map((record) =>
      record.totalSleepHours !== undefined
        ? Math.max(0, (record.sleepNeedHours ?? 8) - record.totalSleepHours)
        : undefined,
    ),
  )
  const bedtimeVariance = circularStdMinutes(recent.map((record) => record.bedtimeMinutes))
  const readinessDelta = trendDelta(records, 'readinessScore')
  const hrvDelta = trendDelta(records, 'hrv')
  const rhrDelta = trendDelta(records, 'restingHeartRate')
  const strainMismatch = recent.filter(
    (record) =>
      (record.activityScore ?? 0) >= 78 &&
      ((record.readinessScore ?? 100) < 68 || (record.totalSleepHours ?? 8) < 6.6),
  ).length
  const tempSpikes = recent.filter((record) => Math.abs(record.tempDeviation ?? 0) >= 0.35).length
  const sleepCorr = pearson(
    records.slice(1).map((record, index) => [
      records[index].totalSleepHours,
      record.readinessScore,
    ]),
  )

  const insights: Insight[] = []

  insights.push({
    label: 'Recovery direction',
    value:
      readinessDelta === undefined
        ? 'Need more days'
        : `${readinessDelta >= 0 ? '+' : ''}${compactNumber(readinessDelta, 1)} pts`,
    evidence:
      readinessDelta === undefined
        ? 'Import at least five weeks to separate signal from noise.'
        : `Last 7 days versus the previous 28. HRV ${hrvDelta && hrvDelta >= 0 ? '+' : ''}${compactNumber(hrvDelta, 1)} ms, RHR ${rhrDelta && rhrDelta >= 0 ? '+' : ''}${compactNumber(rhrDelta, 1)} bpm.`,
    action:
      readinessDelta !== undefined && readinessDelta < -4
        ? 'Hold hard sessions until readiness and HRV stop falling together.'
        : 'Keep the current load unless sleep debt starts stacking.',
    severity: readinessDelta !== undefined && readinessDelta < -4 ? 'risk' : 'good',
  })

  insights.push({
    label: 'Sleep debt ledger',
    value: `${compactNumber(sleepDebt14, 1)} h`,
    evidence: "Accumulated shortfall across the last 14 nights against each day's sleep need or an 8h default.",
    action:
      sleepDebt14 > 8
        ? 'Spend two nights protecting bedtime before adding training volume.'
        : 'Debt is inside the range where consistency beats dramatic catch-up.',
    severity: sleepDebt14 > 8 ? 'risk' : sleepDebt14 > 4 ? 'watch' : 'good',
  })

  insights.push({
    label: 'Clock discipline',
    value:
      bedtimeVariance === undefined
        ? 'n/a'
        : `${compactNumber(bedtimeVariance, 0)} min`,
    evidence: `Bedtime scatter over the last 14 nights. Lower variance usually makes readiness more predictable.`,
    action:
      bedtimeVariance !== undefined && bedtimeVariance > 55
        ? 'Anchor bedtime inside a 45-minute window for the next four nights.'
        : 'Your sleep clock is stable enough to look for smaller levers.',
    severity: bedtimeVariance !== undefined && bedtimeVariance > 55 ? 'watch' : 'good',
  })

  insights.push({
    label: 'Strain mismatch',
    value: `${strainMismatch} days`,
    evidence: `High activity paired with low readiness or short sleep in the last 14 days.`,
    action:
      strainMismatch > 2
        ? "Swap the next intense day for zone 2 or mobility and watch tomorrow's HRV."
        : 'Training load is mostly landing on recoverable days.',
    severity: strainMismatch > 2 ? 'risk' : strainMismatch > 0 ? 'watch' : 'good',
  })

  insights.push({
    label: 'Temperature flags',
    value: `${tempSpikes} spikes`,
    evidence: `Nights with absolute temperature deviation above 0.35 C in the last 14 days.`,
    action:
      tempSpikes > 1
        ? 'Treat this as a context flag, especially if HRV is down and resting HR is up.'
        : 'No repeated temperature disruption in the recent window.',
    severity: tempSpikes > 1 ? 'watch' : 'good',
  })

  insights.push({
    label: 'Sleep-to-readiness link',
    value: sleepCorr === undefined ? 'n/a' : compactNumber(sleepCorr, 2),
    evidence: 'Correlation between prior-night sleep duration and next-day readiness.',
    action:
      sleepCorr !== undefined && sleepCorr > 0.35
        ? 'Sleep duration is a strong lever for this dataset.'
        : 'Duration alone is not explaining readiness; inspect timing, HRV, and stress.',
    severity: 'good',
  })

  const recentReadiness = average(last28.map((record) => record.readinessScore))
  const priorReadiness = average(last56.map((record) => record.readinessScore))
  if (
    recentReadiness !== undefined &&
    priorReadiness !== undefined &&
    recentReadiness - priorReadiness > 5
  ) {
    insights.unshift({
      label: 'Breakout window',
      value: `+${compactNumber(recentReadiness - priorReadiness, 1)} pts`,
      evidence: 'The most recent 28-day readiness baseline is materially above the prior 28 days.',
      action: 'This is the window to test one deliberate training or sleep intervention.',
      severity: 'good',
    })
  }

  if (last && (last.readinessScore ?? 100) < 58 && (last.activityScore ?? 0) > 75) {
    insights.unshift({
      label: 'Today is overdrawn',
      value: `${compactNumber(last.readinessScore)} vs ${compactNumber(last.activityScore)}`,
      evidence: 'Latest readiness is low while activity load is elevated.',
      action: 'Downshift today and protect tonight; this is where the app should interrupt ambition.',
      severity: 'risk',
    })
  }

  return insights.slice(0, 6)
}

function buildContributionPack(records: DailyRecord[], consent: ConsentState) {
  const months = new Map<string, DailyRecord[]>()
  for (const record of records) {
    const key = record.day.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), record])
  }

  return {
    schema: 'oura-signal-aggregate-v1',
    createdAt: new Date().toISOString(),
    localOnlyDefault: true,
    consent: {
      productTelemetry: consent.productTelemetry,
      aggregateResearch: consent.aggregateResearch,
      commercialLicense: consent.commercialLicense,
    },
    includedOnlyIfAllRequiredConsent: consent.aggregateResearch && consent.commercialLicense,
    rawOuraDataIncluded: false,
    directIdentifiersIncluded: false,
    monthlyAggregates: Array.from(months.entries()).map(([, monthRecords], index) => ({
      monthIndex: index + 1,
      days: monthRecords.length,
      avgSleepHours: Number((average(monthRecords.map((record) => record.totalSleepHours)) ?? 0).toFixed(2)),
      avgReadiness: Number((average(monthRecords.map((record) => record.readinessScore)) ?? 0).toFixed(1)),
      avgHrv: Number((average(monthRecords.map((record) => record.hrv)) ?? 0).toFixed(1)),
      avgRestingHeartRate: Number((average(monthRecords.map((record) => record.restingHeartRate)) ?? 0).toFixed(1)),
      avgSteps: Math.round(average(monthRecords.map((record) => record.steps)) ?? 0),
      sleepDebtHours: Number(
        sum(
          monthRecords.map((record) =>
            record.totalSleepHours !== undefined
              ? Math.max(0, (record.sleepNeedHours ?? 8) - record.totalSleepHours)
              : undefined,
          ),
        ).toFixed(1),
      ),
    })),
  }
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function fileKind(name: string) {
  if (name.toLowerCase().endsWith('.csv')) return 'csv'
  if (name.toLowerCase().endsWith('.json')) return 'json'
  return 'unknown'
}

async function parseFiles(files: File[]) {
  const parsed: DailyRecord[] = []
  const notes: string[] = []

  for (const file of files) {
    const text = await file.text()
    try {
      const kind = fileKind(file.name)
      if (kind === 'csv') parsed.push(...parseCsv(text, file.name))
      if (kind === 'json') parsed.push(...parseJson(text, file.name))
      if (kind === 'unknown') {
        notes.push(`${file.name}: skipped; use CSV or JSON.`)
      }
    } catch (error) {
      notes.push(`${file.name}: ${(error as Error).message}`)
    }
  }

  return { records: mergeRecords(parsed), notes }
}

function latestValue(records: DailyRecord[], key: MetricKey) {
  return [...records].reverse().find((record) => record[key] !== undefined)?.[key]
}

function StatusPill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'blue'; children: React.ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>
}

function EmptyState({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="empty-state">
      <Sparkles aria-hidden="true" />
      <h2>No analyzable days yet</h2>
      <p>Load a CSV or JSON export, or use the synthetic demo set.</p>
      <button className="primary-action" onClick={onDemo} type="button">
        <RefreshCw size={18} aria-hidden="true" />
        Load demo
      </button>
    </section>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  delta,
}: {
  icon: typeof Moon
  label: string
  value: string
  detail: string
  delta?: number
}) {
  const tone = delta === undefined ? 'flat' : delta >= 0 ? 'up' : 'down'
  return (
    <article className="metric-card">
      <div className="metric-topline">
        <Icon size={19} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <div className="metric-detail">
        <span>{detail}</span>
        {delta !== undefined && (
          <b className={tone}>{delta >= 0 ? '+' : ''}{compactNumber(delta, 1)}</b>
        )}
      </div>
    </article>
  )
}

function InsightRow({ insight }: { insight: Insight }) {
  const Icon =
    insight.severity === 'risk'
      ? AlertTriangle
      : insight.severity === 'watch'
        ? Gauge
        : BadgeCheck

  return (
    <article className={`insight-row ${insight.severity}`}>
      <div className="insight-icon">
        <Icon size={18} aria-hidden="true" />
      </div>
      <div>
        <div className="insight-heading">
          <span>{insight.label}</span>
          <strong>{insight.value}</strong>
        </div>
        <p>{insight.evidence}</p>
        <small>{insight.action}</small>
      </div>
    </article>
  )
}

function DropZone({
  onFiles,
}: {
  onFiles: (files: File[]) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={`drop-zone ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,application/json,text/csv"
        multiple
        onChange={(event) => {
          void onFiles(Array.from(event.target.files ?? []))
          event.currentTarget.value = ''
        }}
      />
      <button type="button" onClick={() => inputRef.current?.click()}>
        <Upload size={18} aria-hidden="true" />
        Import Oura export
      </button>
      <p>CSV or JSON. Multiple files merge by day.</p>
    </div>
  )
}

function ConsentPanel({
  consent,
  setConsent,
  pack,
}: {
  consent: ConsentState
  setConsent: React.Dispatch<React.SetStateAction<ConsentState>>
  pack: unknown
}) {
  const canContribute = consent.aggregateResearch && consent.commercialLicense
  return (
    <section className="rail-panel consent-panel">
      <div className="panel-title">
        <ShieldCheck size={18} aria-hidden="true" />
        <h2>Data trust</h2>
      </div>
      <div className="trust-line">
        <Lock size={16} aria-hidden="true" />
        <span>Raw imports stay in this browser session.</span>
      </div>
      <label className="toggle-row locked">
        <span>
          <b>Local analysis</b>
          <small>Required for the tool to work.</small>
        </span>
        <input type="checkbox" checked readOnly />
      </label>
      <label className="toggle-row">
        <span>
          <b>Product telemetry</b>
          <small>Usage events, no health metrics.</small>
        </span>
        <input
          type="checkbox"
          checked={consent.productTelemetry}
          onChange={(event) =>
            setConsent((current) => ({
              ...current,
              productTelemetry: event.target.checked,
            }))
          }
        />
      </label>
      <label className="toggle-row">
        <span>
          <b>Aggregate research</b>
          <small>Monthly means only, no raw dates.</small>
        </span>
        <input
          type="checkbox"
          checked={consent.aggregateResearch}
          onChange={(event) =>
            setConsent((current) => ({
              ...current,
              aggregateResearch: event.target.checked,
              commercialLicense: event.target.checked
                ? current.commercialLicense
                : false,
            }))
          }
        />
      </label>
      <label className="toggle-row">
        <span>
          <b>Commercial license</b>
          <small>Explicit permission for aggregate reuse.</small>
        </span>
        <input
          type="checkbox"
          checked={consent.commercialLicense}
          disabled={!consent.aggregateResearch}
          onChange={(event) =>
            setConsent((current) => ({
              ...current,
              commercialLicense: event.target.checked,
            }))
          }
        />
      </label>
      <div className={`research-pack ${canContribute ? 'ready' : ''}`}>
        <span>{canContribute ? 'Contribution pack ready' : 'Contribution locked'}</span>
        <button
          type="button"
          onClick={() => downloadJson('oura-signal-aggregate-pack.json', pack)}
          disabled={!canContribute}
          title="Download aggregate contribution pack"
        >
          <ArrowDownToLine size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

function OAuthPanel({
  clientId,
  setClientId,
  accessToken,
  onConnect,
  onFetch,
  loading,
}: {
  clientId: string
  setClientId: (value: string) => void
  accessToken?: string
  onConnect: () => void
  onFetch: () => Promise<void>
  loading: boolean
}) {
  return (
    <section className="rail-panel">
      <div className="panel-title">
        <Link2 size={18} aria-hidden="true" />
        <h2>Oura API</h2>
      </div>
      <label className="input-label">
        <span>Client ID</span>
        <input
          value={clientId}
          onChange={(event) => setClientId(event.target.value.trim())}
          placeholder="Oura OAuth client ID"
        />
      </label>
      <div className="rail-actions">
        <button type="button" onClick={onConnect} title="Open Oura authorization">
          <Fingerprint size={17} aria-hidden="true" />
          Authorize
        </button>
        <button
          type="button"
          onClick={() => void onFetch()}
          disabled={!accessToken || loading}
          title="Fetch current Oura data"
        >
          <RefreshCw size={17} aria-hidden="true" />
          Sync
        </button>
      </div>
      <p className="microcopy">
        Production OAuth uses Vercel functions for code exchange and Oura API sync.
      </p>
    </section>
  )
}

function Heatmap({ series }: { series: ReturnType<typeof buildSeries> }) {
  const days = series.slice(-56)
  return (
    <section className="panel heat-panel">
      <div className="panel-title">
        <CalendarDays size={18} aria-hidden="true" />
        <h2>Eight-week recovery map</h2>
      </div>
      <div className="heat-grid">
        {days.map((day) => {
          const value = day.recovery ?? 0
          const tone =
            value >= 78 ? 'excellent' : value >= 66 ? 'steady' : value >= 52 ? 'thin' : 'low'
          return (
            <span
              key={day.day}
              className={`heat-cell ${tone}`}
              title={`${day.day}: ${compactNumber(value)} recovery`}
            />
          )
        })}
      </div>
      <div className="heat-legend">
        <span>low</span>
        <span className="legend-cell low" />
        <span className="legend-cell thin" />
        <span className="legend-cell steady" />
        <span className="legend-cell excellent" />
        <span>high</span>
      </div>
    </section>
  )
}

function CorrelationPanel({ records }: { records: DailyRecord[] }) {
  const sleepToReadiness = pearson(
    records.slice(1).map((record, index) => [
      records[index].totalSleepHours,
      record.readinessScore,
    ]),
  )
  const strainToNextRecovery = pearson(
    records.slice(1).map((record, index) => [
      records[index].activityScore,
      record.readinessScore,
    ]),
  )
  const hrvToReadiness = pearson(
    records.map((record) => [record.hrv, record.readinessScore]),
  )
  const rows = [
    {
      label: 'Sleep hours -> next readiness',
      value: sleepToReadiness,
      stance:
        sleepToReadiness !== undefined && sleepToReadiness > 0.35
          ? 'Primary lever'
          : 'Secondary lever',
    },
    {
      label: 'Activity -> next readiness',
      value: strainToNextRecovery,
      stance:
        strainToNextRecovery !== undefined && strainToNextRecovery < -0.25
          ? 'Load-sensitive'
          : 'Load-tolerant',
    },
    {
      label: 'HRV -> same-day readiness',
      value: hrvToReadiness,
      stance:
        hrvToReadiness !== undefined && hrvToReadiness > 0.45
          ? 'Recovery proxy'
          : 'Mixed signal',
    },
  ]

  return (
    <section className="panel correlation-panel">
      <div className="panel-title">
        <Brain size={18} aria-hidden="true" />
        <h2>Personal signal weights</h2>
      </div>
      <div className="correlation-list">
        {rows.map((row) => (
          <div className="correlation-row" key={row.label}>
            <span>{row.label}</span>
            <meter min={-1} max={1} value={row.value ?? 0} />
            <strong>{row.value === undefined ? 'n/a' : compactNumber(row.value, 2)}</strong>
            <small>{row.stance}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function App() {
  const [dataset, setDataset] = useState<DatasetState>(() => ({
    label: 'Synthetic 120-day Oura export',
    mode: 'demo',
    records: generateDemoData(),
    notes: ['Demo data is synthetic and never leaves the browser.'],
  }))
  const [clientId, setClientId] = useState(
    import.meta.env.VITE_OURA_CLIENT_ID ?? '',
  )
  const [accessToken, setAccessToken] = useState<string | undefined>(() => {
    return sessionStorage.getItem('oura-signal-token') ?? undefined
  })
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [consent, setConsent] = useState<ConsentState>({
    localAnalysis: true,
    productTelemetry: false,
    aggregateResearch: false,
    commercialLicense: false,
  })

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    const search = window.location.search.replace(/^\?/, '')
    const hashParams = new URLSearchParams(hash)
    const searchParams = new URLSearchParams(search)
    const token = hashParams.get('access_token')
    const code = searchParams.get('code')
    const state = hashParams.get('state') ?? searchParams.get('state')
    const expected = sessionStorage.getItem('oura-signal-oauth-state')

    if (token && (!expected || state === expected)) {
      setAccessToken(token)
      sessionStorage.setItem('oura-signal-token', token)
      setNotice('Oura authorization received. Sync is ready.')
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    if (!code) return

    if (expected && state !== expected) {
      setNotice('Oura authorization state did not match. Try authorizing again.')
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    const exchangeCode = async () => {
      setLoading(true)
      try {
        const redirectUri = window.location.origin + window.location.pathname
        const response = await fetch('/api/oura-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirectUri }),
        })
        const payload = (await response.json()) as {
          access_token?: string
          error?: string
        }

        if (!response.ok || !payload.access_token) {
          throw new Error(payload.error ?? 'token_exchange_failed')
        }

        setAccessToken(payload.access_token)
        sessionStorage.setItem('oura-signal-token', payload.access_token)
        setNotice('Oura authorization received. Sync is ready.')
      } catch (error) {
        setNotice(`Oura token exchange failed: ${(error as Error).message}`)
      } finally {
        setLoading(false)
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    }

    void exchangeCode()
  }, [])

  const records = dataset.records
  const series = useMemo(() => buildSeries(records), [records])
  const insights = useMemo(() => buildInsights(records), [records])
  const contributionPack = useMemo(
    () => buildContributionPack(records, consent),
    [records, consent],
  )
  const latest = records.at(-1)
  const coverage = {
    days: records.length,
    sources: Array.from(new Set(records.flatMap((record) => record.sources))).slice(0, 6),
  }

  const loadDemo = () => {
    setDataset({
      label: 'Synthetic 120-day Oura export',
      mode: 'demo',
      records: generateDemoData(),
      notes: ['Demo data is synthetic and never leaves the browser.'],
    })
    setNotice('Demo dataset loaded.')
  }

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    setLoading(true)
    const parsed = await parseFiles(files)
    setLoading(false)

    if (!parsed.records.length) {
      setNotice('No daily Oura records found. Try a Trends CSV or API JSON export.')
      return
    }

    setDataset({
      label: files.map((file) => file.name).join(', '),
      mode: 'file',
      records: parsed.records,
      notes: parsed.notes.length ? parsed.notes : ['Files parsed locally.'],
    })
    setNotice(`${parsed.records.length} daily records imported.`)
  }

  const startOAuth = () => {
    if (!clientId) {
      setNotice('Add an Oura OAuth client ID first.')
      return
    }
    const state = crypto.randomUUID()
    sessionStorage.setItem('oura-signal-oauth-state', state)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: window.location.origin + window.location.pathname,
      scope: 'daily heartrate workout tag session spo2',
      state,
    })
    window.location.href = `https://cloud.ouraring.com/oauth/authorize?${params.toString()}`
  }

  const fetchOura = async () => {
    if (!accessToken) return
    setLoading(true)
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - 120)
    const startDate = start.toISOString().slice(0, 10)
    const endDate = end.toISOString().slice(0, 10)
    const notes: string[] = []

    let bundle: Record<string, unknown> = {}

    try {
      const response = await fetch(
        `/api/oura-sync?start_date=${startDate}&end_date=${endDate}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      const payload = (await response.json()) as {
        data?: Record<string, unknown>
        errors?: Array<{ endpoint: string; status: number }>
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? `sync_failed_${response.status}`)
      }

      bundle = payload.data ?? {}
      for (const error of payload.errors ?? []) {
        notes.push(`${error.endpoint}: ${error.status}`)
      }
    } catch (error) {
      notes.push(`oura-sync: ${(error as Error).message}`)
    }

    const parsed = mergeRecords(parseJson(JSON.stringify(bundle), 'oura-api'))
    setLoading(false)

    if (!parsed.length) {
      setNotice('Sync finished, but no daily records were returned.')
      setDataset((current) => ({ ...current, notes }))
      return
    }

    setDataset({
      label: 'Oura API sync',
      mode: 'oura-api',
      records: parsed,
      notes: notes.length ? notes : ['Synced with Oura API.'],
    })
    setNotice(`${parsed.length} Oura API days synced.`)
  }

  const metricCards = [
    {
      icon: Moon,
      label: 'Sleep',
      value: `${compactNumber(latestValue(records, 'totalSleepHours'), 1)}h`,
      detail: `score ${compactNumber(latestValue(records, 'sleepScore'))}`,
      delta: trendDelta(records, 'totalSleepHours'),
    },
    {
      icon: HeartPulse,
      label: 'Readiness',
      value: compactNumber(latestValue(records, 'readinessScore')),
      detail: `HRV ${compactNumber(latestValue(records, 'hrv'))} ms`,
      delta: trendDelta(records, 'readinessScore'),
    },
    {
      icon: Activity,
      label: 'Strain',
      value: compactNumber(latestValue(records, 'activityScore')),
      detail: `${compactNumber(latestValue(records, 'steps'))} steps`,
      delta: trendDelta(records, 'activityScore'),
    },
    {
      icon: Zap,
      label: 'Stress heat',
      value: `${compactNumber(latest?.stressHighMinutes)}m`,
      detail: `temp ${compactNumber(latest?.tempDeviation, 2)} C`,
      delta: trendDelta(records, 'tempDeviation'),
    },
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <LineChartIcon size={22} aria-hidden="true" />
          </div>
          <div>
            <h1>Oura Signal Lab</h1>
            <p>Recovery intelligence from raw ring data.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <StatusPill tone="green">
            <Check size={14} aria-hidden="true" />
            local-first
          </StatusPill>
          <StatusPill tone={dataset.mode === 'demo' ? 'amber' : 'blue'}>
            <Database size={14} aria-hidden="true" />
            {coverage.days} days
          </StatusPill>
          <button
            type="button"
            title="Export transformed JSON"
            onClick={() => downloadJson('oura-signal-transform.json', { dataset, series, insights })}
          >
            <FileJson size={18} aria-hidden="true" />
            Export
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-rail">
          <section className="rail-panel">
            <div className="panel-title">
              <Upload size={18} aria-hidden="true" />
              <h2>Ingest</h2>
            </div>
            <DropZone onFiles={handleFiles} />
            <div className="source-readout">
              <span>{dataset.label}</span>
              <small>{coverage.sources.join(' / ')}</small>
            </div>
          </section>

          <OAuthPanel
            clientId={clientId}
            setClientId={setClientId}
            accessToken={accessToken}
            onConnect={startOAuth}
            onFetch={fetchOura}
            loading={loading}
          />

          <ConsentPanel
            consent={consent}
            setConsent={setConsent}
            pack={contributionPack}
          />
        </aside>

        <section className="dashboard">
          {notice && (
            <div className="notice-bar">
              <Sparkles size={17} aria-hidden="true" />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice('')} title="Dismiss">
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            </div>
          )}

          {!records.length ? (
            <EmptyState onDemo={loadDemo} />
          ) : (
            <>
              <section className="metric-grid">
                {metricCards.map((card) => (
                  <MetricCard key={card.label} {...card} />
                ))}
              </section>

              <section className="brief-panel">
                <div className="brief-copy">
                  <span className="eyebrow">Today</span>
                  <h2>
                    {insights[0]?.severity === 'risk'
                      ? 'Recovery needs a veto.'
                      : insights[0]?.severity === 'watch'
                        ? 'The trend is readable.'
                        : 'The signal is usable.'}
                  </h2>
                  <p>
                    Latest day: {latest?.day}. Bedtime {formatClock(latest?.bedtimeMinutes)},
                    wake {formatClock(latest?.wakeMinutes)}. The app turns Oura scores into
                    baseline shifts, debt, mismatches, and next actions.
                  </p>
                </div>
                <div className="brief-stack">
                  {insights.slice(0, 3).map((insight) => (
                    <InsightRow insight={insight} key={insight.label} />
                  ))}
                </div>
              </section>

              <section className="panel chart-panel wide">
                <div className="panel-title">
                  <LineChartIcon size={18} aria-hidden="true" />
                  <h2>Baseline, not vibes</h2>
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series.slice(-90)} margin={{ top: 18, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="#dde1de" strokeDasharray="4 7" vertical={false} />
                      <XAxis dataKey="dateLabel" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis yAxisId="score" domain={[20, 105]} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="sleep" orientation="right" domain={[4, 10]} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #cfd8d1' }} />
                      <Legend />
                      <Area yAxisId="score" type="monotone" dataKey="readiness7" name="7d readiness" fill="#00b86b22" stroke={colors.green} strokeWidth={2} />
                      <Line yAxisId="score" type="monotone" dataKey="activityScore" name="activity score" stroke={colors.blue} strokeWidth={1.8} dot={false} />
                      <Line yAxisId="sleep" type="monotone" dataKey="sleep7" name="7d sleep hours" stroke={colors.coral} strokeWidth={2} dot={false} />
                      <Bar yAxisId="score" dataKey="strainGap" name="readiness - activity" fill="#17191c22" barSize={5} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="insight-grid">
                <Heatmap series={series} />
                <CorrelationPanel records={records} />
              </section>

              <section className="panel chart-panel">
                <div className="panel-title">
                  <Gauge size={18} aria-hidden="true" />
                  <h2>Sleep debt and stress</h2>
                </div>
                <div className="chart-frame short">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series.slice(-45)} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="#dde1de" strokeDasharray="4 7" vertical={false} />
                      <XAxis dataKey="dateLabel" tickLine={false} axisLine={false} minTickGap={18} />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #cfd8d1' }} />
                      <Area type="monotone" dataKey="sleepDebt" name="sleep debt hours" stroke={colors.coral} fill="#ff5a4f29" strokeWidth={2} />
                      <Area type="monotone" dataKey="stressHighMinutes" name="high stress minutes" stroke={colors.amber} fill="#c58a0022" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel chart-panel">
                <div className="panel-title">
                  <Activity size={18} aria-hidden="true" />
                  <h2>Sleep versus readiness</h2>
                </div>
                <div className="chart-frame short">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 8, left: -14, bottom: 4 }}>
                      <CartesianGrid stroke="#dde1de" strokeDasharray="4 7" />
                      <XAxis type="number" dataKey="totalSleepHours" name="sleep hours" domain={[4, 10]} tickLine={false} axisLine={false} />
                      <YAxis type="number" dataKey="readinessScore" name="readiness" domain={[20, 105]} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 8, border: '1px solid #cfd8d1' }} />
                      <Scatter name="days" data={series.slice(-90)} fill={colors.cyan}>
                        {series.slice(-90).map((entry) => (
                          <Cell key={entry.day} fill={(entry.sleepDebt ?? 0) > 1.2 ? colors.coral : colors.cyan} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel protocol-panel">
                <div className="panel-title">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <h2>Ethical data moat</h2>
                </div>
                <div className="protocol-grid">
                  <div>
                    <strong>Raw data</strong>
                    <span>Never included in contribution export.</span>
                  </div>
                  <div>
                    <strong>Consent gate</strong>
                    <span>Aggregate and commercial reuse are separate switches.</span>
                  </div>
                  <div>
                    <strong>Sale-ready path</strong>
                    <span>Value comes from trusted cohorts, not surprise resale.</span>
                  </div>
                </div>
              </section>

              {dataset.notes.length > 0 && (
                <section className="notes-strip">
                  {dataset.notes.map((note) => (
                    <span key={note}>{note}</span>
                  ))}
                </section>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
