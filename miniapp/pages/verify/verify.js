// pages/verify/verify.js
const app = getApp();

Page({
  data: { realName: "", idCard: "", loading: false },

  onNameInput(e) { this.setData({ realName: e.detail.value }); },
  onIdInput(e) { this.setData({ idCard: e.detail.value }); },

  async onSubmit() {
    const { realName, idCard } = this.data;
    if (!realName) return wx.showToast({ title: "请输入姓名", icon: "none" });
    if (!/^\d{17}[\dXx]$/.test(idCard)) return wx.showToast({ title: "身份证号格式错误", icon: "none" });

    this.setData({ loading: true });
    try {
      const res = await app.request({
        url: "/users/verify-id",
        method: "POST",
        data: { realName, idCard },
      });
      if (res.verified) {
        wx.showToast({ title: "实名核验通过", icon: "success" });
        setTimeout(() => wx.navigateBack(), 1000);
      }
    } catch (e: any) {
      wx.showToast({ title: e.error || "核验失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
