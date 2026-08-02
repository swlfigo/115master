import type { Aria2RpcPreset } from './types'
import { toast } from '@/components/MasterToast/toast'
import { pushFile, pushFolder } from './index'

/** 待推送的列表条目 */
export interface Aria2PushEntry {
  /** 是否文件夹，决定走递归遍历还是单文件推送 */
  isFolder: boolean
  /** 文件夹的自身 ID（cid）。文件不需要 */
  folderCid?: string
  /** 名称，同时作为文件夹递归时的根路径 */
  name: string
  /** 提取码，单文件推送用 */
  pickCode?: string
  /** sha1，可选 */
  sha1?: string
}

/**
 * 推送一个列表条目到 Aria2，并负责全程的 toast 反馈
 *
 * 从各页面的按钮组件中抽出来，使新旧两版网盘的推送行为保持一致：
 * 差异只在「怎么拿到条目数据」，拿到之后的流程完全相同。
 * @param entry 条目
 * @param rpc 目标 RPC 预设
 */
export async function pushEntry(
  entry: Aria2PushEntry,
  rpc: Aria2RpcPreset,
): Promise<void> {
  if (entry.isFolder) {
    await pushFolderEntry(entry, rpc)
    return
  }
  await pushFileEntry(entry, rpc)
}

/**
 * 推送文件夹
 * @param entry 条目
 * @param rpc 目标 RPC 预设
 */
async function pushFolderEntry(
  entry: Aria2PushEntry,
  rpc: Aria2RpcPreset,
): Promise<void> {
  if (!entry.folderCid) {
    toast.error('无法获取文件夹 ID')
    return
  }

  const handle = toast.loading('正在获取文件列表... 0')
  try {
    const result = await pushFolder({
      cid: entry.folderCid,
      rootPath: entry.name,
      rpc,
      onListProgress: walked => handle.update(`正在获取文件列表... ${walked}`),
      onPushProgress: (done, total, failed) =>
        handle.update(`推送中 ${done}/${total}${failed ? `（失败 ${failed}）` : ''}`),
    })

    if (result.failed === 0) {
      handle.success(`已推送 ${result.done} 个文件`)
    }
    else {
      handle.error(`已推送 ${result.done}，失败 ${result.failed}`)
    }
  }
  catch (error) {
    handle.error(`推送失败：${toMessage(error)}`)
  }
}

/**
 * 推送单个文件
 * @param entry 条目
 * @param rpc 目标 RPC 预设
 */
async function pushFileEntry(
  entry: Aria2PushEntry,
  rpc: Aria2RpcPreset,
): Promise<void> {
  if (!entry.pickCode) {
    toast.error('无法获取文件提取码')
    return
  }

  const handle = toast.loading(`推送 ${entry.name}...`)
  try {
    await pushFile(
      {
        pickCode: entry.pickCode,
        name: entry.name,
        sha1: entry.sha1,
      },
      rpc,
    )
    handle.success('推送成功')
  }
  catch (error) {
    handle.error(`推送失败：${toMessage(error)}`)
  }
}

/**
 * 取错误信息文本
 * @param error 错误
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
