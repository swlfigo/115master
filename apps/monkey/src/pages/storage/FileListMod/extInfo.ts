import type { StorageFile } from '../utils/fiber'
import type { ShadowMount } from '../utils/shadowMount'
import { defer } from 'lodash'
import ExtInfo from '@/pages/home/components/ExtInfo/index.vue'
import { isFolder, isVideo } from '../utils/fiber'
import { getRowAvNumber } from '../utils/rowInfo'
import { mountInShadow, unmountShadow } from '../utils/shadowMount'
import { RowFeature } from './RowFeature'

/**
 * 行内扩展信息（番号影片信息）
 */
export class ExtInfoFeature extends RowFeature {
  readonly IS_PLUS = true
  readonly ENABLE_KEY_IN_USER_SETTING = 'enableFilelistPreview'

  /** 已挂载的组件，按所在行记录 */
  private mounted = new Map<HTMLElement, ShadowMount>()

  mount(rowNode: HTMLElement, file: StorageFile): void {
    this.unmount(rowNode)

    // 非视频且非文件夹的条目没有展示价值
    if (!isVideo(file) && !isFolder(file)) {
      return
    }

    const avNumber = getRowAvNumber(file)
    if (!avNumber) {
      return
    }

    this.mounted.set(rowNode, mountInShadow(rowNode, ExtInfo, { avNumber }))
  }

  unmount(rowNode: HTMLElement): void {
    const instance = this.mounted.get(rowNode)
    if (!instance) {
      return
    }
    this.mounted.delete(rowNode)
    // 延迟卸载 Vue，避免阻塞新一批行的挂载（同旧版）
    defer(() => unmountShadow(instance))
  }
}
