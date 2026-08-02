import type { StorageFile } from '../utils/fiber'
import { actressFaceDB } from '@/utils/actressFaceDB'
import { imageCache } from '@/utils/cache'
import { compressImage } from '@/utils/image'
import { appLogger } from '@/utils/logger'
import { STORAGE_SELECTOR } from '../constants'
import { RowFeature } from './RowFeature'

/** 标记属性，用于清理自己插入的节点 */
export const ACTRESS_IMG_ATTR = 'data-master-actress'

/**
 * 行内演员头像
 */
export class ActressInfoFeature extends RowFeature {
  readonly IS_PLUS = true

  /** 日志 */
  private logger = appLogger.sub('StorageActressInfo')

  /** 已插入的头像，按所在行记录 */
  private images = new Map<HTMLElement, HTMLImageElement>()

  mount(rowNode: HTMLElement, file: StorageFile): void {
    this.unmount(rowNode)
    // 查库是异步的，期间行可能已被卸载，故在回调里再次确认
    void this.render(rowNode, file)
  }

  unmount(rowNode: HTMLElement): void {
    this.images.get(rowNode)?.remove()
    this.images.delete(rowNode)
  }

  /**
   * 查演员并插入头像
   * @param rowNode 行元素
   * @param file 文件数据
   */
  private async render(
    rowNode: HTMLElement,
    file: StorageFile,
  ): Promise<void> {
    await actressFaceDB.init()
    const actress = await actressFaceDB.findActress(file.n.trim())
    if (!actress) {
      return
    }

    // 异步期间行可能已经被 React 换掉，此时不能再插
    if (!rowNode.isConnected) {
      return
    }

    const nameNode = rowNode.querySelector<HTMLElement>(
      STORAGE_SELECTOR.ITEM_NAME,
    )
    const host = nameNode?.parentElement
    if (!host) {
      return
    }

    const image = document.createElement('img')
    image.setAttribute(ACTRESS_IMG_ATTR, '')
    image.alt = actress.filename
    image.loading = 'lazy'
    image.style.cssText
      = 'width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;'
    host.prepend(image)
    this.images.set(rowNode, image)

    image.src = await this.resolveSrc(actress.url)
  }

  /**
   * 取头像地址，优先走缓存
   * @param url 原始地址
   */
  private async resolveSrc(url: string): Promise<string> {
    const cacheKey = `actress-face-${url}`
    try {
      const cached = await imageCache.get(cacheKey)
      if (cached) {
        return URL.createObjectURL(cached.value)
      }

      const response = await fetch(url)
      if (response.ok) {
        const compressed = await compressImage(await response.blob(), {
          maxWidth: 200,
          maxHeight: 200,
          quality: 0.8,
          type: 'image/webp',
        })
        await imageCache.set(cacheKey, compressed)
      }
    }
    catch (error) {
      this.logger.error('加载演员头像缓存失败:', error)
    }
    return url
  }
}
