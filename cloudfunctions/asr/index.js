const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  // API Key 通过云函数环境变量注入，不随前端代码下发
  const apiKey = process.env.ALIYUN_API_KEY
  if (!apiKey) {
    return { success: false, error: '服务未配置，请为 asr 云函数配置环境变量 ALIYUN_API_KEY' }
  }

  const fileID = event.fileID
  if (!fileID) {
    return { success: false, error: '缺少音频文件参数' }
  }

  // 1. 从云存储下载录音
  const dl = await cloud.downloadFile({ fileID })
  const audioBase64 = dl.fileContent.toString('base64')
  const audioData = 'data:audio/mpeg;base64,' + audioBase64

  // 2. 调用阿里云语音识别
  const text = await requestAsr(apiKey, audioData)

  // 3. 无论识别成功与否都清理临时音频，避免云存储堆积
  try {
    await cloud.deleteFile({ fileList: [fileID] })
  } catch (e) {
    console.error('[asr] 清理音频失败:', e)
  }

  if (text == null) {
    return { success: false, error: '语音识别失败' }
  }
  return { success: true, text }
}

function requestAsr(apiKey, audioData) {
  const body = JSON.stringify({
    model: 'qwen-audio-3.0-asr-flash',
    input: {
      messages: [{
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: audioData } }]
      }]
    },
    parameters: { format: 'mp3', sample_rate: '16000' }
  })

  return new Promise(function (resolve) {
    const req = https.request({
      hostname: 'llm-mhwgg01ku321wyjx.cn-beijing.maas.aliyuncs.com',
      path: '/api/v1/services/aigc/multimodal-generation/generation',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'X-DashScope-SSE': 'disable',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 60000
    }, function (res) {
      let data = ''
      res.on('data', function (chunk) { data += chunk })
      res.on('end', function () {
        try {
          const json = JSON.parse(data)
          if (res.statusCode === 200 && json && json.text) {
            resolve(json.text)
          } else {
            console.error('[asr] 响应异常 status:', res.statusCode, data)
            resolve(null)
          }
        } catch (e) {
          console.error('[asr] 响应解析失败:', data)
          resolve(null)
        }
      })
    })
    req.on('error', function (err) {
      console.error('[asr] 请求失败:', err)
      resolve(null)
    })
    req.on('timeout', function () {
      req.destroy()
      resolve(null)
    })
    req.write(body)
    req.end()
  })
}
