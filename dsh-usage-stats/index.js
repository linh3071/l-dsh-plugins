/**
 * Host half of the dsh-usage-stats bundle.
 *
 * One authenticated Fetch route on the shared /api channel scans the local
 * session logs (every `session.v4.jsonl.zstd` under `$DSH_HOME/sessions`),
 * folds every assistant settlement into one usage record, and answers the
 * browser panel with aggregates: range totals, per-day buckets for the
 * calendar heatmap, provider/model groups, and the top sessions inside the
 * requested range.
 *
 * Usage sources, in priority order:
 * 1. Provider-reported `data.usage` on `assistant/message` events — exact
 *    buckets (`inputTokens` is the uncached prompt part; `cacheReadTokens` /
 *    `cacheWriteTokens` the cache traffic; `outputTokens` includes
 *    reasoning). Attribution: `data.message.source.{provider, model}`.
 * 2. The DSH token-meter heuristic over the message content for settlements
 *    whose adapter reported nothing (flagged `estimated`; input stays 0
 *    because the request surface is not replayed here).
 *
 * A record is stamped with the settlement event's `time`. Day buckets use a
 * fixed UTC+8 offset, matching the sibling quota dashboard's convention.
 * Auxiliary LLM requests (session titles, web-search rewriting) report no
 * usage on the log; only their in-range counts are returned.
 *
 * Route body: `{ from?, to?, groupBy? }` with epoch-ms bounds (`to`
 * exclusive) and `groupBy: 'provider' | 'model'`. The browser computes the
 * preset bounds in its own locale; the Host never guesses a preset.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Exact Fetch route below /api owned by this plugin. */
export const QUERY_PATH = '/api/dsh-usage-stats/query'

const SHANGHAI_OFFSET_MS = 8 * 3_600_000
const DAY_MS = 86_400_000
/** How far back the per-day heatmap buckets reach. */
const HEATMAP_DAYS = 365
/** Rows returned in the per-session table. */
const MAX_SESSION_ROWS = 50
/** Per-file diagnostics kept in one response. */
const MAX_ERRORS = 10
const ZSTD_MAGIC = 0xFD2FB528

// ---------------------------------------------------------------------------
// Session log discovery and decoding
// ---------------------------------------------------------------------------

function dshHome() {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

/** Every session dir's v4 log; project entries without one are skipped. */
function* listSessionLogFiles(root) {
  let projects
  try {
    projects = readdirSync(root, { withFileTypes: true })
  } catch {
    // A missing sessions root simply yields no records.
    return
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    let sessions
    try {
      sessions = readdirSync(join(root, project.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const file = join(root, project.name, session.name, 'session.v4.jsonl.zstd')
      try {
        if (statSync(file).isFile()) yield file
      } catch {
        // Session dirs without a v4 log hold nothing to fold.
      }
    }
  }
}

/**
 * Locate structurally complete Zstandard frames without decompressing them.
 * A torn final frame (the log is being written) is ignored, mirroring the
 * persistence backend's recovery scan.
 */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid Zstandard frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`reserved Zstandard frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`reserved Zstandard block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push([start, offset])
  }
  return frames
}

/** Decompress every complete frame and parse the concatenated JSONL lines. */
function decodeLogFile(file) {
  const buffer = readFileSync(file)
  const events = []
  for (const [start, end] of scanZstdFrames(buffer)) {
    const text = zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        events.push(JSON.parse(trimmed))
      } catch {
        // Skip a malformed line; the surrounding log stays usable.
      }
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Event folding
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

function nonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Price one assistant settlement's content blocks under the DSH token-meter
 * heuristic (fixed 4 chars/token density plus block/role framing), matching
 * `@deepseek-ai/dsh-token-meter/estimate` for assistant content.
 */
function estimateAssistantOutput(content) {
  let tokens = 0
  for (const block of Array.isArray(content) ? content : []) {
    if (block === null || typeof block !== 'object') continue
    if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
      tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
    } else if (block.type === 'tool-call') {
      tokens += Math.ceil(String(block.name ?? '').length / CHARS_PER_TOKEN)
        + Math.ceil(String(block.arguments ?? '').length / CHARS_PER_TOKEN)
        + BLOCK_OVERHEAD
    } else {
      tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
    }
  }
  return tokens + ROLE_OVERHEAD
}

/** One usage record: `{ sessionId, cwd, time, provider, model, buckets }`. */
function recordFromAssistantMessage(event, sessionId, cwd) {
  const time = event.time
  if (typeof time !== 'number' || !Number.isFinite(time)) return null
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  const message = data.message !== null && typeof data.message === 'object' ? data.message : {}
  const source = message.source !== null && typeof message.source === 'object' ? message.source : {}
  const provider = typeof source.provider === 'string' && source.provider !== '' ? source.provider : 'unknown'
  const model = typeof source.model === 'string' && source.model !== '' ? source.model : 'unknown'
  const usage = data.usage !== null && typeof data.usage === 'object' ? data.usage : null

  const input = usage !== null ? (nonNegative(usage.inputTokens) ?? 0) : 0
  const cacheRead = usage !== null ? (nonNegative(usage.cacheReadTokens) ?? 0) : 0
  const cacheWrite = usage !== null ? (nonNegative(usage.cacheWriteTokens) ?? 0) : 0
  const reportedOutput = usage !== null ? nonNegative(usage.outputTokens) : null
  const estimated = reportedOutput === null
  const output = estimated ? estimateAssistantOutput(message.content) : reportedOutput
  const reportedTotal = usage !== null ? nonNegative(usage.totalTokens) : null
  const total = reportedTotal !== null ? reportedTotal : input + cacheRead + cacheWrite + output

  return { sessionId, cwd, time, provider, model, input, cacheRead, cacheWrite, output, total, estimated }
}

/** Fold one decoded log into records plus auxiliary LLM request times. */
function foldLogFile(events) {
  let sessionId = null
  let cwd = null
  const records = []
  const auxTitleTimes = []
  const auxSearchTimes = []
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'session') {
      sessionId = typeof event.id === 'string' ? event.id : sessionId
      cwd = typeof event.cwd === 'string' ? event.cwd : cwd
      continue
    }
    if (event.type === 'assistant/message') {
      const record = recordFromAssistantMessage(event, sessionId, cwd)
      if (record !== null) records.push(record)
      continue
    }
    if (event.type === 'session/title-llm-request') {
      if (nonNegative(event.time) !== null) auxTitleTimes.push(event.time)
      continue
    }
    if (event.type === 'web/deepseek-search-llm-request') {
      if (nonNegative(event.time) !== null) auxSearchTimes.push(event.time)
      continue
    }
  }
  return { records, auxTitleTimes, auxSearchTimes }
}

// ---------------------------------------------------------------------------
// Scan cache: logs are append-only, so (mtime, size) keys their parsed fold.
// ---------------------------------------------------------------------------

const parseCache = new Map()

function collectAll() {
  const startedAt = Date.now()
  const records = []
  const auxTitleTimes = []
  const auxSearchTimes = []
  const errors = []
  const seen = new Set()
  let files = 0
  let failedFiles = 0

  for (const file of listSessionLogFiles(sessionsRoot())) {
    files += 1
    seen.add(file)
    let stat
    try {
      stat = statSync(file)
    } catch (error) {
      failedFiles += 1
      if (errors.length < MAX_ERRORS) errors.push({ file, message: String(error?.message ?? error) })
      continue
    }
    const cached = parseCache.get(file)
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      for (const record of cached.fold.records) records.push(record)
      auxTitleTimes.push(...cached.fold.auxTitleTimes)
      auxSearchTimes.push(...cached.fold.auxSearchTimes)
      continue
    }
    try {
      const fold = foldLogFile(decodeLogFile(file))
      parseCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, fold })
      for (const record of fold.records) records.push(record)
      auxTitleTimes.push(...fold.auxTitleTimes)
      auxSearchTimes.push(...fold.auxSearchTimes)
    } catch (error) {
      failedFiles += 1
      parseCache.delete(file)
      if (errors.length < MAX_ERRORS) errors.push({ file, message: String(error?.message ?? error) })
    }
  }
  for (const key of parseCache.keys()) {
    if (!seen.has(key)) parseCache.delete(key)
  }

  return { records, auxTitleTimes, auxSearchTimes, files, failedFiles, errors, scanMs: Date.now() - startedAt }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Calendar date of an epoch-ms instant at fixed UTC+8. */
function shanghaiDate(ms) {
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

function addBucket(target, record) {
  target.requests += 1
  target.input += record.input
  target.cacheRead += record.cacheRead
  target.cacheWrite += record.cacheWrite
  target.output += record.output
  target.total += record.total
}

function newBucket() {
  return { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }
}

function inRange(record, from, to) {
  return (from === null || record.time >= from) && (to === null || record.time < to)
}

function shortProject(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return null
  const parts = cwd.split('/').filter(part => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : cwd
}

/**
 * Handle one panel query. Returns `{ generatedAt, groupBy, range, totals,
 * groups, days, sessions, meta }`; every list is sorted by its total.
 *
 * `listProviders` supplies the live LLM provider registry (`ctx.llm
 * .listProviders()`); a group whose provider is absent from it is marked
 * `retired` — historical logs keep the old name, the current configuration
 * dropped it. The literal `unknown` group (records without attribution) is
 * never retired.
 */
async function handleQuery(request, listProviders) {
  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const from = nonNegative(body?.from)
  const to = nonNegative(body?.to)
  const groupBy = body?.groupBy === 'model' ? 'model' : 'provider'
  const scan = collectAll()
  const activeProviders = new Set(
    (typeof listProviders === 'function' ? listProviders() : [])
      .map(info => (info !== null && typeof info === 'object' ? info.id : null))
      .filter(id => typeof id === 'string' && id !== ''),
  )

  const rangeRecords = scan.records.filter(record => inRange(record, from, to))

  // Totals over the requested range.
  const totals = newBucket()
  totals.promptTotal = 0
  totals.reported = 0
  totals.estimated = 0
  const rangeSessions = new Set()
  for (const record of rangeRecords) {
    addBucket(totals, record)
    totals.promptTotal += record.input + record.cacheRead + record.cacheWrite
    if (record.estimated) totals.estimated += 1
    else totals.reported += 1
    if (record.sessionId !== null) rangeSessions.add(record.sessionId)
  }
  totals.sessions = rangeSessions.size

  // Groups: provider ids, or provider/model pairs.
  const groupMap = new Map()
  for (const record of rangeRecords) {
    const key = groupBy === 'model' ? `${record.provider}/${record.model}` : record.provider
    let group = groupMap.get(key)
    if (group === undefined) {
      group = { key, provider: record.provider, model: groupBy === 'model' ? record.model : null, ...newBucket() }
      groupMap.set(key, group)
    }
    addBucket(group, record)
  }
  const groups = [...groupMap.values()].sort((a, b) => b.total - a.total)
  const grandTotal = totals.total
  for (const group of groups) {
    group.share = grandTotal > 0 ? group.total / grandTotal : 0
    group.retired = group.provider !== 'unknown' && !activeProviders.has(group.provider)
  }

  // Per-day buckets for the heatmap: recent window, independent of the range.
  const heatmapCutoff = Date.now() - HEATMAP_DAYS * DAY_MS
  const dayMap = new Map()
  for (const record of scan.records) {
    if (record.time < heatmapCutoff) continue
    const date = shanghaiDate(record.time)
    let day = dayMap.get(date)
    if (day === undefined) {
      day = { date, ...newBucket() }
      dayMap.set(date, day)
    }
    addBucket(day, record)
  }
  const days = [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1))

  // Top sessions inside the range.
  const sessionMap = new Map()
  for (const record of rangeRecords) {
    if (record.sessionId === null) continue
    let entry = sessionMap.get(record.sessionId)
    if (entry === undefined) {
      entry = {
        id: record.sessionId,
        cwd: record.cwd,
        project: shortProject(record.cwd),
        models: new Map(),
        ...newBucket(),
      }
      sessionMap.set(record.sessionId, entry)
    }
    addBucket(entry, record)
    entry.models.set(record.model, (entry.models.get(record.model) ?? 0) + record.total)
  }
  const sessions = [...sessionMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_SESSION_ROWS)
    .map(entry => ({
      id: entry.id,
      shortId: entry.id.replace(/^session-/, '').slice(0, 8),
      cwd: entry.cwd,
      project: entry.project,
      model: [...entry.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown',
      requests: entry.requests,
      input: entry.input,
      cacheRead: entry.cacheRead,
      output: entry.output,
      total: entry.total,
    }))

  // Auxiliary LLM requests: counted, never priced.
  const countTimes = times => times.filter(time => inRange({ time }, from, to)).length

  let coverageFrom = null
  let coverageTo = null
  for (const record of scan.records) {
    if (coverageFrom === null || record.time < coverageFrom) coverageFrom = record.time
    if (coverageTo === null || record.time > coverageTo) coverageTo = record.time
  }

  return new Response(JSON.stringify({
    generatedAt: Date.now(),
    groupBy,
    range: { from, to },
    totals,
    groups,
    days,
    sessions,
    meta: {
      files: scan.files,
      failedFiles: scan.failedFiles,
      errors: scan.errors,
      scanMs: scan.scanMs,
      coverage: { from: coverageFrom, to: coverageTo },
      activeProviders: [...activeProviders],
      aux: {
        titleRequests: countTimes(scan.auxTitleTimes),
        searchRequests: countTimes(scan.auxSearchTimes),
      },
    },
  }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** Services required before registering the route. */
export const inject = ['connection', 'llm']

/**
 * Register the query route; Connection owns transport trust and browser auth.
 * The live provider registry answers each query, so a provider the user
 * retires is marked on the next panel refresh without a reload.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: QUERY_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => handleQuery(request, () => ctx.llm.listProviders()),
    }),
    'dsh-usage-stats: query route',
  )
}
