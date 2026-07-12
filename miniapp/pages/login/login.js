// pages/login/login.js
const app = getApp();

Page({
  data: { loading: false },

  async onMockLogin() {
    this.setData({ loading: true });
    this.doLogin("mock_dev_code");
  },

  async doLogin(code) {
    try {
      const res = await app._doRequest({
        url: "/users/login",
        method: "POST",
        data: { code },
      });

      // v1.2: accessToken + refreshToken
      wx.setStorageSync("accessToken", res.accessToken);
      wx.setStorageSync("refreshToken", res.refreshToken);
      app.globalData.accessToken = res.accessToken;
      app.globalData.refreshToken = res.refreshToken;
      app.globalData.userInfo = res.user;

      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => wx.navigateBack(), 1000);
    } catch (e) {
      wx.showToast({ title: "登录失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
