/**
 * 新版网盘 DOM 选择器
 *
 * 这几个是 115 自定义的语义类名（非 Tailwind 原子类），
 * 相比 `flex items-center ...` 这类样式类稳定得多，优先依赖它们。
 */
export const STORAGE_SELECTOR = {
  /** 文件列表滚动容器 */
  LIST_WRAP: '.file-list-wrap',
  /**
   * 文件列表行
   *
   * 必须带 [data-index] 限定：`.file-list-item` 在外层容器和内层内容上
   * 各出现一次，不限定会拿到双倍节点
   */
  LIST_ITEM: '.file-list-item[data-index]',
  /** 行内文件名 */
  ITEM_NAME: '.file-name-responsive',
  /**
   * 行内原生操作条（置顶 / 星标 / 下载 / 移动 …）
   *
   * 相当于旧版的 .file-opr。悬停才显示，但节点常驻 DOM，可随时插入。
   * 只有 Tailwind 类名可依赖，不如上面几个语义类稳，
   * 因此使用处需要有兜底方案
   */
  ITEM_TOOLBAR: '[class*="group-hover:flex"]',
} as const

/** 行序号属性，取值为该行在已加载文件数组中的下标 */
export const DATA_INDEX_ATTR = 'data-index'
