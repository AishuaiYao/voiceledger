var app = getApp()

// 大类配色（与 index 页一致）
var CATEGORY_COLORS = {
  '餐饮': '#fda4af',
  '交通': '#7dd3fc',
  '购物': '#fcd34d',
  '服饰': '#f9a8d4',
  '娱乐': '#c4b5fd',
  '住房': '#86efac',
  '医疗': '#a5f3fc',
  '教育': '#ddd6fe',
  '生活': '#fdba74',
  '社交': '#fecaca',
  '旅行': '#bae6fd',
  '运动': '#bbf7d0',
  '其他支出': '#e2e8f0',
  '其他': '#e2e8f0'
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navTotalHeight: 64,
    drawerVisible: false,

    // 分类
    categories: [
      { key: 'all', name: '全部', icon: '📋' },
      { key: '餐饮', name: '餐饮', icon: '🍚' },
      { key: '交通', name: '交通', icon: '🚗' },
      { key: '购物', name: '购物', icon: '🛍️' },
      { key: '旅行', name: '旅行', icon: '✈️' },
      { key: '娱乐', name: '娱乐', icon: '🎮' },
      { key: '住房', name: '住房', icon: '🏠' },
      { key: '服饰', name: '服饰', icon: '👕' },
      { key: '医疗', name: '医疗', icon: '💊' },
      { key: '教育', name: '教育', icon: '📚' },
      { key: '生活', name: '生活', icon: '🧴' },
      { key: '社交', name: '社交', icon: '🎉' },
      { key: '运动', name: '运动', icon: '⚽' }
    ],
    activeCategory: 'all',

    // 排序
    sortOptions: [
      { key: 'comprehensive', name: '综合' },
      { key: 'hot', name: '最热' },
      { key: 'latest', name: '最新' }
    ],
    activeSort: 'comprehensive',

    // 博文列表
    posts: [],
    loadingPosts: false,

    // 发布博文弹窗
    showPublish: false,
    publishStep: 'select',        // select / edit
    notebooks: [],
    selectedNotebookId: '',
    generating: false,
    // 编辑态字段
    editTitle: '',
    editContent: '',
    editImages: [],               // fileID 数组
    editImageUrls: [],            // 临时 URL 用于展示
    editNotebookName: '',
    editTotalExpense: 0,
    editRecordCount: 0,
    editMainCategory: '其他',
    editCoverColor: '#e2e8f0',
    publishing: false,

    // 评论弹窗
    showComments: false,
    currentPostId: '',
    comments: [],
    commentInput: '',
    replyTo: null,                // { id, openId, name }
    loadingComments: false,
    filterAreaHeight: 108
  },

  onLoad: function () {
    var sysInfo = wx.getSystemInfoSync()
    this.setData(Object.assign(app.getNavBarLayout(), {
      filterAreaHeight: 216 * sysInfo.windowWidth / 750
    }))
  },

  onShow: function () {
    this.loadPosts()
  },

  // ========== 导航抽屉 ==========

  openDrawer: function () {
    this.setData({ drawerVisible: true })
  },

  closeDrawer: function () {
    this.setData({ drawerVisible: false })
  },

  onNavigate: function (e) {
    var path = e.detail.path
    if (path === '/pages/discover/discover') return
    wx.redirectTo({ url: path })
  },

  // ========== 博文列表 ==========

  loadPosts: function () {
    var that = this
    if (this.data.loadingPosts) return
    this.setData({ loadingPosts: true })

    wx.cloud.callFunction({
      name: 'posts',
      data: { action: 'getPosts', category: this.data.activeCategory, sort: this.data.activeSort },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          that.setData({ loadingPosts: false })
          return
        }
        var posts = result.posts || []
        // 解析图片 URL
        that.resolvePostImages(posts, function () {
          that.setData({ posts: posts, loadingPosts: false })
        })
      },
      fail: function (err) {
        console.error('[博文] 加载失败:', err)
        that.setData({ loadingPosts: false })
      }
    })
  },

  resolvePostImages: function (posts, callback) {
    var allFileIds = []
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].images && posts[i].images.length > 0) {
        allFileIds = allFileIds.concat(posts[i].images)
      }
    }
    if (allFileIds.length === 0) {
      callback()
      return
    }
    wx.cloud.getTempFileURL({
      fileList: allFileIds,
      success: function (res) {
        var urlMap = {}
        for (var i = 0; i < res.fileList.length; i++) {
          urlMap[res.fileList[i].fileID] = res.fileList[i].tempFileURL
        }
        for (var j = 0; j < posts.length; j++) {
          if (posts[j].images) {
            posts[j].imageUrls = posts[j].images.map(function (fid) {
              return urlMap[fid] || ''
            })
          }
        }
        callback()
      },
      fail: function () {
        callback()
      }
    })
  },

  onCategoryTap: function (e) {
    var key = e.currentTarget.dataset.key
    this.setData({ activeCategory: key })
    this.loadPosts()
  },

  onPostTap: function (e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/post-detail/post-detail?postId=' + id })
  },

  // 头像加载失败（fileID 失效等）时，回退显示昵称首字占位
  onAvatarError: function (e) {
    var index = e.currentTarget.dataset.index
    var patch = {}
    patch['posts[' + index + '].authorAvatarUrl'] = ''
    this.setData(patch)
  },

  onSortTap: function (e) {
    var key = e.currentTarget.dataset.key
    this.setData({ activeSort: key })
    this.loadPosts()
  },

  // ========== 转评赞 ==========

  onLikeTap: function (e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.cloud.callFunction({
      name: 'posts',
      data: { action: 'toggleLike', postId: id },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) return
        var posts = that.data.posts.map(function (p) {
          if (p._id === id) {
            p.liked = result.liked
            p.likeCount = result.likeCount
          }
          return p
        })
        that.setData({ posts: posts })
      }
    })
  },

  onShareTap: function (e) {
    var id = e.currentTarget.dataset.id
    wx.cloud.callFunction({
      name: 'posts',
      data: { action: 'incShare', postId: id }
    })
  },

  // 分享给好友
  onShareAppMessage: function (e) {
    var dataset = e.target && e.target.dataset
    if (dataset && dataset.id) {
      var post = this.data.posts.filter(function (p) { return p._id === dataset.id })[0]
      if (post) {
        return {
          title: post.title,
          path: '/pages/discover/discover?postId=' + post._id
        }
      }
    }
    return { title: '智能语音记账 · 发现', path: '/pages/discover/discover' }
  },

  onDeletePost: function (e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.showModal({
      title: '删除博文',
      content: '确定删除这篇博文？相关的点赞和评论也会被删除。',
      confirmColor: '#fb7185',
      success: function (res) {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'posts',
          data: { action: 'deletePost', postId: id },
          success: function (cfRes) {
            var result = cfRes.result
            if (!result || !result.success) {
              wx.showToast({ title: result ? result.error : '删除失败', icon: 'none' })
              return
            }
            // 删除云存储图片
            if (result.images && result.images.length > 0) {
              wx.cloud.deleteFile({ fileList: result.images })
            }
            var posts = that.data.posts.filter(function (p) { return p._id !== id })
            that.setData({ posts: posts })
            wx.showToast({ title: '已删除', icon: 'none' })
          }
        })
      }
    })
  },

  // ========== 评论（楼中楼） ==========

  onCommentTap: function (e) {
    var id = e.currentTarget.dataset.id
    this.setData({
      showComments: true,
      currentPostId: id,
      comments: [],
      commentInput: '',
      replyTo: null
    })
    this.loadComments(id)
  },

  closeComments: function () {
    this.setData({ showComments: false, currentPostId: '', comments: [], replyTo: null })
  },

  loadComments: function (postId) {
    var that = this
    this.setData({ loadingComments: true })
    wx.cloud.callFunction({
      name: 'posts',
      data: { action: 'getComments', postId: postId },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          that.setData({ loadingComments: false })
          return
        }
        that.setData({ comments: result.comments || [], loadingComments: false })
      },
      fail: function () {
        that.setData({ loadingComments: false })
      }
    })
  },

  onCommentInput: function (e) {
    this.setData({ commentInput: e.detail.value })
  },

  // 点击某条评论进行回复
  onReplyTap: function (e) {
    var id = e.currentTarget.dataset.id
    var openId = e.currentTarget.dataset.openid
    var name = e.currentTarget.dataset.name
    this.setData({
      replyTo: { id: id, openId: openId, name: name },
      commentInput: ''
    })
  },

  cancelReply: function () {
    this.setData({ replyTo: null, commentInput: '' })
  },

  onSendComment: function () {
    var content = (this.data.commentInput || '').trim()
    if (!content) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }

    var that = this
    var replyTo = this.data.replyTo
    wx.cloud.callFunction({
      name: 'posts',
      data: {
        action: 'addComment',
        postId: this.data.currentPostId,
        content: content,
        parentId: replyTo ? replyTo.id : '',
        replyToOpenId: replyTo ? replyTo.openId : '',
        replyToName: replyTo ? replyTo.name : ''
      },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) return
        that.loadComments(that.data.currentPostId)
        that.setData({ commentInput: '', replyTo: null })
        // 更新列表中的评论数
        var posts = that.data.posts.map(function (p) {
          if (p._id === that.data.currentPostId) {
            p.commentCount = (p.commentCount || 0) + 1
          }
          return p
        })
        that.setData({ posts: posts })
      }
    })
  },

  onDeleteComment: function (e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.showModal({
      title: '提示',
      content: '确定删除这条评论？',
      success: function (res) {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'posts',
          data: { action: 'deleteComment', commentId: id },
          success: function (cfRes) {
            var result = cfRes.result
            if (!result || !result.success) {
              wx.showToast({ title: result ? result.error : '删除失败', icon: 'none' })
              return
            }
            that.loadComments(that.data.currentPostId)
            var posts = that.data.posts.map(function (p) {
              if (p._id === that.data.currentPostId) {
                p.commentCount = Math.max(0, (p.commentCount || 0) - 1)
              }
              return p
            })
            that.setData({ posts: posts })
          }
        })
      }
    })
  },

  // ========== 发布博文 ==========

  showPublishPopup: function () {
    var userInfo = app.getUserInfo()
    if (!userInfo || !userInfo.openId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    this.setData({
      showPublish: true,
      publishStep: 'select',
      selectedNotebookId: '',
      editTitle: '',
      editContent: '',
      editImages: [],
      editImageUrls: []
    })
    this.loadNotebooksForPublish()
  },

  loadNotebooksForPublish: function () {
    var that = this
    wx.cloud.callFunction({
      name: 'team',
      data: { action: 'getNotebooks' },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) return
        var notebooks = result.notebooks || []
        that.setData({
          notebooks: notebooks,
          selectedNotebookId: notebooks.length > 0 ? notebooks[0]._id : ''
        })
      }
    })
  },

  onSelectNotebook: function (e) {
    this.setData({ selectedNotebookId: e.currentTarget.dataset.id })
  },

  // AI 生成博文
  onGenerate: function () {
    if (!this.data.selectedNotebookId) {
      wx.showToast({ title: '请先选择账本', icon: 'none' })
      return
    }
    this.setData({ generating: true })
    var that = this

    // 先拉取账本的全部记录
    wx.cloud.callFunction({
      name: 'teamRecords',
      data: { action: 'getRecords', notebookId: this.data.selectedNotebookId },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          that.setData({ generating: false })
          wx.showToast({ title: '获取记录失败', icon: 'none' })
          return
        }
        var records = result.records || []
        if (records.length === 0) {
          that.setData({ generating: false })
          wx.showToast({ title: '该账本暂无记录', icon: 'none' })
          return
        }
        // 调 HY3 生成博文
        that.generatePostByAI(records)
      },
      fail: function (err) {
        console.error('[博文] 获取记录失败:', err)
        that.setData({ generating: false })
        wx.showToast({ title: '获取记录失败', icon: 'none' })
      }
    })
  },

  generatePostByAI: function (records) {
    var that = this

    // 统计数据
    var totalExpense = 0
    var categoryMap = {}
    var imageFileIds = []
    for (var i = 0; i < records.length; i++) {
      if (records[i].type === 'expense') {
        totalExpense += Number(records[i].amount || 0)
        var cat = records[i].category || '其他'
        if (!categoryMap[cat]) categoryMap[cat] = 0
        categoryMap[cat] += Number(records[i].amount || 0)
      }
      if (records[i].imageFileID && imageFileIds.length < 9) {
        imageFileIds.push(records[i].imageFileID)
      }
    }

    // 找出主大类（支出最多的）
    var mainCategory = '其他'
    var maxAmount = 0
    for (var k in categoryMap) {
      if (categoryMap[k] > maxAmount) {
        maxAmount = categoryMap[k]
        mainCategory = k
      }
    }

    // 获取账本名
    var notebook = this.data.notebooks.filter(function (n) {
      return n._id === that.data.selectedNotebookId
    })[0]
    var notebookName = notebook ? notebook.name : ''

    // 拼接记录摘要给 AI
    var recordsSummary = records.map(function (r) {
      return r.time + ' | ' + (r.type === 'income' ? '收入' : '支出') + ' | ' +
        r.category + (r.subCategory ? '-' + r.subCategory : '') + ' | ¥' + r.amount +
        (r.description ? ' | ' + r.description : '') + (r.location ? ' | ' + r.location : '')
    }).join('\n')

    var currentTime = this.formatTime(new Date())

    try {
      var model = wx.cloud.extend.AI.createModel('cloudbase')
      var systemPrompt = '你是一个消费分析助手。用户会提供一段账本记录，请根据这些记录生成一篇消费分析博文。\n' +
        '当前时间：' + currentTime + '\n\n' +
        '请严格按照以下JSON格式回复，不要有任何额外文字：\n' +
        '{\n' +
        '  "title": "博文标题，简洁有吸引力",\n' +
        '  "content": "博文正文，200-500字，分析消费结构、趋势、特点，给出合理建议，用纯文本段落格式"\n' +
        '}\n\n' +
        '【要求】\n' +
        '1. 标题要有吸引力，体现账本特点。\n' +
        '2. 正文要分析消费结构（各类目占比）、消费趋势、亮点和可优化点。\n' +
        '3. 语气自然亲切，像和朋友分享消费复盘。\n' +
        '4. 不要罗列每条记录，要做归纳分析。\n' +
        '5. content 中可以用换行符分段。'

      var requestData = {
        model: 'hy3-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '账本名：' + notebookName + '\n总支出：¥' + totalExpense.toFixed(2) + '\n记录数：' + records.length + ' 笔\n\n明细：\n' + recordsSummary }
        ]
      }

      var answer = ''
      var timeoutFlag = true
      var timeoutTimer = setTimeout(function () {
        if (timeoutFlag) {
          that.setData({ generating: false })
          wx.showToast({ title: 'AI 响应超时', icon: 'none' })
        }
      }, 30000)

      ;(async function () {
        try {
          var res = await model.streamText({ data: requestData })
          timeoutFlag = false
          clearTimeout(timeoutTimer)

          for await (var chunk of res.textStream) {
            answer += chunk
          }

          // 解析 JSON（处理 AI 返回的未转义控制字符）
          console.log('[博文] AI 原始回答:', answer)
          var result = parseAIJson(answer)

          if (result) {
            // 解析图片 URL
            that.resolveEditImages(imageFileIds, function () {
              // content 里的 \n 转真实换行
              var content = (result.content || '').replace(/\\n/g, '\n')
              that.setData({
                generating: false,
                publishStep: 'edit',
                editTitle: result.title || '消费分析',
                editContent: content,
                editImages: imageFileIds,
                editNotebookName: notebookName,
                editTotalExpense: Math.round(totalExpense * 1000) / 1000,
                editRecordCount: records.length,
                editMainCategory: mainCategory,
                editCoverColor: CATEGORY_COLORS[mainCategory] || '#e2e8f0'
              })
            })
          } else {
            console.error('[博文] JSON 解析失败, 原文:', answer)
            that.setData({ generating: false })
            wx.showToast({ title: '生成失败，请重试', icon: 'none' })
          }
        } catch (err) {
          timeoutFlag = false
          clearTimeout(timeoutTimer)
          console.error('[博文] AI 生成失败:', err)
          that.setData({ generating: false })
          wx.showToast({ title: 'AI 生成失败', icon: 'none' })
        }
      })()
    } catch (e) {
      console.error('[博文] 异常:', e)
      this.setData({ generating: false })
      wx.showToast({ title: '生成失败', icon: 'none' })
    }
  },

  resolveEditImages: function (fileIds, callback) {
    if (fileIds.length === 0) {
      this.setData({ editImageUrls: [] })
      callback()
      return
    }
    var that = this
    wx.cloud.getTempFileURL({
      fileList: fileIds,
      success: function (res) {
        var urls = res.fileList.map(function (f) { return f.tempFileURL })
        that.setData({ editImageUrls: urls })
        callback()
      },
      fail: function () {
        that.setData({ editImageUrls: [] })
        callback()
      }
    })
  },

  // 编辑态操作
  onEditTitleInput: function (e) {
    this.setData({ editTitle: e.detail.value })
  },

  onEditContentInput: function (e) {
    this.setData({ editContent: e.detail.value })
  },

  onRemoveEditImage: function (e) {
    var index = e.currentTarget.dataset.index
    var images = this.data.editImages.slice()
    var urls = this.data.editImageUrls.slice()
    images.splice(index, 1)
    urls.splice(index, 1)
    this.setData({ editImages: images, editImageUrls: urls })
  },

  onPreviewEditImage: function (e) {
    var url = e.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: this.data.editImageUrls })
  },

  onPublish: function () {
    var title = (this.data.editTitle || '').trim()
    var content = (this.data.editContent || '').trim()
    if (!title) {
      wx.showToast({ title: '请输入标题', icon: 'none' })
      return
    }
    if (!content) {
      wx.showToast({ title: '请输入正文', icon: 'none' })
      return
    }

    var that = this
    this.setData({ publishing: true })

    wx.cloud.callFunction({
      name: 'posts',
      data: {
        action: 'createPost',
        notebookId: this.data.selectedNotebookId,
        notebookName: this.data.editNotebookName,
        title: title,
        content: content,
        images: this.data.editImages,
        totalExpense: this.data.editTotalExpense,
        recordCount: this.data.editRecordCount,
        mainCategory: this.data.editMainCategory,
        coverColor: this.data.editCoverColor
      },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          that.setData({ publishing: false })
          wx.showToast({ title: '发布失败', icon: 'none' })
          return
        }
        that.setData({
          publishing: false,
          showPublish: false,
          publishStep: 'select',
          editTitle: '',
          editContent: '',
          editImages: [],
          editImageUrls: []
        })
        wx.showToast({ title: '发布成功', icon: 'success' })
        that.loadPosts()
      },
      fail: function (err) {
        console.error('[博文] 发布失败:', err)
        that.setData({ publishing: false })
        wx.showToast({ title: '发布失败', icon: 'none' })
      }
    })
  },

  closePublish: function () {
    this.setData({
      showPublish: false,
      publishStep: 'select',
      generating: false,
      publishing: false,
      editTitle: '',
      editContent: '',
      editImages: [],
      editImageUrls: []
    })
  },

  onModalStop: function () {},

  formatTime: function (date) {
    var y = date.getFullYear()
    var m = (date.getMonth() + 1).toString().padStart(2, '0')
    var d = date.getDate().toString().padStart(2, '0')
    var h = date.getHours().toString().padStart(2, '0')
    var min = date.getMinutes().toString().padStart(2, '0')
    return y + '-' + m + '-' + d + ' ' + h + ':' + min
  }
})

// 解析 AI 返回的 JSON（处理控制字符、多个对象、嵌套大括号）
function parseAIJson(text) {
  if (!text) return null

  // 找到第一个 {
  var start = text.indexOf('{')
  if (start < 0) return null

  // 用括号匹配找到对应的 }
  var depth = 0
  var inString = false
  var escape = false
  var end = -1

  for (var i = start; i < text.length; i++) {
    var ch = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === '\\') {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  if (end < 0) return null

  var jsonStr = text.substring(start, end + 1)

  // 先尝试直接解析（AI 可能已返回合法 JSON，含字面 \n 转义序列）
  try {
    return JSON.parse(jsonStr)
  } catch (e) {
    // 直接解析失败，说明字符串值内部有未转义的真实控制字符（如换行）。
    // 注意：只能转义字符串值内部的控制字符，JSON 结构空白（缩进换行）必须保留，
    // 否则 {"\n  "title" 会被转成 {\ 开头，报 Expected property name
    var escaped = escapeControlCharsInStrings(jsonStr)
    try {
      return JSON.parse(escaped)
    } catch (e2) {
      console.error('[博文] JSON parse 最终失败:', e2, '| jsonStr:', jsonStr)
      return null
    }
  }
}

// 只转义字符串值内部的真实控制字符，保留 JSON 结构空白
function escapeControlCharsInStrings(s) {
  var result = ''
  var inString = false
  var escape = false
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i)
    if (escape) {
      result += ch
      escape = false
      continue
    }
    if (inString && ch === '\\') {
      result += ch
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (inString) {
      var code = ch.charCodeAt(0)
      if (code < 0x20) {
        if (ch === '\n') result += '\\n'
        else if (ch === '\r') result += '\\r'
        else if (ch === '\t') result += '\\t'
        else result += '\\u' + ('0000' + code.toString(16)).slice(-4)
        continue
      }
    }
    result += ch
  }
  return result
}
