const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  // 确保所需集合存在
  const db = cloud.database()
  var collections = ['users', 'notebooks', 'records']
  for (var i = 0; i < collections.length; i++) {
    try {
      await db.createCollection(collections[i])
    } catch (e) {
      // 集合已存在，忽略
    }
  }

  // 查询该 openId 是否已注册：已注册则返回用户资料，前端可直接自动登录，无需再选头像昵称
  var existingUser = null
  try {
    var userRes = await db.collection('users').where({ openId: OPENID }).limit(1).get()
    if (userRes.data.length > 0) existingUser = userRes.data[0]
  } catch (e) {
    console.error('[getOpenId] 查询用户失败:', e)
  }

  return { openId: OPENID, existingUser: existingUser }
}
