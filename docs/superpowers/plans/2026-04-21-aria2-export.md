# Aria2 RPC 导出实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 115 网盘文件列表页增加「推送到 Aria2 RPC」能力，补齐文件夹递归下载缺失的体验。

**Architecture:** 纯逻辑层 `utils/aria2/`（零 Vue/DOM 依赖，完全可单测）+ FileItemMod 注入行内按钮 + 独立 Vue 设置面板 + 新通用 Toast 组件。按 RPC 预设数量 0/1/≥2 动态切换按钮态（引导 / 单按钮 / 下拉）。文件夹下载通过 `async generator` 递归遍历，按 intervalMs 节流。

**Tech Stack:** TypeScript, Vue 3 (`<script setup>`), Vitest (node env), DaisyUI + Tailwind, mitt, nanoid, `GM_xmlhttpRequest`（已封装为 `GMRequest`），`GM_getValue/GM_setValue`。

**Spec:** `docs/superpowers/specs/2026-04-21-aria2-export-design.md`

**实施笔记 — 与 spec 的小偏差：**
- spec §5 说"挂到现有 userSettings 下的一个子命名空间"。实施上改为 `utils/aria2/config.ts` 直接用 `GM_getValue('ARIA2_SETTINGS') / GM_setValue`，避免改动 `UserSettings` 类型（那是全局的，且它的 Proxy 只对 top-level key 触发 watch，嵌套更新需要整体替换，反而更繁琐）。设置依然持久化、依然响应式（config 内部维护订阅列表），对用户无感。

---

## 文件清单

| 路径 | 职责 | 新建 / 修改 |
|---|---|---|
| `apps/monkey/src/utils/aria2/types.ts` | 类型定义 | 新建 |
| `apps/monkey/src/utils/aria2/config.ts` | GM 存储 + 订阅 | 新建 |
| `apps/monkey/src/utils/aria2/headers.ts` | 构造 aria2 addUri 的 header 数组 | 新建 |
| `apps/monkey/src/utils/aria2/rpc.ts` | parseRpcUrl + buildAddUriPayload + HTTP 调用 | 新建 |
| `apps/monkey/src/utils/aria2/walker.ts` | 文件夹递归遍历（async generator） | 新建 |
| `apps/monkey/src/utils/aria2/events.ts` | mitt 事件总线 | 新建 |
| `apps/monkey/src/utils/aria2/index.ts` | 对外 API：pushFile / pushFolder / testRpc | 新建 |
| `apps/monkey/src/utils/aria2/__tests__/*.test.ts` | 单元测试 | 新建 |
| `apps/monkey/src/components/MasterToast/toast.ts` | Toast 单例 API | 新建 |
| `apps/monkey/src/components/MasterToast/index.vue` | Toast 渲染组件 | 新建 |
| `apps/monkey/src/components/Aria2SettingsDialog/index.vue` | 设置模态框 | 新建 |
| `apps/monkey/src/components/Aria2SettingsDialog/RpcListEditor.vue` | RPC 列表编辑子组件 | 新建 |
| `apps/monkey/src/pages/home/FileListMod/FileItemMod/aria2Push.ts` | 行内按钮 Mod | 新建 |
| `apps/monkey/src/pages/home/FileListMod/index.ts` | 注册新 Mod（1 行改动） | 修改 |
| `apps/monkey/src/pages/home/index.ts` | 挂载 Toast + 设置面板 | 修改 |
| `apps/monkey/src/icons/index.ts` | 新增图标常量 | 修改 |
| `.changeset/aria2-export.md` | 版本记录 | 新建 |

---

## Task 1：类型定义 + 默认常量

**Files:**
- Create: `apps/monkey/src/utils/aria2/types.ts`

- [ ] **Step 1：写 `types.ts`**

```ts
/** RPC 预设 */
export type Aria2RpcPreset = {
  /** 稳定 ID（nanoid） */
  id: string
  /** 显示名 */
  name: string
  /** 完整 URL，支持 http://token:secret@host:port/jsonrpc#k=v&k2=v2 */
  url: string
}

/** Aria2 设置 */
export type Aria2Settings = {
  rpcList: Aria2RpcPreset[]
  downloadPath: string
  intervalMs: number
  sha1Check: boolean
  useBrowserUA: boolean
  userAgent: string
  referer: string
  /** 每行一条 "Key: Value" */
  extraHeaders: string
}

/** walker 产出的单个文件条目 */
export type Aria2FileEntry = {
  pickCode: string
  name: string
  /** 相对于起始目录的相对路径，根目录下的文件为 ''  */
  relPath: string
  /** 可选 SHA1（用于 checksum 校验） */
  sha1?: string
  /** 字节数 */
  size?: number
}

/** RPC URL 解析结果 */
export type ParsedRpcUrl = {
  /** jsonrpc HTTP endpoint */
  endpoint: string
  /** token 模式：'token:xxx'；basic 模式：'Basic <base64>'；无认证：undefined */
  auth: { mode: 'token', token: string } | { mode: 'basic', header: string } | undefined
  /** URL fragment 解析的 options，例如 {split: '10', 'max-connection-per-server': '5'} */
  options: Record<string, string>
}
```

- [ ] **Step 2：写默认常量**

在同文件尾部追加：

```ts
export const ARIA2_DEFAULT_SETTINGS: Aria2Settings = {
  rpcList: [],
  downloadPath: '',
  intervalMs: 300,
  sha1Check: false,
  useBrowserUA: true,
  userAgent: '',
  referer: 'https://115.com',
  extraHeaders: '',
}
```

- [ ] **Step 3：commit**

```bash
git add apps/monkey/src/utils/aria2/types.ts
git commit -m "feat(aria2): add types and default settings"
```

---

## Task 2：config.ts GM 持久化 + 订阅

**Files:**
- Create: `apps/monkey/src/utils/aria2/config.ts`
- Create: `apps/monkey/src/utils/aria2/__tests__/config.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// __tests__/config.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()

vi.mock('$', () => ({
  GM_getValue: (k: string) => store.get(k),
  GM_setValue: (k: string, v: unknown) => { store.set(k, v) },
}))

import { ARIA2_DEFAULT_SETTINGS } from '../types'
import { readSettings, subscribeSettings, writeSettings } from '../config'

beforeEach(() => {
  store.clear()
})

describe('aria2 config', () => {
  it('首次读取返回默认值', () => {
    expect(readSettings()).toEqual(ARIA2_DEFAULT_SETTINGS)
  })

  it('写入后读取一致', () => {
    writeSettings({ intervalMs: 500, downloadPath: '/tmp' })
    const s = readSettings()
    expect(s.intervalMs).toBe(500)
    expect(s.downloadPath).toBe('/tmp')
    expect(s.rpcList).toEqual([])
  })

  it('写入后 GM 存储包含完整字段', () => {
    writeSettings({ intervalMs: 500 })
    expect(store.get('ARIA2_SETTINGS')).toMatchObject({
      ...ARIA2_DEFAULT_SETTINGS,
      intervalMs: 500,
    })
  })

  it('subscribeSettings 在 writeSettings 后被调用', () => {
    const cb = vi.fn()
    subscribeSettings(cb)
    writeSettings({ downloadPath: '/a' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].downloadPath).toBe('/a')
  })

  it('subscribeSettings 返回 unsubscribe 可取消', () => {
    const cb = vi.fn()
    const un = subscribeSettings(cb)
    un()
    writeSettings({ downloadPath: '/b' })
    expect(cb).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2：运行测试确认失败**

Run: `pnpm --filter @115master/monkey test -- config.test`
Expected: FAIL（模块不存在）

- [ ] **Step 3：实现 config.ts**

```ts
// apps/monkey/src/utils/aria2/config.ts
import { GM_getValue, GM_setValue } from '$'
import type { Aria2Settings } from './types'
import { ARIA2_DEFAULT_SETTINGS } from './types'

const KEY = 'ARIA2_SETTINGS'

type Subscriber = (next: Aria2Settings) => void
const subscribers = new Set<Subscriber>()

/** 读取完整设置（缺失字段填默认值） */
export function readSettings(): Aria2Settings {
  const raw = GM_getValue<Partial<Aria2Settings> | undefined>(KEY) ?? {}
  return { ...ARIA2_DEFAULT_SETTINGS, ...raw }
}

/** 部分更新设置 */
export function writeSettings(patch: Partial<Aria2Settings>): Aria2Settings {
  const next = { ...readSettings(), ...patch }
  GM_setValue(KEY, next)
  subscribers.forEach(fn => fn(next))
  return next
}

/** 订阅变更；返回 unsubscribe */
export function subscribeSettings(cb: Subscriber): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}
```

- [ ] **Step 4：运行测试确认通过**

Run: `pnpm --filter @115master/monkey test -- config.test`
Expected: PASS（5 个用例）

- [ ] **Step 5：commit**

```bash
git add apps/monkey/src/utils/aria2/config.ts apps/monkey/src/utils/aria2/__tests__/config.test.ts
git commit -m "feat(aria2): add config persistence and subscription"
```

---

## Task 3：headers.ts 构造请求头

**Files:**
- Create: `apps/monkey/src/utils/aria2/headers.ts`
- Create: `apps/monkey/src/utils/aria2/__tests__/headers.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// __tests__/headers.test.ts
import { describe, expect, it } from 'vitest'
import type { Aria2Settings } from '../types'
import { ARIA2_DEFAULT_SETTINGS } from '../types'
import { buildAria2Headers } from '../headers'

const base: Aria2Settings = {
  ...ARIA2_DEFAULT_SETTINGS,
  userAgent: 'custom-ua',
  referer: 'https://115.com',
}

describe('buildAria2Headers', () => {
  it('useBrowserUA=true 使用传入的 browserUserAgent', () => {
    const h = buildAria2Headers({
      settings: { ...base, useBrowserUA: true },
      cookie: 'a=1',
      browserUserAgent: 'browser-ua',
    })
    expect(h).toContain('User-Agent: browser-ua')
  })

  it('useBrowserUA=false 使用 settings.userAgent', () => {
    const h = buildAria2Headers({
      settings: { ...base, useBrowserUA: false },
      cookie: 'a=1',
      browserUserAgent: 'browser-ua',
    })
    expect(h).toContain('User-Agent: custom-ua')
  })

  it('包含 Referer 和 Cookie', () => {
    const h = buildAria2Headers({
      settings: base,
      cookie: 'UID=xxx; CID=yyy',
      browserUserAgent: 'b',
    })
    expect(h).toContain('Referer: https://115.com')
    expect(h).toContain('Cookie: UID=xxx; CID=yyy')
  })

  it('extraHeaders 每行一条，空行和无冒号行忽略', () => {
    const h = buildAria2Headers({
      settings: { ...base, extraHeaders: 'X-A: 1\n\nnot-a-header\nX-B: 2' },
      cookie: '',
      browserUserAgent: 'b',
    })
    expect(h).toContain('X-A: 1')
    expect(h).toContain('X-B: 2')
    expect(h).not.toContain('not-a-header')
  })

  it('cookie 为空时不输出 Cookie 行', () => {
    const h = buildAria2Headers({
      settings: base,
      cookie: '',
      browserUserAgent: 'b',
    })
    expect(h.some(line => line.startsWith('Cookie:'))).toBe(false)
  })
})
```

- [ ] **Step 2：运行测试确认失败**

Run: `pnpm --filter @115master/monkey test -- headers.test`
Expected: FAIL

- [ ] **Step 3：实现 headers.ts**

```ts
// apps/monkey/src/utils/aria2/headers.ts
import type { Aria2Settings } from './types'

export function buildAria2Headers(input: {
  settings: Aria2Settings
  cookie: string
  browserUserAgent: string
}): string[] {
  const { settings, cookie, browserUserAgent } = input
  const ua = settings.useBrowserUA ? browserUserAgent : settings.userAgent
  const out: string[] = []
  if (ua) out.push(`User-Agent: ${ua}`)
  if (settings.referer) out.push(`Referer: ${settings.referer}`)
  if (cookie) out.push(`Cookie: ${cookie}`)
  if (settings.extraHeaders) {
    settings.extraHeaders.split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (trimmed && trimmed.includes(':')) {
        out.push(trimmed)
      }
    })
  }
  return out
}
```

- [ ] **Step 4：运行测试确认通过**

Run: `pnpm --filter @115master/monkey test -- headers.test`
Expected: PASS（5 个用例）

- [ ] **Step 5：commit**

```bash
git add apps/monkey/src/utils/aria2/headers.ts apps/monkey/src/utils/aria2/__tests__/headers.test.ts
git commit -m "feat(aria2): add request headers builder"
```

---

## Task 4：rpc.ts parseRpcUrl

**Files:**
- Create: `apps/monkey/src/utils/aria2/rpc.ts`
- Create: `apps/monkey/src/utils/aria2/__tests__/rpc.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// __tests__/rpc.test.ts
import { describe, expect, it } from 'vitest'
import { parseRpcUrl } from '../rpc'

describe('parseRpcUrl', () => {
  it('无认证', () => {
    const r = parseRpcUrl('http://localhost:6800/jsonrpc')
    expect(r.endpoint).toBe('http://localhost:6800/jsonrpc')
    expect(r.auth).toBeUndefined()
    expect(r.options).toEqual({})
  })

  it('token 认证', () => {
    const r = parseRpcUrl('http://token:mysecret@localhost:6800/jsonrpc')
    expect(r.endpoint).toBe('http://localhost:6800/jsonrpc')
    expect(r.auth).toEqual({ mode: 'token', token: 'token:mysecret' })
  })

  it('basic 认证', () => {
    const r = parseRpcUrl('http://alice:p%40ss@host:6800/jsonrpc')
    expect(r.endpoint).toBe('http://host:6800/jsonrpc')
    expect(r.auth?.mode).toBe('basic')
    // alice:p@ss base64
    expect(r.auth && r.auth.mode === 'basic' && r.auth.header)
      .toBe(`Basic ${btoa('alice:p@ss')}`)
  })

  it('fragment options', () => {
    const r = parseRpcUrl('http://localhost:6800/jsonrpc#split=10&max-connection-per-server=5')
    expect(r.options).toEqual({
      'split': '10',
      'max-connection-per-server': '5',
    })
  })

  it('fragment 空值视为 enabled', () => {
    const r = parseRpcUrl('http://localhost:6800/jsonrpc#continue')
    expect(r.options).toEqual({ continue: 'enabled' })
  })
})
```

- [ ] **Step 2：运行测试确认失败**

Run: `pnpm --filter @115master/monkey test -- rpc.test`
Expected: FAIL

- [ ] **Step 3：实现 parseRpcUrl**

```ts
// apps/monkey/src/utils/aria2/rpc.ts
import type { ParsedRpcUrl } from './types'

export function parseRpcUrl(raw: string): ParsedRpcUrl {
  const u = new URL(raw)
  const endpoint = `${u.origin}${u.pathname}`

  let auth: ParsedRpcUrl['auth']
  if (u.username) {
    const pass = decodeURIComponent(u.password)
    const full = `${u.username}:${pass}`
    if (u.username === 'token') {
      auth = { mode: 'token', token: full }
    }
    else {
      auth = { mode: 'basic', header: `Basic ${btoa(full)}` }
    }
  }

  const options: Record<string, string> = {}
  if (u.hash.length > 1) {
    const params = new URLSearchParams(u.hash.slice(1))
    for (const [k, v] of params.entries()) {
      options[k] = v.length ? v : 'enabled'
    }
  }

  return { endpoint, auth, options }
}
```

- [ ] **Step 4：运行测试确认通过**

Run: `pnpm --filter @115master/monkey test -- rpc.test`
Expected: PASS（5 个用例）

- [ ] **Step 5：commit**

```bash
git add apps/monkey/src/utils/aria2/rpc.ts apps/monkey/src/utils/aria2/__tests__/rpc.test.ts
git commit -m "feat(aria2): parse RPC URL with auth and fragment options"
```

---

## Task 5：rpc.ts buildAddUriPayload

**Files:**
- Modify: `apps/monkey/src/utils/aria2/rpc.ts`
- Modify: `apps/monkey/src/utils/aria2/__tests__/rpc.test.ts`

- [ ] **Step 1：在测试文件追加用例**

```ts
import { buildAddUriPayload, parseRpcUrl } from '../rpc'

describe('buildAddUriPayload', () => {
  const base = {
    url: 'https://dl.115.com/file.mp4',
    out: 'foo/bar.mp4',
    headers: ['User-Agent: ua', 'Referer: https://115.com'],
    downloadPath: '',
    sha1: undefined as string | undefined,
    sha1Check: false,
    fragmentOptions: {} as Record<string, string>,
  }

  it('最小载荷', () => {
    const parsed = parseRpcUrl('http://localhost:6800/jsonrpc')
    const payload = buildAddUriPayload(parsed, base)
    expect(payload.jsonrpc).toBe('2.0')
    expect(payload.method).toBe('aria2.addUri')
    expect(typeof payload.id).toBe('number')
    expect(payload.params[0]).toEqual(['https://dl.115.com/file.mp4'])
    const opts = payload.params[1] as Record<string, unknown>
    expect(opts.out).toBe('foo/bar.mp4')
    expect(opts.header).toEqual(base.headers)
    expect(opts.dir).toBeUndefined()
    expect(opts.checksum).toBeUndefined()
  })

  it('token 认证前置 params', () => {
    const parsed = parseRpcUrl('http://token:xxx@localhost:6800/jsonrpc')
    const payload = buildAddUriPayload(parsed, base)
    expect(payload.params[0]).toBe('token:xxx')
    expect(payload.params[1]).toEqual(['https://dl.115.com/file.mp4'])
  })

  it('basic 认证不改 params（由 http 层带 Authorization）', () => {
    const parsed = parseRpcUrl('http://a:b@localhost:6800/jsonrpc')
    const payload = buildAddUriPayload(parsed, base)
    expect(payload.params[0]).toEqual(['https://dl.115.com/file.mp4'])
  })

  it('downloadPath 映射为 dir', () => {
    const parsed = parseRpcUrl('http://localhost:6800/jsonrpc')
    const payload = buildAddUriPayload(parsed, { ...base, downloadPath: '/downloads' })
    const opts = payload.params[payload.params.length - 1] as Record<string, unknown>
    expect(opts.dir).toBe('/downloads')
  })

  it('sha1Check+sha1 填充 checksum', () => {
    const parsed = parseRpcUrl('http://localhost:6800/jsonrpc')
    const payload = buildAddUriPayload(parsed, { ...base, sha1: 'abc', sha1Check: true })
    const opts = payload.params[payload.params.length - 1] as Record<string, unknown>
    expect(opts.checksum).toBe('sha-1=abc')
  })

  it('sha1Check=true 但 sha1 缺失 → 不加 checksum', () => {
    const parsed = parseRpcUrl('http://localhost:6800/jsonrpc')
    const payload = buildAddUriPayload(parsed, { ...base, sha1: undefined, sha1Check: true })
    const opts = payload.params[payload.params.length - 1] as Record<string, unknown>
    expect(opts.checksum).toBeUndefined()
  })

  it('fragmentOptions 合并到末尾 options', () => {
    const parsed = parseRpcUrl('http://localhost:6800/jsonrpc#split=10')
    const payload = buildAddUriPayload(parsed, {
      ...base,
      fragmentOptions: parsed.options,
    })
    const opts = payload.params[payload.params.length - 1] as Record<string, unknown>
    expect(opts.split).toBe('10')
  })
})
```

- [ ] **Step 2：运行测试确认失败**

Run: `pnpm --filter @115master/monkey test -- rpc.test`
Expected: FAIL（buildAddUriPayload 未定义）

- [ ] **Step 3：在 `rpc.ts` 实现 buildAddUriPayload**

```ts
export type AddUriRequest = {
  url: string
  out: string
  headers: string[]
  downloadPath: string
  sha1?: string
  sha1Check: boolean
  fragmentOptions: Record<string, string>
}

export type AddUriPayload = {
  jsonrpc: '2.0'
  method: 'aria2.addUri'
  id: number
  params: unknown[]
}

export function buildAddUriPayload(parsed: ParsedRpcUrl, req: AddUriRequest): AddUriPayload {
  const options: Record<string, unknown> = {
    out: req.out,
    header: req.headers,
    ...req.fragmentOptions,
  }
  if (req.downloadPath) {
    options.dir = req.downloadPath
  }
  if (req.sha1Check && req.sha1) {
    options.checksum = `sha-1=${req.sha1}`
  }

  const params: unknown[] = [[req.url], options]
  if (parsed.auth?.mode === 'token') {
    params.unshift(parsed.auth.token)
  }

  return {
    jsonrpc: '2.0',
    method: 'aria2.addUri',
    id: Date.now(),
    params,
  }
}
```

- [ ] **Step 4：运行测试确认通过**

Run: `pnpm --filter @115master/monkey test -- rpc.test`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add apps/monkey/src/utils/aria2/rpc.ts apps/monkey/src/utils/aria2/__tests__/rpc.test.ts
git commit -m "feat(aria2): build addUri payload with dir/checksum/fragment"
```

---

## Task 6：rpc.ts 加入 HTTP 调用（addUri / getVersion）

**Files:**
- Modify: `apps/monkey/src/utils/aria2/rpc.ts`

> 这部分依赖 `GMRequest` 且涉及真实网络，只做集成，不写单测。

- [ ] **Step 1：在 `rpc.ts` 追加 HTTP 层**

```ts
import { GMRequest } from '@/utils/request/gmRequst'

/** 独立实例，禁用缓存（RPC 不该被缓存） */
const rpcRequest = new GMRequest({ cache: 'no-cache' }, 'aria2-rpc')

async function postJsonRpc(parsed: ParsedRpcUrl, payload: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (parsed.auth?.mode === 'basic') {
    headers.Authorization = parsed.auth.header
  }
  const resp = await rpcRequest.request(parsed.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    timeout: 5000,
  })
  if (!resp.ok) {
    throw new Error(`RPC HTTP ${resp.status}`)
  }
  const json = await resp.json() as { result?: unknown, error?: { message: string } }
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`)
  }
  return json.result
}

/** 发送 addUri */
export async function sendAddUri(rpcUrl: string, req: AddUriRequest): Promise<string> {
  const parsed = parseRpcUrl(rpcUrl)
  const payload = buildAddUriPayload(parsed, req)
  const result = await postJsonRpc(parsed, payload)
  return String(result)
}

/** 获取 aria2 版本（供「测试」按钮） */
export async function getAria2Version(rpcUrl: string): Promise<string> {
  const parsed = parseRpcUrl(rpcUrl)
  const params: unknown[] = []
  if (parsed.auth?.mode === 'token') {
    params.push(parsed.auth.token)
  }
  const payload = {
    jsonrpc: '2.0',
    method: 'aria2.getVersion',
    id: Date.now(),
    params,
  }
  const result = await postJsonRpc(parsed, payload) as { version: string }
  return result.version
}
```

- [ ] **Step 2：确认 TypeScript 通过**

Run: `pnpm --filter @115master/monkey type-check`
Expected: PASS

- [ ] **Step 3：commit**

```bash
git add apps/monkey/src/utils/aria2/rpc.ts
git commit -m "feat(aria2): add HTTP send for addUri and getVersion"
```

---

## Task 7：walker.ts 递归遍历文件夹

**Files:**
- Create: `apps/monkey/src/utils/aria2/walker.ts`
- Create: `apps/monkey/src/utils/aria2/__tests__/walker.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// __tests__/walker.test.ts
import { describe, expect, it, vi } from 'vitest'

const getFiles = vi.fn()
vi.mock('@/utils/drive115', () => ({
  drive115: { getFiles: (...args: unknown[]) => getFiles(...args) },
}))

import { walkFolder } from '../walker'

function mkFile(pc: string, n: string, sha = 's') {
  return { pc, n, sha, s: 1 }
}
function mkDir(cid: string, n: string) {
  // 无 sha 视为文件夹
  return { cid, n }
}

describe('walkFolder', () => {
  it('单层目录：两个文件', async () => {
    getFiles.mockResolvedValueOnce({
      state: true,
      data: [mkFile('p1', 'a.mp4'), mkFile('p2', 'b.mp4')],
      path: [{ name: 'root' }],
    })
    const out: unknown[] = []
    for await (const e of walkFolder('100', 'root', 0)) out.push(e)
    expect(out).toEqual([
      { pickCode: 'p1', name: 'a.mp4', relPath: 'root', sha1: 's', size: 1 },
      { pickCode: 'p2', name: 'b.mp4', relPath: 'root', sha1: 's', size: 1 },
    ])
  })

  it('两层嵌套：根下有一个子目录和一个文件', async () => {
    getFiles
      .mockResolvedValueOnce({
        state: true,
        data: [mkFile('p1', 'a.mp4'), mkDir('200', 'sub')],
        path: [{ name: 'root' }],
      })
      .mockResolvedValueOnce({
        state: true,
        data: [mkFile('p2', 'b.mp4')],
        path: [{ name: 'root' }, { name: 'sub' }],
      })
    const out: unknown[] = []
    for await (const e of walkFolder('100', 'root', 0)) out.push(e)
    expect(out).toContainEqual({ pickCode: 'p1', name: 'a.mp4', relPath: 'root', sha1: 's', size: 1 })
    expect(out).toContainEqual({ pickCode: 'p2', name: 'b.mp4', relPath: 'root/sub', sha1: 's', size: 1 })
  })

  it('失败 1 次后重试成功', async () => {
    getFiles
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({
        state: true,
        data: [mkFile('p1', 'a.mp4')],
        path: [{ name: 'root' }],
      })
    const out: unknown[] = []
    for await (const e of walkFolder('100', 'root', 0)) out.push(e)
    expect(out.length).toBe(1)
  })

  it('失败两次后抛出', async () => {
    getFiles
      .mockRejectedValueOnce(new Error('net1'))
      .mockRejectedValueOnce(new Error('net2'))
    await expect(async () => {
      for await (const _ of walkFolder('100', 'root', 0)) { /* drain */ }
    }).rejects.toThrow()
  })
})
```

- [ ] **Step 2：运行测试确认失败**

Run: `pnpm --filter @115master/monkey test -- walker.test`
Expected: FAIL

- [ ] **Step 3：实现 walker.ts**

```ts
// apps/monkey/src/utils/aria2/walker.ts
import { drive115 } from '@/utils/drive115'
import type { Aria2FileEntry } from './types'

type RawItem = { pc?: string, cid?: string, n: string, sha?: string, s?: number }

async function fetchPage(cid: string, intervalMs: number): Promise<RawItem[]> {
  // 参数字段对齐 wrap.ts 中 getPlaylist，只改 show_dir 为 1 以拿到子目录
  const params = {
    aid: 1,
    cid,
    offset: 0,
    limit: 1150,
    show_dir: 1,
    nf: '',
    qid: 0,
    type: 0,
    source: '',
    format: 'json',
    star: '',
    is_q: '',
    is_share: '',
    r_all: 1,
    o: 'file_name',
    asc: 1,
    cur: 1,
    natsort: 1,
  }

  // 带一次重试
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await drive115.getFiles(params as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((resp as any).data ?? []) as RawItem[]
    }
    catch (e) {
      if (attempt === 1) throw e
      if (intervalMs > 0) await new Promise(r => setTimeout(r, intervalMs))
    }
  }
  return []
}

/**
 * 递归遍历，async generator 逐个 yield 文件条目。
 * @param cid 起始目录 cid
 * @param rootPath 起始目录显示名，用作 relPath 前缀
 * @param intervalMs 每页之间的节流间隔
 */
export async function* walkFolder(
  cid: string,
  rootPath: string,
  intervalMs: number,
): AsyncGenerator<Aria2FileEntry> {
  // 栈元素：{cid, relPath}
  const stack: Array<{ cid: string, relPath: string }> = [{ cid, relPath: rootPath }]

  while (stack.length > 0) {
    const cur = stack.pop()!
    const items = await fetchPage(cur.cid, intervalMs)

    for (const item of items) {
      if (item.sha) {
        // file
        yield {
          pickCode: String(item.pc),
          name: item.n,
          relPath: cur.relPath,
          sha1: item.sha,
          size: item.s,
        }
      }
      else if (item.cid) {
        // folder
        stack.push({
          cid: item.cid,
          relPath: cur.relPath ? `${cur.relPath}/${item.n}` : item.n,
        })
      }
    }

    if (stack.length > 0 && intervalMs > 0) {
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }
}
```

- [ ] **Step 4：运行测试确认通过**

Run: `pnpm --filter @115master/monkey test -- walker.test`
Expected: PASS（4 个用例）

- [ ] **Step 5：commit**

```bash
git add apps/monkey/src/utils/aria2/walker.ts apps/monkey/src/utils/aria2/__tests__/walker.test.ts
git commit -m "feat(aria2): recursive folder walker with retry"
```

---

## Task 8：events.ts 事件总线

**Files:**
- Create: `apps/monkey/src/utils/aria2/events.ts`

> 项目已直接依赖 `mitt`（见 XPlayer 代码）。

- [ ] **Step 1：写 events.ts**

```ts
// apps/monkey/src/utils/aria2/events.ts
import mitt from 'mitt'

type Events = {
  'aria2:open-settings': void
}

export const aria2Events = mitt<Events>()
```

- [ ] **Step 2：commit**

```bash
git add apps/monkey/src/utils/aria2/events.ts
git commit -m "feat(aria2): add event bus"
```

---

## Task 9：aria2/index.ts 对外 API

**Files:**
- Create: `apps/monkey/src/utils/aria2/index.ts`

- [ ] **Step 1：写 `index.ts`**

```ts
// apps/monkey/src/utils/aria2/index.ts
import { drive115 } from '@/utils/drive115'
import { appLogger } from '@/utils/logger'
import type { Aria2FileEntry, Aria2RpcPreset } from './types'
import { readSettings } from './config'
import { buildAria2Headers } from './headers'
import { getAria2Version, parseRpcUrl, sendAddUri } from './rpc'
import { walkFolder } from './walker'

const logger = appLogger.sub('Aria2')

export { readSettings, writeSettings, subscribeSettings } from './config'
export { aria2Events } from './events'
export type { Aria2RpcPreset, Aria2Settings } from './types'

/** 测试 RPC 连通 */
export async function testRpc(rpcUrl: string): Promise<string> {
  return getAria2Version(rpcUrl)
}

/** 推送单文件 */
export async function pushFile(file: {
  pickCode: string
  name: string
  relPath?: string
  sha1?: string
}, rpc: Aria2RpcPreset): Promise<void> {
  const settings = readSettings()
  const download = await drive115.getFileDownloadUrl(file.pickCode)
  const url = download.url?.url
  if (!url) {
    throw new Error(`无法获取下载地址: ${file.name}`)
  }
  const headers = buildAria2Headers({
    settings,
    cookie: document.cookie,
    browserUserAgent: navigator.userAgent,
  })
  const parsed = parseRpcUrl(rpc.url)
  const out = file.relPath ? `${file.relPath}/${file.name}` : file.name
  await sendAddUri(rpc.url, {
    url,
    out,
    headers,
    downloadPath: settings.downloadPath,
    sha1: file.sha1,
    sha1Check: settings.sha1Check,
    fragmentOptions: parsed.options,
  })
  logger.info('pushFile', { name: file.name, rpc: rpc.name })
}

/** 推送文件夹（带进度回调） */
export async function pushFolder(input: {
  cid: string
  rootPath: string
  rpc: Aria2RpcPreset
  onListProgress?: (walked: number) => void
  onPushProgress?: (done: number, total: number, failed: number) => void
}): Promise<{ done: number, failed: number }> {
  const settings = readSettings()
  const files: Aria2FileEntry[] = []
  let walked = 0
  for await (const f of walkFolder(input.cid, input.rootPath, settings.intervalMs)) {
    files.push(f)
    walked++
    input.onListProgress?.(walked)
  }

  let done = 0
  let failed = 0
  for (const f of files) {
    try {
      await pushFile({
        pickCode: f.pickCode,
        name: f.name,
        relPath: f.relPath,
        sha1: f.sha1,
      }, input.rpc)
      done++
    }
    catch (e) {
      failed++
      logger.warn('pushFolder: 单文件失败', { name: f.name, err: e })
    }
    input.onPushProgress?.(done, files.length, failed)
    if (settings.intervalMs > 0) {
      await new Promise(r => setTimeout(r, settings.intervalMs))
    }
  }
  return { done, failed }
}
```

- [ ] **Step 2：确认类型通过**

Run: `pnpm --filter @115master/monkey type-check`
Expected: PASS（如果 DownloadResult 的 URL 字段名不同，按类型定义调整；真实字段见 `apps/monkey/src/utils/drive115/core.ts`）

> **实施提示**：`drive115.getFileDownloadUrl` 返回的 `DownloadResult` 实际字段请打开 `core.ts` 查最新类型；上面用了 `download.url?.url` 的写法（见 `FileItemMod/download.ts:52` 的用法 `res.url.url`），通常是 `{ url: { url: string } }` 结构。如果结构不一致按真实类型调整。

- [ ] **Step 3：commit**

```bash
git add apps/monkey/src/utils/aria2/index.ts
git commit -m "feat(aria2): public API (pushFile/pushFolder/testRpc)"
```

---

## Task 10：图标常量

**Files:**
- Modify: `apps/monkey/src/icons/index.ts`

- [ ] **Step 1：追加图标**

在文件末尾追加：

```ts
// Aria2 推送
export const ICON_ARIA2 = 'material-symbols:cloud-download-rounded'
// 设置齿轮
export const ICON_ARIA2_SETTINGS = 'material-symbols:settings-rounded'
// 下拉箭头
export const ICON_CHEVRON_DOWN = 'material-symbols:keyboard-arrow-down-rounded'
```

- [ ] **Step 2：commit**

```bash
git add apps/monkey/src/icons/index.ts
git commit -m "feat(aria2): add icons"
```

---

## Task 11：Toast 单例 API

**Files:**
- Create: `apps/monkey/src/components/MasterToast/toast.ts`

- [ ] **Step 1：写 toast.ts**

```ts
// apps/monkey/src/components/MasterToast/toast.ts
import { reactive } from 'vue'

export type ToastKind = 'info' | 'success' | 'error' | 'loading'

export type ToastItem = {
  id: number
  kind: ToastKind
  message: string
}

export type LoadingHandle = {
  update: (msg: string) => void
  success: (msg?: string) => void
  error: (msg?: string) => void
  dismiss: () => void
}

const DURATION: Record<Exclude<ToastKind, 'loading'>, number> = {
  info: 3000,
  success: 3000,
  error: 6000,
}

export const toastQueue = reactive<ToastItem[]>([])

let seq = 0
function nextId() { return ++seq }

function remove(id: number) {
  const i = toastQueue.findIndex(t => t.id === id)
  if (i >= 0) toastQueue.splice(i, 1)
}

function push(kind: Exclude<ToastKind, 'loading'>, message: string): void {
  const id = nextId()
  toastQueue.push({ id, kind, message })
  setTimeout(() => remove(id), DURATION[kind])
}

export const toast = {
  info: (msg: string) => push('info', msg),
  success: (msg: string) => push('success', msg),
  error: (msg: string) => push('error', msg),
  loading(message: string): LoadingHandle {
    const id = nextId()
    toastQueue.push({ id, kind: 'loading', message })
    const findIdx = () => toastQueue.findIndex(t => t.id === id)
    return {
      update(msg) {
        const i = findIdx()
        if (i >= 0) toastQueue[i].message = msg
      },
      success(msg) {
        const i = findIdx()
        if (i >= 0) toastQueue[i] = { id, kind: 'success', message: msg ?? message }
        setTimeout(() => remove(id), DURATION.success)
      },
      error(msg) {
        const i = findIdx()
        if (i >= 0) toastQueue[i] = { id, kind: 'error', message: msg ?? message }
        setTimeout(() => remove(id), DURATION.error)
      },
      dismiss() { remove(id) },
    }
  },
}
```

- [ ] **Step 2：commit**

```bash
git add apps/monkey/src/components/MasterToast/toast.ts
git commit -m "feat(toast): add singleton toast API with loading handle"
```

---

## Task 12：Toast 渲染组件

**Files:**
- Create: `apps/monkey/src/components/MasterToast/index.vue`

- [ ] **Step 1：写 `index.vue`**

```vue
<template>
  <div :class="$style.container">
    <TransitionGroup name="toast">
      <div
        v-for="t in toastQueue"
        :key="t.id"
        role="alert"
        :class="[$style.toast, $style[t.kind]]"
      >
        <span v-if="t.kind === 'loading'" :class="[$style.icon, 'loading', 'loading-spinner', 'loading-sm']" />
        <span>{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { toastQueue } from './toast'
</script>

<style module>
.container {
  position: fixed;
  right: 24px;
  bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 99999;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  color: white;
  font-size: 14px;
  min-width: 220px;
  max-width: 400px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}

.info { background: #3b82f6; }
.success { background: #16a34a; }
.error { background: #dc2626; }
.loading { background: #475569; }

.icon { flex-shrink: 0; }
</style>
```

- [ ] **Step 2：commit**

```bash
git add apps/monkey/src/components/MasterToast/index.vue
git commit -m "feat(toast): add Vue render component"
```

---

## Task 13：Aria2 设置面板 RpcListEditor 子组件

**Files:**
- Create: `apps/monkey/src/components/Aria2SettingsDialog/RpcListEditor.vue`

- [ ] **Step 1：写 `RpcListEditor.vue`**

```vue
<template>
  <div :class="$style.wrap">
    <div
      v-for="(item, i) in items"
      :key="item.id"
      :class="$style.row"
    >
      <input
        :value="item.name"
        class="input input-bordered input-sm w-40"
        placeholder="名称"
        @input="update(i, 'name', ($event.target as HTMLInputElement).value)"
      >
      <input
        :value="item.url"
        class="input input-bordered input-sm flex-1"
        placeholder="http://token:密钥@127.0.0.1:6800/jsonrpc"
        @input="update(i, 'url', ($event.target as HTMLInputElement).value)"
      >
      <button class="btn btn-sm btn-ghost" @click="onTest(i)">
        测试
      </button>
      <button class="btn btn-sm btn-ghost text-error" @click="remove(i)">
        删除
      </button>
      <span v-if="testResults[item.id]" :class="$style.result">
        {{ testResults[item.id] }}
      </span>
    </div>
    <button class="btn btn-sm btn-primary" @click="add">
      + 添加 RPC
    </button>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { nanoid } from 'nanoid'
import type { Aria2RpcPreset } from '@/utils/aria2'
import { testRpc } from '@/utils/aria2'

const props = defineProps<{ modelValue: Aria2RpcPreset[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: Aria2RpcPreset[]): void }>()

const items = reactive([...props.modelValue])
const testResults = reactive<Record<string, string>>({})

function emitChange() {
  emit('update:modelValue', JSON.parse(JSON.stringify(items)))
}

function update(i: number, k: 'name' | 'url', v: string) {
  items[i][k] = v
  emitChange()
}

function add() {
  items.push({ id: nanoid(), name: '', url: '' })
  emitChange()
}

function remove(i: number) {
  items.splice(i, 1)
  emitChange()
}

async function onTest(i: number) {
  const item = items[i]
  testResults[item.id] = '连接中...'
  try {
    const v = await testRpc(item.url)
    testResults[item.id] = `v${v}`
  }
  catch (e) {
    testResults[item.id] = e instanceof Error ? e.message : '失败'
  }
}
</script>

<style module>
.wrap { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 8px; }
.result { font-size: 12px; color: #64748b; margin-left: 4px; }
</style>
```

- [ ] **Step 2：确认 `nanoid` 在依赖中**

Run: `pnpm --filter @115master/monkey ls nanoid`
Expected: 如果未安装，运行：

```bash
pnpm --filter @115master/monkey add nanoid
```

- [ ] **Step 3：commit**

```bash
git add apps/monkey/src/components/Aria2SettingsDialog/RpcListEditor.vue apps/monkey/package.json pnpm-lock.yaml
git commit -m "feat(aria2): add RPC list editor component"
```

---

## Task 14：Aria2 设置面板主组件

**Files:**
- Create: `apps/monkey/src/components/Aria2SettingsDialog/index.vue`

- [ ] **Step 1：写 `index.vue`**

```vue
<template>
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box w-11/12 max-w-3xl">
      <h3 class="font-bold text-lg mb-4">
        Aria2 导出设置
      </h3>

      <div :class="$style.section">
        <label class="label">RPC 列表</label>
        <RpcListEditor v-model="form.rpcList" />
      </div>

      <div :class="$style.section">
        <label class="label">下载路径（可选）</label>
        <input v-model="form.downloadPath" class="input input-bordered w-full" placeholder="绝对路径">
      </div>

      <div :class="$style.section">
        <label class="label">递归间隔（ms）</label>
        <input v-model.number="form.intervalMs" type="number" class="input input-bordered w-40" min="0">
      </div>

      <div :class="$style.section">
        <label class="label cursor-pointer justify-start gap-2">
          <input v-model="form.sha1Check" type="checkbox" class="checkbox checkbox-sm">
          SHA1 校验
        </label>
      </div>

      <div :class="$style.section">
        <label class="label cursor-pointer justify-start gap-2">
          <input v-model="form.useBrowserUA" type="checkbox" class="checkbox checkbox-sm">
          使用浏览器 UA
        </label>
        <input
          v-model="form.userAgent"
          class="input input-bordered w-full mt-2"
          :disabled="form.useBrowserUA"
          placeholder="自定义 User-Agent"
        >
      </div>

      <div :class="$style.section">
        <label class="label">Referer</label>
        <input v-model="form.referer" class="input input-bordered w-full">
      </div>

      <div :class="$style.section">
        <label class="label">自定义 Headers（每行 Key: Value）</label>
        <textarea v-model="form.extraHeaders" class="textarea textarea-bordered w-full h-24" />
      </div>

      <div class="modal-action">
        <button class="btn" @click="onReset">
          重置
        </button>
        <button class="btn btn-primary" @click="onApply">
          应用
        </button>
        <button class="btn" @click="close">
          关闭
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import type { Aria2Settings } from '@/utils/aria2'
import { aria2Events, readSettings, writeSettings } from '@/utils/aria2'
import { ARIA2_DEFAULT_SETTINGS } from '@/utils/aria2/types'
import RpcListEditor from './RpcListEditor.vue'

const dialogRef = ref<HTMLDialogElement | null>(null)
const form = reactive<Aria2Settings>({ ...readSettings() })

function refill() {
  Object.assign(form, readSettings())
  // 预填 navigator.userAgent 给自定义 UA 输入框（仅在用户未填时）
  if (!form.userAgent) form.userAgent = navigator.userAgent
}

function open() {
  refill()
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
}

function onApply() {
  const cleaned = {
    ...form,
    rpcList: form.rpcList.filter(r => r.name.trim() && r.url.trim()),
  }
  writeSettings(cleaned)
  close()
}

function onReset() {
  Object.assign(form, ARIA2_DEFAULT_SETTINGS)
}

onMounted(() => {
  aria2Events.on('aria2:open-settings', open)
})
onUnmounted(() => {
  aria2Events.off('aria2:open-settings', open)
})
</script>

<style module>
.section { margin-bottom: 16px; }
</style>
```

- [ ] **Step 2：commit**

```bash
git add apps/monkey/src/components/Aria2SettingsDialog/index.vue
git commit -m "feat(aria2): add settings dialog component"
```

---

## Task 15：FileItemMod 行内按钮（三态）

**Files:**
- Create: `apps/monkey/src/pages/home/FileListMod/FileItemMod/aria2Push.ts`

- [ ] **Step 1：写 `aria2Push.ts`**

```ts
// apps/monkey/src/pages/home/FileListMod/FileItemMod/aria2Push.ts
import type { Aria2RpcPreset } from '@/utils/aria2'
import { aria2Events, pushFile, pushFolder, readSettings, subscribeSettings } from '@/utils/aria2'
import { toast } from '@/components/MasterToast/toast'
import { FileListType, FileType } from '@/pages/home/types'
import { is115Browser } from '@/utils/platform'
import { FileItemModBase } from './base'

export class FileItemModAria2Push extends FileItemModBase {
  private container: HTMLElement | null = null
  private unsubscribe: (() => void) | null = null

  get fileOprNode() {
    return this.itemNode.querySelector<HTMLElement>('.file-opr')
      ?? this.itemNode.querySelector<HTMLElement>('.file-opt')
  }

  get isFolder() {
    return this.itemInfo.attributes.file_type === FileType.folder
  }

  onLoad() {
    if (is115Browser) return
    if (this.itemInfo.fileListType === FileListType.grid) return
    if (!this.fileOprNode) return

    this.render()
    this.unsubscribe = subscribeSettings(() => this.render())
  }

  onDestroy() {
    this.container?.remove()
    this.container = null
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private render() {
    this.container?.remove()
    this.container = document.createElement('span')
    this.container.style.cssText = 'display:inline-flex;align-items:center;margin-right:8px;position:relative;z-index:1000;pointer-events:all;'

    const list = readSettings().rpcList
    if (list.length === 0) {
      this.container.appendChild(this.buildConfigButton())
    }
    else if (list.length === 1) {
      this.container.appendChild(this.buildSingleButton(list[0]))
    }
    else {
      this.container.appendChild(this.buildDropdown(list))
    }

    this.fileOprNode?.prepend(this.container)
  }

  private buildConfigButton(): HTMLElement {
    const a = document.createElement('a')
    a.href = 'javascript:void(0)'
    a.textContent = '⚙ 配置 Aria2'
    a.title = '尚未配置 Aria2 RPC，点击打开设置'
    a.style.cssText = 'color:#888;padding:2px 6px;border:1px dashed #aaa;border-radius:4px;font-size:12px;'
    a.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      aria2Events.emit('aria2:open-settings')
    })
    return a
  }

  private buildSingleButton(preset: Aria2RpcPreset): HTMLElement {
    const a = document.createElement('a')
    a.href = 'javascript:void(0)'
    a.textContent = `⇩ ${preset.name}`
    a.title = `推送到 Aria2：${preset.name}`
    a.style.cssText = 'padding:2px 6px;font-size:12px;'
    a.addEventListener('mousedown', async (e) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      await this.handlePush(preset)
    })
    return a
  }

  private buildDropdown(presets: Aria2RpcPreset[]): HTMLElement {
    const wrap = document.createElement('span')
    wrap.style.cssText = 'position:relative;display:inline-block;'

    const trigger = document.createElement('a')
    trigger.href = 'javascript:void(0)'
    trigger.textContent = '⇩ Aria2 ▾'
    trigger.style.cssText = 'padding:2px 6px;font-size:12px;'

    const menu = document.createElement('div')
    menu.style.cssText = 'position:absolute;top:100%;left:0;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.1);padding:4px 0;min-width:140px;display:none;z-index:1001;'

    for (const p of presets) {
      const item = document.createElement('a')
      item.href = 'javascript:void(0)'
      item.textContent = p.name
      item.style.cssText = 'display:block;padding:6px 12px;font-size:12px;color:#333;text-decoration:none;'
      item.addEventListener('mouseenter', () => { item.style.background = '#f1f5f9' })
      item.addEventListener('mouseleave', () => { item.style.background = '' })
      item.addEventListener('mousedown', async (e) => {
        e.preventDefault()
        e.stopImmediatePropagation()
        menu.style.display = 'none'
        await this.handlePush(p)
      })
      menu.appendChild(item)
    }

    const divider = document.createElement('div')
    divider.style.cssText = 'border-top:1px solid #eee;margin:4px 0;'
    menu.appendChild(divider)

    const settingsItem = document.createElement('a')
    settingsItem.href = 'javascript:void(0)'
    settingsItem.textContent = '⚙ 设置'
    settingsItem.style.cssText = 'display:block;padding:6px 12px;font-size:12px;color:#666;text-decoration:none;'
    settingsItem.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      menu.style.display = 'none'
      aria2Events.emit('aria2:open-settings')
    })
    menu.appendChild(settingsItem)

    wrap.addEventListener('mouseenter', () => { menu.style.display = 'block' })
    wrap.addEventListener('mouseleave', () => { menu.style.display = 'none' })

    wrap.appendChild(trigger)
    wrap.appendChild(menu)
    return wrap
  }

  private async handlePush(rpc: Aria2RpcPreset) {
    const attrs = this.itemInfo.attributes
    if (this.isFolder) {
      const handle = toast.loading(`正在获取文件列表... 0`)
      try {
        const result = await pushFolder({
          cid: attrs.cid,
          rootPath: attrs.title,
          rpc,
          onListProgress: walked => handle.update(`正在获取文件列表... ${walked}`),
          onPushProgress: (done, total, failed) => handle.update(`推送中 ${done}/${total}${failed ? `（失败 ${failed}）` : ''}`),
        })
        if (result.failed === 0) {
          handle.success(`已推送 ${result.done} 个文件`)
        }
        else {
          handle.error(`已推送 ${result.done}，失败 ${result.failed}`)
        }
      }
      catch (e) {
        handle.error(`推送失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    else {
      const h = toast.loading(`推送 ${attrs.title}...`)
      try {
        await pushFile({
          pickCode: attrs.pick_code,
          name: attrs.title,
          sha1: attrs.sha1,
        }, rpc)
        h.success('推送成功')
      }
      catch (e) {
        h.error(`推送失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}
```

- [ ] **Step 2：确认类型通过**

Run: `pnpm --filter @115master/monkey type-check`
Expected: PASS

- [ ] **Step 3：commit**

```bash
git add apps/monkey/src/pages/home/FileListMod/FileItemMod/aria2Push.ts
git commit -m "feat(aria2): add file item mod with 3-state button"
```

---

## Task 16：注册 Mod + 挂载 Toast / 设置面板

**Files:**
- Modify: `apps/monkey/src/pages/home/FileListMod/index.ts`
- Modify: `apps/monkey/src/pages/home/index.ts`

- [ ] **Step 1：在 `FileListMod/index.ts` 注册新 Mod**

在 `apps/monkey/src/pages/home/FileListMod/index.ts` 的 import 区追加：

```ts
import { FileItemModAria2Push } from './FileItemMod/aria2Push'
```

并在 `itemMods` 数组中加入（建议放在 `FileItemModExtMenu` 之后 / `FileItemModDownload` 之前，与下载按钮相邻渲染）：

```ts
const itemMods = [
  FileItemModFolderLink,
  FileItemModExtInfo,
  FileItemModActressInfo,
  FileItemModVideoCover,
  FileItemModExtMenu,
  FileItemModAria2Push,      // NEW
  FileItemModClickPlay,
  FileItemModDownload,
]
```

- [ ] **Step 2：在 `home/index.ts` 挂载 Toast + 设置面板**

修改 `apps/monkey/src/pages/home/index.ts`：

```ts
import { createApp, h } from 'vue'
import { registerMagnetTaskHandler } from '@/pages/magnet'
import Aria2SettingsDialog from '@/components/Aria2SettingsDialog/index.vue'
import MasterToast from '@/components/MasterToast/index.vue'
import { ModManager } from './BaseMod'
import FileListMod from './FileListMod'
import { TopFilePathMod } from './TopFilePathMod'
import { TopHeaderMod } from './TopHeaderMod'
import './index.css'

/**
 * 首页页面类
 */
class HomePage {
  private modManager: ModManager | undefined = undefined

  constructor() {
    this.init()
  }

  destroy(): void {
    this.modManager?.destroy()
  }

  private async init(): Promise<void> {
    registerMagnetTaskHandler()
    this.modManager = new ModManager([
      new FileListMod(),
      new TopFilePathMod(),
      new TopHeaderMod(),
    ])
    this.mountToast()
    this.mountAria2SettingsDialog()
  }

  private mountToast() {
    const host = document.createElement('div')
    document.body.appendChild(host)
    createApp({ render: () => h(MasterToast) }).mount(host)
  }

  private mountAria2SettingsDialog() {
    const host = document.createElement('div')
    document.body.appendChild(host)
    createApp({ render: () => h(Aria2SettingsDialog) }).mount(host)
  }
}

export default HomePage
```

- [ ] **Step 3：确认类型通过**

Run: `pnpm --filter @115master/monkey type-check`
Expected: PASS

- [ ] **Step 4：运行全部测试**

Run: `pnpm --filter @115master/monkey test`
Expected: 全部通过

- [ ] **Step 5：commit**

```bash
git add apps/monkey/src/pages/home/FileListMod/index.ts apps/monkey/src/pages/home/index.ts
git commit -m "feat(aria2): register file item mod and mount components"
```

---

## Task 17：手动冒烟测试

> 无自动化手段，只有文字脚本。按顺序执行，任一失败则排查。

- [ ] **Step 1：启动本机 aria2**

```bash
aria2c --enable-rpc --rpc-listen-all --rpc-secret=test123
```

- [ ] **Step 2：本地起 dev**

```bash
pnpm --filter @115master/monkey dev
```

并确保浏览器 Tampermonkey 加载 dev 脚本。

- [ ] **Step 3：打开 115 文件列表（`https://115.com/?cid=...`）**

- [ ] **Step 4：验证空态按钮**

首次访问 → 每个文件/文件夹行的 `.file-opr` 应出现「⚙ 配置 Aria2」灰色按钮。点击 → 设置模态框弹出。

- [ ] **Step 5：配置 1 个 RPC**

输入 `名称=本地`、`URL=http://token:test123@localhost:6800/jsonrpc`，「测试」显示 `v<版本号>`；点击「应用」。模态框关闭后，文件行按钮变为「⇩ 本地」。

- [ ] **Step 6：推送单文件**

点击某个视频文件行的「⇩ 本地」→ toast：`推送 xxx...` → `推送成功`。aria2 面板（`http://localhost:6800`）应出现该任务并下载中。

- [ ] **Step 7：推送文件夹**

点击某个含嵌套子目录的文件夹行 → toast 实时更新`正在获取文件列表...` → `推送中 x/y` → `已推送 N 个文件`。aria2 面板里每个任务的 `out` 应含相对路径（目录结构被保留）。

- [ ] **Step 8：添加第二个 RPC**

在设置面板点「+ 添加 RPC」→ 填任意名称与 URL → 应用。文件行按钮应变为「⇩ Aria2 ▾」下拉；hover 展开能看到两个预设 + 「⚙ 设置」。

- [ ] **Step 9：故意断开 aria2**

按 Ctrl-C 关掉 aria2 → 再次点击推送 → toast 红色错误，附错误消息；控制台 Aria2 logger 有堆栈。

- [ ] **Step 10（可选）：验证 Cookie/UA 注入**

在 aria2 日志启用 `--log=/tmp/aria2.log --log-level=debug`，查看下载请求 header 应包含 `User-Agent`、`Referer: https://115.com`、`Cookie: ...`。

- [ ] **Step 11：lint 和 type-check**

```bash
pnpm --filter @115master/monkey lint
pnpm --filter @115master/monkey type-check
```

Expected: 均通过。

---

## Task 18：生成 changeset

**Files:**
- Create: `.changeset/aria2-export.md`

- [ ] **Step 1：生成 changeset**

```bash
pnpm changeset
```

在交互式提示中：
- 选择 `@115master/monkey`（空格选中，回车确认）
- bump 类型：`minor`
- 填写描述：`feat(aria2): add Aria2 RPC export with folder recursion`

- [ ] **Step 2：检查生成的文件**

确认 `.changeset/` 下新增 `.md` 文件，内容大致：

```md
---
"@115master/monkey": minor
---

feat(aria2): add Aria2 RPC export with folder recursion
```

- [ ] **Step 3：commit**

```bash
git add .changeset
git commit -m "chore: add changeset for aria2 export"
```

---

## 完成检查

- [ ] 所有 `apps/monkey/src/utils/aria2/__tests__/*.test.ts` 通过
- [ ] `pnpm --filter @115master/monkey type-check` 通过
- [ ] `pnpm --filter @115master/monkey lint` 通过
- [ ] 手动冒烟 Task 17 全部步骤通过
- [ ] changeset 已生成并提交

验收通过后，本功能可以发 PR。
