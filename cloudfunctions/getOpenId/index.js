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

  return { openId: OPENID }
}
