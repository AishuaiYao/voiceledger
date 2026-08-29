const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const MAX_MEMBERS = 10
const INVITE_TTL_MS = 24 * 60 * 60 * 1000 // 24小时

// 确保集合存在（已存在则忽略）
async function ensureCollections() {
  var names = ['notebooks']
  for (var i = 0; i < names.length; i++) {
    try {
      await db.createCollection(names[i])
    } catch (e) {
      // 集合已存在，忽略
    }
  }
}

exports.main = async (event, context) => {
  await ensureCollections()
  const { OPENID } = cloud.getWXContext()
  var action = event.action

  if (action === 'createNotebook') return createNotebook(OPENID, event)
  if (action === 'getNotebooks') return getNotebooks(OPENID)
  if (action === 'deleteNotebook') return deleteNotebook(OPENID, event)
  if (action === 'createInvite') return createInvite(OPENID, event)
  if (action === 'getInviteInfo') return getInviteInfo(event)
  if (action === 'joinNotebook') return joinNotebook(OPENID, event)
  if (action === 'removeMember') return removeMember(OPENID, event)
  if (action === 'getNotebookDetail') return getNotebookDetail(OPENID, event)
  if (action === 'touchNotebook') return touchNotebook(OPENID, event)

  return { success: false, error: '未知 action: ' + action }
}

// ========== 账本 ==========

async function createNotebook(openId, event) {
  var user = await getUser(openId)
  var member = {
    openId: openId,
    nickName: user.nickName,
    avatarUrl: user.avatarUrl,
    joinedAt: Date.now(),
    isOwner: true
  }
  var res = await db.collection('notebooks').add({
    data: {
      openId: openId,
      ownerNickName: user.nickName,
      name: event.name,
      description: event.description || '',
      customIcon: event.customIcon || '',
      members: [member],
      createdAt: db.serverDate(),
      inviteExpireAt: Date.now() + INVITE_TTL_MS
    }
  })
  return { success: true, _id: res._id }
}

async function getNotebooks(openId) {
  var res = await db.collection('notebooks')
    .where({ members: _.elemMatch({ openId: openId }) })
    .orderBy('createdAt', 'asc')
    .get()
  var notebooks = res.data
  for (var i = 0; i < notebooks.length; i++) {
    decorateNotebook(notebooks[i], openId)
  }
  return { success: true, notebooks: notebooks }
}

// 记录账本最近使用时间（用于登录后自动恢复「最近使用」的账本）
async function touchNotebook(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (!isMember(nb, openId)) return { success: false, error: '无权访问' }
  await db.collection('notebooks').doc(event.notebookId).update({
    data: { lastUsedAt: Date.now() }
  })
  return { success: true }
}

async function deleteNotebook(openId, event) {
  var notebookId = event.notebookId
  var nb = await getNotebookDoc(notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (nb.openId !== openId) return { success: false, error: '只有创建者可以删除账本' }

  await db.collection('notebooks').doc(notebookId).remove()
  // 删除该账本下全部记录
  var recRes = await db.collection('records').where({ notebookId }).limit(1000).get()
  for (var i = 0; i < recRes.data.length; i++) {
    await db.collection('records').doc(recRes.data[i]._id).remove()
  }
  return { success: true }
}

async function getNotebookDetail(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (!isMember(nb, openId)) return { success: false, error: '无权访问' }
  decorateNotebook(nb, openId)
  return { success: true, notebook: nb }
}

// ========== 邀请 ==========

// 点邀请按钮时更新账本的 inviteExpireAt（24h 有效窗口）
async function createInvite(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (nb.openId !== openId) return { success: false, error: '只有创建者可以邀请' }
  if (nb.members.length >= MAX_MEMBERS) return { success: false, error: '成员已满（最多' + MAX_MEMBERS + '人）' }

  var now = Date.now()
  await db.collection('notebooks').doc(event.notebookId).update({
    data: { inviteExpireAt: now + INVITE_TTL_MS }
  })
  return { success: true }
}

async function getInviteInfo(event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  var user = await getUser(nb.openId)
  var expired = !nb.inviteExpireAt || Date.now() > nb.inviteExpireAt
  return {
    success: true,
    invite: {
      notebookId: nb._id,
      notebookName: nb.name,
      inviterNickName: user.nickName,
      expired: expired
    }
  }
}

async function joinNotebook(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (!nb.inviteExpireAt || Date.now() > nb.inviteExpireAt) {
    return { success: false, error: '邀请已过期，请联系对方重新邀请' }
  }
  if (isMember(nb, openId)) return { success: false, error: 'already_joined', notebook: decorateNotebook(nb, openId) }
  if (nb.members.length >= MAX_MEMBERS) return { success: false, error: '成员已满' }

  var user = await getUser(openId)
  var newMember = {
    openId: openId,
    nickName: user.nickName,
    avatarUrl: user.avatarUrl,
    joinedAt: Date.now(),
    isOwner: false
  }
  await db.collection('notebooks').doc(nb._id).update({
    data: { members: _.push(newMember) }
  })
  nb.members.push(newMember)
  decorateNotebook(nb, openId)
  return { success: true, notebook: nb }
}

// ========== 成员管理 ==========

async function removeMember(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (nb.openId !== openId) return { success: false, error: '只有创建者可以移除成员' }
  if (event.memberOpenId === openId) return { success: false, error: '不能移除自己' }

  await db.collection('notebooks').doc(nb._id).update({
    data: { members: _.pull({ openId: event.memberOpenId }) }
  })
  return { success: true }
}

// ========== 工具函数 ==========

async function getUser(openId) {
  var res = await db.collection('users').where({ openId }).limit(1).get()
  if (res.data.length === 0) return { openId: openId, nickName: '微信用户', avatarUrl: '' }
  return res.data[0]
}

async function getNotebookDoc(notebookId) {
  try {
    var res = await db.collection('notebooks').doc(notebookId).get()
    return res.data
  } catch (e) {
    return null
  }
}

function isMember(notebook, openId) {
  if (!notebook.members) return false
  for (var i = 0; i < notebook.members.length; i++) {
    if (notebook.members[i].openId === openId) return true
  }
  return false
}

function decorateNotebook(notebook, currentOpenId) {
  notebook.isOwner = notebook.openId === currentOpenId
  notebook.memberCount = notebook.members ? notebook.members.length : 1
  notebook.isTeam = notebook.memberCount > 1
  return notebook
}
