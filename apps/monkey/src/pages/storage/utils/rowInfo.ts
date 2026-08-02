import type { StorageFile } from './fiber'
import { getAvNumber } from '@/utils/getNumber'
import { STORAGE_SELECTOR } from '../constants'

/**
 * 取番号
 *
 * 旧版从 DOM 的 title 属性取，新版直接用文件名字段，来源等价。
 * @param file 文件数据
 */
export function getRowAvNumber(file: StorageFile): string | null {
  return getAvNumber(file.n)
}

/**
 * 取视频时长（秒）
 *
 * 旧版要从 .duration 节点的属性里解析 "hh:mm:ss"，
 * 新版 play_long 直接就是秒数，省掉解析。
 * @param file 文件数据
 */
export function getRowDuration(file: StorageFile): number {
  return Number(file.play_long) || 0
}

/**
 * 取列表滚动容器
 *
 * ExtVideoCover 靠它做可视区懒加载，取不到会退化成不加载封面。
 */
export function getListScrollBox(): HTMLElement | null {
  return document.querySelector<HTMLElement>(STORAGE_SELECTOR.LIST_WRAP)
}

/**
 * 在行内的操作条中查找按钮
 *
 * 新版操作条里的按钮没有 menu="download_one" 这类语义属性，
 * 只能按文案匹配。115 目前只有中文界面，暂无国际化风险。
 * @param rowNode 行元素
 * @param label 按钮文案，如「下载」
 */
export function findToolbarButton(
  rowNode: HTMLElement,
  label: string,
): HTMLElement | null {
  const toolbar = rowNode.querySelector<HTMLElement>(
    STORAGE_SELECTOR.ITEM_TOOLBAR,
  )
  if (!toolbar) {
    return null
  }

  const buttons = toolbar.querySelectorAll<HTMLElement>('button')
  for (const button of buttons) {
    if (button.textContent?.trim() === label) {
      return button
    }
  }
  return null
}

/**
 * 取行内操作条的按钮容器
 * @param rowNode 行元素
 */
export function getToolbarHost(rowNode: HTMLElement): HTMLElement | null {
  const toolbar = rowNode.querySelector<HTMLElement>(
    STORAGE_SELECTOR.ITEM_TOOLBAR,
  )
  const inner = toolbar?.firstElementChild
  return inner instanceof HTMLElement ? inner : null
}
