const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function ensureCollections() {
  var names = ['posts', 'post_likes', 'post_comments']
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

  if (action === 'getPosts') return getPosts(OPENID, event)
  if (action === 'getPost') return getPost(OPENID, event)
  if (action === 'createPost') return createPost(OPENID, event)
  if (action === 'deletePost') return deletePost(OPENID, event)
  if (action === 'toggleLike') return toggleLike(OPENID, event)
  if (action === 'incShare') return incShare(OPENID, event)
  if (action === 'getComments') return getComments(event)
  if (action === 'addComment') return addComment(OPENID, event)
  if (action === 'deleteComment') return deleteComment(OPENID, event)

  return { success: false, error: '未知 action: ' + action }
}

// ========== 博文 CRUD ==========

async function getPosts(openId, event) {
  var query = {}
  if (event.category && event.category !== 'all') {
    query.mainCategory = event.category
  }

  var sort = event.sort || 'comprehensive'
  var orderField = 'createdAt'
  var orderDir = 'desc'

  if (sort === 'latest') {
    orderField = 'createdAt'
    orderDir = 'desc'
  } else if (sort === 'hot') {
    orderField = 'likeCount'
    orderDir = 'desc'
  }

  var res = await db.collection('posts')
    .where(query)
    .orderBy(orderField, orderDir)
    .limit(50)
    .get()

  var posts = res.data

  // 综合排序：按热度（点赞+评论+分享）降序，再按时间降序
  if (sort === 'comprehensive') {
    posts.sort(function (a, b) {
      var scoreA = (a.likeCount || 0) + (a.commentCount || 0) * 2 + (a.shareCount || 0) * 3
      var scoreB = (b.likeCount || 0) + (b.commentCount || 0) * 2 + (b.shareCount || 0) * 3
      if (scoreB !== scoreA) return scoreB - scoreA
      // 同分按时间降序
      return (b.createdAt || 0) - (a.createdAt || 0)
    })
  }

  // 查询当前用户对这批博文的点赞状态
  if (posts.length > 0) {
    var postIds = posts.map(function (p) { return p._id })
    var likeRes = await db.collection('post_likes')
      .where({ postId: _.in(postIds), openId: openId })
      .get()
    var likedSet = {}
    for (var i = 0; i < likeRes.data.length; i++) {
      likedSet[likeRes.data[i].postId] = true
    }
    for (var j = 0; j < posts.length; j++) {
      posts[j].liked = !!likedSet[posts[j]._id]
      posts[j].isOwner = posts[j].openId === openId
    }
  }
  return { success: true, posts: posts }
}

// 单篇博文详情
async function getPost(openId, event) {
  var post = null
  try {
    var postRes = await db.collection('posts').doc(event.postId).get()
    post = postRes.data
  } catch (e) {
    // 文档不存在会抛错
    post = null
  }
  if (!post) return { success: false, error: '博文不存在' }

  post.isOwner = post.openId === openId

  // 查询当前用户是否点赞
  var likeRes = await db.collection('post_likes')
    .where({ postId: event.postId, openId: openId })
    .limit(1)
    .get()
  post.liked = likeRes.data.length > 0

  return { success: true, post: post }
}

async function createPost(openId, event) {
  var user = await getUser(openId)
  var data = {
    openId: openId,
    authorNickName: user.nickName,
    authorAvatarUrl: user.avatarUrl || '',
    notebookId: event.notebookId,
    notebookName: event.notebookName || '',
    title: event.title,
    content: event.content,
    images: event.images || [],
    totalExpense: event.totalExpense || 0,
    recordCount: event.recordCount || 0,
    mainCategory: event.mainCategory || '其他',
    coverColor: event.coverColor || '#e2e8f0',
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    createdAt: db.serverDate()
  }
  var res = await db.collection('posts').add({ data: data })
  data._id = res._id
  data.isOwner = true
  data.liked = false
  return { success: true, post: data }
}

async function deletePost(openId, event) {
  var postRes = await db.collection('posts').doc(event.postId).get()
  var post = postRes.data
  if (!post) return { success: false, error: '博文不存在' }
  if (post.openId !== openId) return { success: false, error: '只能删除自己的博文' }

  await db.collection('posts').doc(event.postId).remove()
  // 删除关联的点赞和评论
  var likeRes = await db.collection('post_likes').where({ postId: event.postId }).limit(1000).get()
  for (var i = 0; i < likeRes.data.length; i++) {
    await db.collection('post_likes').doc(likeRes.data[i]._id).remove()
  }
  var commentRes = await db.collection('post_comments').where({ postId: event.postId }).limit(1000).get()
  for (var j = 0; j < commentRes.data.length; j++) {
    await db.collection('post_comments').doc(commentRes.data[j]._id).remove()
  }
  return { success: true, images: post.images || [] }
}

// ========== 点赞 ==========

async function toggleLike(openId, event) {
  var postId = event.postId
  var postRes = await db.collection('posts').doc(postId).get()
  var post = postRes.data
  if (!post) return { success: false, error: '博文不存在' }

  var existRes = await db.collection('post_likes')
    .where({ postId: postId, openId: openId })
    .limit(1)
    .get()

  if (existRes.data.length > 0) {
    // 已点赞，取消
    await db.collection('post_likes').doc(existRes.data[0]._id).remove()
    await db.collection('posts').doc(postId).update({
      data: { likeCount: _.inc(-1) }
    })
    return { success: true, liked: false, likeCount: post.likeCount - 1 }
  }

  // 未点赞，添加
  await db.collection('post_likes').add({
    data: { postId: postId, openId: openId, createdAt: db.serverDate() }
  })
  await db.collection('posts').doc(postId).update({
    data: { likeCount: _.inc(1) }
  })
  return { success: true, liked: true, likeCount: post.likeCount + 1 }
}

// ========== 分享计数 ==========

async function incShare(openId, event) {
  await db.collection('posts').doc(event.postId).update({
    data: { shareCount: _.inc(1) }
  })
  return { success: true }
}

// ========== 评论（楼中楼） ==========

async function getComments(event) {
  var res = await db.collection('post_comments')
    .where({ postId: event.postId })
    .orderBy('createdAt', 'asc')
    .limit(200)
    .get()

  var comments = res.data
  // 构建楼中楼结构
  var rootList = []
  var replyMap = {}
  for (var i = 0; i < comments.length; i++) {
    comments[i].replies = []
    if (comments[i].parentId) {
      if (!replyMap[comments[i].parentId]) replyMap[comments[i].parentId] = []
      replyMap[comments[i].parentId].push(comments[i])
    }
  }
  // 把回复挂到对应根评论下
  var commentMap = {}
  for (var j = 0; j < comments.length; j++) {
    commentMap[comments[j]._id] = comments[j]
  }
  for (var k = 0; k < comments.length; k++) {
    if (comments[k].parentId) {
      var parent = commentMap[comments[k].parentId]
      if (parent) parent.replies.push(comments[k])
    } else {
      rootList.push(comments[k])
    }
  }
  return { success: true, comments: rootList }
}

async function addComment(openId, event) {
  var user = await getUser(openId)
  var data = {
    postId: event.postId,
    openId: openId,
    nickName: user.nickName,
    avatarUrl: user.avatarUrl || '',
    content: event.content,
    parentId: event.parentId || '',
    replyToOpenId: event.replyToOpenId || '',
    replyToName: event.replyToName || '',
    createdAt: db.serverDate()
  }
  var res = await db.collection('post_comments').add({ data: data })
  data._id = res._id

  // 只在根评论时 +1（回复不计入 commentCount）
  if (!event.parentId) {
    await db.collection('posts').doc(event.postId).update({
      data: { commentCount: _.inc(1) }
    })
  }
  return { success: true, comment: data }
}

async function deleteComment(openId, event) {
  var commentRes = await db.collection('post_comments').doc(event.commentId).get()
  var comment = commentRes.data
  if (!comment) return { success: false, error: '评论不存在' }
  if (comment.openId !== openId) return { success: false, error: '只能删除自己的评论' }

  await db.collection('post_comments').doc(event.commentId).remove()
  // 删除该评论下的所有回复
  var replyRes = await db.collection('post_comments')
    .where({ parentId: event.commentId })
    .limit(100)
    .get()
  for (var i = 0; i < replyRes.data.length; i++) {
    await db.collection('post_comments').doc(replyRes.data[i]._id).remove()
  }

  // 只在根评论时 -1
  if (!comment.parentId) {
    await db.collection('posts').doc(comment.postId).update({
      data: { commentCount: _.inc(-1) }
    })
  }
  return { success: true }
}

// ========== 工具函数 ==========

async function getUser(openId) {
  var res = await db.collection('users').where({ openId: openId }).limit(1).get()
  if (res.data.length === 0) return { openId: openId, nickName: '微信用户', avatarUrl: '' }
  return res.data[0]
}
