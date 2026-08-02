// 测试 monorepo 共享包引用
import { TEST_VALUE } from '@115master/shared'
import globToRegex from 'glob-to-regexp'
import ROUTE_MATCH from './constants/route.match'
import HomePage from './pages/home/index'
import { magnetPage, registerMagnetProtocolHandler } from './pages/magnet'
import StoragePage from './pages/storage/index'
import { videoPage, videoTokenPage } from './pages/video'
import { checkUserAgent } from './utils/checkUserAgent'
import { debugInfo } from './utils/debugInfo'

console.log('[115Master] Shared package:', TEST_VALUE)

/** 设置 document.domain 以支持 115 Bridge 跨域通信 */
/** 必须在任何代码执行之前设置 */
try {
  if (document.domain && document.domain.endsWith('115.com')) {
    document.domain = '115.com'
  }
}
catch (error) {
  // 某些浏览器可能不允许设置 domain
  console.warn('[115Master] Failed to set document.domain:', error)
}

/** 调试信息 */
debugInfo.bootstrapInfo()

/** 检查用户代理 */
checkUserAgent()

/** 注册磁力链接协议处理程序 */
registerMagnetProtocolHandler()

/** 路由匹配 */
const routeMatch = [
  /** 旧版首页 */
  {
    match: ROUTE_MATCH.HOME,
    exec: () => new HomePage(),
  },
  /** 新版网盘 */
  {
    match: ROUTE_MATCH.STORAGE,
    exec: () => new StoragePage(),
  },
  /** 视频页 */
  {
    match: ROUTE_MATCH.VIDEO,
    exec: () => videoPage(),
  },
  /** 视频页（token中转） */
  {
    match: ROUTE_MATCH.VIDEO_TOKEN,
    exec: () => videoTokenPage(),
  },
  /** 磁力链接页 */
  {
    match: ROUTE_MATCH.MAGNET,
    exec: () => magnetPage(),
  },
]

/**
 * 防止重复初始化的标记
 *
 * 实测新版页面上脚本会被执行两次（两条「启动成功」日志，耗时不同），
 * 不拦住的话每个 Mod 都会挂两遍，按钮、浮层全部重复。
 * 标记打在 documentElement 上而不是模块变量里：
 * 两次执行是相互独立的模块实例，模块级变量各算各的，拦不住。
 */
const BOOTSTRAPPED_FLAG = 'master115Bootstrapped'

/** 主函数 */
function main() {
  if (document.documentElement.dataset[BOOTSTRAPPED_FLAG]) {
    return
  }
  document.documentElement.dataset[BOOTSTRAPPED_FLAG] = '1'

  for (const route of routeMatch) {
    if (globToRegex(route.match).test(window.location.href)) {
      route.exec()
    }
  }
}

/** 文档加载完成 */
if (
  document.readyState === 'complete'
  || document.readyState === 'interactive'
) {
  main()
}
else {
  window.addEventListener('DOMContentLoaded', main)
}
