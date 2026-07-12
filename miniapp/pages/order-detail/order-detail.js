// pages/order-detail/order-detail.js
const app = getApp();

Page({
  data: { order: null, items: [] },

  onLoad(options) {
    if (options.id) {
      this.loadOrder(options.id);
    }
  },

  async loadOrder(id) {
    wx.showLoading({ title: "加载中..." });
    try {
      const data = await app.request({ url: `/orders/${id}` });
      this.setData({ order: data, items: data.items || [] });
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  async onPay() {
    wx.showLoading({ title: "支付中..." });
    try {
      await app.request({
        url: `/orders/${this.data.order.id}/pay`,
        method: "POST",
      });
      wx.hideLoading();
      wx.showToast({ title: "支付成功" });
      this.loadOrder(this.data.order.id);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: "支付失败", icon: "none" });
    }
  },
});
