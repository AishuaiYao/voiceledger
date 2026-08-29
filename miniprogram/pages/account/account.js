var app = getApp()

Page({
  data: {
    drawerVisible: false,
    userInfo: null,
    showRegister: false,
    avatarUrl: '',
    nickName: '',
    submitting: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    navTotalHeight: 64
  },

  onLoad: function () {
    this.setData(app.getNavBarLayout())
  },

  onShow: function () {
    var userInfo = app.getUserInfo()
    this.setData({ userInfo: userInfo })

    // 历史数据可能存过本地临时路径头像（wxfile://、http://tmp），跨设备已失效，提示重新设置
    if (userInfo && userInfo.avatarUrl && userInfo.avatarUrl.indexOf('cloud://') !== 0) {
      wx.showToast({ title: '头像已失效，请重新设置', icon: 'none' })
    }

    // 未登录且未显示注册表单时，自动弹窗
    if (!userInfo && !this.data.showRegister) {
      var that = this
      setTimeout(function () {
        that.setData({ showRegister: true })
      }, 400)
    }
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
    if (path === '/pages/account/account') return
    wx.redirectTo({ url: path })
  },

  // ========== 登录注册 ==========

  showLoginPopup: function () {
    this.setData({ showRegister: true })
  },

  closeRegister: function () {
    this.setData({ showRegister: false })
  },

  onChooseAvatar: function (e) {
    console.log('[account] chooseAvatar:', e.detail.avatarUrl)
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNicknameInput: function (e) {
    this.setData({ nickName: e.detail.value })
  },

  handleRegister: function () {
    var that = this
    var nickName = this.data.nickName
    var avatarUrl = this.data.avatarUrl

    if (!nickName || !nickName.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    // 获取 OpenID
    wx.cloud.callFunction({
      name: 'getOpenId',
      success: function (res) {
        console.log('[account] getOpenId 返回:', res.result)
        if (!res.result || !res.result.openId) {
          wx.showToast({ title: '获取身份信息失败', icon: 'none' })
          that.setData({ submitting: false })
          return
        }

        var openId = res.result.openId

        // 创建或更新用户（存到云数据库 users 集合）
        var db = wx.cloud.database()
        // 头像如果是本地临时路径（wxfile://、http://tmp），必须先上传到云存储拿 fileID，
        // 否则跨设备/会话就失效，别人看博文时头像加载不出来
        if (avatarUrl && avatarUrl.indexOf('cloud://') !== 0) {
          that.uploadAvatar(openId, avatarUrl, function (fileID) {
            that.queryAndSaveUser(db, openId, nickName, fileID || '')
          })
        } else {
          that.queryAndSaveUser(db, openId, nickName, avatarUrl || '')
        }
      },

      fail: function (err) {
        console.error('[account] getOpenId 失败:', err)
        wx.showToast({ title: '获取身份信息失败', icon: 'none' })
        that.setData({ submitting: false })
      }
    })
  },

  // 上传头像到云存储，返回 cloud:// fileID，可跨设备长期有效
  uploadAvatar: function (openId, localPath, callback) {
    var ext = '.png'
    var dot = localPath.lastIndexOf('.')
    if (dot > -1) {
      var e = localPath.substring(dot).toLowerCase()
      if (e.indexOf('?') === -1 && e.length <= 5) ext = e
    }
    var cloudPath = 'avatars/' + openId + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + ext
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: localPath,
      success: function (res) {
        console.log('[account] 头像上传成功:', res.fileID)
        callback(res.fileID)
      },
      fail: function (err) {
        console.error('[account] 头像上传失败:', err)
        wx.showToast({ title: '头像上传失败，已用默认头像', icon: 'none' })
        callback('')
      }
    })
  },

      queryAndSaveUser: function (db, openId, nickName, avatarUrl) {
    var that = this
    db.collection('users').where({ openId: openId }).get({
      success: function (queryRes) {
        var userInfo = {
          openId: openId,
          nickName: nickName.trim(),
          avatarUrl: avatarUrl || ''
        }

        if (queryRes.data.length > 0) {
          // 已有记录，更新
          var userId = queryRes.data[0]._id
          // 记下旧头像 fileID，更新成功后删除，避免云存储积累孤儿头像
          var oldAvatarUrl = queryRes.data[0].avatarUrl || ''
          db.collection('users').doc(userId).update({
            data: {
              nickName: nickName.trim(),
              avatarUrl: avatarUrl || '',
              updatedAt: new Date()
            },
            success: function () {
              // 新头像已生效，清理旧头像（仅当旧的是 cloud:// 且确实换掉了）
              // 走云函数删除：前端 deleteFile 受"仅创建者可删"限制，跨登录身份不同会失败
              if (avatarUrl && oldAvatarUrl && oldAvatarUrl.indexOf('cloud://') === 0 && oldAvatarUrl !== avatarUrl) {
                wx.cloud.callFunction({
                  name: 'deleteFiles',
                  data: { fileList: [oldAvatarUrl] },
                  fail: function (err) {
                    console.error('[account] 删除旧头像失败:', err)
                  }
                })
              }
              userInfo._id = userId
              app.setUserInfo(userInfo)
              that.setData({
                userInfo: userInfo,
                showRegister: false,
                submitting: false,
                avatarUrl: '',
                nickName: ''
              })
              that.notifyLoginSuccess()
              wx.showToast({ title: '登录成功', icon: 'success' })
            },
            fail: function (err) {
              console.error('[account] 更新用户失败:', err)
              wx.showToast({ title: '登录失败', icon: 'none' })
              that.setData({ submitting: false })
            }
          })
        } else {
          // 新用户，创建
          db.collection('users').add({
            data: {
              openId: openId,
              nickName: nickName.trim(),
              avatarUrl: avatarUrl || '',
              createdAt: new Date()
            },
            success: function (addRes) {
              userInfo._id = addRes._id
              app.setUserInfo(userInfo)
              that.setData({
                userInfo: userInfo,
                showRegister: false,
                submitting: false,
                avatarUrl: '',
                nickName: ''
              })
              that.notifyLoginSuccess()
              wx.showToast({ title: '登录成功', icon: 'success' })
            },
            fail: function (err) {
              console.error('[account] 创建用户失败:', err)
              wx.showToast({ title: '登录失败', icon: 'none' })
              that.setData({ submitting: false })
            }
          })
        }
      },
      fail: function (err) {
        // 集合不存在时，add 会自动创建集合
        console.log('[account] 查询失败，尝试直接创建用户:', err.errCode || err.errMsg)
        var userInfo = {
          openId: openId,
          nickName: nickName.trim(),
          avatarUrl: avatarUrl || ''
        }
        db.collection('users').add({
          data: {
            openId: openId,
            nickName: nickName.trim(),
            avatarUrl: avatarUrl || '',
            createdAt: new Date()
          },
          success: function (addRes) {
            userInfo._id = addRes._id
            app.setUserInfo(userInfo)
            that.setData({
              userInfo: userInfo,
              showRegister: false,
              submitting: false,
              avatarUrl: '',
              nickName: ''
            })
            that.notifyLoginSuccess()
            wx.showToast({ title: '登录成功', icon: 'success' })
          },
          fail: function (err) {
            console.error('[account] 创建用户失败:', err)
            wx.showToast({ title: '登录失败', icon: 'none' })
            that.setData({ submitting: false })
          }
        })
      }
    })
  },

  // 登录成功后触发邀请流程回调，并自动恢复最近使用的账本
  notifyLoginSuccess: function () {
    // 有历史账本时自动选中最近使用的账本，新用户无账本则不设置（保持提示创建账本）
    app.ensureRecentNotebook()
    if (typeof app.globalData.onLoginSuccess === 'function') {
      var cb = app.globalData.onLoginSuccess
      app.globalData.onLoginSuccess = null
      setTimeout(function () { cb() }, 500)
    }
  },

  // 支持作者：点击逻辑待实现
  onSupportTap: function () {
    console.log('[account] 支持作者点击（逻辑待实现）')
  },

  // ========== 消息 ==========

  onMessageTap: function () {
    // TODO: 后续接入消息列表页，支持给用户发送消息
    wx.showToast({ title: '消息功能即将上线', icon: 'none' })
  },

  handleLogout: function () {
    var that = this
    wx.showModal({
      title: '退出登录',
      content: '退出后不会删除您的数据。确定退出吗？',
      confirmColor: '#fb7185',
      success: function (res) {
        if (res.confirm) {
          app.setUserInfo(null)
          that.setData({
            userInfo: null,
            showRegister: false,
            avatarUrl: '',
            nickName: ''
          })
          wx.showToast({ title: '已退出登录', icon: 'none' })
        }
      }
    })
  }
})
