import { DATA_INDEX_ATTR } from '../constants'

/**
 * 新版网盘文件列表项数据
 *
 * 字段名与 webapi.115.com/files 的返回一致（115 直接把接口数据塞进了组件 props），
 * 因此这里沿用接口的缩写命名，不做重命名，方便与 utils/drive115 对齐。
 *
 * 仅声明已确认存在的字段；实际对象上还有 aid / fuuid / thumbnail 等，
 * 用到时再按需补充。
 */
export interface StorageFile {
  /** 目录 ID。文件夹为自身 ID，文件为所在目录 ID */
  cid: string
  /** 提取码 */
  pc: string
  /** 名称 */
  n: string
  /** 文件 ID。**仅文件有，文件夹没有此字段**，据此区分两者 */
  fid?: string
  /** 父目录 ID */
  pid?: string
  /** 星标 */
  m?: number
  /** 文件大小（字节），文件夹为 0 */
  size?: number
  /** 修改时间 */
  modified_time?: string
  /**
   * 扩展名，如 "mp4"；文件夹为 "folder"
   *
   * 注意：与旧版语义完全不同。旧版 DOM 属性上的 file_type 是
   * '0'（文件夹）/ '1'（文件），新版这里放的是扩展名。
   * 照搬旧版的 `file_type === '0'` 判断会恒为 false 且不报错，
   * 判断文件夹一律使用 {@link isFolder}
   */
  file_type?: string
  /** 条目种类："file" | "folder" */
  type?: string
  /** 是否视频，1 为是。注意是 number，旧版 DOM 属性上是字符串 '1' */
  iv?: number
  /** 视频时长（秒） */
  play_long?: number
  /**
   * sha1
   *
   * 沿用 webapi.115.com/files 的字段名（同 PlaylistItem.sha）。
   * 尚未在新版页面上实测确认，取不到时视频封面会退化为不展示，
   * 不影响其他功能
   */
  sha?: string
}

/**
 * React Fiber 上本模块用到的最小结构
 *
 * 这是 React 内部实现，非公开 API。所有读取都必须能安全失败，
 * 由调用方降级到 webapi.115.com/files。
 */
interface FiberNode {
  return: FiberNode | null
  memoizedProps: Record<string, unknown> | null
}

/** 向上回溯的最大层数，防止在异常结构上无限爬 */
const MAX_FIBER_DEPTH = 25

/** React 挂在 DOM 元素上的 fiber 属性前缀 */
const FIBER_KEY_PREFIX = '__reactFiber$'

/**
 * 判断是否为文件列表项数据
 * @param value 待判断值
 */
function isStorageFile(value: unknown): value is StorageFile {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return 'pc' in value && 'cid' in value && 'n' in value
}

/**
 * 取 DOM 元素上的 React Fiber
 * @param node DOM 元素
 */
function getFiber(node: Element): FiberNode | null {
  const key = Object.keys(node).find(item => item.startsWith(FIBER_KEY_PREFIX))
  if (!key) {
    return null
  }
  return (node as unknown as Record<string, FiberNode>)[key] ?? null
}

/**
 * 从行元素向上查找承载整页文件数据的数组
 *
 * 实测该数组挂在行元素向上约 5 层的 `memoizedProps.files` 上，
 * 内容为「当前已加载」的文件（分页加载，非全部），
 * 与 DOM 上的行一一对应。
 * @param rowNode 文件列表行元素
 * @returns 文件数组，读取失败返回 null
 */
export function findFileList(rowNode: HTMLElement): StorageFile[] | null {
  let fiber = getFiber(rowNode)
  let depth = 0

  while (fiber && depth < MAX_FIBER_DEPTH) {
    const files = fiber.memoizedProps?.files
    if (Array.isArray(files) && files.length > 0 && isStorageFile(files[0])) {
      return files as StorageFile[]
    }
    fiber = fiber.return
    depth += 1
  }

  return null
}

/**
 * 读取某一行对应的文件数据
 *
 * 新版行 DOM 上不带 file_id / pick_code 之类的属性，
 * 唯一可用的信息是 data-index，需要用它去索引 fiber 上的文件数组。
 * @param rowNode 文件列表行元素
 * @returns 文件数据，读取失败返回 null
 */
export function readFileFromRow(rowNode: HTMLElement): StorageFile | null {
  const rawIndex = rowNode.getAttribute(DATA_INDEX_ATTR)
  if (rawIndex === null) {
    return null
  }

  const index = Number(rawIndex)
  if (!Number.isInteger(index) || index < 0) {
    return null
  }

  const files = findFileList(rowNode)
  if (!files) {
    return null
  }

  return files[index] ?? null
}

/**
 * 生成文件的稳定标识
 *
 * 用于判断一行的内容是否发生了变化：切换目录时 React 可能复用同一个 DOM 节点
 * 只替换数据，此时节点没有增删，只能靠数据本身识别。
 * @param file 文件数据
 */
export function getFileKey(file: StorageFile): string {
  return `${file.cid}:${file.pc}`
}

/**
 * 判断是否为文件夹
 *
 * 以 fid 是否存在为准：文件带 fid，文件夹没有这个字段。
 *
 * 实测两侧取值（type / file_type / fid）：
 * - 文件夹：'folder' / 'folder' / 无
 * - 文件：  'file'   / 'mp4'    / 有
 *
 * type 同样可用，这里选 fid 是因为它同时决定了 {@link getFileId} 取哪个字段，
 * 两处用同一依据不会出现判断打架。
 * 绝不能用 file_type —— 新版它是扩展名而非旧版的 '0'/'1'。
 * @param file 文件数据
 */
export function isFolder(file: StorageFile): boolean {
  return !file.fid
}

/**
 * 判断是否为视频
 *
 * 新版 iv 是 number（1），旧版 DOM 属性上是字符串 '1'，
 * 这里统一按数值比较，避免因类型差异漏判。
 * @param file 文件数据
 */
export function isVideo(file: StorageFile): boolean {
  return Number(file.iv) === 1
}

/**
 * 取条目自身的 115 ID
 *
 * 文件夹的自身 ID 是 cid（此时 cid 不是父目录），文件的是 fid。
 * aria2 递归遍历目录时依赖这个区分，取错会从错误的层级开始展开。
 * @param file 文件数据
 */
export function getFileId(file: StorageFile): string {
  return isFolder(file) ? file.cid : (file.fid as string)
}
