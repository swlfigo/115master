import { describe, expect, it } from 'vitest'
import { findFileList, getFileId, getFileKey, isFolder, isVideo, readFileFromRow } from '../fiber'

/** 文件夹自身 ID，同时是 FILE_ROW 所在的目录 */
const FOLDER_CID = '1000000000000000001'

/**
 * 文件行数据
 *
 * 字段构成取自新版网盘 React props 的实测结果，值本身为占位数据。
 */
const FILE_ROW = {
  cid: FOLDER_CID,
  fid: '2000000000000000002',
  file_type: 'mp4',
  n: 'ABC-123.mp4',
  pc: 'pickcode00000test',
  type: 'file',
  iv: 1,
  play_long: 9061,
}

/**
 * 文件夹行数据
 *
 * 与 FILE_ROW 构成父子关系：本文件夹的 cid 即 FILE_ROW 的 cid，
 * 用于验证「文件夹的 cid 是自身 ID 而非父目录」
 */
const FOLDER_ROW = {
  cid: FOLDER_CID,
  pid: '3000000000000000003',
  n: 'ABC-123',
  pc: 'pickcode00000fold',
  type: 'folder',
  file_type: 'folder',
}

/** 构造一个文件数据 */
function makeFile(cid: string, pc: string, n = 'name') {
  return { cid, pc, n }
}

/**
 * 构造一个带 React Fiber 的假行元素
 * @param depth files 数组所在的层数（0 表示行元素自身的 fiber）
 * @param files 文件数组，传 null 表示整条链上都没有
 * @param index data-index 属性值
 */
function makeRow(
  depth: number,
  files: ReturnType<typeof makeFile>[] | null,
  index: string | null = '0',
) {
  /** chain[0] 是行自身的 fiber，逐级 return 向上 */
  const total = files ? depth + 1 : 8
  const chain: Record<string, unknown>[] = []
  for (let i = 0; i < total; i++) {
    chain.push({
      memoizedProps:
        files !== null && i === depth ? { files } : { className: 'x' },
      return: null,
    })
  }
  chain.forEach((node, i) => {
    node.return = chain[i + 1] ?? null
  })

  return {
    getAttribute: (name: string) => (name === 'data-index' ? index : null),
    __reactFiber$abc123: chain[0],
  } as unknown as HTMLElement
}

describe('findFileList', () => {
  it('找到挂在上层 fiber 上的文件数组', () => {
    const files = [makeFile('1', 'a'), makeFile('2', 'b')]
    expect(findFileList(makeRow(5, files))).toEqual(files)
  })

  it('文件数组就在行自身 fiber 上时也能找到', () => {
    const files = [makeFile('1', 'a')]
    expect(findFileList(makeRow(0, files))).toEqual(files)
  })

  it('整条链上都没有文件数组时返回 null', () => {
    expect(findFileList(makeRow(0, null))).toBeNull()
  })

  it('元素上没有 fiber 时返回 null，不抛错', () => {
    const row = { getAttribute: () => '0' } as unknown as HTMLElement
    expect(findFileList(row)).toBeNull()
  })

  it('超过最大回溯层数后放弃，不会无限爬', () => {
    // files 放在第 30 层，超出 MAX_FIBER_DEPTH(25)
    expect(findFileList(makeRow(30, [makeFile('1', 'a')]))).toBeNull()
  })

  it('忽略不是文件数据的 files 数组', () => {
    const row = makeRow(3, [{ foo: 'bar' }] as never)
    expect(findFileList(row)).toBeNull()
  })

  it('忽略空的 files 数组', () => {
    expect(findFileList(makeRow(3, []))).toBeNull()
  })
})

describe('readFileFromRow', () => {
  const files = [makeFile('10', 'pa'), makeFile('20', 'pb'), makeFile('30', 'pc')]

  it('按 data-index 取到对应的文件', () => {
    expect(readFileFromRow(makeRow(5, files, '1'))).toEqual(files[1])
  })

  it('data-index 缺失时返回 null', () => {
    expect(readFileFromRow(makeRow(5, files, null))).toBeNull()
  })

  it('data-index 越界时返回 null', () => {
    expect(readFileFromRow(makeRow(5, files, '99'))).toBeNull()
  })

  it('data-index 不是合法非负整数时返回 null', () => {
    expect(readFileFromRow(makeRow(5, files, 'abc'))).toBeNull()
    expect(readFileFromRow(makeRow(5, files, '-1'))).toBeNull()
    expect(readFileFromRow(makeRow(5, files, '1.5'))).toBeNull()
  })

  it('读不到文件数组时返回 null', () => {
    expect(readFileFromRow(makeRow(5, null, '0'))).toBeNull()
  })
})

describe('getFileKey', () => {
  it('cid 与 pc 共同决定标识', () => {
    expect(getFileKey(makeFile('1', 'a'))).toBe(getFileKey(makeFile('1', 'a')))
    expect(getFileKey(makeFile('1', 'a'))).not.toBe(getFileKey(makeFile('1', 'b')))
    expect(getFileKey(makeFile('1', 'a'))).not.toBe(getFileKey(makeFile('2', 'a')))
  })

  it('同名不同文件的标识不同', () => {
    const x = getFileKey(makeFile('1', 'a', '同名.mp4'))
    const y = getFileKey(makeFile('2', 'b', '同名.mp4'))
    expect(x).not.toBe(y)
  })
})

describe('isFolder', () => {
  it('有 fid 的是文件', () => {
    expect(isFolder(FILE_ROW)).toBe(false)
  })

  it('没有 fid 的是文件夹', () => {
    expect(isFolder(FOLDER_ROW)).toBe(true)
  })

  it('不能用 file_type 判断：新版它是扩展名而非 0/1', () => {
    // 旧版写法 file_type === '0' 在新旧两侧都恒为 false，
    // 会把文件夹静默误判成文件，这里锁死该回归
    expect(FILE_ROW.file_type).toBe('mp4')
    expect(FOLDER_ROW.file_type).toBe('folder')
    expect(FILE_ROW.file_type === '0').toBe(false)
    expect(FOLDER_ROW.file_type === '0').toBe(false)
    // isFolder 不受 file_type 干扰
    expect(isFolder({ ...FOLDER_ROW, file_type: '1' })).toBe(true)
    expect(isFolder({ ...FILE_ROW, file_type: '0' })).toBe(false)
  })

  it('与 type 字段的判断结果一致', () => {
    expect(isFolder(FOLDER_ROW)).toBe(FOLDER_ROW.type === 'folder')
    expect(isFolder(FILE_ROW)).toBe(FILE_ROW.type === 'folder')
  })

  it('fid 为空串时按文件夹处理', () => {
    expect(isFolder({ ...FILE_ROW, fid: '' })).toBe(true)
  })
})

describe('isVideo', () => {
  it('实测的视频文件 iv 为数值 1', () => {
    expect(FILE_ROW.iv).toBe(1)
    expect(isVideo(FILE_ROW)).toBe(true)
  })

  it('兼容旧版的字符串 1', () => {
    expect(isVideo({ ...FILE_ROW, iv: '1' as unknown as number })).toBe(true)
  })

  it('文件夹没有 iv，不是视频', () => {
    expect(isVideo(FOLDER_ROW)).toBe(false)
  })

  it('非视频文件不误判', () => {
    expect(isVideo({ ...FILE_ROW, iv: 0 })).toBe(false)
    expect(isVideo({ ...FILE_ROW, iv: undefined })).toBe(false)
  })

  it('不能用扩展名判断：mp4 之外还有别的视频容器', () => {
    // file_type 为 mkv 但 iv=1 仍应识别为视频
    expect(isVideo({ ...FILE_ROW, file_type: 'mkv' })).toBe(true)
  })
})

describe('getFileId', () => {
  it('文件取 fid', () => {
    expect(getFileId(FILE_ROW)).toBe(FILE_ROW.fid)
  })

  it('文件夹取 cid（自身 ID，非父目录）', () => {
    expect(getFileId(FOLDER_ROW)).toBe(FOLDER_CID)
    expect(getFileId(FOLDER_ROW)).not.toBe(FOLDER_ROW.pid)
  })

  it('文件夹的 cid 正是其子项的 cid（自身 ID 得证）', () => {
    expect(getFileId(FOLDER_ROW)).toBe(FILE_ROW.cid)
  })

  it('文件的 cid 是所在目录，不能当作自身 ID', () => {
    expect(getFileId(FILE_ROW)).not.toBe(FILE_ROW.cid)
  })
})
