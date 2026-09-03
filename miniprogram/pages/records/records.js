var app = getApp()

function round3(n) {
  return Math.round(n * 1000) / 1000
}

Page({
  data: {
    filterType: '',
    filterValue: '',
    title: '',
    loading: false,
    records: [],
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    recordCount: 0,
    expenseCount: 0,
    incomeCount: 0,
    recordEditVisible: false,
    recordEditId: '',
    recordEditType: 'expense',
    recordEditAmount: '',
    recordEditCategory: '',
    recordEditSubCategory: '',
    recordEditDescription: '',
    recordEditDate: '',
    recordEditTime: '',
    recordEditLocation: '',

    imagePreviewVisible: false,
    imagePreviewId: '',
    imagePreviewUrl: '',

    // 右上角「更多」菜单（分享 / 选择成员 / 按范围删除）与成员筛选弹层
    moreMenuVisible: false,
    memberSelectVisible: false,

    // 分页加载状态
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: false,
    loadingMore: false,

    // 组队模式：按成员筛选（默认全部成员）
    notebookIsTeam: false,
    memberOptions: [], // 成员下拉项 { openId, nickName }
    memberFilterOpenId: '',
    memberFilterIndex: 0, // picker 选中索引（0 = 全部成员）
    memberFilterLabel: '全部成员',

    // 分享只读浏览：从分享卡片进入他人账本时使用
    sharedView: false,       // 是否由分享链接进入
    shareNotebookId: '',     // 目标账本
    shareOwnerId: '',        // 分享者（账本成员，服务端授权凭证）
    viewerIsMember: true,    // 当前用户是否为账本成员（false 时只读）
    notebookName: '',
    notebookOwnerName: '',
    notebookOwnerAvatar: ''
  },

  categoryIcons: {
    '餐饮': '/images/classification/餐饮.png',
    '交通': '/images/classification/交通.png',
    '购物': '/images/classification/购物.png',
    '服饰': '/images/classification/服饰.png',
    '娱乐': '/images/classification/游戏.png',
    '住房': '/images/classification/住房.png',
    '医疗': '/images/classification/医疗.png',
    '教育': '/images/classification/教育.png',
    '生活': '/images/classification/生活.png',
    '社交': '/images/classification/社交.png',
    '旅行': '/images/classification/旅行.png',
    '运动': '/images/classification/运动.png',
    '其他支出': '/images/classification/支出的其他.png',
    '工资': '/images/classification/工资.png',
    '奖金': '/images/classification/奖金.png',
    '兼职': '/images/classification/兼职.png',
    '投资': '/images/classification/投资.png',
    '红包': '/images/classification/红包.png',
    '退款': '/images/classification/退款.png',
    '其他收入': '/images/classification/收入的其他.png'
  },

  onLoad: function (options) {
    options = options || {}
    var shareNotebookId = options.nid || ''
    var shareOwnerId = options.owner || ''

    if (shareNotebookId) {
      // 从分享卡片进入：直接浏览该账本（成员正常读写，非成员只读、免登录可看）
      var ft = options.ft || ''
      var fv = options.fv || ''
      try { fv = decodeURIComponent(fv) } catch (e) {}
      var title = shareOwnerId ? '正在加载分享账本...' : '记录'
      this.setData({
        sharedView: true,
        shareNotebookId: shareNotebookId,
        shareOwnerId: shareOwnerId,
        filterType: ft || '',
        filterValue: fv || '',
        memberFilterOpenId: '',
        memberFilterLabel: '全部成员',
        title: title,
        loading: true
      })
      wx.setNavigationBarTitle({ title: '分享账本' })
      // 分享只读视图固定展示「全部成员」范围；成员选项需成员接口，访客不加载
      this.loadRecords(ft || '', fv || '')
      return
    }

    var data = app.tagFilterData || {}
    var type = data.filterType || ''
    var value = data.filterValue || ''
    var title = this.formatRangeLabel(type, value)

    // 若从首页带着「成员筛选」进入（点查看全部/某条记录/某天日历），继承该选择
    this.setData({
      filterType: type,
      filterValue: value,
      title: title,
      memberFilterOpenId: data.memberOpenId || '',
      memberFilterLabel: data.memberLabel || '全部成员'
    })

    wx.setNavigationBarTitle({ title: title })
    this.loadRecords(type, value)

    app.tagFilterData = null

    // 加载账本成员用于筛选下拉（异步返回，期间默认显示全部成员）
    this.loadMemberOptions()
  },

  // date 支持某天（YYYY-MM-DD）与整月（YYYY-MM）两种范围，标题友好显示
  formatRangeLabel: function (type, value) {
    if (type === 'date' && value) {
      return value.length === 7 ? value.replace('-', '年') + '月' : value
    }
    if (type === 'location' && value) {
      return '定位 · ' + value
    }
    return '全部记录'
  },

  // 加载当前账本成员，构建筛选下拉；成员不在账本中时回落为「全部成员」
  loadMemberOptions: function () {
    var that = this
    if (this.data.sharedView) return // 分享只读视图不加载成员下拉
    var notebookId = app.getCurrentNotebookId()
    if (!notebookId) return
    wx.cloud.callFunction({
      name: 'team',
      data: { action: 'getNotebookDetail', notebookId: notebookId },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) return
        var nb = result.notebook || {}
        var members = nb.members || []
        // 下拉首项固定为「全部成员」，picker value 即 options 下标
        var options = [{ openId: '', nickName: '全部成员' }]
        for (var i = 0; i < members.length; i++) {
          options.push({
            openId: members[i].openId,
            nickName: members[i].nickName || '微信用户'
          })
        }

        var isTeam = !!nb.isTeam
        var targetOpenId = that.data.memberFilterOpenId
        var index = 0
        if (isTeam && targetOpenId) {
          var found = false
          for (var k = 1; k < options.length; k++) {
            if (options[k].openId === targetOpenId) {
              index = k
              found = true
              break
            }
          }
          if (!found) targetOpenId = '' // 传入的成员已不在账本
        }
        if (!isTeam) targetOpenId = ''
        var label = options[index] ? options[index].nickName : '全部成员'

        var needReload = targetOpenId !== that.data.memberFilterOpenId
        that.setData({
          notebookIsTeam: isTeam,
          memberOptions: options,
          memberFilterOpenId: targetOpenId,
          memberFilterIndex: index,
          memberFilterLabel: label
        })
        // 首页带入的成员选择已失效：按「全部成员」重新拉取第一页
        if (needReload) {
          that.loadRecords(that.data.filterType, that.data.filterValue)
        }
      },
      fail: function () {}
    })
  },

  // 成员下拉切换：重置分页并按所选成员重新加载（默认第一项=全部成员）
  onMemberFilterChange: function (e) {
    var index = Number(e.detail.value) || 0
    var options = this.data.memberOptions
    var opt = options[index]
    var openId = opt ? opt.openId : ''
    var label = opt ? opt.nickName : '全部成员'
    this.setData({
      memberFilterOpenId: openId,
      memberFilterIndex: index,
      memberFilterLabel: label
    })
    this.loadRecords(this.data.filterType, this.data.filterValue)
  },

  loadRecords: function (type, value) {
    var that = this
    // 分享卡片进入的访客可免登录浏览；普通入口仍要求登录
    var userInfo = app.getUserInfo()
    if (!this.data.sharedView && (!userInfo || !userInfo.openId)) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    var notebookId = this.data.shareNotebookId || app.getCurrentNotebookId()
    if (!notebookId) {
      wx.showToast({ title: '请先选择账本', icon: 'none' })
      return
    }
    that.setData({ loading: true, records: [], page: 1, hasMore: false, loadingMore: false })
    wx.cloud.callFunction({
      name: 'teamRecords',
      data: {
        action: 'getRecords',
        notebookId: notebookId,
        page: 1,
        pageSize: that.data.pageSize,
        date: type === 'date' ? value : '',
        location: type === 'location' ? value : '',
        memberOpenId: that.data.memberFilterOpenId,
        shareOpenId: that.data.shareOwnerId
      },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          wx.showToast({ title: result ? result.error : '加载失败', icon: 'none' })
          that.setData({ loading: false })
          return
        }
        var records = result.records || []
        var icons = that.categoryIcons
        for (var i = 0; i < records.length; i++) {
          records[i].categoryIcon = icons[records[i].category] || ''
        }
        that.resolveRecordImages(records, function () {
          var stats = result.stats || {}
          var incomeAmount = stats.incomeAmount || 0
          var expenseAmount = stats.expenseAmount || 0
          var info = result.notebookInfo || {}
          // 首载返回后确认查看者身份与账本概要：非成员为只读访客视图
          var viewerIsMember = result.viewerIsMember !== false
          var navTitle = that.data.title
          if (that.data.sharedView) {
            var rangeLabel = that.formatRangeLabel(that.data.filterType, that.data.filterValue)
            that.setData({
              viewerIsMember: viewerIsMember,
              notebookName: info.name || '',
              notebookOwnerName: info.ownerNickName || '',
              notebookOwnerAvatar: info.ownerAvatarUrl || ''
            })
            if (viewerIsMember) {
              navTitle = rangeLabel
            } else if (info.ownerNickName) {
              navTitle = info.ownerNickName + ' 的账本'
            }
            if (!viewerIsMember) {
              // 访客模式：无写入能力，也无需加载成员下拉
              that.setData({ notebookIsTeam: false })
            }
            that.setData({ title: navTitle })
            wx.setNavigationBarTitle({ title: navTitle })
          }
          that.setData({
            records: records,
            loading: false,
            page: result.page || 1,
            hasMore: !!result.hasMore,
            total: result.total || 0,
            totalIncome: round3(incomeAmount),
            totalExpense: round3(expenseAmount),
            balance: round3(incomeAmount - expenseAmount),
            recordCount: result.total || 0,
            incomeCount: stats.incomeCount || 0,
            expenseCount: stats.expenseCount || 0
          })
        })
      },
      fail: function (err) {
        console.error('[记录] 查询失败:', err)
        that.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  // 触底预加载下一页
  onLoadMore: function () {
    var that = this
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    var nextPage = this.data.page + 1
    that.setData({ loadingMore: true })
    wx.cloud.callFunction({
      name: 'teamRecords',
      data: {
        action: 'getRecords',
        notebookId: this.data.shareNotebookId || app.getCurrentNotebookId(),
        page: nextPage,
        pageSize: that.data.pageSize,
        date: that.data.filterType === 'date' ? that.data.filterValue : '',
        location: that.data.filterType === 'location' ? that.data.filterValue : '',
        memberOpenId: that.data.memberFilterOpenId,
        shareOpenId: that.data.shareOwnerId
      },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          wx.showToast({ title: result ? result.error : '加载失败', icon: 'none' })
          that.setData({ loadingMore: false })
          return
        }
        var newRecords = result.records || []
        var icons = that.categoryIcons
        for (var i = 0; i < newRecords.length; i++) {
          newRecords[i].categoryIcon = icons[newRecords[i].category] || ''
        }
        that.resolveRecordImages(newRecords, function () {
          that.setData({
            records: that.data.records.concat(newRecords),
            page: result.page || nextPage,
            hasMore: !!result.hasMore,
            total: result.total || that.data.total,
            loadingMore: false
          })
        })
      },
      fail: function (err) {
        console.error('[记录] 加载更多失败:', err)
        that.setData({ loadingMore: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  resolveRecordImages: function (records, callback) {
    var that = this
    var fileIDs = []
    for (var i = 0; i < records.length; i++) {
      if (records[i].imageFileID && fileIDs.indexOf(records[i].imageFileID) === -1) {
        fileIDs.push(records[i].imageFileID)
      }
    }
    if (fileIDs.length === 0) {
      callback()
      return
    }
    var apply = function (mapping) {
      for (var j = 0; j < records.length; j++) {
        if (records[j].imageFileID && mapping[records[j].imageFileID]) {
          records[j].imageUrl = mapping[records[j].imageFileID]
        }
      }
      callback()
    }
    // 非成员访客在云存储上无读权限，改由服务端换取临时链接
    if (this.data.sharedView && !this.data.viewerIsMember) {
      wx.cloud.callFunction({
        name: 'teamRecords',
        data: {
          action: 'getImageUrls',
          notebookId: that.data.shareNotebookId,
          shareOpenId: that.data.shareOwnerId,
          fileList: fileIDs
        },
        success: function (cfRes) {
          var result = cfRes.result
          var mapping = {}
          if (result && result.success && result.urls) {
            for (var i = 0; i < result.urls.length; i++) {
              mapping[result.urls[i].fileID] = result.urls[i].tempFileURL
            }
          }
          apply(mapping)
        },
        fail: function () { apply({}) }
      })
      return
    }
    wx.cloud.getTempFileURL({
      fileList: fileIDs,
      success: function (res) {
        var mapping = {}
        var list = res.fileList || []
        for (var i = 0; i < list.length; i++) {
          mapping[list[i].fileID] = list[i].tempFileURL
        }
        apply(mapping)
      },
      fail: function () { apply({}) }
    })
  },

  onAddImage: function (e) {
    var that = this
    var recordId = e.currentTarget.dataset.id
    var oldRecord = this.data.records.filter(function (record) { return record._id === recordId })[0]
    var oldImageFileID = oldRecord && oldRecord.imageFileID
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        wx.compressImage({
          src: res.tempFiles[0].tempFilePath,
          quality: 70,
          compressedWidth: 800,
          success: function (compressed) {
            var userInfo = app.getUserInfo()
            var cloudPath = 'images/' + userInfo.openId + '/' + recordId + '_' + Date.now() + '.jpg'
            wx.cloud.uploadFile({
              cloudPath: cloudPath,
              filePath: compressed.tempFilePath,
              success: function (uploadRes) {
                wx.cloud.callFunction({
                  name: 'teamRecords',
                  data: {
                    action: 'updateImage',
                    recordId: recordId,
                    imageFileID: uploadRes.fileID
                  },
                  success: function (cfRes) {
                    var cfResult = cfRes.result
                    if (!cfResult || !cfResult.success) {
                      wx.showToast({ title: cfResult ? cfResult.error : '图片保存失败', icon: 'none' })
                      return
                    }
                    wx.cloud.getTempFileURL({
                      fileList: [uploadRes.fileID],
                      success: function (urlRes) {
                        var url = urlRes.fileList[0].tempFileURL
                        var records = that.data.records.map(function (record) {
                          if (record._id === recordId) {
                            record.imageFileID = uploadRes.fileID
                            record.imageUrl = url
                          }
                          return record
                        })
                        that.setData({ records: records, imagePreviewVisible: false, imagePreviewUrl: url })
                        if (oldImageFileID && oldImageFileID !== uploadRes.fileID) {
                          wx.cloud.deleteFile({ fileList: [oldImageFileID] })
                        }
                        wx.showToast({ title: oldImageFileID ? '换图成功' : '配图成功', icon: 'success' })
                      }
                    })
                  },
                  fail: function () { wx.showToast({ title: '图片保存失败', icon: 'none' }) }
                })
              },
              fail: function () { wx.showToast({ title: '图片上传失败', icon: 'none' }) }
            })
          }
        })
      }
    })
  },

  onImageBtnTap: function (e) {
    var has = e.currentTarget.dataset.has
    var id = e.currentTarget.dataset.id
    var url = e.currentTarget.dataset.url
    if (!has) {
      if (this.data.viewerIsMember === false) return // 只读访客不能上传配图
      this.onAddImage({ currentTarget: { dataset: { id: id } } })
      return
    }
    if (!url) {
      wx.showToast({ title: '图片加载中或已失效', icon: 'none' })
      return
    }
    this.setData({ imagePreviewVisible: true, imagePreviewId: id, imagePreviewUrl: url })
  },

  closeImagePreview: function () {
    this.setData({ imagePreviewVisible: false })
  },

  onDeleteImage: function (e) {
    var that = this
    var recordId = e.currentTarget.dataset.id
    var oldRecord = this.data.records.filter(function (record) { return record._id === recordId })[0]
    var fileID = oldRecord && oldRecord.imageFileID
    if (!fileID) return

    wx.showModal({
      title: '提示',
      content: '确定删除这张配图？',
      success: function (res) {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'teamRecords',
          data: { action: 'updateImage', recordId: recordId, imageFileID: '' },
          success: function (cfRes) {
            var cfResult = cfRes.result
            if (!cfResult || !cfResult.success) {
              wx.showToast({ title: cfResult ? cfResult.error : '删除失败', icon: 'none' })
              return
            }
            wx.cloud.deleteFile({ fileList: [fileID] })
            var records = that.data.records.map(function (record) {
              if (record._id === recordId) {
                record.imageFileID = ''
                record.imageUrl = ''
              }
              return record
            })
            that.setData({ records: records, imagePreviewVisible: false })
            wx.showToast({ title: '已删除', icon: 'success' })
          },
          fail: function () { wx.showToast({ title: '删除失败', icon: 'none' }) }
        })
      }
    })
  },

  onPreviewImage: function (e) {
    wx.previewImage({ current: e.currentTarget.dataset.url, urls: [e.currentTarget.dataset.url] })
  },

  onModalStop: function () {},

  onEditRecord: function (e) {
    var id = e.currentTarget.dataset.id
    var record = this.data.records.filter(function (r) { return r._id === id })[0]
    if (!record) return
    var time = record.time || ''
    this.setData({
      recordEditVisible: true,
      recordEditId: id,
      recordEditType: record.type || 'expense',
      recordEditAmount: record.amount != null ? String(record.amount) : '',
      recordEditCategory: record.category || '',
      recordEditSubCategory: record.subCategory || '',
      recordEditDescription: record.description || '',
      recordEditDate: time.substring(0, 10),
      recordEditTime: time.substring(11, 16) || '12:00',
      recordEditLocation: record.location || ''
    })
  },

  onEditTypeChange: function (e) {
    this.setData({ recordEditType: e.currentTarget.dataset.type })
  },

  onEditAmountInput: function (e) {
    this.setData({ recordEditAmount: e.detail.value })
  },

  onEditCategoryInput: function (e) {
    this.setData({ recordEditCategory: e.detail.value })
  },

  onEditSubCategoryInput: function (e) {
    this.setData({ recordEditSubCategory: e.detail.value })
  },

  onEditDescriptionInput: function (e) {
    this.setData({ recordEditDescription: e.detail.value })
  },

  onEditDateChange: function (e) {
    this.setData({ recordEditDate: e.detail.value })
  },

  onEditTimeChange: function (e) {
    this.setData({ recordEditTime: e.detail.value })
  },

  onEditLocationInput: function (e) {
    this.setData({ recordEditLocation: e.detail.value })
  },

  closeRecordEdit: function () {
    this.setData({ recordEditVisible: false })
  },

  confirmRecordEdit: function () {
    var that = this
    var amount = Number(this.data.recordEditAmount)
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入正确金额', icon: 'none' })
      return
    }
    var category = this.data.recordEditCategory.trim()
    if (!category) {
      wx.showToast({ title: '请输入分类', icon: 'none' })
      return
    }
    var time = this.data.recordEditDate + ' ' + this.data.recordEditTime
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(time)) {
      wx.showToast({ title: '时间格式不正确', icon: 'none' })
      return
    }
    var id = this.data.recordEditId
    var update = {
      type: this.data.recordEditType,
      amount: Math.round(amount * 100) / 100,
      category: category,
      subCategory: this.data.recordEditSubCategory.trim(),
      description: this.data.recordEditDescription.trim(),
      time: time,
      location: this.data.recordEditLocation.trim()
    }

    wx.cloud.callFunction({
      name: 'teamRecords',
      data: { action: 'updateRecord', recordId: id, update: update },
      success: function (cfRes) {
        var cfResult = cfRes.result
        if (!cfResult || !cfResult.success) {
          wx.showToast({ title: cfResult ? cfResult.error : '更新失败', icon: 'none' })
          return
        }
        var oldRec = null
        var records = that.data.records.map(function (record) {
          if (record._id === id) {
            oldRec = { type: record.type, amount: record.amount }
            record.type = update.type
            record.amount = update.amount
            record.category = update.category
            record.subCategory = update.subCategory
            record.description = update.description
            record.time = update.time
            record.location = update.location
            record.categoryIcon = that.categoryIcons[update.category] || ''
          }
          return record
        })
        // 本地增量维护统计（分页下不能全量重算）
        var data = { records: records, recordEditVisible: false }
        if (oldRec) {
          var totalIncome = that.data.totalIncome
          var totalExpense = that.data.totalExpense
          var incomeCount = that.data.incomeCount
          var expenseCount = that.data.expenseCount
          if (oldRec.type === 'income') {
            totalIncome = round3(Math.max(0, totalIncome - oldRec.amount))
            incomeCount = Math.max(0, incomeCount - 1)
          } else {
            totalExpense = round3(Math.max(0, totalExpense - oldRec.amount))
            expenseCount = Math.max(0, expenseCount - 1)
          }
          if (update.type === 'income') {
            totalIncome = round3(totalIncome + update.amount)
            incomeCount++
          } else {
            totalExpense = round3(totalExpense + update.amount)
            expenseCount++
          }
          data.totalIncome = totalIncome
          data.totalExpense = totalExpense
          data.incomeCount = incomeCount
          data.expenseCount = expenseCount
          data.balance = round3(totalIncome - totalExpense)
        }
        that.setData(data)
        wx.showToast({ title: '已保存', icon: 'success' })
      },
      fail: function (err) {
        console.error('[记录] 编辑保存失败:', err)
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  },

  onDeleteRecord: function (e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.showModal({
      title: '提示',
      content: '确定删除这条记录？',
      success: function (res) {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'teamRecords',
            data: { action: 'deleteRecord', recordId: id },
            success: function (cfRes) {
              var cfResult = cfRes.result
              if (!cfResult || !cfResult.success) {
                wx.showToast({ title: cfResult ? cfResult.error : '删除失败', icon: 'none' })
                return
              }
              if (cfResult.imageFileID) wx.cloud.deleteFile({ fileList: [cfResult.imageFileID] })
              var removed = null
              var records = that.data.records.filter(function (r) {
                if (r._id === id) { removed = r; return false }
                return true
              })
              var data = { records: records }
              if (removed) {
                var newTotal = Math.max(0, that.data.total - 1)
                var totalIncome = that.data.totalIncome
                var totalExpense = that.data.totalExpense
                var incomeCount = that.data.incomeCount
                var expenseCount = that.data.expenseCount
                if (removed.type === 'income') {
                  totalIncome = round3(Math.max(0, totalIncome - removed.amount))
                  incomeCount = Math.max(0, incomeCount - 1)
                } else {
                  totalExpense = round3(Math.max(0, totalExpense - removed.amount))
                  expenseCount = Math.max(0, expenseCount - 1)
                }
                data.totalIncome = totalIncome
                data.totalExpense = totalExpense
                data.incomeCount = incomeCount
                data.expenseCount = expenseCount
                data.recordCount = newTotal
                data.total = newTotal
                data.balance = round3(totalIncome - totalExpense)
                data.hasMore = that.data.page * that.data.pageSize < newTotal
              }
              that.setData(data)
              wx.showToast({ title: '已删除', icon: 'none' })
            },
            fail: function (err) {
              console.error('[记录] 删除失败:', err)
              wx.showToast({ title: '删除失败', icon: 'none' })
            }
          })
        }
      }
    })
  },

  // ========== 右上角「更多」菜单 ==========

  // 打开菜单：分享 / 选择成员（组队）/ 删除当天·当月（按日期进入，防误删全部）
  onMoreMenuTap: function () {
    this.setData({ moreMenuVisible: true })
  },

  closeMoreMenu: function () {
    this.setData({ moreMenuVisible: false })
  },

  // 「选择成员」仅组队账本菜单里有：进入成员筛选弹层
  onOpenMemberSelect: function () {
    this.setData({ moreMenuVisible: false, memberSelectVisible: true })
  },

  closeMemberSelect: function () {
    this.setData({ memberSelectVisible: false })
  },

  // 成员筛选弹层点选：下标与 memberOptions 对齐（0 = 全部成员）
  onMemberSelectTap: function (e) {
    var index = Number(e.currentTarget.dataset.index) || 0
    this.setData({ memberSelectVisible: false })
    this.onMemberFilterChange({ detail: { value: index } })
  },

  // 菜单里删除当天/当月：仍走原有确认流程，仅按日期进入时出现
  onMoreDeleteTap: function () {
    this.setData({ moreMenuVisible: false })
    if (this.data.filterType !== 'date') return
    if (this.data.filterValue.length === 7) this.onDeleteMonthView() // YYYY-MM 整月视图
    else this.onDeleteDay()
  },

  // 删除当天自己创建的全部记录（需确认）
  onDeleteDay: function () {
    var that = this
    if (this.data.filterType !== 'date') return
    var date = this.data.filterValue
    var myOpenId = (app.getUserInfo() || {}).openId
    var allCount = this.data.records.length
    var myCount = 0
    for (var i = 0; i < this.data.records.length; i++) {
      if (this.data.records[i].openId === myOpenId) myCount++
    }
    if (myCount === 0) {
      wx.showToast({ title: '当天没有你的记录', icon: 'none' })
      return
    }

    wx.showModal({
      title: '删除当天记录',
      content: '确定删除 ' + date + ' 你创建的 ' + myCount + ' 条记录？当天共 ' + allCount + ' 条，此操作不可恢复！',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: function (res) {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'teamRecords',
          data: { action: 'deleteByDate', notebookId: app.getCurrentNotebookId(), date: date },
          success: function (cfRes) {
            var result = cfRes.result
            if (!result || !result.success) {
              wx.showToast({ title: result ? result.error : '删除失败', icon: 'none' })
              return
            }
            // 清理配图（走 deleteFiles 云函数，管理员权限，不受"仅创建者可删"限制）
            if (result.imageFileIDs && result.imageFileIDs.length > 0) {
              wx.cloud.callFunction({
                name: 'deleteFiles',
                data: { fileList: result.imageFileIDs },
                fail: function () {}
              })
            }
            wx.showToast({ title: '已删除 ' + result.removed + ' 条', icon: 'none' })
            // 删除整天后统计需要重算，重新加载首屏
            that.loadRecords(that.data.filterType, that.data.filterValue)
          },
          fail: function (err) {
            console.error('[记录] 删除当天记录失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        })
      }
    })
  },

  // 删除当月自己创建的全部记录（需确认；从整月明细进入，走 deleteByMonth）
  onDeleteMonthView: function () {
    var that = this
    if (this.data.filterType !== 'date') return
    var month = this.data.filterValue
    var myOpenId = (app.getUserInfo() || {}).openId
    var allCount = this.data.records.length
    var myCount = 0
    for (var i = 0; i < this.data.records.length; i++) {
      if (this.data.records[i].openId === myOpenId) myCount++
    }
    if (myCount === 0) {
      wx.showToast({ title: '当月没有你的记录', icon: 'none' })
      return
    }

    wx.showModal({
      title: '删除当月记录',
      content: '确定删除 ' + month.replace('-', '年') + '月 你创建的 ' + myCount + ' 条记录？当月共 ' + allCount + ' 条，此操作不可恢复！',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: function (res) {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'teamRecords',
          data: { action: 'deleteByMonth', notebookId: app.getCurrentNotebookId(), month: month },
          success: function (cfRes) {
            var result = cfRes.result
            if (!result || !result.success) {
              wx.showToast({ title: result ? result.error : '删除失败', icon: 'none' })
              return
            }
            // 清理配图（走 deleteFiles 云函数，管理员权限）
            if (result.imageFileIDs && result.imageFileIDs.length > 0) {
              wx.cloud.callFunction({
                name: 'deleteFiles',
                data: { fileList: result.imageFileIDs },
                fail: function () {}
              })
            }
            wx.showToast({ title: '已删除 ' + result.removed + ' 条', icon: 'none' })
            // 删除整月后统计需要重算，重新加载首屏
            that.loadRecords(that.data.filterType, that.data.filterValue)
          },
          fail: function (err) {
            console.error('[记录] 删除当月记录失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        })
      }
    })
  },

  recalcStats: function (records) {
    var totalIncome = 0
    var totalExpense = 0
    var incomeCount = 0
    var expenseCount = 0
    for (var i = 0; i < records.length; i++) {
      if (records[i].type === 'income') {
        totalIncome += records[i].amount
        incomeCount++
      } else {
        totalExpense += records[i].amount
        expenseCount++
      }
    }
    this.setData({
      totalIncome: round3(totalIncome),
      totalExpense: round3(totalExpense),
      balance: round3(totalIncome - totalExpense),
      recordCount: records.length,
      expenseCount: expenseCount,
      incomeCount: incomeCount
    })
  },

  // ========== 分享 ==========

  // 构造分享落地链接：账本 nid + 分享者 owner（服务端授权凭证）+ 可选日期范围
  buildShareQuery: function () {
    var notebookId = this.data.shareNotebookId || app.getCurrentNotebookId() || ''
    var userInfo = app.getUserInfo() || {}
    var ownerId = this.data.shareOwnerId || userInfo.openId || ''
    var q = 'nid=' + notebookId
    if (ownerId) q += '&owner=' + ownerId
    // 带上当前查看范围（整月 YYYY-MM / 某天 YYYY-MM-DD / 定位），所见即所得
    if (this.data.filterType && this.data.filterValue) {
      q += '&ft=' + this.data.filterType + '&fv=' + encodeURIComponent(this.data.filterValue)
    }
    return q
  },

  buildShareTitle: function () {
    var rangeLabel = this.formatRangeLabel(this.data.filterType, this.data.filterValue)
    var title = ''
    if (this.data.sharedView && !this.data.viewerIsMember) {
      // 访客转发分享卡片：仍以原账本成员(owner)授权，标题点明账本归属
      var owner = this.data.notebookOwnerName || '账本主人'
      var nbName = this.data.notebookName
      title = owner + ' 的' + (nbName ? '「' + nbName + '」账本' : '账本')
      if (rangeLabel && rangeLabel !== '全部记录') title += ' · ' + rangeLabel
    } else {
      var name = this.data.sharedView ? this.data.notebookName : (app.getCurrentNotebookName() || '')
      title = (name || '智能语音记账') + ' 记账明细'
      if (rangeLabel && rangeLabel !== '全部记录') title = (name || '智能语音记账') + ' · ' + rangeLabel
    }
    return title.length > 30 ? title.slice(0, 30) : title
  },

  onShareAppMessage: function () {
    // 从「更多」菜单里点分享后收起弹层
    if (this.data.moreMenuVisible || this.data.memberSelectVisible) {
      this.setData({ moreMenuVisible: false, memberSelectVisible: false })
    }
    return {
      title: this.buildShareTitle(),
      path: '/pages/records/records?' + this.buildShareQuery()
    }
  },

  onShareTimeline: function () {
    return {
      title: this.buildShareTitle(),
      query: this.buildShareQuery()
    }
  }
})
