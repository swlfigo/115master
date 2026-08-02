import type { StorageFile } from '../utils/fiber'
import { GM_openInTab } from '$'
import { VOD_URL_115 } from '@/constants/115'
import { goToPlayer } from '@/utils/route'
import { isVideo } from '../utils/fiber'
import { RowFeature } from './RowFeature'

/** 一行上绑定的监听，卸载时按原引用解绑 */
interface BoundListeners {
  nameNode: HTMLElement | null
  onNameClick: (event: Event) => void
  onRowDoubleClick: (event: Event) => void
  onRowAuxClick: (event: Event) => void
}

/**
 * 行内点击播放
 *
 * 接管新版原本的打开行为，改为跳转 115Master 播放器：
 * - 单击文件名 / 双击整行 → Master 播放器
 * - 中键 → 115 官方播放器
 *
 * 新版行上共有三处 React onClick（文件名、行内层、行外层）和一处
 * onDoubleClick，任何一处漏拦都会让原生播放器同时被打开，
 * 因此统一在捕获阶段拦截并终止传播。
 */
export class ClickPlayFeature extends RowFeature {
  /** 每行绑定的监听 */
  private bound = new Map<HTMLElement, BoundListeners>()

  mount(rowNode: HTMLElement, file: StorageFile): void {
    this.unmount(rowNode)

    // 只接管视频，其余条目保持 115 原生行为（进目录、预览文档等）
    if (!isVideo(file)) {
      return
    }

    const nameNode = rowNode.querySelector<HTMLElement>('.file-name-responsive')

    const openMaster = (event: Event): void => {
      stop(event)
      goToPlayer({ pickCode: file.pc }, true)
    }

    const openNative = (event: Event): void => {
      if ((event as MouseEvent).button !== 1) {
        return
      }
      stop(event)
      GM_openInTab(
        new URL(`/?pickcode=${file.pc}&share_id=0`, VOD_URL_115).href,
        { active: true },
      )
    }

    const listeners: BoundListeners = {
      nameNode,
      onNameClick: openMaster,
      onRowDoubleClick: openMaster,
      onRowAuxClick: openNative,
    }

    nameNode?.addEventListener('click', listeners.onNameClick, true)
    rowNode.addEventListener('dblclick', listeners.onRowDoubleClick, true)
    rowNode.addEventListener('auxclick', listeners.onRowAuxClick, true)

    this.bound.set(rowNode, listeners)
  }

  unmount(rowNode: HTMLElement): void {
    const listeners = this.bound.get(rowNode)
    if (!listeners) {
      return
    }

    listeners.nameNode?.removeEventListener(
      'click',
      listeners.onNameClick,
      true,
    )
    rowNode.removeEventListener('dblclick', listeners.onRowDoubleClick, true)
    rowNode.removeEventListener('auxclick', listeners.onRowAuxClick, true)

    this.bound.delete(rowNode)
  }
}

/**
 * 终止事件，阻止 115 自身的打开行为
 *
 * React 把 onClick 挂在根容器上，事件冒泡到根才会触发；
 * 在行元素的捕获阶段就终止传播即可拦住，
 * 这与 Aria2 按钮的隔离方式一致（已实测有效）。
 * @param event 事件
 */
function stop(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}
