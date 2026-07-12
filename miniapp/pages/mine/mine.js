// pages/mine/mine.js
const app = getApp();

Page({
  data: {
    userInfo: null,
    orderStats: { all: 0, pending: 0, paid: 0 },
  },

  onShow() {
    this.loadUserInfo();
    this.loadOrderStats();
  },

  async loadUserInfo() {
    if (!app.globalData.accessToken) return;
    try {
      const user = await app.request({ url: "/users/me" });
      this.setData({ userInfo: user });
    } catch (e) {
      // 未登录
    }
  },

  async loadOrderStats() {
    if (!app.globalData.accessToken) return;
    try {
      const [all, pending, paid] = await Promise.all([
        app.request({ url: "/orders", data: { pageSize: 1 } }),
        app.request({ url: "/orders", data: { status: "pending", pageSize: 1 } }),
        app.request({ url: "/orders", data: { status: "paid", pageSize: 1 } }),
      ]);
      this.setData({
        orderStats: {
          all: all.pagination?.total || 0,
          pending: pending.pagination?.total || 0,
          paid: paid.pagination?.total || 0,
        },
      });
    } catch (e) {
      // ignore
    }
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/login/login" });
  },

  onGoOrders(e) {
    const status = e.currentTarget.dataset.status || "";
    wx.navigateTo({ url: `/pages/order/order?status=${status}` });
  },

  onGoVerify() {
    wx.navigateTo({ url: "/pages/verify/verify" });
  },

  onLogout() {
    wx.removeStorageSync("accessToken");
    wx.removeStorageSync("refreshToken");
    app.globalData.accessToken = null;
    app.globalData.refreshToken = null;
    app.globalData.userInfo = null;
    this.setData({ userInfo: null, orderStats: { all: 0, pending: 0, paid: 0 } });
  },
});
