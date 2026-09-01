var app = getApp()

function round3(n) {
  return Math.round(n * 1000) / 1000
}

// 首页数据本地缓存 key（按账本隔离），用于冷启动/重新进入时秒开
var HOME_CACHE_PREFIX = 'homeCache_'
function homeCacheKey(notebookId) {
  return HOME_CACHE_PREFIX + notebookId
}

Page({
  data: {
    // 导航栏
    statusBarHeight: 20,
    navBarHeight: 44,
    navTotalHeight: 64,
    drawerVisible: false,

    // 录音状态
    recording: false,
    loading: false,
    recordDuration: 0,
    recordStatusText: '正在录音...',
    loadingText: '正在识别语音...',
    queueCount: 0,
    slideCancel: false,

    // ASR 结果
    asrText: '',

    // 记账数据
    records: [],
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    dateRange: '',

    // 综合分析时间筛选
    analysisMonth: '',
    analysisLabel: '全部时间',
    calendarMonth: '',
    calendarLabel: '',
    calendarDays: [],
    dailyExpenseTotal: 0,
    monthlyHeat: [],

    // 饼状图数据
    pieData: [],

    // 分类统计
    categoryStats: [],
    activeTab: 'all', // all / expense / income
    filteredRecords: [],
    showAllBtn: false,
    allCount: 0,
    expenseCount: 0,
    incomeCount: 0,

    // 当前账本
    currentNotebookId: '',
    currentNotebookName: '',
    currentNotebookIcon: '',
    currentNotebookIsTeam: false,
    currentNotebookMemberCount: 0,
    hasNotebook: false,

    // 邀请加入流程
    inviteId: '',
    inviteInfo: null,
    showInviteConfirm: false,

    // 文本输入弹窗
    textInputVisible: false,
    textInputValue: '',

    // 编辑记录弹窗
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
    imagePreviewUrl: ''
  },

  // 录音管理器
  recorderManager: null,
  durationTimer: null,
  recordStartTime: 0,
  // 权限缓存
  recordAuthed: null,
  // 本地录音路径（本次）
  localAudioPath: '',
  audioContext: null,
  playingIndex: -1,
  // 语音/文本处理队列：录完一段即可入队，后台串行识别+分析，期间可继续录入
  voiceQueue: [],
  processing: false,

  onLoad: function (options) {
    // 初始化导航栏尺寸；综合分析默认展示全部时间（整个账本所有成员的消费情况）
    this.setData(Object.assign(app.getNavBarLayout(), {
      analysisMonth: '',
      analysisLabel: '全部时间',
      calendarMonth: '',
      calendarLabel: ''
    }))

    this.recorderManager = wx.getRecorderManager()
    var that = this

    this.recorderManager.onStart(function () {
      console.log('[录音] 开始录音')
    })

    this.recorderManager.onStop(function (res) {
      console.log('[录音] 结束, duration:', res.duration, 'ms, path:', res.tempFilePath)
      that.handleRecordEnd(res)
    })

    this.recorderManager.onError(function (err) {
      console.error('[录音] 错误:', err)
      if (that.durationTimer) {
        clearInterval(that.durationTimer)
        that.durationTimer = null
      }
      that.recorderManager.stop()
      that.setData({ recording: false })
      // 录音过短（<1s）属于误触，静默不提示
      var errDuration = Date.now() - that.recordStartTime
      if (errDuration >= 1000) {
        wx.showToast({ title: '录音失败', icon: 'none' })
      }
    })

    // 加载本地存储的记账记录
    this.loadRecords()

    // 预检查录音权限
    this.checkRecordAuth()

    // 处理分享落地邀请参数
    if (options && options.inviteNotebookId) {
      this.handleInvite(options.inviteNotebookId)
    }
  },

  onShow: function (options) {
    // 每次显示页面时刷新当前账本
    var that = this
    var notebookId = app.getCurrentNotebookId()
    var notebookName = app.getCurrentNotebookName()

    this.setData({
      currentNotebookId: notebookId,
      currentNotebookName: notebookName,
      hasNotebook: !!notebookId
    })

    // 加载当前账本图标
    if (notebookId) {
      this.loadNotebookIcon(notebookId)
      // 首次进入该账本（冷启动/重新进入/切换账本）用缓存秒开，否则直接后台刷新
      var firstForNotebook = this._loadedNotebookId !== notebookId
      this.loadRecords(firstForNotebook)
    } else {
      // 已登录但本地没有当前账本（如登录后首次回主页/缓存被清），
      // 尝试从云端自动恢复最近使用的账本；无账本时保持「创建账本」提示
      var userInfo = app.getUserInfo()
      if (userInfo && userInfo.openId) {
        app.ensureRecentNotebook(function (id) {
          if (id) {
            that.setData({
              currentNotebookId: id,
              currentNotebookName: app.getCurrentNotebookName(),
              hasNotebook: true
            })
            that.loadNotebookIcon(id)
            var firstForNb = that._loadedNotebookId !== id
            that.loadRecords(firstForNb)
          }
        })
      }
    }

    // 热启动时通过 options 处理邀请
    if (options && options.inviteNotebookId && !this.data.inviteId) {
      this.handleInvite(options.inviteNotebookId)
    }
  },

  // ========== 邀请加入流程 ==========

  handleInvite: function (notebookId) {
    this.setData({ inviteId: notebookId })
    var userInfo = app.getUserInfo()
    if (!userInfo || !userInfo.openId) {
      // 未登录，暂存 notebookId，跳转登录，登录后回来继续
      app.globalData.pendingInviteId = notebookId
      var that = this
      app.globalData.onLoginSuccess = function () {
        var pid = app.globalData.pendingInviteId
        if (pid) {
          app.globalData.pendingInviteId = ''
          that.handleInvite(pid)
        }
      }
      wx.navigateTo({ url: '/pages/account/account' })
      return
    }
    this.fetchInviteInfo(notebookId)
  },

  fetchInviteInfo: function (notebookId) {
    var that = this
    wx.cloud.callFunction({
      name: 'team',
      data: { action: 'getInviteInfo', notebookId: notebookId },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          wx.showToast({ title: result ? result.error : '邀请无效', icon: 'none' })
          that.setData({ inviteId: '' })
          return
        }
        if (result.invite.expired) {
          wx.showModal({
            title: '邀请已过期',
            content: '该邀请超过 24 小时未确认，请联系对方重新邀请',
            showCancel: false
          })
          that.setData({ inviteId: '' })
          return
        }
        that.setData({ inviteInfo: result.invite, showInviteConfirm: true })
      },
      fail: function (err) {
        console.error('[邀请] 查询失败:', err)
        wx.showToast({ title: '邀请查询失败', icon: 'none' })
        that.setData({ inviteId: '' })
      }
    })
  },

  confirmJoin: function () {
    var that = this
    var notebookId = this.data.inviteId
    wx.cloud.callFunction({
      name: 'team',
      data: { action: 'joinNotebook', notebookId: notebookId },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result) {
          wx.showToast({ title: '加入失败', icon: 'none' })
          return
        }
        // 已是成员也算成功切换
        if (!result.success && result.error !== 'already_joined') {
          wx.showToast({ title: result.error || '加入失败', icon: 'none' })
          return
        }
        var nb = result.notebook
        app.setCurrentNotebook(nb._id, nb.name)
        that.setData({
          showInviteConfirm: false,
          inviteId: '',
          inviteInfo: null,
          currentNotebookId: nb._id,
          currentNotebookName: nb.name,
          hasNotebook: true
        })
        wx.showToast({ title: '已加入账本', icon: 'success' })
        that.loadNotebookIcon(nb._id)
        that.loadRecords()
      },
      fail: function (err) {
        console.error('[邀请] 加入失败:', err)
        wx.showToast({ title: '加入失败', icon: 'none' })
      }
    })
  },

  cancelJoin: function () {
    this.setData({ showInviteConfirm: false, inviteId: '', inviteInfo: null })
  },

  loadNotebookIcon: function (notebookId) {
    var that = this
    wx.cloud.callFunction({
      name: 'team',
      data: { action: 'getNotebookDetail', notebookId: notebookId },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          that.setData({ currentNotebookIcon: '', currentNotebookIsTeam: false })
          return
        }
        var nb = result.notebook
        that.setData({
          currentNotebookIcon: nb.customIcon || '',
          currentNotebookIsTeam: !!nb.isTeam,
          currentNotebookMemberCount: nb.memberCount || 1
        })
        that.writeHomeCache()
      },
      fail: function () {
        that.setData({ currentNotebookIcon: '', currentNotebookIsTeam: false })
      }
    })
  },

  checkRecordAuth: function () {
    var that = this
    wx.getSetting({
      success: function (res) {
        that.recordAuthed = !!res.authSetting['scope.record']
        console.log('[录音] 权限预检查:', that.recordAuthed)
      }
    })
  },

  // ========== 录音 ==========

  onRecordStart: function (e) {
    // 同一时间只能录一段（录音管理器限制），但处理中的语音不阻塞新录音，可排队
    if (this.data.recording) return

    // 记录触摸起点，用于左右滑动取消
    this.touchStartX = (e && e.touches && e.touches[0]) ? e.touches[0].clientX : 0

    // 检查是否已有账本
    if (!this.data.currentNotebookId) {
      wx.showModal({
        title: '请先创建账本',
        content: '记账前需要先创建一个账本，是否现在创建？',
        confirmText: '去创建',
        confirmColor: '#38bdf8',
        success: function (res) {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/notebooks/notebooks' })
          }
        }
      })
      return
    }

    // 已授权，直接开始录音（零延迟）
    if (this.recordAuthed === true) {
      this.startRecording()
      return
    }

    // 权限未知或未授权，走异步检查
    var that = this
    wx.getSetting({
      success: function (res) {
        if (res.authSetting['scope.record']) {
          that.recordAuthed = true
          that.startRecording()
        } else {
          wx.authorize({
            scope: 'scope.record',
            success: function () {
              that.recordAuthed = true
              that.startRecording()
            },
            fail: function () {
              wx.showModal({
                title: '提示',
                content: '需要录音权限才能使用语音功能',
                confirmText: '去设置',
                success: function (res) {
                  if (res.confirm) wx.openSetting()
                }
              })
            }
          })
        }
      }
    })
  },

  startRecording: function () {
  this.setData({
    recording: true,
    recordDuration: 20,
    recordStatusText: '正在录音...',
    slideCancel: false
  })
  this.recordStartTime = Date.now()

  var that = this
  this.durationTimer = setInterval(function () {
    var elapsed = Math.floor((Date.now() - that.recordStartTime) / 1000)
    var remaining = 20 - elapsed
    if (remaining <= 0) {
      that.setData({ recordDuration: 0 })
      that.recorderManager.stop()
      return
    }
    that.setData({ recordDuration: remaining })
  }, 1000)

    this.recorderManager.start({
      duration: 20000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    })
  },

  onRecordEnd: function () {
    if (!this.data.recording) return

    // 左右滑出语音球：取消本次录音，不识别、不入队
    if (this.data.slideCancel) {
      this.pendingCancel = true
      if (this.durationTimer) {
        clearInterval(this.durationTimer)
        this.durationTimer = null
      }
      this.recorderManager.stop()
      this.setData({ recording: false, slideCancel: false })
      return
    }

    // 误触保护：录音时长过短（<1s），兜底 stop 释放资源后静默忽略
    var duration = Date.now() - this.recordStartTime
    if (duration < 1000) {
      if (this.durationTimer) {
        clearInterval(this.durationTimer)
        this.durationTimer = null
      }
      this.recorderManager.stop()
      this.setData({ recording: false })
      return
    }

    this.recorderManager.stop()
  },

  // 录音中监听手指滑动：横向滑出语音球一定距离即进入"取消"状态
  onRecordMove: function (e) {
    if (!this.data.recording) return
    var touch = e.touches && e.touches[0]
    if (!touch) return

    // 阈值 100px（约语音球半径），滑出球体边缘即触发取消
    var deltaX = touch.clientX - this.touchStartX
    var slide = Math.abs(deltaX) > 100
    if (slide !== this.data.slideCancel) {
      this.setData({ slideCancel: slide })
    }
  },

  handleRecordEnd: function (res) {
    if (this.durationTimer) {
      clearInterval(this.durationTimer)
      this.durationTimer = null
    }

    // 滑动取消：静默丢弃这段录音
    if (this.pendingCancel) {
      this.pendingCancel = false
      this.setData({ recording: false, slideCancel: false })
      wx.showToast({ title: '已取消录音', icon: 'none' })
      return
    }

    var duration = Date.now() - this.recordStartTime
    // 录音时长过短（<1s）：视为误触或无效输入，静默忽略，不提示、不调用识别
    if (duration < 1000) {
      this.setData({ recording: false })
      return
    }

    this.localAudioPath = res.tempFilePath
    this.setData({ recording: false })

    // 加入处理队列：上传→识别→AI 分析在后台串行执行，期间可继续录制下一条
    this.voiceQueue.push({ type: 'voice', tempFilePath: res.tempFilePath })
    this.syncQueueUI()
    this.processQueue()
  },

  // ========== 语音/文本处理队列 ==========

  // 把队列状态同步到界面
  syncQueueUI: function () {
    this.setData({
      loading: this.processing,
      queueCount: this.voiceQueue.length
    })
  },

  // 串行处理队列，每条任务完成后自动取下一条
  processQueue: function () {
    if (this.processing || this.voiceQueue.length === 0) return

    var that = this
    var task = this.voiceQueue.shift()
    this.processing = true
    this.syncQueueUI()

    // 当前任务结束（成功或失败）后，处理下一条
    var done = function () {
      that.processing = false
      that.syncQueueUI()
      that.processQueue()
    }

    if (task.type === 'text') {
      // 文本任务：直接走 AI 分析
      that.setData({ loadingText: 'AI 正在分析...' })
      that.callHY3(task.text, done)
      return
    }

    // 语音任务：上传云存储 → ASR 识别 → AI 分析
    that.setData({ loadingText: '正在识别语音...' })
    var cloudPath = 'audio/' + Date.now() + '_' + Math.floor(Math.random() * 100000) + '.mp3'
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: task.tempFilePath,
      success: function (uploadRes) {
        that.callASR(uploadRes.fileID, done)
      },
      fail: function (err) {
        console.error('[ASR] 上传录音失败:', err)
        wx.showToast({ title: '上传录音失败', icon: 'none' })
        done()
      }
    })
  },

  // ========== ASR ==========

  // 调用云端 asr 云函数识别，API Key 在云端环境变量中，前端不接触
  callASR: function (fileID, done) {
    var that = this

    wx.cloud.callFunction({
      name: 'asr',
      data: { fileID: fileID },
      success: function (res) {
        var result = res.result
        if (result && result.success && result.text) {
          var text = result.text
          console.log('[ASR] 识别结果:', text)
          that.setData({
            asrText: text,
            loadingText: 'AI 正在分析...'
          })
          that.callHY3(text, done)
        } else {
          console.error('[ASR] 识别失败:', result)
          wx.showToast({ title: (result && result.error) || '识别失败', icon: 'none' })
          done()
        }
      },
      fail: function (err) {
        console.error('[ASR] 云函数调用失败:', err)
        wx.showToast({ title: '识别失败，请重试', icon: 'none' })
        done()
      }
    })
  },

  // ========== 账本 AI 分析报告 ==========

  goToAIReport: function () {
    var records = this.data.records
    if (!records || records.length === 0) {
      wx.showToast({ title: '暂无记录可分析', icon: 'none' })
      return
    }
    // 用全局变量传数据（记录可能较多，避免 URL 长度限制）
    app.aiReportData = {
      records: records,
      notebookName: this.data.currentNotebookName || ''
    }
    wx.navigateTo({ url: '/pages/ai-report/ai-report' })
  },

  // ========== HY3 记账分析 ==========

  callHY3: function (text, done) {
    var that = this
    var answer = ''
    var currentTime = this.formatTime(new Date())

    try {
      var model = wx.cloud.extend.AI.createModel('cloudbase')

      var systemPrompt = '你是智能记账助手，将用户语音/文字收支描述提取为结构化数据。\n' +
        '当前时间：' + currentTime + '\n\n' +
        '只输出JSON，不要任何额外文字：\n' +
        '{"is_transaction":true/false,"type":"expense/income","amount":0,"category":"大类","sub_category":"细类","description":"简短描述","location":"地点,无则空串","transaction_time":"YYYY-MM-DD HH:mm,未提及则空串","reply":"给用户的简短回复"}\n\n' +
        '【多笔记录】一次描述多笔时，每笔输出一个JSON对象，用换行分隔，不要用数组包裹，transaction_time按各自相对时间计算。\n\n' +
        '【时间规则】\n' +
        '1. 提及时间必须换算为完整YYYY-MM-DD HH:mm（只有日期无时刻则用12:00）；\n' +
        '2. "今天/昨天/前天/上周五/上个月/周1/周2"等相对时间按当前时间计算，只有月日补当前年份，去年/前年按语义减年份；\n' +
        '3. 未提及时间则transaction_time返回空串，由程序使用当前时间。\n\n' +
        '【支出大类及细类】（每个细类全局唯一，只属于一个大类）\n' +
        '餐饮：堂食、外卖、快餐、零食、饮料、咖啡、聚餐、夜宵、早餐、午餐、晚餐、奶茶、甜品/烘焙、水果、生鲜食材、调味品、酒水、茶叶、预制菜、自热食品、保健品（食品类）\n' +
        '交通：打车、出租车、地铁、公交、共享单车、高铁、火车、飞机、停车费、加油、过路费、充电、网约车、拼车、代驾、轮渡/船票、长途客车、机场大巴、磁悬浮、景区交通、租车、车险、车辆保养、洗车、年检、ETC、违章罚款\n' +
        '购物：日用品、电子设备、数码配件、家居用品、厨房用具、化妆品、护肤品、洗护用品、清洁用品、纸品、收纳用品、灯具、床上用品、窗帘、地毯、绿植、礼品、盲盒/潮玩、二手商品\n' +
        '服饰：衣服、裤子、鞋子、包、帽子、配饰、首饰、内衣、袜子、围巾、手套、皮带、领带、丝巾、眼镜、墨镜、手表、运动服、睡衣、泳衣、定制服装\n' +
        '娱乐：电影、游戏、KTV、密室、演唱会、演出、游乐场、视频会员、音乐会员、话剧/音乐剧、脱口秀、相声、展览、博物馆/美术馆、剧本杀、桌游、酒吧、网吧/电竞、直播打赏、漫画/阅读会员、云盘会员、体育赛事\n' +
        '住房：房租、房贷、水电费、燃气费、物业费、宽带、装修、维修、中介费、押金、取暖费、有线电视、固话、保洁、搬家、除甲醛、杀虫、智能家居、家具、家电\n' +
        '医疗：门诊、药品、住院、体检、牙科、眼科、保健、挂号费、检查/化验费、手术费、理疗/针灸、中医、心理咨询、疫苗、救护车、医疗器械、康复、医美/整形、视力矫正\n' +
        '教育：学费、培训、书籍、课程、考试报名、教材/教辅、网课、语言学习、兴趣班、夏令营/游学、留学、论文/查重、打印/复印/扫描、文具\n' +
        '生活：理发、美容、洗浴、快递、洗衣、家政、宠物、话费、美甲/美睫、纹眉、SPA/按摩、足疗/采耳、脱毛、开锁/换锁、配钥匙、修鞋/改衣、干洗/熨烫、缝补、手机/电脑维修、家电维修、管道疏通、水电维修、废品回收\n' +
        '社交：红包、礼物、请客、份子钱、鲜花、贺卡、伴手礼、回礼、众筹、借款/还款、团建、生日/纪念日、节日、婚庆、丧葬、探望/慰问\n' +
        '旅行：酒店、机票、门票、纪念品、跟团、民宿/青旅、邮轮、签证/护照、旅行保险、行李托运、机场服务、导游/讲解、自驾、露营/户外、徒步、温泉\n' +
        '运动：健身、瑜伽、游泳、球类、装备、跑步、骑行、登山/徒步、滑雪/滑冰、滑板、冲浪/潜水、攀岩、拳击/格斗、舞蹈、普拉提、私教、团课、场地费、赛事报名、运动保险、运动康复\n' +
        '其他支出：无法归类的支出、手续费、利息、滞纳金、罚款、税费、保险、差价、补贴、报销、预存、会员费/年费、服务费、咨询费、律师费、公证费\n\n' +
        '【分类映射唯一性】\n' +
        '每个细类只属于上面清单中的一个大类，严格按清单匹配，禁止跨大类使用；例如酒店/民宿/青旅→旅行，房租/水电/物业/搬家→住房，鲜花→社交，文具→教育，借款/还款→社交，租车→交通；无法精确匹配时选语义最近的细类。\n\n' +
        '【收入大类及细类】\n' +
        '工资：基本工资、绩效、加班费\n' +
        '奖金：年终奖、项目奖、全勤奖\n' +
        '兼职：副业、自由职业、外包\n' +
        '投资：股票、基金、理财、利息、分红\n' +
        '红包：微信红包、转账、礼金\n' +
        '退款：退货退款、报销\n' +
        '其他收入：无法归类的收入\n\n' +
        '【示例】\n' +
        '用户："今天中午吃饭花了30块" → {"is_transaction":true,"type":"expense","amount":30,"category":"餐饮","sub_category":"午餐","description":"吃饭","transaction_time":"YYYY-MM-DD 12:00","reply":"已记：餐饮-午餐 30元"}\n' +
        '用户："工资到账8000" → {"is_transaction":true,"type":"income","amount":8000,"category":"工资","sub_category":"基本工资","description":"工资","reply":"已记：工资-基本工资 8000元"}\n' +
        '用户："股票赚了2000" → {"is_transaction":true,"type":"income","amount":2000,"category":"投资","sub_category":"股票","description":"股票收益","reply":"已记：投资-股票 2000元"}\n' +
        '用户："周1吃饭100住宿200" → 两笔：\n' +
        '{"is_transaction":true,"type":"expense","amount":100,"category":"餐饮","sub_category":"晚餐","description":"布尔津吃饭","location":"布尔津","transaction_time":"本周一12:00","reply":"已记：餐饮-晚餐 100元"}\n' +
        '{"is_transaction":true,"type":"expense","amount":200,"category":"旅行","sub_category":"酒店","description":"布尔津住宿","location":"布尔津","transaction_time":"本周一12:00","reply":"已记：旅行-酒店 200元"}\n' +
        '用户："你好" → {"is_transaction":false,"type":"","amount":0,"category":"","sub_category":"","description":"","reply":"你好，请告诉我你的收支情况"}\n\n' +
        '注意：amount必须是数字，不带单位。'

      var requestData = {
        model: 'hy3-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]
      }

      var timeoutFlag = true
      var timeoutTimer = setTimeout(function () {
        if (timeoutFlag) {
          wx.showToast({ title: 'AI 响应超时', icon: 'none' })
          done()
        }
      }, 20000)

      ;(async function () {
        try {
          var res = await model.streamText({ data: requestData })
          timeoutFlag = false
          clearTimeout(timeoutTimer)

          for await (var chunk of res.textStream) {
            answer += chunk
          }

          console.log('[HY3] 完成, 回答:', answer)
          that.handleAIReply(answer, done)
        } catch (err) {
          timeoutFlag = false
          clearTimeout(timeoutTimer)
          console.error('[HY3] 错误:', err)
          wx.showToast({ title: 'AI 分析失败', icon: 'none' })
          done()
        }
      })()
    } catch (e) {
      console.error('[HY3] 异常:', e)
      done()
    }
  },

  // ========== 解析 AI 回复，记账 ==========

  handleAIReply: function (answer, done) {
    // 提取所有 {...} 对象（支持一次返回多条记录）
    var reg = /\{[^{}]*\}/g
    var matches = answer.match(reg)
    if (!matches) {
      console.error('[记账] 未找到 JSON:', answer)
      if (done) done()
      return
    }

    var results = []
    for (var i = 0; i < matches.length; i++) {
      try {
        var obj = JSON.parse(matches[i])
        if (obj.is_transaction === true && obj.amount > 0) results.push(obj)
      } catch (e) {
        console.error('[记账] 单条解析失败:', e, '| 原文:', matches[i])
      }
    }

    if (results.length === 0) {
      wx.showToast({ title: '未识别到记账信息', icon: 'none' })
      if (done) done()
      return
    }

    var that2 = this
    var userInfo = app.getUserInfo()
    if (!userInfo || !userInfo.openId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      if (done) done()
      return
    }

    var nowTime = that2.formatTime(new Date())
    var timePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/

    // 逐条入库，全部回调结束后才算本任务完成
    var savedCount = 0
    var completedCount = 0
    for (var j = 0; j < results.length; j++) {
      ;(function (result, isLast) {
        var extractedTime = result.transaction_time || ''
        var recordTime = timePattern.test(extractedTime) ? extractedTime : nowTime
        var recordData = {
          type: result.type || 'expense',
          amount: round3(result.amount),
          category: result.category || '其他',
          subCategory: result.sub_category || '',
          description: result.description || '',
          location: result.location || '',
          time: recordTime,
          raw: that2.data.asrText
        }

        wx.cloud.callFunction({
          name: 'teamRecords',
          data: {
            action: 'addRecord',
            notebookId: that2.data.currentNotebookId,
            record: recordData
          },
          success: function (cfRes) {
            var cfResult = cfRes.result
            if (!cfResult || !cfResult.success) {
              // 账本不存在/已删除时给出明确提示
              if (isLast) wx.showToast({ title: '账本已删除，请选择新账本', icon: 'none' })
            } else {
              var saved = cfResult.record
              saved.categoryIcon = that2.categoryIcons[saved.category] || ''
              var records = [saved].concat(that2.data.records)
              that2.setData({ records: records })
              that2.updateStats(records)
              that2.filterRecords()
              that2.writeHomeCache()
              savedCount++
              if (isLast) {
                wx.showToast({ title: '已记 ' + savedCount + ' 条', icon: 'success' })
              }
            }
            completedCount++
            if (completedCount >= results.length && done) done()
          },
          fail: function (err) {
            console.error('[记账] 保存失败:', err)
            if (isLast) wx.showToast({ title: '部分保存失败', icon: 'none' })
            completedCount++
            if (completedCount >= results.length && done) done()
          }
        })
      })(results[j], j === results.length - 1)
    }
  },

  // ========== 记账数据管理 ==========

  // 读取本地缓存
  readHomeCache: function (notebookId) {
    try {
      return wx.getStorageSync(homeCacheKey(notebookId)) || null
    } catch (e) {
      return null
    }
  },

  // 将当前页面数据写入本地缓存（每次成功加载/增删改后调用，保证缓存是最新快照）
  writeHomeCache: function () {
    var notebookId = this.data.currentNotebookId
    if (!notebookId) return
    try {
      wx.setStorageSync(homeCacheKey(notebookId), {
        records: this.data.records,
        notebookIcon: this.data.currentNotebookIcon,
        notebookIsTeam: this.data.currentNotebookIsTeam,
        memberCount: this.data.currentNotebookMemberCount,
        cachedAt: Date.now()
      })
    } catch (e) {
      console.error('[缓存] 写入失败:', e)
    }
  },

  // 用本地缓存立即渲染，实现秒开
  renderFromCache: function (notebookId) {
    var cache = this.readHomeCache(notebookId)
    if (!cache || !cache.records) return
    var records = cache.records
    var icons = this.categoryIcons
    for (var i = 0; i < records.length; i++) {
      if (!records[i].categoryIcon) records[i].categoryIcon = icons[records[i].category] || ''
    }
    this.setData({
      records: records,
      currentNotebookIcon: cache.notebookIcon || '',
      currentNotebookIsTeam: !!cache.notebookIsTeam,
      currentNotebookMemberCount: cache.memberCount || 1
    })
    this.updateStats(records)
    this.filterRecords()
  },

  // useCache: true 时先用本地缓存秒开，再后台云函数刷新；false 时直接后台刷新
  loadRecords: function (useCache) {
    var that = this
    var notebookId = this.data.currentNotebookId
    var userInfo = app.getUserInfo()
    if (!userInfo || !userInfo.openId || !notebookId) return

    // 秒开：先渲染本地缓存
    if (useCache) {
      this.renderFromCache(notebookId)
    }

    wx.cloud.callFunction({
      name: 'teamRecords',
      data: { action: 'getRecords', notebookId: notebookId },
      success: function (cfRes) {
        var result = cfRes.result
        if (!result || !result.success) {
          console.error('[记录] 查询失败:', result ? result.error : 'no result')
          return
        }
        var records = result.records || []
        var icons = that.categoryIcons
        for (var i = 0; i < records.length; i++) {
          records[i].categoryIcon = icons[records[i].category] || ''
        }
        that.resolveRecordImages(records, function () {
          that._loadedNotebookId = notebookId
          that.setData({ records: records })
          that.updateStats(records)
          that.filterRecords()
          that.writeHomeCache()
        })
      },
      fail: function (err) {
        console.error('[记录] 查询失败:', err)
      }
    })
  },

  saveRecords: function () {
    // 云端模式下，单条记录在 handleAIReply 里直接 add，这里不再需要批量保存
  },

  updateStats: function (records) {
    // 收支概览：按整个账本（所有成员、所有时间）全量统计，与 dateRange 展示范围一致
    var totalIncome = 0
    var totalExpense = 0
    for (var i = 0; i < records.length; i++) {
      var r0 = records[i]
      if (r0.type === 'income') {
        totalIncome += Number(r0.amount || 0)
      } else {
        totalExpense += Number(r0.amount || 0)
      }
    }

    // 综合分析：按筛选时间范围（默认全部时间）统计分类
    var analysisRecords = records
    if (this.data.analysisMonth) {
      analysisRecords = records.filter(function (r) {
        return (r.time || '').substring(0, 7) === this.data.analysisMonth
      }, this)
    }

    var analysisExpense = 0
    var categoryMap = {}

    for (var j = 0; j < analysisRecords.length; j++) {
      var r = analysisRecords[j]
      if (r.type !== 'income') {
        analysisExpense += r.amount
      }

      // 按大类聚合
      var key = r.type + '_' + r.category
      if (!categoryMap[key]) {
        categoryMap[key] = {
          type: r.type,
          category: r.category,
          amount: 0,
          count: 0,
          subCategories: {}  // 细类明细
        }
      }
      categoryMap[key].amount += r.amount
      categoryMap[key].count++

      // 记录细类
      var subCat = r.subCategory || '其他'
      if (!categoryMap[key].subCategories[subCat]) {
        categoryMap[key].subCategories[subCat] = 0
      }
      categoryMap[key].subCategories[subCat] += r.amount
    }

    var categoryStats = []
    for (var k in categoryMap) {
      // 把 subCategories 对象转成数组方便展示
      var stat = categoryMap[k]
      stat.amount = round3(stat.amount)
      var subList = []
      for (var sk in stat.subCategories) {
        subList.push({ name: sk, amount: round3(stat.subCategories[sk]) })
      }
      subList.sort(function (a, b) { return b.amount - a.amount })
      stat.subList = subList
      categoryStats.push(stat)
    }
    // 按金额排序
    categoryStats.sort(function (a, b) { return b.amount - a.amount })

    // 计算时间范围
    var times = records.map(function (r) { return r.time || '' }).filter(function (t) { return t })
    times.sort()
    var dateRange = ''
    if (times.length > 0) {
      var start = times[0].substring(0, 10)
      var end = times[times.length - 1].substring(0, 10)
      dateRange = start === end ? start : start + ' ~ ' + end
    }

    this.setData({
      totalIncome: round3(totalIncome),
      totalExpense: round3(totalExpense),
      balance: round3(totalIncome - totalExpense),
      categoryStats: categoryStats,
      dateRange: dateRange
    })

    // 生成饼状图数据（只展示筛选范围内的支出分类，百分比按筛选范围支出计算）
    this.buildPieData(categoryStats, analysisExpense)
    this.updateCalendar(records)
  },

  onAnalysisMonthChange: function (e) {
    var month = e.detail.value
    this.setData({
      analysisMonth: month,
      analysisLabel: month.replace('-', '年') + '月',
      calendarMonth: month,
      calendarLabel: month.replace('-', '年') + '月'
    })
    this.updateStats(this.data.records)
  },

  clearAnalysisMonth: function () {
    this.setData({ analysisMonth: '', analysisLabel: '全部时间', calendarMonth: '', calendarLabel: '' })
    this.updateStats(this.data.records)
  },

  onCalendarMonthChange: function (e) {
    var month = e.detail.value
    this.setData({
      calendarMonth: month,
      calendarLabel: month.replace('-', '年') + '月'
    })
    this.updateCalendar(this.data.records)
  },

  updateCalendar: function (records) {
    var month = this.data.analysisMonth || this.data.calendarMonth

    // 选择具体月份：展示该月每日热力图
    if (month) {
      var parts = month.split('-')
      var year = Number(parts[0])
      var monthIndex = Number(parts[1]) - 1
      var firstDay = new Date(year, monthIndex, 1).getDay()
      var daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
      var totals = {}
      var max = 0
      var dailyTotal = 0

      for (var i = 0; i < records.length; i++) {
        var record = records[i]
        if (record.type !== 'expense' || (record.time || '').substring(0, 7) !== month) continue
        var day = Number(record.time.substring(8, 10))
        totals[day] = round3((totals[day] || 0) + Number(record.amount || 0))
        dailyTotal += Number(record.amount || 0)
        if (totals[day] > max) max = totals[day]
      }

      var days = []
      for (var blank = 0; blank < firstDay; blank++) days.push({ empty: true })
      for (var date = 1; date <= daysInMonth; date++) {
        var amount = totals[date] || 0
        var level = amount > 0 ? Math.max(1, Math.ceil(amount / max * 4)) : 0
        days.push({ day: date, amount: amount, level: level, empty: false })
      }

      this.setData({ calendarDays: days, dailyExpenseTotal: round3(dailyTotal), monthlyHeat: [] })
      return
    }

    // 全部时间：展示 12 个月热力图
    var monthTotals = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    for (var j = 0; j < records.length; j++) {
      var r = records[j]
      if (r.type !== 'expense') continue
      var t = r.time || ''
      if (t.length < 7) continue
      var monthNum = Number(t.substring(5, 7))
      if (monthNum >= 1 && monthNum <= 12) {
        monthTotals[monthNum] += Number(r.amount || 0)
      }
    }

    var maxMonth = 0
    for (var k = 1; k <= 12; k++) {
      if (monthTotals[k] > maxMonth) maxMonth = monthTotals[k]
    }

    var monthlyHeat = []
    for (var m = 1; m <= 12; m++) {
      var monthAmount = round3(monthTotals[m])
      var monthLevel = monthAmount > 0 ? Math.max(1, Math.ceil(monthAmount / maxMonth * 4)) : 0
      monthlyHeat.push({ label: m + '月', amount: monthAmount, level: monthLevel })
    }

    this.setData({ calendarDays: [], dailyExpenseTotal: 0, monthlyHeat: monthlyHeat })
  },

  // 大类固定配色（马卡龙色系）
  categoryColors: {
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
    '工资': '#86efac',
    '奖金': '#7dd3fc',
    '兼职': '#fcd34d',
    '投资': '#c4b5fd',
    '红包': '#fda4af',
    '退款': '#a5f3fc',
    '其他收入': '#e2e8f0'
  },

  // 大类图标映射
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
  // 备用颜色
  fallbackColors: ['#fda4af', '#fcd34d', '#86efac', '#7dd3fc', '#c4b5fd', '#f9a8d4', '#fdba74', '#a5f3fc', '#ddd6fe', '#fecaca'],

  buildPieData: function (categoryStats, totalExpense) {
    var colorMap = this.categoryColors
    var fallback = this.fallbackColors
    var pieData = []
    var expenseStats = categoryStats.filter(function (s) { return s.type === 'expense' })

    for (var i = 0; i < expenseStats.length; i++) {
      var s = expenseStats[i]
      var percent = totalExpense > 0 ? Math.round((s.amount / totalExpense) * 100) : 0
      var color = colorMap[s.category] || fallback[i % fallback.length]

      // 构造细类描述
      var subText = ''
      if (s.subList && s.subList.length > 0) {
        var names = s.subList.map(function (sub) { return sub.name }).join('、')
        subText = ' (' + names + ')'
      }

      pieData.push({
        name: s.category,
        value: s.amount,
        percent: percent,
        color: color,
        subText: subText
      })
    }

    this.setData({ pieData: pieData })
    // 延迟绘制，等 canvas DOM 渲染完成
    var that = this
    setTimeout(function () {
      that.drawPieChart()
    }, 300)
  },

  drawPieChart: function () {
    var pieData = this.data.pieData
    if (!pieData || pieData.length === 0) {
      console.log('[饼图] 无数据，跳过绘制')
      return
    }

    console.log('[饼图] 开始绘制, 数据:', JSON.stringify(pieData))

    var query = wx.createSelectorQuery()
    query.select('#pieChart')
      .fields({ node: true, size: true })
      .exec(function (res) {
        console.log('[饼图] selectorQuery 结果:', JSON.stringify(res))

        if (!res || !res[0]) {
          console.error('[饼图] 未找到 canvas 节点，可能 DOM 未渲染')
          return
        }

        if (!res[0].node) {
          console.error('[饼图] canvas node 为空')
          return
        }

        if (!res[0].width || !res[0].height) {
          console.error('[饼图] canvas 尺寸为 0, width:', res[0].width, 'height:', res[0].height)
          return
        }

        var canvas = res[0].node
        var ctx = canvas.getContext('2d')
        var dpr = wx.getSystemInfoSync().pixelRatio
        canvas.width = res[0].width * dpr
        canvas.height = res[0].height * dpr
        ctx.scale(dpr, dpr)

        var width = res[0].width
        var height = res[0].height
        var cx = width / 2
        var cy = height / 2
        var radius = Math.min(width, height) / 2 - 8

        var total = 0
        for (var i = 0; i < pieData.length; i++) {
          total += pieData[i].value
        }
        if (total === 0) {
          console.error('[饼图] total 为 0')
          return
        }

        console.log('[饼图] canvas 尺寸:', width, 'x', height, '| radius:', radius, '| total:', total)

        var startAngle = -Math.PI / 2

        for (var j = 0; j < pieData.length; j++) {
          var item = pieData[j]
          var angle = (item.value / total) * Math.PI * 2

          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, radius, startAngle, startAngle + angle)
          ctx.closePath()
          ctx.fillStyle = item.color
          ctx.fill()

          startAngle += angle
        }

        // 中心圆（甜甜圈效果）
        ctx.beginPath()
        ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.fill()

        // 中心文字
        ctx.fillStyle = '#475569'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('支出', cx, cy - 8)
        ctx.font = 'bold 14px sans-serif'
        ctx.fillText('¥' + round3(total), cx, cy + 10)

        console.log('[饼图] 绘制完成')
      })
  },

  filterRecords: function () {
    var tab = this.data.activeTab
    var records = this.data.records
    var filtered = records

    if (tab === 'expense') {
      filtered = records.filter(function (r) { return r.type === 'expense' })
    } else if (tab === 'income') {
      filtered = records.filter(function (r) { return r.type === 'income' })
    }

    // 统计各类型数量
    var expenseCount = 0
    var incomeCount = 0
    for (var i = 0; i < records.length; i++) {
      if (records[i].type === 'income') incomeCount++
      else expenseCount++
    }

    // 主页列表最多展示 20 条（最近记录），超出时显示「查看全部」按钮
    this.setData({
      filteredRecords: filtered.slice(0, 20),
      showAllBtn: filtered.length > 20,
      allCount: records.length,
      expenseCount: expenseCount,
      incomeCount: incomeCount
    })
  },

  onTabChange: function (e) {
    var tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    this.filterRecords()
  },

  goToAllRecords: function () {
    app.tagFilterData = { filterType: '', filterValue: '' }
    wx.navigateTo({ url: '/pages/records/records' })
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
                        that.filterRecords()
                        that.writeHomeCache()
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
            that.filterRecords()
            that.writeHomeCache()
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
              var records = that.data.records.filter(function (r) { return r._id !== id })
              that.setData({ records: records })
              that.updateStats(records)
              that.filterRecords()
              that.writeHomeCache()
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

  formatTime: function (date) {
    var y = date.getFullYear()
    var m = (date.getMonth() + 1).toString().padStart(2, '0')
    var d = date.getDate().toString().padStart(2, '0')
    var h = date.getHours().toString().padStart(2, '0')
    var min = date.getMinutes().toString().padStart(2, '0')
    return y + '-' + m + '-' + d + ' ' + h + ':' + min
  },

  // ========== 语音播放 ==========

  onPlayAudio: function () {
    if (!this.localAudioPath) {
      wx.showToast({ title: '没有录音', icon: 'none' })
      return
    }

    var that = this
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
      this.setData({ playingIndex: -1 })
      return
    }

    this.audioContext = wx.createInnerAudioContext()
    this.audioContext.src = this.localAudioPath
    this.setData({ playingIndex: 0 })

    this.audioContext.onEnded(function () {
      that.setData({ playingIndex: -1 })
    })
    this.audioContext.onError(function () {
      that.setData({ playingIndex: -1 })
      wx.showToast({ title: '播放失败', icon: 'none' })
    })

    this.audioContext.play()
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
    if (path === '/pages/index/index') return
    wx.redirectTo({ url: path })
  },

  goToNotebooks: function () {
    // 未登录时先引导去「我的」页登录，而不是进入创建账本页
    var userInfo = app.getUserInfo()
    if (!userInfo || !userInfo.openId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      wx.navigateTo({ url: '/pages/account/account' })
      return
    }
    wx.navigateTo({ url: '/pages/notebooks/notebooks' })
  },

  // ========== 文本输入 ==========

  onTextInput: function () {
    if (this.data.recording) return
    this.setData({ textInputVisible: true, textInputValue: '' })
  },

  onTextInputChange: function (e) {
    this.setData({ textInputValue: e.detail.value })
  },

  onTextInputConfirm: function () {
    var text = (this.data.textInputValue || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }

    this.setData({
      textInputVisible: false,
      asrText: text
    })

    // 加入处理队列，与语音任务一起串行分析
    this.voiceQueue.push({ type: 'text', text: text })
    this.syncQueueUI()
    this.processQueue()
  },

  onTextInputCancel: function () {
    this.setData({ textInputVisible: false })
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
        var records = that.data.records.map(function (record) {
          if (record._id === id) {
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
        that.setData({ records: records, recordEditVisible: false })
        that.updateStats(records)
        that.filterRecords()
        that.writeHomeCache()
        wx.showToast({ title: '已保存', icon: 'success' })
      },
      fail: function (err) {
        console.error('[记录] 编辑保存失败:', err)
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  },

  onTagTap: function (e) {
    var type = e.currentTarget.dataset.type
    var value = e.currentTarget.dataset.value

    // 用全局变量传参，避免 URL 编码问题
    app.tagFilterData = {
      filterType: type === 'time' ? 'date' : 'location',
      filterValue: type === 'time' ? value.substring(0, 10) : value
    }

    wx.navigateTo({ url: '/pages/records/records' })
  },

  // 点击每日消费日历中的某一天，跳转到当天的记录页
  onCalendarDayTap: function (e) {
    var ds = e.currentTarget.dataset
    if (ds.empty) return
    if (!ds.amount || ds.amount <= 0) {
      wx.showToast({ title: '当天没有消费记录', icon: 'none' })
      return
    }
    var month = this.data.analysisMonth
    if (!month) return
    var day = Number(ds.day)
    var date = month + '-' + (day < 10 ? '0' + day : String(day))
    app.tagFilterData = { filterType: 'date', filterValue: date }
    wx.navigateTo({ url: '/pages/records/records' })
  },

  // 日历月份菜单（三个点）：先弹菜单再确认，隐藏删除入口防误删
  onCalendarMenuTap: function () {
    var that = this
    if (!this.data.analysisMonth) return
    wx.showActionSheet({
      itemList: ['删除当月记录'],
      itemColor: '#e64340',
      success: function (res) {
        if (res.tapIndex === 0) that.onDeleteMonth()
      },
      fail: function () {}
    })
  },

  // 删除当月自己创建的全部记录（需确认）
  onDeleteMonth: function () {
    var that = this
    var month = this.data.analysisMonth
    if (!month) return
    var myOpenId = (app.getUserInfo() || {}).openId
    var records = this.data.records || []
    var myCount = 0
    for (var i = 0; i < records.length; i++) {
      if (records[i].openId === myOpenId && (records[i].time || '').substring(0, 7) === month) myCount++
    }
    if (myCount === 0) {
      wx.showToast({ title: '当月没有你的记录', icon: 'none' })
      return
    }

    wx.showModal({
      title: '删除当月记录',
      content: '确定删除 ' + month.replace('-', '年') + '月 你创建的 ' + myCount + ' 条记录？此操作不可恢复！',
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
            // 清理配图（走 deleteFiles 云函数，管理员权限，不受"仅创建者可删"限制）
            if (result.imageFileIDs && result.imageFileIDs.length > 0) {
              wx.cloud.callFunction({
                name: 'deleteFiles',
                data: { fileList: result.imageFileIDs },
                fail: function () {}
              })
            }
            wx.showToast({ title: '已删除 ' + result.removed + ' 条', icon: 'none' })
            that.loadRecords()
          },
          fail: function (err) {
            console.error('[首页] 删除当月记录失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        })
      }
    })
  },

  // ========== 分享 ==========

  onShareAppMessage: function () {
    var name = this.data.currentNotebookName
    return {
      title: name ? '智能语音记账 · ' + name : '智能语音记账',
      path: '/pages/index/index'
    }
  },

  onShareTimeline: function () {
    var name = this.data.currentNotebookName
    return { title: name ? '智能语音记账 · ' + name : '智能语音记账' }
  }
})
