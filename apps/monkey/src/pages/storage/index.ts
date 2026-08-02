import type { App } from 'vue'
import { createApp, h } from 'vue'
import Aria2SettingsDialog from '@/components/Aria2SettingsDialog/index.vue'
import MasterToast from '@/components/MasterToast/index.vue'
import { StorageModManager } from './BaseMod'
import { FileListMod } from './FileListMod'
import { watchRouteChange } from './utils/spaRoute'

/**
 * 新版网盘页面类（Next.js SPA）
 *
 * 与旧版 HomePage 的关键差异：
 * - 无 iframe，整站单页，一级页面切换不重载文档
 * - 目录切换的 URL 行为不一致，存在完全不改 URL、不发 history 事件的路径
 * - 行 DOM 上不带 file_id / pick_code，数据只在 React 内部
 *
 * 因此 Mod 不能在构造时一次性 querySelector 注入，
 * 也不能依赖 URL 判断当前目录，
 * 必须由 DOM 变化驱动挂载（见 BaseMod/observeFileRows）。
 */
class StoragePage {
  /** 修改器管理器 */
  private modManager: StorageModManager | undefined = undefined

  /** 取消路由监听 */
  private disposeRouteWatch: (() => void) | undefined = undefined

  /** 挂载到 body 的 Vue 应用，销毁时需一并卸载 */
  private overlays: App[] = []

  constructor() {
    this.init()
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.disposeRouteWatch?.()
    this.disposeRouteWatch = undefined
    this.modManager?.destroy()
    this.modManager = undefined
    this.overlays.forEach(app => app.unmount())
    this.overlays = []
  }

  /**
   * 初始化
   */
  private init(): void {
    this.mountOverlay(MasterToast)
    this.mountOverlay(Aria2SettingsDialog)
    this.startMods()

    // 一级页面切换（如「全部文件」→「回收站」）不重载文档，
    // 各 Mod 依赖的 DOM 会整体换掉，需要重新挂载一轮。
    // 目录切换不走这里，由 observeFileRows 的行比对覆盖。
    this.disposeRouteWatch = watchRouteChange(() => {
      this.modManager?.destroy()
      this.startMods()
    })
  }

  /** 创建并启动全部 Mod */
  private startMods(): void {
    this.modManager = new StorageModManager([new FileListMod()])
    // 构造只是登记，load() 才真正开始观察 DOM，漏掉这一步 Mod 不会生效
    this.modManager.load()
  }

  /**
   * 把常驻浮层组件挂到 body
   * @param component 组件
   */
  private mountOverlay(component: Parameters<typeof h>[0]): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp({ render: () => h(component) })
    app.mount(host)
    this.overlays.push(app)
  }
}

export default StoragePage
