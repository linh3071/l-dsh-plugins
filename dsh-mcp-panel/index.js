/**
 * Host half of the dsh-mcp-panel bundle.
 *
 * Two authenticated Fetch routes on the shared `/api` channel back the MCP
 * management panel:
 *
 * - `query` re-reads the profile patch (`$DSH_PROFILE_DIR/cordis.patch.yml`)
 *   on every call, collects every row resolved to
 *   `@deepseek-ai/dsh-mcp-client` under the Loader's override semantics
 *   (`insert` items define, later same-id rows merge with a full `config`
 *   replacement and last `disabled` wins), and decorates each row with live
 *   state: whether the Loader entry is loaded, and how many
 *   `mcp__<serverName>__*` tools are currently model-visible. The file is
 *   never cached, so hand edits show up on the next refresh.
 * - `set` toggles one patch row through the shipped
 *   `pluginManager.setPluginEnabled()` service: the row id must resolve to an
 *   MCP row in the current patch, the write lands as a `disabled:` override in
 *   the same patch file, and the returned `ChangeResult` is forwarded so the
 *   panel can report `applied | restart-required | overridden | failed`.
 *
 * Secrets never cross the route: `env`/`headers` values (including `!!js`
 * expressions, kept as raw strings by the parser), stdio arguments, and HTTP
 * URL values are not echoed. The response carries only a transport label.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/** The bundle ships its own `yaml` dependency (installed beside this file). */
const require = createRequire(import.meta.url)
const YAML = require('yaml')

/** Exact Fetch routes below /api owned by this plugin. */
export const QUERY_PATH = '/api/dsh-mcp-panel/query'
export const SET_PATH = '/api/dsh-mcp-panel/set'

/** The only plugin package whose Loader rows this panel lists and toggles. */
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

/** Services required before the routes register; the rest is optional. */
export const inject = ['connection', 'tools']

// ---------------------------------------------------------------------------
// Profile patch reading
// ---------------------------------------------------------------------------

/** The running profile owns the user patch layer. */
function profileDir() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return process.env.DSH_PROFILE_DIR?.trim() || join(home, 'profiles', 'web')
}

/**
 * Parse the patch file. `!!js` expressions stay raw strings: the panel never
 * evaluates or displays them.
 */
function readPatch(file) {
  const text = readFileSync(file, 'utf8')
  const document = YAML.parseDocument(text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }],
  })
  if (document.errors.length > 0) {
    throw new Error(document.errors.map(error => error.message).join('; '))
  }
  return document.toJS()
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Fold patch rows into one entry per id, in Loader override order: an
 * `insert` group defines its items; a later same-id row merges over it,
 * replacing the complete `config` and taking the last `disabled` value.
 * @returns rows resolved to the MCP client package, in patch order.
 */
function collectMcpRows(patch) {
  if (!Array.isArray(patch)) return []
  const byId = new Map()
  for (const item of patch) {
    if (!isPlainObject(item)) continue
    if (Array.isArray(item.insert)) {
      for (const definition of item.insert) {
        if (!isPlainObject(definition) || typeof definition.id !== 'string' || definition.id === '') continue
        byId.set(definition.id, { ...definition })
      }
      continue
    }
    if (typeof item.id !== 'string' || item.id === '') continue
    const merged = { ...byId.get(item.id) ?? { id: item.id } }
    if (typeof item.name === 'string') merged.name = item.name
    if (item.config !== undefined) merged.config = item.config
    if (item.disabled !== undefined) merged.disabled = item.disabled
    byId.set(item.id, merged)
  }
  return [...byId.values()].filter(row => row.name === MCP_CLIENT_PACKAGE)
}

/** One panel row: patch identity plus connection summary; no secret material. */
function describeServer(row) {
  const config = isPlainObject(row.config) ? row.config : null
  const serverName = typeof config?.serverName === 'string' ? config.serverName : ''
  const transport = config?.transport === 'streamable-http' || config?.transport === 'stdio'
    ? config.transport
    : ''
  const hasTarget = transport === 'stdio'
    ? typeof config?.command === 'string' && config.command !== ''
    : transport === 'streamable-http'
      ? typeof config?.url === 'string' && config.url !== ''
      : false
  const target = hasTarget
    ? transport === 'stdio' ? 'stdio command configured' : 'HTTP endpoint configured'
    : ''
  return {
    id: row.id,
    serverName,
    transport,
    target,
    toolCallTimeoutMs: typeof config?.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : null,
    disabled: row.disabled === true,
    failOnStartupError: config?.failOnStartupError === true,
    configOk: config !== null && serverName !== '' && transport !== '' && hasTarget,
  }
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

/**
 * Decorate panel rows with runtime facts. `live` reads the Loader's active
 * entries; `tools` counts the server's currently model-visible tools in the
 * global tool surface.
 */
function withLiveState(ctx, servers) {
  const loader = ctx.get('loader')
  const liveIds = new Set()
  if (loader !== undefined) {
    for (const entry of loader.entries()) {
      const id = entry?.options?.id ?? entry?.id
      if (typeof id === 'string') liveIds.add(id)
    }
  }
  const schemas = ctx.tools.schemas()
  for (const server of servers) {
    server.live = liveIds.has(server.id)
    server.tools = server.serverName === ''
      ? 0
      : schemas.filter(schema => typeof schema?.name === 'string' && schema.name.startsWith(`mcp__${server.serverName}__`)).length
  }
  return servers
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** Panel snapshot: patch-declared MCP rows plus live state. */
function handleQuery(ctx) {
  const file = join(profileDir(), 'cordis.patch.yml')
  try {
    const servers = withLiveState(ctx, collectMcpRows(readPatch(file)).map(describeServer))
    return json({
      generatedAt: Date.now(),
      patchPath: file,
      managerAvailable: ctx.get('pluginManager') !== undefined,
      servers,
    })
  } catch (error) {
    return json({
      generatedAt: Date.now(),
      patchPath: file,
      managerAvailable: ctx.get('pluginManager') !== undefined,
      servers: [],
      error: String(error?.message ?? error),
    })
  }
}

/**
 * Resolve the patch row id to the live Loader entry id the plugin manager
 * addresses (`include:<id>` for profile-patch rows). Returns the input when
 * no live entry matches, so the manager's own refusal stays the failure mode.
 */
function resolveEntryId(ctx, id) {
  const loader = ctx.get('loader')
  if (loader === undefined) return `include:${id}`
  const entry = [...loader.entries()].find(candidate => (candidate?.options?.id ?? candidate?.id) === id)
  return typeof entry?.id === 'string' && entry.id !== '' ? entry.id : `include:${id}`
}

/**
 * Toggle one MCP patch row through the shipped plugin manager. The id must
 * currently resolve to an MCP row in the patch, so this route cannot address
 * unrelated plugins.
 */
async function handleSet(ctx, request) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: { code: 'invalid-json' } }, 400)
  }
  const id = typeof body?.id === 'string' ? body.id : ''
  const enabled = body?.enabled
  if (id === '' || typeof enabled !== 'boolean') {
    return json({ error: { code: 'invalid-body' } }, 400)
  }
  const manager = ctx.get('pluginManager')
  if (manager === undefined) {
    return json({ ok: false, application: 'unavailable', error: { code: 'plugin-manager-unavailable' } })
  }
  let known = false
  try {
    known = collectMcpRows(readPatch(join(profileDir(), 'cordis.patch.yml'))).some(row => row.id === id)
  } catch {
    known = false
  }
  if (!known) {
    return json({ ok: false, application: 'failed', error: { code: 'unknown-mcp-row' } })
  }
  try {
    const result = await manager.setPluginEnabled(resolveEntryId(ctx, id), enabled)
    const application = String(result?.application ?? 'failed')
    return json({
      ok: application === 'applied' || application === 'restart-required' || application === 'overridden',
      changed: result?.changed === true,
      application,
      ...Array.isArray(result?.warnings) && result.warnings.length > 0 ? { warnings: result.warnings } : {},
      ...isPlainObject(result?.error) ? { error: result.error } : {},
    })
  } catch (error) {
    return json({
      ok: false,
      application: 'failed',
      error: { code: 'operation-error', diagnostic: String(error?.message ?? error) },
    })
  }
}

/**
 * Register both panel routes; Connection owns transport trust and browser
 * authentication.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: QUERY_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => handleQuery(ctx),
    }),
    'dsh-mcp-panel: query route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: SET_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => handleSet(ctx, request),
    }),
    'dsh-mcp-panel: set route',
  )
}
