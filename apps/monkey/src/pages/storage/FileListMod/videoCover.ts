import type { StorageFile } from '../utils/fiber'
import type { ShadowMount } from '../utils/shadowMount'
import { PLUS_VERSION } from '@/constants'
import ExtVideoCover from '@/pages/home/components/ExtVideoCover/index.vue'
import { isVideo } from '../utils/fiber'
import { getListScrollBox, getRowAvNumber, getRowDuration } from '../utils/rowInfo'
import { mountInShadow, unmountShadow } from '../utils/shadowMount'
import { RowFeature } from './RowFeature'

/**
 * 行内视频封面预览
 *
 * 组件本身直接复用旧版的 ExtVideoCover，只是数据来源换成 React 内部字段：
 * 时长从 play_long 直接拿到秒数，不用再解析 "hh:mm:ss"。
 */
export class VideoCoverFeature extends RowFeature {
  readonly ENABLE_KEY_IN_USER_SETTING = 'enableFilelistPreview'

  /** 已挂载的组件，按所在行记录 */
  private mounted = new Map<HTMLElement, ShadowMount>()

  mount(rowNode: HTMLElement, file: StorageFile): void {
    this.unmount(rowNode)

    if (!isVideo(file)) {
      return
    }

    // Plus 版本下有番号的走 ExtInfo，避免两块预览重复占位
    if (PLUS_VERSION && getRowAvNumber(file)) {
      return
    }

    const listScrollBoxNode = getListScrollBox()
    if (!listScrollBoxNode) {
      return
    }

    this.mounted.set(
      rowNode,
      mountInShadow(rowNode, ExtVideoCover, {
        pickCode: file.pc,
        sha1: file.sha ?? '',
        duration: getRowDuration(file),
        listScrollBoxNode,
      }),
    )
  }

  unmount(rowNode: HTMLElement): void {
    const instance = this.mounted.get(rowNode)
    if (!instance) {
      return
    }
    unmountShadow(instance)
    this.mounted.delete(rowNode)
  }
}
