const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function ensureCollections() {
  var names = ['records']
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

  if (action === 'getRecords') return getRecords(OPENID, event)
  if (action === 'getRecordsVersion') return getRecordsVersion(OPENID, event)
  if (action === 'addRecord') return addRecord(OPENID, event)
  if (action === 'updateRecord') return updateRecord(OPENID, event)
  if (action === 'deleteRecord') return deleteRecord(OPENID, event)
  if (action === 'deleteByDate') return deleteByDate(OPENID, event)
  if (action === 'deleteByMonth') return deleteByMonth(OPENID, event)
  if (action === 'updateImage') return updateImage(OPENID, event)

  return { success: false, error: '未知 action: ' + action }
}

async function getRecords(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (!isMember(nb, openId)) return { success: false, error: '无权访问' }

  var condition = { notebookId: event.notebookId }
  if (event.date && /^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    condition.time = _.gte(event.date + ' 00:00').and(_.lte(event.date + ' 23:59'))
  } else if (event.location) {
    condition.location = event.location
  }
  // 按成员筛选：只看指定成员创建的记录（不传/空串=全部成员），分页与统计共用该条件
  if (event.memberOpenId) {
    condition.openId = event.memberOpenId
  }

  // 显式传 page/pageSize 才分页；否则保持原行为一次拉全部（index/discover 依赖）
  var isPaged = event.page != null || event.pageSize != null
  var page = 1
  var pageSize = 500
  if (isPaged) {
    page = Math.max(1, Number(event.page) || 1)
    pageSize = Math.min(1000, Math.max(1, Number(event.pageSize) || 20))
  }

  var total = 0
  if (isPaged) {
    var countRes = await db.collection('records').where(condition).count()
    total = countRes.total
  }

  var res = null
  if (isPaged) {
    var q = db.collection('records').where(condition).orderBy('time', 'desc')
    q = q.skip((page - 1) * pageSize).limit(pageSize)
    res = await q.get()
  } else {
    // 首页等依赖全量数据的调用：循环拉取全部记录，避免单次 limit 截断导致统计缺失
    var all = []
    var batchSize = 1000
    var offset = 0
    var MAX_ALL = 20000
    while (true) {
      var batch = await db.collection('records')
        .where(condition)
        .orderBy('time', 'desc')
        .skip(offset)
        .limit(batchSize)
        .get()
      all = all.concat(batch.data)
      if (batch.data.length < batchSize) break
      offset += batchSize
      if (all.length >= MAX_ALL) break // 安全上限，防止异常数据导致死循环
    }
    res = { data: all }
  }

  var stats = null
  if (isPaged) {
    stats = await getRecordStats(condition)
  }

  return {
    success: true,
    recordsVersion: Number(nb.recordsVersion) || 0,
    records: res.data,
    total: total,
    page: page,
    pageSize: pageSize,
    hasMore: isPaged ? page * pageSize < total : false,
    stats: stats
  }
}

// 轻量版本查询：供前端轮询判断账本记录是否有变化，只返回版本号不拉数据
async function getRecordsVersion(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (!isMember(nb, openId)) return { success: false, error: '无权访问' }
  return { success: true, recordsVersion: Number(nb.recordsVersion) || 0 }
}

// 账本记录发生增/删/改后递增版本号，作为成员间同步的变更信号
async function bumpRecordsVersion(notebookId) {
  if (!notebookId) return
  try {
    await db.collection('notebooks').doc(notebookId).update({
      data: { recordsVersion: _.inc(1) }
    })
  } catch (e) {
    // 老账本文档可能还没有该字段，inc 失败时改为读取后直接赋值
    try {
      var docRes = await db.collection('notebooks').doc(notebookId).get()
      if (docRes.data) {
        await db.collection('notebooks').doc(notebookId).update({
          data: { recordsVersion: (Number(docRes.data.recordsVersion) || 0) + 1 }
        })
      }
    } catch (e2) {
      console.error('[版本] 账本记录版本递增失败:', e2)
    }
  }
}

// 按条件统计收支金额与条数（用于分页列表的全量汇总，避免分页导致统计不准）
async function getRecordStats(condition) {
  var $ = db.command.aggregate
  var aggRes = await db.collection('records').aggregate()
    .match(condition)
    .group({ _id: '$type', totalAmount: $.sum('$amount'), totalCount: $.sum(1) })
    .end()
  var stats = { expenseAmount: 0, incomeAmount: 0, expenseCount: 0, incomeCount: 0 }
  for (var i = 0; i < aggRes.list.length; i++) {
    var item = aggRes.list[i]
    if (item._id === 'expense') {
      stats.expenseAmount = item.totalAmount || 0
      stats.expenseCount = item.totalCount || 0
    } else if (item._id === 'income') {
      stats.incomeAmount = item.totalAmount || 0
      stats.incomeCount = item.totalCount || 0
    }
  }
  return stats
}

async function addRecord(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (!isMember(nb, openId)) return { success: false, error: '无权添加' }

  var user = await getUser(openId)
  var data = event.record
  data.openId = openId
  data.creatorNickName = user.nickName
  data.creatorAvatarUrl = user.avatarUrl
  data.notebookId = event.notebookId
  data.createdAt = db.serverDate()

  var res = await db.collection('records').add({ data: data })
  data._id = res._id
  await bumpRecordsVersion(event.notebookId)
  return { success: true, record: data }
}

async function updateRecord(openId, event) {
  var rec = await getRecordDoc(event.recordId)
  if (!rec) return { success: false, error: '记录不存在' }
  if (rec.openId !== openId) return { success: false, error: '只能修改自己的记录' }

  await db.collection('records').doc(event.recordId).update({ data: event.update })
  await bumpRecordsVersion(rec.notebookId)
  return { success: true }
}

async function deleteRecord(openId, event) {
  var rec = await getRecordDoc(event.recordId)
  if (!rec) return { success: false, error: '记录不存在' }
  if (rec.openId !== openId) return { success: false, error: '只能删除自己的记录' }

  await db.collection('records').doc(event.recordId).remove()
  return { success: true, imageFileID: rec.imageFileID || '' }
}

async function deleteByDate(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (!isMember(nb, openId)) return { success: false, error: '无权操作' }

  var date = event.date
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { success: false, error: '日期格式不正确' }
  }

  // 只删除该用户自己当天创建的记录（与单条删除权限一致）
  var condition = {
    notebookId: event.notebookId,
    openId: openId,
    time: _.gte(date + ' 00:00').and(_.lte(date + ' 23:59'))
  }

  // 先查出当天自己的记录，收集配图 fileID 用于清理
  var listRes = await db.collection('records').where(condition).field({ imageFileID: true }).limit(1000).get()
  var imageFileIDs = []
  for (var i = 0; i < listRes.data.length; i++) {
    if (listRes.data[i].imageFileID) imageFileIDs.push(listRes.data[i].imageFileID)
  }

  var delRes = await db.collection('records').where(condition).remove()
  await bumpRecordsVersion(event.notebookId)
  return { success: true, removed: delRes.stats.removed, imageFileIDs: imageFileIDs }
}

async function deleteByMonth(openId, event) {
  var nb = await getNotebookDoc(event.notebookId)
  if (!nb) return { success: false, error: '账本不存在' }
  if (!isMember(nb, openId)) return { success: false, error: '无权操作' }

  var month = event.month
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return { success: false, error: '月份格式不正确' }
  }

  // 计算当月最后一天，得到当月时间范围
  var parts = month.split('-')
  var lastDay = new Date(Number(parts[0]), Number(parts[1]), 0).getDate()
  var monthEnd = month + '-' + String(lastDay).padStart(2, '0') + ' 23:59'

  // 只删除该用户自己当月创建的记录（与单条删除权限一致）
  var condition = {
    notebookId: event.notebookId,
    openId: openId,
    time: _.gte(month + '-01 00:00').and(_.lte(monthEnd))
  }

  // 先查出当月的记录，收集配图 fileID 用于清理
  var listRes = await db.collection('records').where(condition).field({ imageFileID: true }).limit(1000).get()
  var imageFileIDs = []
  for (var i = 0; i < listRes.data.length; i++) {
    if (listRes.data[i].imageFileID) imageFileIDs.push(listRes.data[i].imageFileID)
  }

  var delRes = await db.collection('records').where(condition).remove()
  await bumpRecordsVersion(event.notebookId)
  return { success: true, removed: delRes.stats.removed, imageFileIDs: imageFileIDs }
}

async function updateImage(openId, event) {
  var rec = await getRecordDoc(event.recordId)
  if (!rec) return { success: false, error: '记录不存在' }
  if (rec.openId !== openId) return { success: false, error: '只能修改自己的记录' }

  await db.collection('records').doc(event.recordId).update({
    data: { imageFileID: event.imageFileID }
  })
  await bumpRecordsVersion(rec.notebookId)
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

async function getRecordDoc(recordId) {
  try {
    var res = await db.collection('records').doc(recordId).get()
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
