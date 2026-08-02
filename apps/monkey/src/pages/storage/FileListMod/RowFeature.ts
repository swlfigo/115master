import type { StorageFile } from '../utils/fiber'
import type { UserSettings } from '@/utils/userSettings'

/**
 * 行内功能
 *
 * 对应旧版的 FileItemMod。差别在于新版的行会被 React 反复重建，
 * 所以功能不能在构造时绑定一次，而是由 FileListMod 在每次行挂载/卸载时
 * 调用 mount / unmount，实例本身跨行复用、只保存以行为键的状态。
 */
export abstract class RowFeature {
  /** 是否 Plus 专属功能，非 Plus 版本不加载 */
  readonly IS_PLUS: boolean = false

  /** 在用户设置中的使能字段，未设置表示不受开关控制 */
  readonly ENABLE_KEY_IN_USER_SETTING:
    | keyof UserSettings['value']
    | undefined = undefined

  /**
   * 行挂载：插入元素、绑定事件
   * @param rowNode 行元素
   * @param file 该行的文件数据
   */
  abstract mount(rowNode: HTMLElement, file: StorageFile): void

  /**
   * 行卸载：需还原本功能对该行做的全部修改
   * @param rowNode 行元素
   */
  abstract unmount(rowNode: HTMLElement): void
}
