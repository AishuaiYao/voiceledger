var app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navTotalHeight: 64,
    postId: '',
    post: null,
    loading: true,
    // 评论
    comments: [],
    commentInput: '',
    replyTo: null,
    loadingComments: false,
    showCommentBar: false
  },

  onLoad: function (options) {
    this.setData(app.getNavBarLayout())
    if (options.postId) {
      this.setData({ postId: options.postId })
      this.loadPost(options.postId)
      this.loadComments(options.postId)
    }
  },

  // ========== 加载博文 ==========

  loadPost: function (postId) {
    var that = this
    wx.cloud.callFunction({
      name: 'posts',
      data: { action: 'getPost', postId: postId },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          that.setData({ loading: false })
          wx.showToast({ title: '博文不存在', icon: 'none' })
          return
        }
        var post = result.post
        // 把 content 字符串按换行拆成段落数组
        post.paragraphs = (post.content || '').split('\n')
        that.resolvePostImages(post, function () {
          that.setData({ post: post, loading: false })
        })
      },
      fail: function () {
        that.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  resolvePostImages: function (post, callback) {
    if (!post.images || post.images.length === 0) {
      post.imageUrls = []
      callback()
      return
    }
    wx.cloud.getTempFileURL({
      fileList: post.images,
      success: function (res) {
        post.imageUrls = res.fileList.map(function (f) { return f.tempFileURL })
        callback()
      },
      fail: function () {
        post.imageUrls = []
        callback()
      }
    })
  },

  // ========== 图片预览 ==========

  // 头像加载失败（fileID 失效等）时，回退显示昵称首字占位
  onAvatarError: function () {
    this.setData({ 'post.authorAvatarUrl': '' })
  },

  onPreviewImage: function (e) {
    var url = e.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: this.data.post.imageUrls })
  },

  // ========== 转评赞 ==========

  onLikeTap: function () {
    var post = this.data.post
    if (!post) return
    var that = this
    wx.cloud.callFunction({
      name: 'posts',
      data: { action: 'toggleLike', postId: post._id },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) return
        post.liked = result.liked
        post.likeCount = result.likeCount
        that.setData({ post: post })
      }
    })
  },

  onShareTap: function () {
    var post = this.data.post
    if (!post) return
    wx.cloud.callFunction({
      name: 'posts',
      data: { action: 'incShare', postId: post._id }
    })
  },

  onShareAppMessage: function () {
    var post = this.data.post
    if (!post) return { title: '智能语音记账 · 发现' }
    return {
      title: post.title,
      path: '/pages/post-detail/post-detail?postId=' + post._id
    }
  },

  // ========== 评论 ==========

  openCommentBar: function () {
    this.setData({ showCommentBar: true })
  },

  closeCommentBar: function () {
    this.setData({ showCommentBar: false, replyTo: null, commentInput: '' })
  },

  onCommentInput: function (e) {
    this.setData({ commentInput: e.detail.value })
  },

  onReplyTap: function (e) {
    var id = e.currentTarget.dataset.id
    var openId = e.currentTarget.dataset.openid
    var name = e.currentTarget.dataset.name
    this.setData({
      replyTo: { id: id, openId: openId, name: name },
      commentInput: '',
      showCommentBar: true
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
        postId: this.data.postId,
        content: content,
        parentId: replyTo ? replyTo.id : '',
        replyToOpenId: replyTo ? replyTo.openId : '',
        replyToName: replyTo ? replyTo.name : ''
      },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) return
        that.loadComments(that.data.postId)
        that.setData({ commentInput: '', replyTo: null, showCommentBar: false })
        var post = that.data.post
        post.commentCount = (post.commentCount || 0) + 1
        that.setData({ post: post })
      }
    })
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
            that.loadComments(that.data.postId)
            var post = that.data.post
            post.commentCount = Math.max(0, (post.commentCount || 0) - 1)
            that.setData({ post: post })
          }
        })
      }
    })
  },

  onBack: function () {
    wx.navigateBack({ delta: 1 })
  }
})
