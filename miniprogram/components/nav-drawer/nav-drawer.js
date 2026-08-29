Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    currentPath: {
      type: String,
      value: ''
    }
  },

  data: {
    drawerHeaderPaddingTop: 40,
    menuItems: [
      { name: '主页', icon: '/images/主页.png', path: '/pages/index/index' },
      { name: '账本', icon: '/images/账本.png', path: '/pages/notebooks/notebooks' },
      { name: '发现', icon: '/images/发现.png', path: '/pages/discover/discover' },
      { name: '我', icon: '/images/我的.png', path: '/pages/account/account' }
    ]
  },

  lifetimes: {
    attached() {
      var app = getApp()
      var layout = app.getNavBarLayout ? app.getNavBarLayout() : {}
      var statusBarHeight = layout.statusBarHeight || 20
      this.setData({
        drawerHeaderPaddingTop: statusBarHeight + 20
      })
    }
  },

  methods: {
    close() {
      this.triggerEvent('close')
    },

    navigate(e) {
      var path = e.currentTarget.dataset.path
      this.triggerEvent('navigate', { path: path })
      this.close()
    },

    preventMove() {
      return false
    }
  }
})
