import { DL_HOST_155, NORMAL_HOST_155 } from './115'

const ROUTE_MATCH = {
  /** 旧版网盘首页，形如 /?cid=0&mode=wangpan */
  HOME: `*://${NORMAL_HOST_155}/?*`,
  /**
   * 新版网盘（Next.js SPA），形如 /storage/allfiles?cid=xxx
   *
   * 匹配整个 /storage 命名空间：新版切换目录不会重载文档，
   * 具体页面是否启用由各 Mod 自行判断
   */
  STORAGE: `*://${NORMAL_HOST_155}/storage/*`,
  VIDEO: `*://${NORMAL_HOST_155}/web/lixian/master/video/*`,
  MAGNET: `*://${NORMAL_HOST_155}/web/lixian/master/magnet/*`,
  VIDEO_TOKEN: `*://${DL_HOST_155}/video/token`,
}

export default ROUTE_MATCH
