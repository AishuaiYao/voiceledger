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

    // 分页加载状态
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: false,
    loadingMore: false
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
    var data = app.tagFilterData || {}
    var type = data.filterType || ''
    var value = data.filterValue || ''
    var title = type === 'date' ? value : (value ? '定位 · ' + value : '记录')

    this.setData({
      filterType: type,
      filterValue: value,
      title: title
    })

    wx.setNavigationBarTitle({ title: title })
    this.loadRecords(type, value)

    app.tagFilterData = null
  },

  loadRecords: function (type, value) {
    var that = this
    var userInfo = app.getUserInfo()
    if (!userInfo || !userInfo.openId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    var notebookId = app.getCurrentNotebookId()
    that.setData({ loading: true, records: [], page: 1, hasMore: false, loadingMore: false })
    wx.cloud.callFunction({
      name: 'teamRecords',
      data: {
        action: 'getRecords',
        notebookId: notebookId,
        page: 1,
        pageSize: that.data.pageSize,
        date: type === 'date' ? value : '',
        location: type === 'location' ? value : ''
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
        notebookId: app.getCurrentNotebookId(),
        page: nextPage,
        pageSize: that.data.pageSize,
        date: that.data.filterType === 'date' ? that.data.filterValue : '',
        location: that.data.filterType === 'location' ? that.data.filterValue : ''
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
    var pending = 0
    for (var i = 0; i < records.length; i++) {
      if (!records[i].imageFileID) continue
      pending++
      wx.cloud.getTempFileURL({
        fileList: [records[i].imageFileID],
        success: function (res) {
          if (res.fileList && res.fileList[0]) {
            for (var j = 0; j < records.length; j++) {
              if (records[j].imageFileID === res.fileList[0].fileID) {
                records[j].imageUrl = res.fileList[0].tempFileURL
              }
            }
          }
          pending--
          if (pending === 0) callback()
        },
        fail: function () {
          pending--
          if (pending === 0) callback()
        }
      })
    }
    if (pending === 0) callback()
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
      this.onAddImage({ currentTarget: { dataset: { id: id } } })
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

  // 当天记录菜单（三个点）：先弹菜单再确认，藏深一点防误删
  onDayMenuTap: function () {
    var that = this
    if (this.data.filterType !== 'date') return
    wx.showActionSheet({
      itemList: ['删除当天记录'],
      itemColor: '#e64340',
      success: function (res) {
        if (res.tapIndex === 0) that.onDeleteDay()
      },
      fail: function () {}
    })
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

  onShareAppMessage: function () {
    var title = this.data.title || '智能语音记账 · 记账明细'
    return { title: title, path: '/pages/records/records' }
  },

  onShareTimeline: function () {
    var title = this.data.title || '智能语音记账 · 记账明细'
    return { title: title }
  }
})
