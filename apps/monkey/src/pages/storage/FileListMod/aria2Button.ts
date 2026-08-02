import type { StorageFile } from '../utils/fiber'
import type { Aria2RpcPreset } from '@/utils/aria2'
import { aria2Events, readSettings } from '@/utils/aria2'
import { pushEntry } from '@/utils/aria2/pushEntry'
import { getFileId, isFolder } from '../utils/fiber'

/**
 * 阻断事件，避免触发所在行的 React 处理器
 *
 * 行本身绑了 onClick（进入目录 / 选中），按钮嵌在行内，
 * 必须同时拦住 mousedown 和 click：
 * React 17+ 把监听挂在根容器上，只拦 mousedown 的话
 * 原生 click 仍会照常冒泡到根容器并触发 onClick。
 * @param event 事件
 */
function isolate(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

/**
 * 给元素绑定点击行为，并与所在行隔离
 * @param element 目标元素
 * @param onActivate 点击回调
 */
function bindIsolatedClick(element: HTMLElement, onActivate: () => void): void {
  element.addEventListener('mousedown', isolate)
  element.addEventListener('dblclick', isolate)
  element.addEventListener('click', (event) => {
    isolate(event)
    onActivate()
  })
}

/**
 * 构建行内 Aria2 推送按钮
 *
 * 三态与旧版一致：0 个 RPC 预设 → 配置引导；1 个 → 单按钮；≥2 → 下拉
 * @param file 该行的文件数据
 * @returns 按钮容器元素
 */
export function buildAria2Button(file: StorageFile): HTMLElement {
  const container = document.createElement('span')
  container.dataset.masterAria2 = 'true'
  container.style.cssText
    = 'display:inline-flex;align-items:center;flex-shrink:0;position:relative;z-index:20;'

  const presets = readSettings().rpcList
  if (presets.length === 0) {
    container.appendChild(buildSettingsLink('⚙ 配置 Aria2', '尚未配置 Aria2 RPC，点击打开设置'))
  }
  else if (presets.length === 1) {
    container.appendChild(buildSingleButton(file, presets[0]))
  }
  else {
    container.appendChild(buildDropdown(file, presets))
  }

  return container
}

/**
 * 打开 Aria2 设置的入口
 * @param label 文案
 * @param title 悬浮提示
 * @param beforeOpen 打开前的回调
 */
function buildSettingsLink(
  label: string,
  title: string,
  beforeOpen?: () => void,
): HTMLElement {
  const link = document.createElement('a')
  link.textContent = label
  link.title = title
  link.style.cssText
    = 'padding:1px 5px;font-size:12px;color:#64748b;cursor:pointer;white-space:nowrap;'
  bindIsolatedClick(link, () => {
    beforeOpen?.()
    aria2Events.emit('aria2:open-settings')
  })
  return link
}

/**
 * 单预设时的推送按钮
 * @param file 文件数据
 * @param preset RPC 预设
 */
function buildSingleButton(
  file: StorageFile,
  preset: Aria2RpcPreset,
): HTMLElement {
  const wrap = document.createElement('span')
  wrap.style.cssText = 'display:inline-flex;align-items:center;'

  const button = document.createElement('a')
  button.textContent = `⇩ ${preset.name}`
  button.title = `推送到 Aria2：${preset.name}`
  button.style.cssText
    = 'padding:1px 5px;font-size:12px;color:#2563eb;cursor:pointer;white-space:nowrap;'
  bindIsolatedClick(button, () => {
    void push(file, preset)
  })

  wrap.appendChild(button)
  wrap.appendChild(buildSettingsLink('⚙', 'Aria2 导出设置'))
  return wrap
}

/**
 * 多预设时的下拉菜单
 * @param file 文件数据
 * @param presets RPC 预设列表
 */
function buildDropdown(
  file: StorageFile,
  presets: Aria2RpcPreset[],
): HTMLElement {
  const wrap = document.createElement('span')
  wrap.style.cssText = 'position:relative;display:inline-block;'

  const trigger = document.createElement('a')
  trigger.textContent = '⇩ Aria2 ▾'
  trigger.style.cssText
    = 'padding:1px 5px;font-size:12px;color:#2563eb;cursor:pointer;white-space:nowrap;'

  const menu = document.createElement('div')
  menu.style.cssText
    = 'position:absolute;top:100%;left:0;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.1);padding:4px 0;min-width:140px;display:none;z-index:1001;'

  for (const preset of presets) {
    const item = document.createElement('a')
    item.textContent = preset.name
    item.style.cssText
      = 'display:block;padding:6px 12px;font-size:12px;color:#334155;cursor:pointer;white-space:nowrap;'
    item.addEventListener('mouseenter', () => {
      item.style.background = '#f1f5f9'
    })
    item.addEventListener('mouseleave', () => {
      item.style.background = ''
    })
    bindIsolatedClick(item, () => {
      menu.style.display = 'none'
      void push(file, preset)
    })
    menu.appendChild(item)
  }

  const divider = document.createElement('div')
  divider.style.cssText = 'border-top:1px solid #e2e8f0;margin:4px 0;'
  menu.appendChild(divider)
  menu.appendChild(
    buildSettingsLink('⚙ 设置', 'Aria2 导出设置', () => {
      menu.style.display = 'none'
    }),
  )

  wrap.addEventListener('mouseenter', () => {
    menu.style.display = 'block'
  })
  wrap.addEventListener('mouseleave', () => {
    menu.style.display = 'none'
  })

  wrap.appendChild(trigger)
  wrap.appendChild(menu)
  return wrap
}

/**
 * 执行推送
 * @param file 文件数据
 * @param rpc RPC 预设
 */
async function push(file: StorageFile, rpc: Aria2RpcPreset): Promise<void> {
  const folder = isFolder(file)
  await pushEntry(
    {
      isFolder: folder,
      // 文件夹的自身 ID 是 cid，不是父目录；取错会从错误层级开始递归
      folderCid: folder ? getFileId(file) : undefined,
      name: file.n,
      pickCode: file.pc,
    },
    rpc,
  )
}
