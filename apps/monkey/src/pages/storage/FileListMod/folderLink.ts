import type { StorageFile } from '../utils/fiber'
import { GM_openInTab } from '$'
import { NORMAL_URL_115 } from '@/constants/115'
import { getFileId, isFolder } from '../utils/fiber'
import { RowFeature } from './RowFeature'

/**
 * 文件夹中键新标签打开
 *
 * 旧版的做法是把文件夹 a 标签的 `javascript:;` 换成真实 href，
 * 浏览器原生就支持中键新开。新版文件名根本不是 a 标签而是 div，
 * 没有 href 可改，因此改为直接监听中键并自行开标签页，保留同一能力。
 */
export class FolderLinkFeature extends RowFeature {
  /** 每行绑定的中键监听 */
  private bound = new Map<HTMLElement, (event: Event) => void>()

  mount(rowNode: HTMLElement, file: StorageFile): void {
    this.unmount(rowNode)

    if (!isFolder(file)) {
      return
    }

    const onAuxClick = (event: Event): void => {
      if ((event as MouseEvent).button !== 1) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      const url = new URL(
        `/storage/allfiles?cid=${getFileId(file)}&mode=wangpan`,
        NORMAL_URL_115,
      ).href
      GM_openInTab(url, { active: true })
    }

    rowNode.addEventListener('auxclick', onAuxClick, true)
    this.bound.set(rowNode, onAuxClick)
  }

  unmount(rowNode: HTMLElement): void {
    const onAuxClick = this.bound.get(rowNode)
    if (!onAuxClick) {
      return
    }
    rowNode.removeEventListener('auxclick', onAuxClick, true)
    this.bound.delete(rowNode)
  }
}
