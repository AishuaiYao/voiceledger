const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 全局缓存
let cachedApiKey = null

exports.main = async (event, context) => {
  // 命中缓存直接返回
  if (cachedApiKey) {
    console.log('[getConfig] 使用缓存的 api_key')
    return { success: true, apiKey: cachedApiKey }
  }

  const fileID = 'cloud://cloud1-d7g1myj7ab00b5661.636c-cloud1-d7g1myj7ab00b5661-1466793040/config.json'
  console.log('[getConfig] 下载配置文件:', fileID)

  try {
    const res = await cloud.downloadFile({ fileID })
    const configStr = res.fileContent.toString('utf-8')
    console.log('[getConfig] 配置内容:', configStr)

    const config = JSON.parse(configStr)
    if (!config.aliyun_api_key) {
      return { success: false, error: 'config.json 中未找到 aliyun_api_key' }
    }

    cachedApiKey = config.aliyun_api_key
    console.log('[getConfig] 成功, key 长度:', cachedApiKey.length)
    return { success: true, apiKey: cachedApiKey }
  } catch (err) {
    console.error('[getConfig] 失败:', err)
    return { success: false, error: err.message }
  }
}
