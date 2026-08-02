import type { StorageFile } from '../utils/fiber'
import { GM_openInTab } from '$'
import iinaIcon from '@/assets/icons/iina-icon.png'
import { toast } from '@/components/MasterToast/toast'
import { VOD_URL_115 } from '@/constants/115'
import { drive115 } from '@/utils/drive115'
import { isMac } from '@/utils/platform'
import { goToPlayer } from '@/utils/route'
import { webLinkIINA } from '@/utils/weblink'
import { isVideo } from '../utils/fiber'
import { getToolbarHost } from '../utils/rowInfo'
import { RowFeature } from './RowFeature'

/** 标记属性，用于清理自己插入的节点 */
export const EXT_MENU_ATTR = 'data-master-ext-menu'

/** 按钮配置 */
interface ButtonConfig {
  /** 标题 */
  title: string
  /** 文本 */
  text: string
  /** 图标 */
  icon?: string
  /** 点击事件 */
  click: () => void
}

/**
 * 行内扩展菜单
 *
 * 在原生操作条里追加 Master 播放 / 115 官方播放 / IINA 三个入口。
 * 与 Aria2 按钮插在同一处，因此同样必须 prepend——操作条已横向溢出。
 */
export class ExtMenuFeature extends RowFeature {
  /** 已插入的按钮容器，按所在行记录 */
  private hosts = new Map<HTMLElement, HTMLElement>()

  mount(rowNode: HTMLElement, file: StorageFile): void {
    this.unmount(rowNode)

    // 仅视频有这些播放入口，其余条目不插
    if (!isVideo(file)) {
      return
    }

    const host = getToolbarHost(rowNode)
    if (!host) {
      return
    }

    const container = document.createElement('span')
    container.setAttribute(EXT_MENU_ATTR, '')
    container.style.cssText
      = 'display:inline-flex;align-items:center;flex-shrink:0;'

    for (const config of buildButtons(file)) {
      container.appendChild(createButton(config))
    }

    host.prepend(container)
    this.hosts.set(rowNode, container)
  }

  unmount(rowNode: HTMLElement): void {
    this.hosts.get(rowNode)?.remove()
    this.hosts.delete(rowNode)
  }
}

/**
 * 生成按钮配置
 * @param file 文件数据
 */
function buildButtons(file: StorageFile): ButtonConfig[] {
  return [
    {
      title: '使用【Master播放器】',
      text: '▶️ Master',
      click: () => goToPlayer({ pickCode: file.pc }, true),
    },
    {
      title: '使用【115官方播放器】',
      text: '5️⃣ 官方',
      click: () => {
        GM_openInTab(
          new URL(`/?pickcode=${file.pc}&share_id=0`, VOD_URL_115).href,
          { active: true },
        )
      },
    },
    ...(isMac
      ? [
          {
            title: '使用【iina】',
            text: 'IINA',
            icon: iinaIcon,
            click: async (): Promise<void> => {
              try {
                const download = await drive115.getFileDownloadUrl(file.pc)
                window.open(webLinkIINA(download))
              }
              catch {
                toast.error('打开 iina 失败')
              }
            },
          },
        ]
      : []),
  ]
}

/**
 * 创建按钮元素
 * @param config 按钮配置
 */
function createButton(config: ButtonConfig): HTMLElement {
  const link = document.createElement('a')
  link.title = config.title
  link.style.cssText
    = 'display:inline-flex;align-items:center;gap:3px;padding:1px 5px;font-size:12px;color:#2563eb;cursor:pointer;white-space:nowrap;'

  if (config.icon) {
    const icon = document.createElement('img')
    icon.src = config.icon
    icon.style.cssText = 'width:14px;height:14px;pointer-events:none;'
    link.appendChild(icon)
  }

  const text = document.createElement('span')
  text.textContent = config.text
  text.style.pointerEvents = 'none'
  link.appendChild(text)

  /** 与行的 React onClick 隔离，同 Aria2 按钮 */
  const stop = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }
  link.addEventListener('mousedown', stop)
  link.addEventListener('click', (event) => {
    stop(event)
    config.click()
  })

  return link
}
