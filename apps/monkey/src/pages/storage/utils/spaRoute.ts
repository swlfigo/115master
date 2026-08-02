/** 路径变化回调 */
type RouteChangeHandler = (pathname: string) => void

/**
 * 监听新版网盘的一级页面切换
 *
 * 新版是 Next.js SPA，「全部文件」→「回收站」这类切换只走 history.pushState，
 * 不重载文档，脚本仅执行一次，必须劫持 history 才能感知。
 *
 * 注意：**不能用本函数感知目录跳转**。实测目录切换的 URL 行为并不一致：
 * 双击进入下级目录时出现过 URL 与 history 均无任何变化的情况，
 * 而点面包屑返回上级则会走 replaceState 并更新 ?cid=。
 * 既然存在观察不到的路径，就不能把它当作判据。
 * 目录变化一律由 DOM 驱动识别，本函数只负责一级页面切换。
 * @param handler 路径变化时触发，入参为新的 pathname
 * @returns 取消监听并还原 history API
 */
export function watchRouteChange(handler: RouteChangeHandler): () => void {
  let lastPathname = location.pathname

  const emit = (): void => {
    const { pathname } = location
    if (pathname === lastPathname) {
      return
    }
    lastPathname = pathname
    handler(pathname)
  }

  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState

  const patchedPushState = function (
    this: History,
    ...args: Parameters<History['pushState']>
  ): void {
    originalPushState.apply(this, args)
    emit()
  }

  const patchedReplaceState = function (
    this: History,
    ...args: Parameters<History['replaceState']>
  ): void {
    originalReplaceState.apply(this, args)
    emit()
  }

  history.pushState = patchedPushState
  history.replaceState = patchedReplaceState

  window.addEventListener('popstate', emit)

  return () => {
    // 只还原仍是自己的那一层：若已被其他脚本二次劫持，
    // 还原会切断对方的调用链，此时宁可留着（emit 已无副作用）
    if (history.pushState === patchedPushState) {
      history.pushState = originalPushState
    }
    if (history.replaceState === patchedReplaceState) {
      history.replaceState = originalReplaceState
    }
    window.removeEventListener('popstate', emit)
  }
}
