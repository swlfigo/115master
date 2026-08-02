import type { StorageFile } from '../utils/fiber'
import type { RowFeature } from './RowFeature'
import { PLUS_VERSION } from '@/constants'
import { subscribeSettings } from '@/utils/aria2'
import { userSettings } from '@/utils/userSettings'
import { observeFileRows, StorageMod } from '../BaseMod'
import { ACTRESS_IMG_ATTR, ActressInfoFeature } from './actressInfo'
import { ARIA2_HOST_ATTR, Aria2PushFeature } from './aria2Push'
import { ClickPlayFeature } from './clickPlay'
import { DownloadFeature } from './download'
import { ExtInfoFeature } from './extInfo'
import { EXT_MENU_ATTR, ExtMenuFeature } from './extMenu'
import { FolderLinkFeature } from './folderLink'
import { VideoCoverFeature } from './videoCover'

/** 所有注入节点的标记属性，销毁时兜底清理 */
const INJECTED_ATTRS = [ARIA2_HOST_ATTR, EXT_MENU_ATTR, ACTRESS_IMG_ATTR]

/**
 * 新版网盘文件列表修改器
 *
 * 负责把行的挂载/卸载事件分发给各个行内功能，
 * 功能本身互不感知，新增一项只需加进 features。
 */
export class FileListMod extends StorageMod {
  /** 停止观察行变化 */
  private disposeObserve: (() => void) | undefined = undefined

  /** 取消订阅 Aria2 设置变更 */
  private unsubscribeSettings: (() => void) | undefined = undefined

  /** 取消监听用户设置开关 */
  private disposeSettingWatchers: Array<() => void> = []

  /** 行内功能 */
  private features: RowFeature[] = [
    new Aria2PushFeature(),
    new ExtMenuFeature(),
    new ClickPlayFeature(),
    new FolderLinkFeature(),
    new DownloadFeature(),
    new ActressInfoFeature(),
    new VideoCoverFeature(),
    new ExtInfoFeature(),
  ]

  /** 各行当前的文件数据，重建时复用 */
  private files = new Map<HTMLElement, StorageFile>()

  load(): void {
    this.disposeObserve = observeFileRows({
      onMount: (rowNode, file) => {
        this.files.set(rowNode, file)
        this.mountRow(rowNode, file)
      },
      onUnmount: (rowNode) => {
        this.files.delete(rowNode)
        this.unmountRow(rowNode)
      },
    })

    // RPC 预设增删会改变按钮形态（引导 / 单按钮 / 下拉），需整体重建
    this.unsubscribeSettings = subscribeSettings(() => this.rebuildAll())
    this.watchUserSettings()
  }

  destroy(): void {
    this.unsubscribeSettings?.()
    this.unsubscribeSettings = undefined
    this.disposeSettingWatchers.forEach(dispose => dispose())
    this.disposeSettingWatchers = []
    this.disposeObserve?.()
    this.disposeObserve = undefined

    for (const rowNode of [...this.files.keys()]) {
      this.unmountRow(rowNode)
    }
    this.files.clear()

    // 兜底：清掉任何遗留的注入节点（如行在卸载回调前已被 React 移除）
    document
      .querySelectorAll(INJECTED_ATTRS.map(attr => `[${attr}]`).join(','))
      .forEach(node => node.remove())
  }

  /**
   * 判断某个功能当前是否该启用
   *
   * 复刻旧版 FileItemModLoader / FileItemModBase 的两道开关：
   * Plus 专属功能在非 Plus 版本不加载，受设置控制的功能跟随开关。
   * @param feature 功能
   */
  private isEnabled(feature: RowFeature): boolean {
    if (feature.IS_PLUS && !PLUS_VERSION) {
      return false
    }
    const key = feature.ENABLE_KEY_IN_USER_SETTING
    return key ? Boolean(userSettings.value[key]) : true
  }

  /** 监听受开关控制的功能，开关变化时整体重建 */
  private watchUserSettings(): void {
    const keys = new Set(
      this.features
        .map(feature => feature.ENABLE_KEY_IN_USER_SETTING)
        .filter(key => key !== undefined),
    )

    for (const key of keys) {
      // 必须存下取消函数：一级页面切换会重建 FileListMod，
      // 不取消的话每切一次就多留一个监听，重建次数会累积翻倍
      this.disposeSettingWatchers.push(
        userSettings.watch(key, () => this.rebuildAll()),
      )
    }
  }

  /**
   * 挂载一行的全部功能
   * @param rowNode 行元素
   * @param file 该行的文件数据
   */
  private mountRow(rowNode: HTMLElement, file: StorageFile): void {
    for (const feature of this.features) {
      if (!this.isEnabled(feature)) {
        continue
      }
      try {
        feature.mount(rowNode, file)
      }
      catch (error) {
        // 单个功能失败不能连累同一行的其他功能
        console.error('[115Master] row feature mount failed:', error)
      }
    }
  }

  /**
   * 卸载一行的全部功能
   *
   * 不判断 isEnabled：开关刚被关掉时也要能把已挂载的清理干净。
   * @param rowNode 行元素
   */
  private unmountRow(rowNode: HTMLElement): void {
    for (const feature of this.features) {
      try {
        feature.unmount(rowNode)
      }
      catch (error) {
        console.error('[115Master] row feature unmount failed:', error)
      }
    }
  }

  /** 重建全部行 */
  private rebuildAll(): void {
    for (const [rowNode, file] of this.files) {
      this.unmountRow(rowNode)
      this.mountRow(rowNode, file)
    }
  }
}
