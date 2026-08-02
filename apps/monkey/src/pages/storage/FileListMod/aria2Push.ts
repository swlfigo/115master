import type { StorageFile } from '../utils/fiber'
import { is115Browser } from '@/utils/platform'
import { STORAGE_SELECTOR } from '../constants'
import { buildAria2Button } from './aria2Button'
import { RowFeature } from './RowFeature'

/** 标记属性，用于识别与清理自己插入的节点 */
export const ARIA2_HOST_ATTR = 'data-master-aria2-host'

/**
 * 行内 Aria2 推送按钮
 */
export class Aria2PushFeature extends RowFeature {
  /** 已插入的按钮，按所在行记录 */
  private buttons = new Map<HTMLElement, HTMLElement>()

  mount(rowNode: HTMLElement, file: StorageFile): void {
    this.unmount(rowNode)

    // 115 浏览器自带下载能力，与旧版行为保持一致不注入
    if (is115Browser) {
      return
    }

    const target = findMountHost(rowNode)
    if (!target) {
      return
    }

    const button = buildAria2Button(file)
    button.setAttribute(ARIA2_HOST_ATTR, '')
    if (target.prepend) {
      target.host.prepend(button)
    }
    else {
      target.host.appendChild(button)
    }
    this.buttons.set(rowNode, button)
  }

  unmount(rowNode: HTMLElement): void {
    this.buttons.get(rowNode)?.remove()
    this.buttons.delete(rowNode)
  }
}

/**
 * 找到行内的按钮插入点
 *
 * 首选行内原生操作条，和「下载」等按钮并排，符合用户预期且不占列宽。
 * 必须插在最前：操作条本身已经放满并横向溢出，
 * 追加到末尾会被挤出可视区域，看起来就像没生效。
 *
 * 操作条只有 Tailwind 类名可依赖，115 改一次样式就可能失效，
 * 因此兜底到文件名所在的弹性列——那里有语义类名 .file-name-responsive，
 * 稳定得多。不直接追加成第 8 列是因为表头与数据行列宽一一对应，会错位。
 * @param rowNode 行元素
 * @returns 插入点与插入位置，找不到返回 null
 */
function findMountHost(
  rowNode: HTMLElement,
): { host: HTMLElement, prepend: boolean } | null {
  const toolbar = rowNode.querySelector<HTMLElement>(
    STORAGE_SELECTOR.ITEM_TOOLBAR,
  )
  /** 操作条内层是真正排列按钮的容器，直接插外层会被绝对定位撑开 */
  const toolbarInner = toolbar?.firstElementChild
  if (toolbarInner instanceof HTMLElement) {
    return { host: toolbarInner, prepend: true }
  }

  const nameNode = rowNode.querySelector<HTMLElement>(
    STORAGE_SELECTOR.ITEM_NAME,
  )
  return nameNode?.parentElement
    ? { host: nameNode.parentElement, prepend: false }
    : null
}
