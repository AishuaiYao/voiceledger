const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  var nickName = (event.nickName || '').trim()
  var avatarUrl = event.avatarUrl || ''
  if (!nickName) return { success: false, error: '昵称不能为空' }
  if (nickName.length > 20) return { success: false, error: '昵称最长 20 个字符' }

  // 1. 更新 users 主记录
  var userRes = await db.collection('users').where({ openId: OPENID }).limit(1).get()
  if (userRes.data.length === 0) return { success: false, error: '用户不存在，请先登录' }
  var userDoc = userRes.data[0]
  var oldNickName = userDoc.nickName || ''
  var oldAvatarUrl = userDoc.avatarUrl || ''

  await db.collection('users').doc(userDoc._id).update({
    data: { nickName: nickName, avatarUrl: avatarUrl, updatedAt: new Date() }
  })

  // 资料无变化时无需同步历史数据
  if (oldNickName === nickName && oldAvatarUrl === avatarUrl) {
    return {
      success: true,
      user: { _id: userDoc._id, openId: OPENID, nickName: nickName, avatarUrl: avatarUrl }
    }
  }

  var syncErrors = []

  // 2. 同步账单记录（records）的创建者快照
  try {
    await updateAll('records', { openId: OPENID }, {
      creatorNickName: nickName,
      creatorAvatarUrl: avatarUrl
    })
  } catch (e) {
    syncErrors.push('records: ' + e.message)
  }

  // 3. 同步账本（notebooks）的创建者昵称与成员快照
  try {
    var nbs = await db.collection('notebooks')
      .where({ members: db.command.elemMatch({ openId: OPENID }) })
      .limit(1000)
      .get()
    for (var i = 0; i < nbs.data.length; i++) {
      var nb = nbs.data[i]
      var patch = { members: nb.members || [] }
      var changed = false
      for (var j = 0; j < patch.members.length; j++) {
        if (patch.members[j].openId === OPENID) {
          patch.members[j].nickName = nickName
          patch.members[j].avatarUrl = avatarUrl
          changed = true
        }
      }
      if (nb.openId === OPENID) {
        patch.ownerNickName = nickName
        changed = true
      }
      if (changed) {
        await db.collection('notebooks').doc(nb._id).update({ data: patch })
      }
    }
  } catch (e) {
    syncErrors.push('notebooks: ' + e.message)
  }

  // 4. 同步博文（posts）作者快照（集合可能不存在，忽略）
  try {
    await updateAll('posts', { openId: OPENID }, {
      authorNickName: nickName,
      authorAvatarUrl: avatarUrl
    })
  } catch (e) {
    // posts 集合不存在等情况，不影响主流程
  }

  // 5. 清理旧头像（换了 cloud:// 头像时删除旧文件，避免云存储堆积）
  if (avatarUrl && oldAvatarUrl && oldAvatarUrl.indexOf('cloud://') === 0 && oldAvatarUrl !== avatarUrl) {
    try {
      await cloud.deleteFile({ fileList: [oldAvatarUrl] })
    } catch (e) {
      syncErrors.push('deleteAvatar: ' + e.message)
    }
  }

  return {
    success: true,
    user: { _id: userDoc._id, openId: OPENID, nickName: nickName, avatarUrl: avatarUrl },
    synced: syncErrors.length === 0,
    errors: syncErrors
  }
}

// 循环执行 where().update()，直到无更多匹配文档，规避单次更新的数量限制
async function updateAll(collectionName, condition, data) {
  var total = 0
  while (true) {
    var res = await db.collection(collectionName).where(condition).update({ data: data })
    total += res.stats.updated
    if (res.stats.updated < 1000) break
  }
  return total
}
