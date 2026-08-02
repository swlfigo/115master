/**
 * 新版网盘修改器基类
 *
 * 与旧版 BaseMod 的差异：旧版在构造时一次性注入即可，
 * 新版页面 DOM 会被 React 反复重建，Mod 必须自己管理挂载生命周期，
 * 因此这里把 load / destroy 拆开。
 */
export abstract class StorageMod {
  /** 挂载 */
  abstract load(): void

  /** 卸载，需还原自身对页面做的全部修改 */
  abstract destroy(): void
}

/**
 * 新版网盘修改器管理器
 */
export class StorageModManager {
  private mods: StorageMod[] = []

  constructor(mods: StorageMod[] = []) {
    this.mods = mods
  }

  /**
   * 注册并立即挂载
   * @param mod 修改器
   */
  register(mod: StorageMod): void {
    this.mods.push(mod)
    this.loadMod(mod)
  }

  /** 挂载全部修改器 */
  load(): void {
    this.mods.forEach(mod => this.loadMod(mod))
  }

  /** 卸载全部修改器 */
  destroy(): void {
    this.mods.forEach((mod) => {
      try {
        mod.destroy()
      }
      catch (error) {
        // 单个 Mod 卸载失败不能影响其余 Mod
        console.error('[115Master] mod destroy failed:', error)
      }
    })
    this.mods = []
  }

  /**
   * 挂载单个修改器
   * @param mod 修改器
   */
  private loadMod(mod: StorageMod): void {
    try {
      mod.load()
    }
    catch (error) {
      console.error('[115Master] mod load failed:', error)
    }
  }
}

export { observeFileRows } from './observeFileRows'
