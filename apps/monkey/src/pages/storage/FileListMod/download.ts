import type { StorageFile } from '../utils/fiber'
import { toast } from '@/components/MasterToast/toast'
import { drive115 } from '@/utils/drive115'
import { is115Browser } from '@/utils/platform'
import { isFolder } from '../utils/fiber'
import { findToolbarButton } from '../utils/rowInfo'
import { RowFeature } from './RowFeature'

/**
 * 接管行内原生「下载」按钮
 *
 * 走 drive115 取真实下载地址后自行打开，绕过 115 网页端的下载限制。
 * 与旧版行为一致：文件夹不支持，115 浏览器内不接管。
 *
 * 旧版靠 `a[menu="download_one"]` 定位，新版按钮没有这类语义属性，
 * 只能按文案「下载」匹配（见 findToolbarButton）。
 */
export class DownloadFeature extends RowFeature {
  /** 每行绑定的监听 */
  private bound = new Map<HTMLElement, { node: HTMLElement, handler: (event: Event) => void }>()

  mount(rowNode: HTMLElement, file: StorageFile): void {
    this.unmount(rowNode)

    if (is115Browser) {
      return
    }

    const button = findToolbarButton(rowNode, '下载')
    if (!button) {
      return
    }

    const handler = (event: Event): void => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      void this.download(file)
    }

    button.addEventListener('click', handler, true)
    this.bound.set(rowNode, { node: button, handler })
  }

  unmount(rowNode: HTMLElement): void {
    const entry = this.bound.get(rowNode)
    if (!entry) {
      return
    }
    entry.node.removeEventListener('click', entry.handler, true)
    this.bound.delete(rowNode)
  }

  /**
   * 取下载地址并打开
   * @param file 文件数据
   */
  private async download(file: StorageFile): Promise<void> {
    if (isFolder(file)) {
      toast.error('当前未支持文件夹下载')
      return
    }

    const handle = toast.loading(`获取下载地址 ${file.n}...`)
    try {
      const res = await drive115.getFileDownloadUrl(file.pc)
      const url = res?.url?.url
      if (!url) {
        throw new Error('未取到下载地址')
      }
      window.open(url, '_blank')
      handle.success('已开始下载')
    }
    catch (error) {
      handle.error(
        `下载失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
