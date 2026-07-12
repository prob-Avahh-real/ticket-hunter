// pages/order/order.js
const app = getApp();

Page({
  data: {
    orders: [],
    tabs: [
      { label: "全部", value: "" },
      { label: "待支付", value: "pending" },
      { label: "已支付", value: "paid" },
      { label: "已取消", value: "cancelled" },
    ],
    activeTab: "",
    page: 1,
    hasMore: true,
    loading: false,
  },

  onShow() {
    this.setData({ page: 1, hasMore: true, orders: [] }, () => this.loadOrders(true));
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadOrders(false);
    }
  },

  async loadOrders(refresh) {
    if (this.data.loading) return;
    if (!app.globalData.accessToken) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }
    this.setData({ loading: true });

    const { activeTab, page } = this.data;
    const params = { page: refresh ? 1 : page, pageSize: 20 };
    if (activeTab) params.status = activeTab;

    try {
      const res = await app.request({ url: "/orders", data: params });
      const list = refresh ? res.list : [...this.data.orders, ...res.list];
      this.setData({
        orders: list,
        page: res.pagination.page + 1,
        hasMore: res.pagination.page < res.pagination.totalPages,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onTabChange(e) {
    const v = e.currentTarget.dataset.value;
    this.setData({ activeTab: v, page: 1, hasMore: true, orders: [] }, () => this.loadOrders(true));
  },

  onTapOrder(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` });
  },

  // 去支付
  async onPay(e) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: "支付中..." });
    try {
      await app.request({ url: `/orders/${id}/pay`, method: "POST" });
      wx.hideLoading();
      wx.showToast({ title: "支付成功" });
      this.onShow();
    } catch {
      wx.hideLoading();
      wx.showToast({ title: "支付失败", icon: "none" });
    }
  },
});
