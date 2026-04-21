# Aria2 RPC 导出功能设计

- **日期**：2026-04-21
- **所属项目**：`@115master/monkey`（Tampermonkey 用户脚本）
- **目标**：为 115 网盘文件列表页增加「推送到 Aria2 RPC」能力，补齐当前缺失的**文件夹下载**体验。
- **参考实现**：Chrome 扩展 115Exporter（`/Users/sylar/Documents/115`）

## 1. 背景与目标

### 1.1 用户痛点

115master 现有的行内下载按钮只能下载单个文件。当文件是文件夹时，`FileItemModDownload` 直接弹出 `alert('当前未支持文件夹下载')`（`apps/monkey/src/pages/home/FileListMod/FileItemMod/download.ts:39`）。参考项目 115Exporter 通过递归遍历目录 + 推送给 aria2 解决了这个问题，但它是独立的 Chrome 扩展，本项目用户需要在油猴脚本内达成相同体验。

### 1.2 目标

- 在每个文件行 `.file-opr` 容器中，紧邻 115 原生下载按钮，增加「推送 Aria2」按钮
- 点击文件行 → 拉取直链并推给 aria2
- 点击文件夹行 → 递归遍历后，批量推给 aria2，保持目录结构
- 支持**多个 RPC 预设**（名字 + URL），行内按钮按数量自动变形（单按钮 / 下拉）
- 提供独立设置面板管理 RPC 列表、UA、Referer、Headers、下载路径、递归间隔、SHA1 校验

### 1.3 非目标（v1 不做）

- 顶部工具栏批量推送入口（仅行内按钮）
- 文本导出（aria2c.down / idm.ef2 / 纯链接 / 复制）
- 小文件优先排序
- 非 115 浏览器环境适配（与现有下载行为一致，在 `is115Browser === true` 时不渲染）

## 2. 参考实现关键点摘录

来自 `/Users/sylar/Documents/115`：

| 文件 | 要点 |
|---|---|
| `src/js/lib/downloader.js` | 递归文件夹的基类：用 `folders` 栈 + `files` 字典，按 `interval` 逐级展开；`item.sha` 为空即为文件夹 |
| `src/js/home.js` | 目录 API：`webapi.115.com/files?aid=1&limit=1000&show_dir=1&cid=<cid>`；直链 API 普通走 `webapi.115.com/files/download?pickcode=`，会员走 `proapi.115.com/app/chrome/downurl`（AES+RSA 加密） |
| `src/js/lib/core.js` | RPC URL 解析：`token:xxx@host` → `params[0]='token:xxx'`；`user:pass@host` → `Authorization: Basic base64(user:pass)`；URL `#k=v&k=v` fragment 作为每次 `addUri` 的 options |
| `src/js/lib/core.js` | 推送到 aria2 时注入 `User-Agent` / `Referer` / `Cookie` / 自定义 `Headers`，否则 aria2 侧无法通过 115 鉴权，下载 403 |
| `src/js/lib/ui.js` | 设置项：多 RPC（name+URL）、SHA1 校验、VIP、小文件优先、递归间隔、下载路径、UA（+ 浏览器 UA 勾选）、Referer、自定义 Headers |

## 3. 115master 现有可复用能力

| 能力 | 位置 | 用途 |
|---|---|---|
| `drive115.getFileDownloadUrl(pickcode)` | `apps/monkey/src/utils/drive115/wrap.ts:62` | 取直链（proapi 加密，已覆盖 VIP 场景，无需在新功能里复刻加密） |
| `drive115.getFiles({ cid, ... })` | `apps/monkey/src/utils/drive115/wrap.ts:29` | 列出目录（含子目录），用于 walker |
| `GMRequest` | `apps/monkey/src/utils/request/gmRequst.ts` | 基于 `GM_xmlhttpRequest` 的 POST JSON，绕 CORS 调本地 aria2 RPC |
| `userSettings` | `apps/monkey/src/utils/userSettings.ts` | GM 存储 + 响应式 watch，用于 Aria2 设置持久化 |
| `FileItemMod` 基类与加载器 | `apps/monkey/src/pages/home/FileListMod/FileItemMod/base.ts`、`FileItemLoader.ts` | 为每行文件注入 Mod 的统一通道 |
| `appLogger` | `apps/monkey/src/utils/logger.ts` | 分模块日志，错误走 `appLogger.sub('Aria2')` |

## 4. 架构

### 4.1 文件布局

```
apps/monkey/src/
├── utils/aria2/                        # NEW — 纯逻辑层，无 Vue / DOM 依赖
│   ├── types.ts                        # Aria2Settings、Aria2RpcPreset、FileEntry
│   ├── config.ts                       # userSettings 子命名空间 'aria2' 的读写与默认值
│   ├── headers.ts                      # 构造 aria2 addUri 的 header 数组
│   ├── rpc.ts                          # JSON-RPC 客户端：addUri / getVersion（走 GMRequest）
│   ├── walker.ts                       # 异步生成器，递归遍历文件夹，按 intervalMs 节流
│   ├── events.ts                       # mitt 事件总线（aria2:open-settings 等）
│   └── index.ts                        # 对外统一：pushFile / pushFolder / testRpc
│
├── pages/home/FileListMod/FileItemMod/
│   └── aria2Push.ts                    # NEW — FileItemMod：注入行内按钮/下拉
│
├── components/Aria2SettingsDialog/     # NEW — Vue 设置面板
│   ├── index.vue                       # 模态框容器
│   └── RpcListEditor.vue               # 多 RPC 编辑子组件
│
└── components/MasterToast/             # NEW — 通用 toast 组件
    ├── index.vue                       # Toast 容器（挂 body）
    └── toast.ts                        # API：toast.info/success/error/loading
```

### 4.2 分层原则

- `utils/aria2/`：纯 TS，不依赖 Vue、不依赖 DOM，全部可单测
- `FileItemMod/aria2Push.ts`：只负责 DOM（注入按钮、hover 下拉）+ 调用 `utils/aria2/`
- `components/Aria2SettingsDialog/`：仅通过事件总线被打开，不反向持有 Mod 引用
- `components/MasterToast/`：完全独立的通用组件，Aria2 功能只是首个消费者

### 4.3 挂载点

- `apps/monkey/src/pages/home/FileListMod/FileItemLoader.ts`：注册 `FileItemModAria2Push`
- `apps/monkey/src/pages/home/index.ts`（或 `main.ts`）：应用初始化时将 `<MasterToast />` 与 `<Aria2SettingsDialog />` 挂到主文档 `body`（不进 iframe）

## 5. 交互设计

### 5.1 行内按钮三态

根据 `rpcList.length` 自动切换：

| 预设数量 | 行内呈现 | 点击行为 |
|---|---|---|
| 0 | `⚙ 配置 Aria2`（引导样式，柔和灰） | 触发 `aria2:open-settings` 打开设置面板 |
| 1 | `⇩ <preset.name>` 单按钮 | 直接 `pushFile` / `pushFolder` 到该 RPC |
| ≥2 | `⇩ Aria2 ▾` 下拉触发 | hover 展开菜单项：`• 预设1  • 预设2  • …  ── ⚙ 设置` |

- 网格视图（`itemInfo.fileListType === FileListType.grid`）不显示，对齐现有 `extMenu.ts` 行为
- `userSettings.watch` 监听 `aria2.rpcList` 变化，自动刷新所有行的按钮态

### 5.2 设置面板

- Vue 3 `<script setup lang="ts">` + `<style module>` + DaisyUI（`modal`、`input`、`btn`、`checkbox`、`textarea`）
- 打开方式：监听 `events.ts` 暴露的 `aria2:open-settings` 事件
- 关闭方式：模态框遮罩点击、`×` 按钮、Esc
- 字段：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `rpcList` | `{id, name, url}[]` | `[]` | 名称 + URL（示例占位 `http://token:密钥@127.0.0.1:6800/jsonrpc`），每行末尾带「测试」按钮 |
| `downloadPath` | string | `''` | 对应 aria2 `dir` 参数，空则不传 |
| `intervalMs` | number | `300` | 递归目录间隔、逐文件推送间隔 |
| `sha1Check` | boolean | `false` | 勾选时 addUri 带 `checksum=sha-1=<sha>` |
| `useBrowserUA` | boolean | `true` | 勾选时禁用下面的 UA 输入框，实际发给 aria2 的 UA 取自 `navigator.userAgent` |
| `userAgent` | string | `navigator.userAgent`（首次写入时固化） | 关闭 `useBrowserUA` 时生效；默认值在首次打开设置面板时以当前浏览器 UA 预填 |
| `referer` | string | `https://115.com` | 注入 Referer |
| `extraHeaders` | string | `''` | 每行 `Key: Value` |

- 底部：`应用` / `重置`。应用即写回 `userSettings.value.aria2`，`重置` 回到上面的默认值。
- 「测试」按钮调用 `aria2.testRpc(preset.url)` → `aria2.getVersion` → 行末显示版本号或错误文案。

### 5.3 Toast 组件规格

- 位置：主文档右下角堆叠
- 自动关闭：`info`/`success` 3s、`error` 6s、`loading` 手动（返回 handle 供调用方 `update`/`success`/`error`）
- API：

```ts
toast.info(msg: string): void
toast.success(msg: string): void
toast.error(msg: string): void
toast.loading(msg: string): LoadingHandle
// LoadingHandle: { update(msg), success(msg?), error(msg?) }
```

### 5.4 推送反馈流程

- **单文件**：`loading → success/error`，1 条 toast
- **文件夹**：保留一条 `loading` toast，内容分阶段更新
  - 阶段 1：`正在获取文件列表... X/Y`（Y 随遍历递增）
  - 阶段 2：`推送中 M/N`
  - 结束：`已推送 N 个文件` 或 `已推送 N 个，失败 K 个`

## 6. 数据流

### 6.1 单文件推送

```
aria2Push.ts onClick(file row)
  └─ aria2.pushFile({ pickCode, name, relPath? , sha? }, rpcId)
       ├─ drive115.getFileDownloadUrl(pickCode)          # 已有，走加密 proapi
       ├─ headers.build(settings, document.cookie)       # 组装 Cookie / UA / Referer / extraHeaders
       ├─ rpc.addUri(rpcUrl, [downloadUrl], {
       │     out: relPath ? `${relPath}/${name}` : name, # 单文件行点击时 relPath 省略
       │     dir?, header: headers[],
       │     checksum?: 'sha-1=<sha>', ...fragmentOptions
       │  })
       └─ toast.success / toast.error
```

`pushFile` 的 `relPath` 参数为可选：
- 单文件行点击 → 不传，`out = name`
- walker 递归时 → 传文件相对于被点击文件夹的路径，`out = relPath/name`，从而在 aria2 落盘端重建目录结构

### 6.2 文件夹推送（核心新能力）

```
aria2Push.ts onClick(folder row)
  └─ aria2.pushFolder(cid, rootPath, rpcId)
       ├─ toast.loading(handle, '正在获取文件列表...')
       ├─ for await (batch of walker.walk(cid, rootPath, intervalMs))
       │    ├─ handle.update(`正在获取文件列表... ${walked}/${walked + pending}`)
       │    └─ accumulate files[]
       ├─ handle.update(`推送中 0/${files.length}`)
       ├─ for each file (sleep intervalMs)
       │    ├─ pushFile(...) 内部复用 6.1
       │    └─ handle.update(`推送中 ${done}/${total}`)
       └─ handle.success(`已推送 ${done} 个` + 失败补充)
```

**walker 用 async generator 而非一次收完**：
- 大文件夹可能数千个文件，边走边推，用户不必全部等完
- 便于 toast 实时反馈进度
- 任一层级失败可聚合而不中断（见 §7）

### 6.3 RPC 请求体（addUri）

```jsonc
{
  "jsonrpc": "2.0",
  "method": "aria2.addUri",
  "id": <timestamp>,
  "params": [
    // 若 URL 为 token:xxx@... 形式，这里前置 "token:xxx"
    ["<downloadUrl>"],
    {
      "out": "path/to/file.mp4",
      "dir": "/downloads",              // 可选，来自 settings.downloadPath
      "header": [
        "User-Agent: ...",
        "Referer: https://115.com",
        "Cookie: ..."
      ],
      "checksum": "sha-1=<sha>",        // settings.sha1Check 为 true 且文件有 sha 时
      "max-connection-per-server": "5", // 来自 URL fragment `#k=v&k=v`
      "split": "10"
    }
  ]
}
```

URL 为 `user:pass@host` 形式时，改为在 HTTP 层携带 `Authorization: Basic base64(user:pass)`。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| `rpcList` 为空时点击推送 | 不会发生（按钮态 0 已变为「⚙ 配置 Aria2」），点击即开面板 |
| RPC 连接失败 / 4xx / 5xx | `toast.error('无法连接 aria2: <URL>')`，详细错误写日志 |
| 认证错误（secret 不对） | 同上，附带原始 `message` |
| RPC 请求超时 | 默认 5s 超时（`GMRequest` 侧配置），计入失败 |
| 单次 `getFileDownloadUrl` 失败 | 记入失败计数，继续下一个；不中断整体 |
| 文件夹某页 `getFiles` 失败 | 重试 1 次；仍失败则中断并 toast `"获取目录失败，已推送 N 个"` |
| `GM_xmlhttpRequest` 不可用 | 启动时一次性检测，toast 报警并禁用按钮 |
| 非 115 浏览器环境 | 和现有 `FileItemModDownload` 一致，`is115Browser === true` 时不渲染按钮 |

所有错误走 `appLogger.sub('Aria2')`，控制台可查堆栈。

### 7.1 Cookie 注入策略

- 推送前从 `document.cookie` 读取（主文档同源于 115，可直接读）
- 不持久化到 `userSettings`，避免泄露
- 每次推送都实时取，保证 session 有效

## 8. 测试计划

### 8.1 单元测试（Vitest）

| 被测单元 | 用例 |
|---|---|
| `utils/aria2/rpc.ts#parseRpcUrl` | `token:xxx@` → `authMode: 'token'`；`user:pass@` → `authMode: 'basic'`；`#k=v&k2=v2` → `options: {k:v, k2:v2}`；缺 `jsonrpc` 路径 → 默认补齐 |
| `utils/aria2/rpc.ts#buildAddUriPayload` | 断言 `params[0]` 在 token 模式下前置、basic 模式下不前置；header 数组按顺序；fragment options 合并不冲突 |
| `utils/aria2/headers.ts#build` | UA（浏览器 / 自定义）、Referer、Cookie、extraHeaders 正确组合；空值过滤 |
| `utils/aria2/walker.ts#walk` | 用 mock `drive115.getFiles` 构造 3 层嵌套目录，断言产出文件路径全部正确；断言 yield 间隔 ≈ intervalMs；断言无 sha 字段的 item 被判为目录 |
| `utils/aria2/config.ts` | 默认值完整；写入后可读回；watch 触发 |

### 8.2 手动验证

前置：本机启 `aria2c --enable-rpc --rpc-listen-all --rpc-secret=mysecret`

1. 设置 RPC `http://token:mysecret@localhost:6800/jsonrpc`，点「测试」→ 显示版本号
2. 选一个文件 → 推送 → aria2 面板出现任务并下载完成
3. 选一个三层嵌套文件夹（约 20 个文件）→ 推送 → aria2 全部添加，目录结构正确
4. 配置 2 个 RPC → 行内按钮变下拉 → 分别推送能路由到正确 RPC
5. 手动断开 aria2 → 推送时 toast 报错，日志有堆栈
6. `sha1Check` 勾选 + 关闭 → 对比 addUri 请求体是否带 `checksum`

### 8.3 暂不覆盖

- CI 上的 e2e（aria2 实例搭建成本高）
- 不同认证组合的真实 aria2 兼容性（只测 token 模式，basic 模式由用户自验）

## 9. 代码约定遵循

- Vue：`<script setup lang="ts">` + `<style module>` + template→script→style 顺序
- Tailwind：用 `@/utils/clsx` 抽样式
- TS：优先 `type`；组件 props 类型化；`Aria2RpcPreset` 的持久化态要求 `name` + `url` 均非空（编辑中间态可用 `Partial<Aria2RpcPreset>`，保存前在 `config.ts` 做 schema 校验过滤）
- 图标：走 `@iconify/vue`，前缀 `ICON_`，新增 `ICON_ARIA2`、`ICON_SETTINGS_GEAR` 等集中在 `@/icons/index.ts`
- Git：commit 不加 Co-Authored-By（全局规则），变更同时跑 `pnpm changeset` 记录 minor

## 10. 风险与取舍

| 风险 | 缓解 |
|---|---|
| 大文件夹递归耗时长 / 占用 115 API 配额 | intervalMs（默认 300ms）节流；toast 实时反馈让用户可感知进度；失败重试上限 1 |
| aria2 需要正确 Cookie 才能下载，未来 115 改变 cookie 机制 | Cookie 每次实时取，不持久化；若 115 侧变更只需用户刷新登录态 |
| 多 RPC 下拉在行内空间紧张 | 下拉是 hover/点击展开，行内触发只占 1 个按钮宽度；展开层 z-index 高于文件列表 |
| `userSettings` 如果后续迁移或重命名 | `config.ts` 对 `userSettings` 作薄封装，迁移只改一处 |
| Toast 首次引入，可能与现有 alert 并存 | 本期只在 Aria2 模块使用，后续渐进替换；不强制改动既有 `alert` 调用 |

## 11. 交付清单

- `apps/monkey/src/utils/aria2/{types,config,headers,rpc,walker,events,index}.ts`
- `apps/monkey/src/pages/home/FileListMod/FileItemMod/aria2Push.ts`
- `apps/monkey/src/pages/home/FileListMod/FileItemLoader.ts`（注册新 Mod，单行改动）
- `apps/monkey/src/components/Aria2SettingsDialog/{index.vue,RpcListEditor.vue}`
- `apps/monkey/src/components/MasterToast/{index.vue,toast.ts}`
- `apps/monkey/src/pages/home/index.ts`（挂载对话框 + toast 容器）
- `apps/monkey/src/icons/index.ts`（新增 aria2 / 设置图标常量）
- 单元测试：`apps/monkey/src/utils/aria2/__tests__/*.spec.ts`
- changeset：`.changeset/xxx.md`（`@115master/monkey` minor）
