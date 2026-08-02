import { describe, expect, it } from 'vitest'
import { getRowAvNumber, getRowDuration } from '../rowInfo'

/**
 * 视频文件行数据
 *
 * 字段构成取自新版网盘 React props 的实测结果，值本身为占位数据。
 */
const FILE_ROW = {
  cid: '1000000000000000001',
  fid: '2000000000000000002',
  n: 'ABC-123.mp4',
  pc: 'pickcode00000test',
  iv: 1,
  play_long: 9061,
}

describe('getRowDuration', () => {
  it('play_long 直接就是秒数，不需要解析时间串', () => {
    expect(getRowDuration(FILE_ROW)).toBe(9061)
  })

  it('缺失时归零，不产生 NaN', () => {
    expect(getRowDuration({ ...FILE_ROW, play_long: undefined })).toBe(0)
  })

  it('非数值归零', () => {
    expect(
      getRowDuration({ ...FILE_ROW, play_long: 'abc' as unknown as number }),
    ).toBe(0)
  })

  it('文件夹没有时长', () => {
    expect(getRowDuration({ cid: '1', pc: 'a', n: 'folder' })).toBe(0)
  })
})

describe('getRowAvNumber', () => {
  it('从文件名取番号', () => {
    expect(getRowAvNumber(FILE_ROW)).toBe('ABC-123')
  })

  it('文件夹名同样能取', () => {
    expect(getRowAvNumber({ cid: '1', pc: 'a', n: 'ABC-123' })).toBe('ABC-123')
  })

  it('没有番号时返回 null', () => {
    expect(
      getRowAvNumber({ cid: '1', pc: 'a', n: '新建文档.docx' }),
    ).toBeNull()
  })
})
