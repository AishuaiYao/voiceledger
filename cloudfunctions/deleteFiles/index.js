// 云函数：批量删除云存储文件
// 走管理员身份，不受"仅上传创建者可删"限制
// 入参：{ fileList: ['cloud://...', ...] }，单次最多 50 个
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const fileList = event.fileList || []
  if (!Array.isArray(fileList) || fileList.length === 0) {
    return { success: false, error: 'fileList 为空或格式不正确' }
  }
  if (fileList.length > 50) {
    return { success: false, error: '单次最多删除 50 个文件' }
  }

  // 过滤非 cloud:// 的非法值，避免误删
  const validList = fileList.filter(function (id) {
    return typeof id === 'string' && id.indexOf('cloud://') === 0
  })
  if (validList.length === 0) {
    return { success: false, error: '没有合法的 cloud:// fileID' }
  }

  try {
    const res = await cloud.deleteFile({ fileList: validList })
    return { success: true, fileList: res.fileList }
  } catch (e) {
    console.error('[deleteFiles] 删除失败:', e)
    return { success: false, error: e.message || '删除失败' }
  }
}
