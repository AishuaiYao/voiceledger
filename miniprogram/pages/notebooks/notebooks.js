var app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navTotalHeight: 64,
    drawerVisible: false,
    notebooks: [],
    currentNotebookId: '',
    // 创建弹窗
    showTypeSelect: false,
    showCreate: false,
    newName: '',
    newDesc: '',
    customIcon: '',
    creating: false,
    // 成员管理
    showMembers: false,
    memberNotebook: null,

    presetTypes: [
      { name: '日常开销', icon: '/images/notebook/日常开销.png', desc: '日常生活支出' },
      { name: '旅行账本', icon: '/images/notebook/旅行.png', desc: '旅途花销记录' },
      { name: '育儿账本', icon: '/images/notebook/育儿.png', desc: '孩子相关支出' },
      { name: '养宠账本', icon: '/images/notebook/养宠.png', desc: '宠物日常开销' },
      { name: '学习账本', icon: '/images/notebook/学习.png', desc: '学习培训费用' },
      { name: '装修账本', icon: '/images/notebook/装修.png', desc: '房屋装修支出' },
      { name: '婚礼账本', icon: '/images/notebook/结婚.png', desc: '结婚相关花销' },
      { name: '医疗健康', icon: '/images/notebook/医疗.png', desc: '看病保健支出' },
      { name: '聚餐账本', icon: '/images/notebook/团建聚餐.png', desc: '请客聚餐花销' }
    ]
  },

  onLoad: function () {
    this.setData(app.getNavBarLayout())
  },

  onShow: function () {
    this.loadNotebooks()
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
    if (path === '/pages/notebooks/notebooks') return
    wx.redirectTo({ url: path })
  },

  // ========== 账本数据 ==========

  loadNotebooks: function () {
    var that = this
    var userInfo = app.getUserInfo()
    if (!userInfo || !userInfo.openId) {
      // 未登录：提示并引导去「我的」页登录，避免停在创建账本页
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(function () {
        wx.navigateTo({ url: '/pages/account/account' })
      }, 800)
      return
    }

    wx.cloud.callFunction({
      name: 'team',
      data: { action: 'getNotebooks' },
      success: function (res) {
        var result = res.result
        if (!result || !result.success) {
          wx.showToast({ title: '加载失败', icon: 'none' })
          return
        }
        var notebooks = result.notebooks || []
        // 按最近使用/创建时间倒序排列，最近用的排前面
        notebooks.sort(function (a, b) {
          var ta = a.lastUsedAt || Date.parse(a.createdAt) || 0
          var tb = b.lastUsedAt || Date.parse(b.createdAt) || 0
          return tb - ta
        })
        for (var i = 0; i < notebooks.length; i++) {
          if (notebooks[i].createdAt) {
            notebooks[i].timeStr = that.formatTime(new Date(notebooks[i].createdAt))
          }
          notebooks[i].memberText = notebooks[i].memberCount + '人'
        }
        that.setData({
          notebooks: notebooks,
          currentNotebookId: app.getCurrentNotebookId()
        })
      },
      fail: function (err) {
        console.error('[账本] 查询失败:', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  // ========== 创建账本 ==========

  showCreatePopup: function () {
    this.setData({ showTypeSelect: true })
  },

  closeTypeSelect: function () {
    this.setData({ showTypeSelect: false })
  },

  onSelectType: function (e) {
    var name = e.currentTarget.dataset.name
    var icon = e.currentTarget.dataset.icon
    var desc = e.currentTarget.dataset.desc

    this.setData({
      showTypeSelect: false,
      newName: name,
      newDesc: desc
    })

    this.createNotebook(name, desc, icon)
  },

  showCustomInput: function () {
    this.setData({
      showTypeSelect: false,
      showCreate: true,
      newName: '',
      newDesc: '',
      customIcon: ''
    })
  },

  closeCreate: function () {
    this.setData({ showCreate: false, customIcon: '' })
  },

  onChooseIcon: function () {
    var that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        var tempPath = res.tempFiles[0].tempFilePath
        that.setData({ customIcon: tempPath })
      }
    })
  },

  onRemoveIcon: function () {
    this.setData({ customIcon: '' })
  },

  onNameInput: function (e) {
    this.setData({ newName: e.detail.value })
  },

  onDescInput: function (e) {
    this.setData({ newDesc: e.detail.value })
  },

  handleCreate: function () {
    var name = this.data.newName.trim()
    if (!name) {
      wx.showToast({ title: '请输入账本名称', icon: 'none' })
      return
    }

    this.setData({ creating: true })
    this.createNotebook(name, this.data.newDesc.trim(), this.data.customIcon)
  },

  createNotebook: function (name, desc, icon) {
    var that = this
    var userInfo = app.getUserInfo()
    if (!userInfo || !userInfo.openId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'createNotebook',
        name: name,
        description: desc,
        customIcon: icon || ''
      },
      success: function (res) {
        var result = res.result
        if (!result || !result.success) {
          wx.showToast({ title: '创建失败', icon: 'none' })
          that.setData({ creating: false })
          return
        }
        that.setData({ creating: false, showCreate: false, customIcon: '' })
        // 新建的账本自动设为当前账本
        if (result._id) {
          app.setCurrentNotebook(result._id, name)
          app.touchCurrentNotebook(result._id)
        }
        that.loadNotebooks()
        wx.showToast({ title: '创建成功', icon: 'success' })
      },
      fail: function (err) {
        console.error('[账本] 创建失败:', err)
        wx.showToast({ title: '创建失败', icon: 'none' })
        that.setData({ creating: false })
      }
    })
  },

  // ========== 选择账本 ==========

  selectNotebook: function (e) {
    var id = e.currentTarget.dataset.id
    var name = e.currentTarget.dataset.name

    app.setCurrentNotebook(id, name)
    this.setData({ currentNotebookId: id })
    // 记录该账本的使用时间，用于「最近使用」排序
    app.touchCurrentNotebook(id)

    wx.showToast({ title: '已切换到「' + name + '」', icon: 'none' })
  },

  // ========== 删除账本 ==========

  onDeleteNotebook: function (e) {
    var id = e.currentTarget.dataset.id
    var name = e.currentTarget.dataset.name
    var that = this

    wx.showModal({
      title: '删除账本',
      content: '删除「' + name + '」后，该账本下的记账记录也会被删除，确定删除吗？',
      confirmColor: '#fb7185',
      success: function (res) {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'team',
            data: { action: 'deleteNotebook', notebookId: id },
            success: function (cfRes) {
              var result = cfRes.result
              if (!result || !result.success) {
                wx.showToast({ title: result ? result.error : '删除失败', icon: 'none' })
                return
              }
              var notebooks = that.data.notebooks.filter(function (n) { return n._id !== id })
              that.setData({ notebooks: notebooks })
              // 同步清理本地最近使用记录，避免回主页误恢复已删除的账本
              app.removeRecentNotebook(id)

              if (that.data.currentNotebookId === id) {
                if (notebooks.length > 0) {
                  app.setCurrentNotebook(notebooks[0]._id, notebooks[0].name)
                  that.setData({ currentNotebookId: notebooks[0]._id })
                } else {
                  app.setCurrentNotebook('', '')
                  that.setData({ currentNotebookId: '' })
                }
              }
              wx.showToast({ title: '已删除', icon: 'none' })
            },
            fail: function (err) {
              console.error('[账本] 删除失败:', err)
              wx.showToast({ title: '删除失败', icon: 'none' })
            }
          })
        }
      }
    })
  },

  // ========== 成员管理 ==========

  onShowMembers: function (e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.cloud.callFunction({
      name: 'team',
      data: { action: 'getNotebookDetail', notebookId: id },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          wx.showToast({ title: result ? result.error : '加载失败', icon: 'none' })
          return
        }
        that.setData({ showMembers: true, memberNotebook: result.notebook })
      },
      fail: function (err) {
        console.error('[成员] 加载失败:', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  closeMembers: function () {
    this.setData({ showMembers: false, memberNotebook: null })
  },

  onRemoveMember: function (e) {
    var memberOpenId = e.currentTarget.dataset.openid
    var notebookId = this.data.memberNotebook._id
    var that = this

    wx.showModal({
      title: '移除成员',
      content: '确定移除该成员？',
      confirmColor: '#fb7185',
      success: function (res) {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'team',
          data: { action: 'removeMember', notebookId: notebookId, memberOpenId: memberOpenId },
          success: function (cfRes) {
            var result = cfRes.result
            if (!result || !result.success) {
              wx.showToast({ title: result ? result.error : '移除失败', icon: 'none' })
              return
            }
            var nb = that.data.memberNotebook
            nb.members = nb.members.filter(function (m) { return m.openId !== memberOpenId })
            nb.memberCount = nb.members.length
            nb.isTeam = nb.memberCount > 1
            that.setData({ memberNotebook: nb })
            that.loadNotebooks()
            wx.showToast({ title: '已移除', icon: 'none' })
          }
        })
      }
    })
  },

  // ========== 邀请分享 ==========

  onShareAppMessage: function (e) {
    var dataset = e.target && e.target.dataset
    var notebookId = dataset && dataset.id
    var name = dataset && dataset.name

    if (!notebookId) {
      return { title: '智能语音记账', path: '/pages/index/index' }
    }

    // 异步刷新邀请窗口（24h），不阻塞分享
    wx.cloud.callFunction({
      name: 'team',
      data: { action: 'createInvite', notebookId: notebookId }
    })

    return {
      title: '邀请你一起记账：' + (name || '组队账本'),
      path: '/pages/index/index?inviteNotebookId=' + notebookId
    }
  },

  formatTime: function (date) {
    var y = date.getFullYear()
    var m = (date.getMonth() + 1).toString().padStart(2, '0')
    var d = date.getDate().toString().padStart(2, '0')
    var h = date.getHours().toString().padStart(2, '0')
    var min = date.getMinutes().toString().padStart(2, '0')
    return y + '-' + m + '-' + d + ' ' + h + ':' + min
  }
})
