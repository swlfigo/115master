import type { StorageFile } from '../utils/fiber'
import { STORAGE_SELECTOR } from '../constants'
import { getFileKey, readFileFromRow } from '../utils/fiber'

/** 行挂载回调 */
interface RowHandlers {
  /** 行出现，或行数据被替换成了另一个文件 */
  onMount: (rowNode: HTMLElement, file: StorageFile) => void
  /** 行消失，或行数据即将被替换 */
  onUnmount: (rowNode: HTMLElement) => void
}

/** 已挂载行的记录：DOM 节点 -> 当时的文件标识 */
type MountedRows = Map<HTMLElement, string>

/**
 * 持续跟踪文件列表行的挂载与卸载
 *
 * 新版网盘有三种会让行发生变化的情况，缺一不可：
 * 1. 首次渲染 —— 脚本在 React 挂载前就执行了，行还不存在
 * 2. 分页加载 —— 点「加载更多」会追加行
 * 3. 切换目录 —— URL 行为不可靠（存在不改 URL 也不发 history 事件的路径），
 *    且不能假设 React 一定会重建行节点。实测行数变化较大时是重建新节点，
 *    但复用同一节点只替换数据同样是 React 的合法行为，一旦发生，
 *    节点没有增删，仅靠 MutationObserver 的增删信号会漏掉，
 *    按钮会留在原地却指向另一个文件。比对每行的文件标识才能覆盖两种情况。
 * @param handlers 行挂载/卸载回调
 * @returns 停止观察
 */
export function observeFileRows(handlers: RowHandlers): () => void {
  const mounted: MountedRows = new Map()
  let scheduled = false
  let stopped = false

  /** 卸载一行并从记录中移除 */
  const unmount = (rowNode: HTMLElement): void => {
    mounted.delete(rowNode)
    try {
      handlers.onUnmount(rowNode)
    }
    catch (error) {
      console.error('[115Master] row unmount failed:', error)
    }
  }

  const scan = (): void => {
    if (stopped) {
      return
    }

    const rowNodes = new Set(
      document.querySelectorAll<HTMLElement>(STORAGE_SELECTOR.LIST_ITEM),
    )

    // 已脱离文档的行：切换目录、收起列表
    for (const rowNode of mounted.keys()) {
      if (!rowNodes.has(rowNode)) {
        unmount(rowNode)
      }
    }

    for (const rowNode of rowNodes) {
      const file = readFileFromRow(rowNode)
      if (!file) {
        // fiber 读不到（React 尚未提交，或内部结构变了），
        // 留到下一轮，不要把这一行标记成已处理
        continue
      }

      const key = getFileKey(file)
      const mountedKey = mounted.get(rowNode)

      if (mountedKey === key) {
        continue
      }

      // 节点被复用来渲染另一个文件：先卸掉旧的再挂新的
      if (mountedKey !== undefined) {
        unmount(rowNode)
      }

      mounted.set(rowNode, key)
      try {
        handlers.onMount(rowNode, file)
      }
      catch (error) {
        mounted.delete(rowNode)
        console.error('[115Master] row mount failed:', error)
      }
    }
  }

  /**
   * 合并同一帧内的多次变更
   *
   * 观察范围是整个 body，React 渲染期间回调会非常密集，
   * 必须节流，否则每次 DOM 变动都要全量扫描一次列表
   */
  const schedule = (): void => {
    if (scheduled || stopped) {
      return
    }
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      scan()
    })
  }

  /** 列表容器本身在切换目录时会被整个替换，因此只能观察 body */
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })

  scan()

  return () => {
    stopped = true
    observer.disconnect()
    for (const rowNode of [...mounted.keys()]) {
      unmount(rowNode)
    }
  }
}
