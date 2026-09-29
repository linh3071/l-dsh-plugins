/**
 * Host half of the dsh-quota-dashboard bundle.
 *
 * One authenticated Fetch route on the shared `/api` channel proxies the four
 * platform quota APIs for the browser panel. The provider backing each
 * platform is discovered from the profile patch (`cordis.patch.yml`,
 * `config.providers`); its `apiKeyEnv` names the secret in
 * `$DSH_HOME/.credentials.yaml` (`refs`). Both files are re-read per query,
 * so edits take effect on the next query without a reload. Normalized results
 * never contain a key.
 *
 * Normalized result (per platform):
 * - `{ ok: true, platform, provider, fetchedAt, status, badge?, summary, sections, conclusion }`
 * - `{ ok: false, platform, provider?, code, message, fetchedAt }` with code
 *   `not_configured | network | http | business | unknown_platform | internal`
 *
 * `summary` lines carry compact labels (`5h`, `7d`, `额度`, `余额`), a value,
 * a `tone` (`ok | warn | bad | neutral`), and an optional epoch-ms `resetAt`
 * the browser renders as a countdown. Table cells are display strings; times
 * are pre-formatted in Asia/Shanghai, matching the source skills.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/** The bundle ships its own `yaml` dependency (installed beside this file). */
const require = createRequire(import.meta.url)
const YAML = require('yaml')

/** Exact Fetch route below /api owned by this plugin. */
export const QUERY_PATH = '/api/dsh-quota-dashboard/query'

const REQUEST_TIMEOUT_MS = 20_000
const USER_AGENT = 'dsh-quota-dashboard/1.0'
const SHANGHAI_OFFSET_MS = 8 * 3_600_000
const SUB2API_DAYS = 30
const DAY_MS = 86_400_000

/**
 * Query protocols. Every provider in the profile patch becomes one card,
 * classified by its id into the protocol whose `match` its id satisfies
 * (`sub2api-*` providers match by prefix, so several can coexist). The
 * protocol supplies the query adapter, the site origin (`defaultOrigin`,
 * except Sub2API whose origin comes from the provider's `baseURL`), and an
 * `envFallback` for a built-in provider missing from the patch (DeepSeek).
 */
const PLATFORMS = [
  {
    id: 'deepseek',
    match: /deepseek/i,
    envFallback: 'DEEPSEEK_API_KEY',
    defaultOrigin: 'https://api.deepseek.com',
  },
  {
    id: 'minimax',
    match: /minimax/i,
    defaultOrigin: 'https://www.minimaxi.com',
  },
  {
    id: 'glm',
    match: /zai|bigmodel|glm/i,
    defaultOrigin: 'https://open.bigmodel.cn',
  },
  {
    id: 'sub2api',
    match: /^sub2api/i,
    defaultOrigin: null,
  },
]

const PLATFORM_BY_ID = new Map(PLATFORMS.map(platform => [platform.id, platform]))

/** Profile root: the running profile owns the user patch layer. */
function profileDir() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return process.env.DSH_PROFILE_DIR?.trim() || join(home, 'profiles', 'web')
}

function dshHome() {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

/** Raise a shaped error handled by queryPlatform. */
function fail(code, message) {
  throw { code, message }
}

/**
 * Providers declared in the profile patch: every patch row's
 * `config.providers` flattened to `{ id, apiKeyEnv, baseURL }`.
 */
function loadProviders() {
  const file = join(profileDir(), 'cordis.patch.yml')
  let patch
  try {
    patch = YAML.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail('not_configured', `无法读取 ${file}:${error?.message || '解析失败'}`)
  }
  if (!Array.isArray(patch)) return []
  const providers = []
  for (const row of patch) {
    const declared = row?.config?.providers
    if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) continue
    for (const [id, value] of Object.entries(declared)) {
      if (value === null || typeof value !== 'object') continue
      providers.push({
        id,
        apiKeyEnv: typeof value.apiKeyEnv === 'string' ? value.apiKeyEnv.trim() : '',
        baseURL: typeof value.baseURL === 'string' ? value.baseURL.trim() : '',
      })
    }
  }
  return providers
}

/** Credential references: env-name → secret from `$DSH_HOME/.credentials.yaml`. */
function loadCredentialRefs() {
  const file = join(dshHome(), '.credentials.yaml')
  let document
  try {
    document = YAML.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail('not_configured', `无法读取 ${file}:${error?.message || '解析失败'}`)
  }
  const refs = document?.refs
  return refs !== null && typeof refs === 'object' && !Array.isArray(refs) ? refs : {}
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pad2(value) {
  return String(value).padStart(2, '0')
}

function num(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function int(value) {
  const n = num(value)
  return n === null ? '—' : Math.round(n).toLocaleString('en-US')
}

/** `0%`, `43%`, `99.5%` — one decimal only when the value needs it. */
function fmtPercent(value) {
  const n = num(value)
  if (n === null) return '—'
  const rounded = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Math.round(n * 10) / 10
  return `${rounded}%`
}

const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$' }

function fmtMoney(value, currency) {
  const n = num(value)
  if (n === null) return '—'
  const code = String(currency ?? '').trim().toUpperCase()
  const symbol = CURRENCY_SYMBOLS[code]
  return symbol !== undefined ? `${symbol}${n.toFixed(2)}` : `${n.toFixed(2)} ${code || ''}`.trim()
}

function currencyLabel(currency) {
  const code = String(currency ?? '').trim().toUpperCase()
  if (code === 'CNY') return '人民币'
  if (code === 'USD') return '美元'
  return code || 'N/A'
}

function shanghaiFull(ms) {
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())} `
    + `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`
}

function shanghaiShort(ms) {
  return shanghaiFull(ms).slice(5)
}

function shanghaiDate(ms) {
  return shanghaiFull(ms).slice(0, 10)
}

/** Epoch ms from an ISO string, or null. */
function parseIsoMs(value) {
  if (value === null || value === undefined || value === '') return null
  const ms = Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

function toneOf(usedPercent) {
  if (usedPercent === null || usedPercent === undefined) return 'neutral'
  if (usedPercent >= 100) return 'bad'
  if (usedPercent >= 80) return 'warn'
  return 'ok'
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** GET one JSON document; raises `{ code: network | http, message }`. */
async function getJson(url, headers) {
  let response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error?.cause?.message || error?.message || '未知网络错误'
    fail('network', `连接失败:${reason}`)
  }
  const text = await response.text()
  if (!response.ok) {
    let detail = text.slice(0, 300)
    try {
      detail = JSON.stringify(JSON.parse(text)).slice(0, 300)
    } catch {
      // Keep the raw text excerpt.
    }
    fail('http', `HTTP ${response.status}:${detail}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    fail('http', `响应不是有效 JSON:${text.slice(0, 120)}`)
  }
}

/** Bearer-authenticated GET. */
function bearerGet(url, key) {
  return getJson(url, { Authorization: `Bearer ${key}` })
}

// ---------------------------------------------------------------------------
// MiniMax Token Plan (www.minimaxi.com /v1/token_plan/remains)
// ---------------------------------------------------------------------------

/**
 * Extract model groups from a remains payload. The outer key is a container
 * name (`model_remains`), never a model name: groups keep their own
 * `model_name`, with the container key only as `_name` fallback.
 */
function extractMinimaxGroups(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return []
  let data = payload.data ?? payload
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && 'data' in data) {
    const inner = data.data
    if (typeof inner === 'object' && inner !== null) data = inner
  }
  const isGroup = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (Array.isArray(data)) {
    const groups = []
    for (const item of data) {
      if (isGroup(item)) groups.push(item)
      else if (Array.isArray(item)) for (const sub of item) if (isGroup(sub)) groups.push(sub)
    }
    return groups
  }
  if (data !== null && typeof data === 'object') {
    const values = Object.entries(data)
      .filter(([key]) => key !== 'base_resp')
      .map(([, value]) => value)
    if (values.length > 0 && values.every(value => typeof value === 'object' && value !== null)) {
      const groups = []
      for (const [key, value] of Object.entries(data)) {
        if (key === 'base_resp') continue
        for (const item of Array.isArray(value) ? value : [value]) {
          if (isGroup(item)) groups.push({ ...item, _name: key })
        }
      }
      return groups
    }
    return [data]
  }
  return []
}

/**
 * One model's window usage. Usage rates come only from the remaining-percent
 * fields (`current_*_remaining_percent`); the count fields are inconsistent
 * across models and are used solely as a fallback ratio when percents are
 * missing. `end_time`/`weekly_end_time` are future window-end epoch ms.
 */
function minimaxWindow(group, prefix, windowKey) {
  const total = num(group[`${prefix}_total_count`])
  const remainingCount = num(group[`${prefix}_usage_count`])
  let remainingPercent = num(group[`${prefix}_remaining_percent`])

  const hasTotal = total !== null && total > 0
  if (remainingPercent === null && !hasTotal) return null
  if (remainingPercent === null || remainingPercent < 0 || remainingPercent > 100) {
    remainingPercent = hasTotal && remainingCount !== null ? (remainingCount / total) * 100 : null
  }
  if (remainingPercent === null) return null

  const endKey = windowKey === 'window5h' ? 'end_time' : 'weekly_end_time'
  const resetAt = num(group[endKey])
  const resetMs = resetAt !== null && resetAt > 10_000_000_000
    ? (resetAt > 10_000_000_000_00 ? resetAt : resetAt * 1000)
    : null

  return {
    model: String(group.model_name || group._name || '未知模型'),
    windowKey,
    usedPercent: 100 - remainingPercent,
    remainingPercent,
    resetAt: resetMs !== null && resetMs > Date.now() ? resetMs : null,
  }
}

async function queryMinimax(url, key) {
  const payload = await bearerGet(`${url}/v1/token_plan/remains`, key)
  const base = payload !== null && typeof payload === 'object' ? payload.base_resp : undefined
  if (base !== null && typeof base === 'object' && base.status_code !== undefined && base.status_code !== 0) {
    fail('business', `业务错误 ${base.status_code}:${base.status_msg || '未知错误'}`)
  }

  const windows = []
  for (const group of extractMinimaxGroups(payload)) {
    for (const [prefix, windowKey] of [['current_interval', 'window5h'], ['current_weekly', 'window7d']]) {
      const row = minimaxWindow(group, prefix, windowKey)
      if (row !== null) windows.push(row)
    }
  }

  const rows = windows.map(row => ({
    cells: [
      row.model,
      row.windowKey === 'window5h' ? '5 小时窗口' : '每周窗口',
      fmtPercent(row.usedPercent),
      fmtPercent(row.remainingPercent),
      row.resetAt === null ? '—' : shanghaiShort(row.resetAt),
    ],
    tones: [null, null, toneOf(row.usedPercent), 'ok', null],
  }))

  return {
    status: { kind: 'ok' },
    summary: summarizeWorstWindows(windows),
    sections: [{
      title: '用量',
      head: ['模型', '窗口', '已用', '剩余', '重置'],
      rows,
    }],
    conclusion: windows.length === 0
      ? '未返回任何 Token Plan 配额,该 Key 可能未订阅 Token Plan。'
      : windowBottleneckConclusion(windows),
  }
}

/** One summary line per window kind, worst (most-used) model first. */
function summarizeWorstWindows(windows) {
  const lines = []
  for (const [windowKey, label] of [['window5h', '5h'], ['window7d', '7d']]) {
    const candidates = windows.filter(row => row.windowKey === windowKey && row.usedPercent !== null)
    if (candidates.length === 0) continue
    const worst = candidates.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a))
    lines.push({
      label,
      value: fmtPercent(worst.usedPercent),
      tone: toneOf(worst.usedPercent),
      resetAt: worst.resetAt,
    })
  }
  return lines
}

function windowBottleneckConclusion(windows) {
  const candidates = windows.filter(row => row.usedPercent !== null)
  if (candidates.length === 0) return '配额已返回,但未提供可用于计算使用率的字段。'
  const worst = candidates.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a))
  const scope = worst.model !== undefined
    ? `${worst.model} · `
    : ''
  const label = worst.label ?? (worst.windowKey === 'window5h' ? '5 小时窗口' : '每周窗口')
  const reset = worst.resetAt !== null ? `,${shanghaiShort(worst.resetAt)} 重置` : ''
  const verdict = worst.usedPercent < 0.01
    ? '尚未产生消耗'
    : worst.usedPercent >= 100 ? '已用尽' : worst.usedPercent < 80 ? '余量充足' : '接近上限'
  return `当前瓶颈:${scope}${label},已用 ${fmtPercent(worst.usedPercent)}(${verdict})${reset}。`
}

// ---------------------------------------------------------------------------
// DeepSeek API balance (api.deepseek.com /user/balance)
// ---------------------------------------------------------------------------

async function queryDeepseek(url, key) {
  const payload = await bearerGet(`${url}/user/balance`, key)
  const infos = Array.isArray(payload?.balance_infos)
    ? payload.balance_infos.filter(info => info !== null && typeof info === 'object')
    : []
  const available = payload?.is_available

  const rows = infos.map(info => ({
    cells: [
      currencyLabel(info.currency),
      fmtMoney(info.total_balance, info.currency),
      fmtMoney(info.granted_balance, info.currency),
      fmtMoney(info.topped_up_balance, info.currency),
    ],
  }))

  const summary = infos.map(info => ({
    label: '余额',
    value: fmtMoney(info.total_balance, info.currency),
    tone: available === false ? 'bad' : 'ok',
  }))

  const conclusion = available === false
    ? '当前账户余额不足以发起 API 调用,请及时充值。'
    : available === true
      ? '余额充足,账户可正常调用 DeepSeek API。'
      : 'API 未返回可用性状态,请结合 DeepSeek 开放平台控制台确认。'

  return {
    status: { kind: available === false ? 'unavailable' : 'ok' },
    summary,
    sections: [{
      title: '余额',
      head: ['币种', '总余额', '赠金(未过期)', '充值余额'],
      rows,
    }],
    conclusion,
  }
}

// ---------------------------------------------------------------------------
// GLM Coding Plan (open.bigmodel.cn /api/monitor/usage/*)
// ---------------------------------------------------------------------------

/** The gateway reports business failures as HTTP 200 + a nonzero `code`. */
function assertGlmOk(payload) {
  if (payload === null || typeof payload !== 'object') fail('business', 'GLM 响应为空')
  const code = payload.code
  if (payload.success === false || (code !== undefined && code !== null && code !== 0 && code !== 200)) {
    fail('business', `业务错误 ${code}:${payload.msg || payload.message || '未知错误'}`)
  }
}

/** Data may sit at `.data.limits` or `.data`. */
function glmLimits(payload) {
  const data = payload?.data
  if (Array.isArray(data)) return data.filter(item => item !== null && typeof item === 'object')
  if (Array.isArray(data?.limits)) return data.limits.filter(item => item !== null && typeof item === 'object')
  return []
}

function glmWindowName(item) {
  const kind = String(item.type || item.name || '').trim().toUpperCase()
  if (kind === 'TIME_LIMIT') return { key: 'search', label: '联网搜索 / MCP(每月)' }
  if (kind === 'TOKENS_LIMIT' || kind === 'CREDIT_LIMIT') {
    return item.unit === 6
      ? { key: 'window7d', label: 'Token 用量(每周滚动)' }
      : { key: 'window5h', label: 'Token 用量(5 小时滚动)' }
  }
  return { key: 'other', label: kind || '未知窗口' }
}

async function queryGlm(url, key) {
  // The GLM gateway expects the RAW key in Authorization (no Bearer prefix).
  const headers = { Authorization: key }
  const quotaPayload = await getJson(`${url}/api/monitor/usage/quota/limit`, headers)
  assertGlmOk(quotaPayload)

  let subscription = null
  try {
    const subPayload = await getJson(`${url}/api/biz/subscription/list`, headers)
    assertGlmOk(subPayload)
    const first = Array.isArray(subPayload?.data) ? subPayload.data[0] : null
    if (first !== null && typeof first === 'object' && first !== null) subscription = first
  } catch {
    // Subscription info is optional decoration; the quota result stands alone.
  }

  const windows = []
  const rows = []
  for (const item of glmLimits(quotaPayload)) {
    const { key, label } = glmWindowName(item)
    const percent = num(item.percentage)
    const reset = num(item.nextResetTime)
    const resetText = reset !== null && reset > 0 ? shanghaiShort(reset) : '—'

    const kind = String(item.type || item.name || '').trim().toUpperCase()
    if (kind === 'TIME_LIMIT') {
      const used = num(item.currentValue)
      const limit = num(item.usage)
      const remaining = used !== null && limit !== null ? Math.max(0, limit - used) : null
      rows.push({
        cells: [
          label,
          used !== null && limit !== null ? `${int(used)} / ${int(limit)}` : '—',
          fmtPercent(percent),
          int(remaining),
          resetText,
        ],
        tones: [null, null, toneOf(percent), null, null],
      })
    } else if (kind === 'TOKENS_LIMIT' || kind === 'CREDIT_LIMIT') {
      const windowKey = item.unit === 6 ? 'window7d' : 'window5h'
      windows.push({ windowKey, label, usedPercent: percent, resetAt: reset !== null && reset > Date.now() ? reset : null })
      rows.push({
        cells: [label, '—', fmtPercent(percent), '—', resetText],
        tones: [null, null, toneOf(percent), null, null],
      })
    } else {
      rows.push({
        cells: [label, '—', fmtPercent(percent), '—', resetText],
        tones: [null, null, toneOf(percent), null, null],
      })
    }
  }

  const plan = typeof subscription?.productName === 'string' ? subscription.productName : null

  return {
    status: { kind: 'ok' },
    summary: summarizeWorstWindows(windows),
    sections: [{
      title: '用量',
      head: ['窗口', '已用 / 上限', '使用率', '剩余', '重置'],
      rows,
    }],
    conclusion: rows.length === 0
      ? '未返回任何配额,该 Key 可能未订阅 GLM Coding Plan。'
      : `${plan !== null ? `套餐 ${plan}。` : ''}${windowBottleneckConclusion(windows)}`,
  }
}

// ---------------------------------------------------------------------------
// Sub2API (sub2api… /v1/usage)
// ---------------------------------------------------------------------------

function sub2apiWindowLabel(window) {
  const text = String(window ?? '').trim().toLowerCase()
  const match = /^(\d+)\s*([hdw])$/.exec(text)
  if (match === null) return text || '滚动窗口'
  const units = { h: 'h', d: 'd', w: 'w' }
  return `${match[1]}${units[match[2]]}`
}

function calcRemaining(used, limit, explicit) {
  const direct = num(explicit)
  if (direct !== null) return direct
  const u = num(used)
  const l = num(limit)
  if (u === null || l === null) return null
  return Math.max(0, l - u)
}

function sub2apiStatus(payload) {
  if (payload?.isValid === false) return 'unavailable'
  const status = String(payload?.status ?? '').toLowerCase()
  if (['disabled', 'expired', 'invalid', 'error'].includes(status)) return 'unavailable'
  return 'ok'
}

function sub2apiBadge(payload) {
  const plan = payload?.planName
  if (typeof plan === 'string' && plan.trim() !== '') return plan.trim()
  const mode = String(payload?.mode ?? '').toLowerCase()
  if (mode === 'quota_limited') return 'API Key 限额'
  if (mode === 'unrestricted') return '订阅 / 钱包'
  return null
}

async function querySub2api(url, key) {
  const now = Date.now()
  const params = new URLSearchParams({
    days: String(SUB2API_DAYS),
    start_date: shanghaiDate(now - (SUB2API_DAYS - 1) * DAY_MS),
    end_date: shanghaiDate(now),
    timezone: 'Asia/Shanghai',
  })
  const payload = await bearerGet(`${url}/v1/usage?${params.toString()}`, key)
  if (payload === null || typeof payload !== 'object') fail('http', 'Sub2API 响应为空')

  const unit = payload.unit ?? payload.quota?.unit ?? 'USD'
  const quota = payload.quota !== null && typeof payload.quota === 'object' ? payload.quota : {}
  const rateLimits = Array.isArray(payload.rate_limits)
    ? payload.rate_limits.filter(item => item !== null && typeof item === 'object')
    : []

  const quotaRemaining = calcRemaining(quota.used, quota.limit, quota.remaining)
  const quotaPercent = quotaRemaining !== null && num(quota.limit) > 0
    ? (num(quota.limit) - quotaRemaining) / num(quota.limit) * 100
    : null

  const summary = []
  if (quotaRemaining !== null) {
    summary.push({ label: '额度', value: fmtMoney(quotaRemaining, unit), tone: toneOf(quotaPercent) })
  }
  for (const item of rateLimits) {
    const used = num(item.used)
    const limit = num(item.limit)
    const percent = used !== null && limit !== null && limit > 0 ? used / limit * 100 : null
    summary.push({
      label: sub2apiWindowLabel(item.window),
      value: fmtPercent(percent),
      tone: toneOf(percent),
      resetAt: parseIsoMs(item.reset_at),
    })
  }

  const usage = payload.usage !== null && typeof payload.usage === 'object' ? payload.usage : {}
  const today = usage.today !== null && typeof usage.today === 'object' ? usage.today : {}
  const total = usage.total !== null && typeof usage.total === 'object' ? usage.total : {}
  const expiresAt = parseIsoMs(payload.expires_at ?? payload.subscription?.expires_at)

  const usageRow = (label, source) => ({
    cells: [
      label,
      int(source.requests),
      int(source.total_tokens),
      fmtMoney(source.actual_cost, unit),
    ],
  })

  const limitRows = [{
    cells: [
      'Key 总额度',
      `${fmtMoney(quota.used, unit)} / ${fmtMoney(quota.limit, unit)}`,
      fmtPercent(quotaPercent),
      fmtMoney(quotaRemaining, unit),
      '—',
    ],
    tones: [null, null, toneOf(quotaPercent), null, null],
  }]
  for (const item of rateLimits) {
    const remaining = calcRemaining(item.used, item.limit, item.remaining)
    const used = num(item.used)
    const limit = num(item.limit)
    const percent = used !== null && limit !== null && limit > 0 ? used / limit * 100 : null
    const resetAt = parseIsoMs(item.reset_at)
    limitRows.push({
      cells: [
        `${sub2apiWindowLabel(item.window)} 限流`,
        `${fmtMoney(used, unit)} / ${fmtMoney(limit, unit)}`,
        fmtPercent(percent),
        fmtMoney(remaining, unit),
        resetAt === null ? '—' : shanghaiShort(resetAt),
      ],
      tones: [null, null, toneOf(percent), null, null],
    })
  }

  const bottleneckCandidates = [
    { name: 'Key 总额度', remaining: quotaRemaining },
    ...rateLimits.map(item => ({
      name: `${sub2apiWindowLabel(item.window)} 限流`,
      remaining: calcRemaining(item.used, item.limit, item.remaining),
      resetAt: parseIsoMs(item.reset_at),
    })),
  ].filter(row => row.remaining !== null)
  const bottleneck = bottleneckCandidates.length > 0
    ? bottleneckCandidates.reduce((a, b) => (b.remaining < a.remaining ? b : a))
    : null

  const conclusion = bottleneck === null
    ? null
    : bottleneck.name === 'Key 总额度'
      ? `当前瓶颈:Key 总额度,约还可使用 ${fmtMoney(bottleneck.remaining, unit)}。`
      : `当前瓶颈:${bottleneck.name},重置前约还可使用 ${fmtMoney(bottleneck.remaining, unit)}`
        + (bottleneck.resetAt !== undefined && bottleneck.resetAt !== null ? `,${shanghaiShort(bottleneck.resetAt)} 重置。` : '。')

  return {
    status: { kind: sub2apiStatus(payload) },
    badge: sub2apiBadge(payload),
    summary,
    sections: [
      {
        title: '额度',
        head: ['剩余', '已用 / 总额', '使用率', '到期时间'],
        rows: [{
          cells: [
            fmtMoney(quotaRemaining, unit),
            `${fmtMoney(quota.used, unit)} / ${fmtMoney(quota.limit, unit)}`,
            fmtPercent(quotaPercent),
            expiresAt === null ? '—' : shanghaiFull(expiresAt),
          ],
          tones: [null, null, toneOf(quotaPercent), null],
        }],
      },
      {
        title: '用量',
        head: ['周期', '请求', 'Token', '实际费用'],
        rows: [
          usageRow('今日', today),
          usageRow(`最近 ${SUB2API_DAYS} 天`, aggregateDaily(usage.daily_usage)),
          usageRow('历史累计', total),
        ],
      },
      {
        title: '限制',
        head: ['规则', '已用 / 上限', '使用率', '剩余', '重置'],
        rows: limitRows,
      },
    ],
    conclusion,
  }
}

/** Sum a daily-usage list's request/token/cost fields. */
function aggregateDaily(daily) {
  const result = { requests: 0, total_tokens: 0, actual_cost: 0 }
  if (!Array.isArray(daily)) return result
  for (const row of daily) {
    if (row === null || typeof row !== 'object') continue
    for (const field of Object.keys(result)) {
      const value = num(row[field])
      if (value !== null) result[field] += value
    }
  }
  return result
}

const QUERIES = {
  minimax: queryMinimax,
  deepseek: queryDeepseek,
  glm: queryGlm,
  sub2api: querySub2api,
}

// ---------------------------------------------------------------------------
// Route plumbing
// ---------------------------------------------------------------------------

/**
 * One queryable card: a patch provider classified by its id into a query
 * protocol. Cards exist per provider, in patch declaration order — multiple
 * `sub2api-*` providers each get their own card. DeepSeek is a built-in
 * provider absent from the patch's provider table: when no provider matches
 * it, one built-in instance keyed `deepseek` leads the panel.
 * @param providers - providers loaded once per query from the profile patch.
 */
function resolveInstances(providers) {
  const instances = []
  let sawDeepseek = false
  for (const provider of providers) {
    const platform = PLATFORMS.find(protocol => protocol.match.test(provider.id))
    if (platform === undefined) continue
    if (platform.id === 'deepseek') sawDeepseek = true
    instances.push({ key: provider.id, platform: platform.id, provider })
  }
  if (!sawDeepseek) {
    instances.unshift({ key: 'deepseek', platform: 'deepseek', provider: null })
  }
  return instances
}

/**
 * Resolve one instance's site origin and key. The provider's `apiKeyEnv`
 * names the credential reference; Sub2API's site origin is the provider's
 * `baseURL`, the other platforms use their fixed quota-site origins (an LLM
 * baseURL may carry an API path).
 * @param instance - one resolved instance (provider may be the built-in null).
 * @param refs - credential references read once per query.
 */
function readInstanceAccess(instance, refs) {
  const platform = PLATFORM_BY_ID.get(instance.platform)
  const provider = instance.provider
  const providerId = provider?.id ?? instance.key

  const envName = provider?.apiKeyEnv || platform.envFallback
  if (!envName) {
    return {
      ok: false,
      provider: providerId,
      message: `provider ${providerId} 未声明 apiKeyEnv,且该平台没有内置 Key 约定`,
    }
  }
  const key = String(refs[envName] ?? '').trim()
  if (key === '') {
    return {
      ok: false,
      provider: providerId,
      message: `credentials 中缺少 ${envName}(provider ${providerId} 的 apiKeyEnv)`,
    }
  }

  const originSource = platform.defaultOrigin !== null ? platform.defaultOrigin : provider?.baseURL
  let origin = ''
  try {
    origin = new URL(originSource).origin
  } catch {
    origin = ''
  }
  if (!origin.startsWith('https://')) {
    return {
      ok: false,
      provider: providerId,
      message: `provider ${providerId} 未提供可用的 https 站点地址`,
    }
  }
  return { ok: true, provider: providerId, url: origin, key }
}

/**
 * Run one instance query, folding every failure into a shaped error result.
 * @param instance - one resolved instance from resolveInstances.
 * @param refs - credential references read once per query.
 */
async function queryInstance(instance, refs) {
  const fetchedAt = Date.now()
  const base = { key: instance.key, platform: instance.platform }
  let access
  try {
    access = readInstanceAccess(instance, refs)
  } catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'internal'
    const message = error !== null && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error)
    return { ...base, provider: instance.provider?.id, ok: false, code, message, fetchedAt: Date.now() }
  }
  if (!access.ok) {
    return { ...base, provider: access.provider, ok: false, code: 'not_configured', message: access.message, fetchedAt }
  }
  try {
    const data = await QUERIES[instance.platform](access.url, access.key)
    return { ...base, provider: access.provider, ok: true, fetchedAt, ...data }
  } catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'internal'
    const message = error !== null && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error)
    return { ...base, provider: access.provider, ok: false, code, message, fetchedAt: Date.now() }
  }
}

/**
 * Handle one panel query. Body `{ key }` narrows to one provider card;
 * an empty body queries every resolved instance concurrently.
 */
async function handleQuery(request) {
  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const providers = loadProviders()
  const refs = loadCredentialRefs()
  const instances = resolveInstances(providers)
  const selected = typeof body?.key === 'string' && body.key !== ''
    ? instances.filter(instance => instance.key === body.key)
    : instances
  const results = await Promise.all(selected.map(instance => queryInstance(instance, refs)))
  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** Services required before registering the route. */
export const inject = ['connection']

/**
 * Register the query route; Connection owns transport trust and browser auth.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: QUERY_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: handleQuery,
    }),
    'dsh-quota-dashboard: query route',
  )
}
