var app = getApp()

function round3(n) {
  return Math.round(n * 1000) / 1000
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

// 聚合统计：收入/支出/笔数/按月/按分类
function aggregateStats(records) {
  var totalIncome = 0
  var totalExpense = 0
  var incomeCount = 0
  var expenseCount = 0
  var monthMap = {}
  var categoryMap = {}
  for (var i = 0; i < records.length; i++) {
    var r = records[i]
    var amount = Number(r.amount || 0)
    var t = r.time || ''
    var monthKey = t.substring(0, 7)
    if (r.type === 'income') {
      totalIncome += amount
      incomeCount++
    } else {
      totalExpense += amount
      expenseCount++
      if (monthKey) monthMap[monthKey] = round3((monthMap[monthKey] || 0) + amount)
      var cat = r.category || '其他'
      categoryMap[cat] = round3((categoryMap[cat] || 0) + amount)
    }
  }
  return {
    totalIncome: round3(totalIncome),
    totalExpense: round3(totalExpense),
    incomeCount: incomeCount,
    expenseCount: expenseCount,
    monthMap: monthMap,
    categoryMap: categoryMap
  }
}

// 生成消费画像标签（本地统计得出）
function buildPortraitTags(stats) {
  var tags = []
  var catKeys = Object.keys(stats.categoryMap)
  if (catKeys.length) {
    var topCat = catKeys[0]
    var topAmt = stats.categoryMap[topCat]
    for (var i = 1; i < catKeys.length; i++) {
      if (stats.categoryMap[catKeys[i]] > topAmt) {
        topCat = catKeys[i]
        topAmt = stats.categoryMap[catKeys[i]]
      }
    }
    tags.push(topCat + '控')
  }
  var monthCount = Object.keys(stats.monthMap).length
  if (monthCount > 0 && stats.totalExpense > 0) {
    var monthAvg = stats.totalExpense / monthCount
    if (monthAvg < 500) tags.push('轻量消费')
    else if (monthAvg < 2000) tags.push('均衡日常型')
    else if (monthAvg < 8000) tags.push('品质生活型')
    else tags.push('高阶消费型')
  }
  if (stats.expenseCount > 0 && stats.totalExpense > 0) {
    var perAvg = stats.totalExpense / stats.expenseCount
    if (perAvg < 30) tags.push('小额高频')
    else if (perAvg > 300) tags.push('大额出手')
    else tags.push('理性消费')
  }
  return tags.slice(0, 4)
}

Page({
  data: {
    notebookName: '',
    portraitTitle: '',
    portraitDesc: '',
    avatarChar: '',
    portraitTags: [],
    totalExpense: 0,
    totalIncome: 0,
    monthAvg: 0,
    expenseCount: 0,
    incomeCount: 0,
    loading: false,
    sections: [],
    reportText: '',
    error: ''
  },

  onLoad: function () {
    var data = app.aiReportData || {}
    var records = data.records || []
    this._records = records
    this._notebookName = data.notebookName || ''

    var stats = aggregateStats(records)
    this._stats = stats

    if (!records.length) {
      this.setData({ error: '暂无记录可分析' })
      return
    }

    var monthCount = Math.max(1, Object.keys(stats.monthMap).length)
    var monthAvg = round2(stats.totalExpense / monthCount)
    var tags = buildPortraitTags(stats)
    var topCat = ''
    if (tags.length) topCat = tags[0].replace(/控$/, '')

    this.setData({
      notebookName: this._notebookName,
      portraitTitle: this._notebookName ? this._notebookName + ' · 消费画像' : '我的消费画像',
      portraitDesc: '共 ' + records.length + ' 笔记录' + (topCat ? ' · 主力分类「' + topCat + '」' : ''),
      avatarChar: this._notebookName ? this._notebookName.substring(0, 1) : '我',
      portraitTags: tags,
      totalExpense: stats.totalExpense,
      totalIncome: stats.totalIncome,
      monthAvg: monthAvg,
      expenseCount: stats.expenseCount,
      incomeCount: stats.incomeCount
    })
    this.generate()
  },

  generate: function () {
    var that = this
    if (this._running) return
    this._running = true
    this.setData({ loading: true, error: '', reportText: '', sections: [] })

    var records = this._records
    var stats = this._stats || aggregateStats(records)

    var monthKeys = Object.keys(stats.monthMap).sort()
    var monthSummary = monthKeys.map(function (m) {
      return m + ' 支出 ¥' + stats.monthMap[m]
    }).join('、')
    var catKeys = Object.keys(stats.categoryMap).sort(function (a, b) {
      return stats.categoryMap[b] - stats.categoryMap[a]
    })
    var categorySummary = catKeys.map(function (c) {
      return c + ' ¥' + stats.categoryMap[c]
    }).join('、')

    // ---- 明细抽样（最多 60 条，仅日期/分类/金额，省 token） ----
    var detailList = records.slice(0, 60).map(function (r) {
      return (r.time || '').substring(5) + ' ' + (r.type === 'income' ? '收' : '支') + ' ' +
        (r.category || '') + ' ¥' + r.amount
    }).join('；')

    var now = new Date()
    var currentTime = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())

    try {
      var model = wx.cloud.extend.AI.createModel('cloudbase')
      var systemPrompt = '你是消费数据分析师。基于提供的账本数据写约300字的消费分析报告：' +
        '1.消费偏好：主力分类、单笔习惯、大额或小额高频特点；' +
        '2.按月对比消费行为是否一致：金额增减、高峰低谷月、消费结构变化；' +
        '3.总结变化点并给出2-3条建议。' +
        '要求：用"1."开始分点输出，每点一个自然段；不要标题和客套话。'

      var requestData = {
        model: 'hy3-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: '账本：' + that._notebookName + '\n' +
              '总支出 ¥' + stats.totalExpense + '(' + stats.expenseCount + '笔)，总收入 ¥' + stats.totalIncome + '(' + stats.incomeCount + '笔)\n' +
              '按月支出：' + monthSummary + '\n' +
              '分类支出：' + categorySummary + '\n' +
              '明细抽样：' + detailList
          }
        ]
      }

      var answer = ''
      var retried = false

      var doRequest = function () {
        var timeoutFlag = true
        var timeoutTimer = setTimeout(function () {
          if (timeoutFlag) {
            that._running = false
            that.setData({ loading: false })
            wx.showToast({ title: 'AI 响应超时', icon: 'none' })
          }
        }, 60000)

        ;(async function () {
          try {
            var res = await model.streamText({ data: requestData })
            timeoutFlag = false
            clearTimeout(timeoutTimer)

            for await (var chunk of res.textStream) {
              answer += chunk
            }

            answer = answer.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
            that._running = false
            that.setData({
              loading: false,
              reportText: answer,
              sections: that.parseReport(answer)
            })
          } catch (err) {
            timeoutFlag = false
            clearTimeout(timeoutTimer)
            var errMsg = (err && (err.errMsg || err.message)) || ''
            var is429 = err && (err.statusCode === 429 || err.errCode === 429 || /429|too many requests/i.test(errMsg))
            if (is429 && !retried) {
              retried = true
              wx.showToast({ title: '请求繁忙，3秒后自动重试', icon: 'none' })
              setTimeout(doRequest, 3000)
              return
            }
            console.error('[AI分析报告] 错误:', err)
            that._running = false
            that.setData({ loading: false })
            wx.showToast({ title: is429 ? '请求过于频繁，请稍后再试' : 'AI 分析失败', icon: 'none' })
          }
        })()
      }

      doRequest()
    } catch (e) {
      console.error('[AI分析报告] 异常:', e)
      this._running = false
      this.setData({ loading: false })
      wx.showToast({ title: 'AI 分析失败', icon: 'none' })
    }
  },

  // 将报告文本按 "1." "2." 分点解析为结构化条目，便于排版
  parseReport: function (text) {
    var lines = text.split('\n')
    var sections = []
    var current = null
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim()
      if (!line) continue
      var m = line.match(/^(\d+)[\.、．]?\s*(.*)$/)
      if (m) {
        current = { no: m[1], text: m[2] }
        sections.push(current)
      } else if (current) {
        current.text += '\n' + line
      } else {
        sections.push({ no: '', text: line })
      }
    }
    // 兜底：没有识别出任何分点时，整段作为一个条目
    if (sections.length === 0 && text.trim()) {
      sections.push({ no: '', text: text.trim() })
    }
    return sections
  }
})
