// ============================================
// 演出详情 & 一键抢票 — v2.0 增强版
// 功能：NTP 同步倒计时 + WebSocket 库存 + 预检 + 自动重试
// ============================================

const app = getApp();
const SNATCH_COOLDOWN_MS = 500;    // 抢票冷却 (防连点)
const MAX_RETRIES = 3;             // 最大重试次数
const RETRY_BASE_DELAY_MS = 100;   // 重试基础延迟
const PREFLIGHT_ADVANCE_MS = 3000; // 开售前 3 秒预检

Page({
  data: {
    show: null,
    sessions: [],
    passBundles: [],
    activeSessionIdx: 0,
    selectedTickets: {},
    totalPrice: 0,
    snatching: false,

    // 倒计时
    countdown: { days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 },
    saleStarted: false,
    saleEnded: false,

    // 实时库存 (来自 WebSocket)
    liveStock: {},

    // 预检状态
    preflightOk: false,
    preflightPending: false,

    // 抢票状态机: idle | preflighting | ready | snatching | success | failed
    stage: "idle",
    stageText: "",
  },

  // ---- 页面生命周期 ----
  onLoad(options: any) {
    if (options.id) {
      this.loadShow(options.id);
    }
  },

  onUnload() {
    this._cleanup();
  },

  _cleanup() {
    if (this._wsUnsub) {
      this._wsUnsub();
      this._wsUnsub = null;
    }
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
    if (this._preflightTimer) {
      clearTimeout(this._preflightTimer);
      this._preflightTimer = null;
    }
  },

  // ---- 加载演出 ----
  async loadShow(id: string) {
    wx.showLoading({ title: "加载中..." });
    try {
      const data = await app.request({ url: "/shows/" + id });
      const sessions = data.sessions || [];

      // 初始化选中
      let selected: Record<string, number> = {};
      if (sessions.length > 0 && sessions[0].ticketTypes) {
        sessions[0].ticketTypes.forEach((t: any) => {
          selected[t.id] = 0;
        });
      }

      this.setData({
        show: data,
        sessions,
        activeSessionIdx: 0,
        selectedTickets: selected,
        totalPrice: 0,
      });

      // 加载通票
      if (data.category === "city_pass") {
        const bundles = await app.request({ url: "/shows/" + id + "/pass-bundles" });
        this.setData({ passBundles: bundles });
      }

      wx.hideLoading();

      // 启动倒计时
      if (sessions.length > 0) {
        this._startCountdown(sessions[0].sale_start_time, sessions[0].sale_end_time);
        // 连接 WebSocket 库存推送
        this._connectStock(sessions[0].id);
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  // ---- NTP 同步倒计时 ----
  _startCountdown(saleStart: string, saleEnd: string) {
    const startTime = new Date(saleStart).getTime();
    const endTime = new Date(saleEnd).getTime();

    const tick = () => {
      const now = app.serverNow();
      const remaining = Math.max(0, startTime - now);

      if (remaining <= 0) {
        // 已开售
        const ended = now > endTime;
        this.setData({
          saleStarted: true,
          saleEnded: ended,
          countdown: { days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 },
          stage: ended ? "failed" : this.data.stage === "preflighting" ? "ready" : "idle",
          stageText: ended ? "已结束" : "正在抢票中",
        });
        if (ended) {
          clearInterval(this._countdownTimer!);
          this._countdownTimer = null;
        }
        return;
      }

      const totalSec = Math.ceil(remaining / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;

      this.setData({
        countdown: { days, hours, minutes, seconds, totalSeconds: totalSec },
      });

      // 开售前 3 秒触发预检
      if (totalSec <= PREFLIGHT_ADVANCE_MS / 1000 && !this.data.preflightPending && !this.data.saleStarted && !this.data.preflightOk) {
        this._doPreflight();
      }
    };

    tick(); // 立即执行
    this._countdownTimer = setInterval(tick, 200); // 200ms 间隔，避免 1000ms 延迟抖动
  },

  // ---- WebSocket 库存订阅 ----
  _connectStock(sessionId: string) {
    this._wsUnsub = app.connectStockWS(sessionId, (stocks: any) => {
      this.setData({ liveStock: stocks });

      // 更新票种列表中的 available
      const sessions = this.data.sessions;
      if (sessions[this.data.activeSessionIdx]) {
        const ts = sessions[this.data.activeSessionIdx].ticketTypes || [];
        for (const t of ts) {
          if (stocks[t.id] !== undefined) {
            t.available = typeof stocks[t.id] === "object" ? stocks[t.id].available : stocks[t.id];
          }
        }
        this.setData({ sessions });
      }
    });
  },

  // ---- 预检 (开售前 3 秒) ----
  async _doPreflight() {
    if (this.data.preflightPending || this.data.preflightOk) return;
    this.setData({ preflightPending: true, stage: "preflighting", stageText: "预检验证中..." });

    const session = this.data.sessions[this.data.activeSessionIdx];
    if (!session) return;

    const items = this._buildSnatchItems();
    if (items.length === 0) return;

    try {
      const res = await app.request({
        url: "/orders/preflight",
        method: "POST",
        data: { sessionId: session.id, items },
      });

      this.setData({
        preflightOk: res.ready,
        stage: res.ready ? "ready" : "idle",
        stageText: res.ready ? "准备就绪，等待开售" : res.message || "预检未通过",
      });
    } catch (e: any) {
      this.setData({
        preflightOk: false,
        stage: "idle",
        stageText: "预检失败: " + (e.error || "unknown"),
      });
    } finally {
      this.setData({ preflightPending: false });
    }
  },

  // ---- 构建抢票 items ----
  _buildSnatchItems() {
    const { selectedTickets } = this.data;
    return Object.entries(selectedTickets)
      .filter(([_, qty]) => (qty as number) > 0)
      .map(([ticketTypeId, quantity]) => ({
        ticketTypeId,
        quantity: quantity as number,
      }));
  },

  // ============================================
  // 🔥 一键抢票 (v2 Lua 引擎 + 自动重试)
  // ============================================
  async onSnatch() {
    if (!app.globalData.accessToken) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }

    if (this.data.snatching) return;
    if (this.data.saleEnded) {
      wx.showToast({ title: "已结束", icon: "none" });
      return;
    }

    const session = this.data.sessions[this.data.activeSessionIdx];
    if (!session) return;

    const items = this._buildSnatchItems();
    if (items.length === 0) {
      wx.showToast({ title: "请选择票种", icon: "none" });
      return;
    }

    // 开售倒计时未到 → 自动等到开售再抢
    const startTime = new Date(session.sale_start_time).getTime();
    const now = app.serverNow();
    if (now < startTime) {
      wx.showToast({ title: "未到开售时间", icon: "none" });
      return;
    }

    this.setData({ snatching: true, stage: "snatching", stageText: "抢票中..." });
    wx.showLoading({ title: "抢票中...", mask: true });

    try {
      const result = await this._snatchWithRetry(session.id, items);
      wx.hideLoading();

      if (result.success) {
        this.setData({ stage: "success", stageText: "抢票成功!", snatching: false });
        wx.vibrateShort({ type: "heavy" });

        wx.showModal({
          title: "🎉 抢票成功！",
          content:
            "订单号: " +
            result.orderId +
            "\n总价: ¥" +
            (result.totalAmount / 100).toFixed(2) +
            "\n延迟: " +
            result.latencyMs +
            "ms" +
            "\n请在 " +
            result.expireAt +
            " 前支付",
          confirmText: "去支付",
          cancelText: "稍后",
          success: (modalRes: any) => {
            if (modalRes.confirm) {
              wx.showLoading({ title: "支付中..." });
              app
                .request({ url: "/orders/" + result.orderId + "/pay", method: "POST" })
                .then(() => {
                  wx.hideLoading();
                  wx.showToast({ title: "支付成功！" });
                  wx.switchTab({ url: "/pages/order/order" });
                });
            } else {
              wx.switchTab({ url: "/pages/order/order" });
            }
          },
        });
      } else {
        this.setData({ stage: "failed", stageText: result.error || "抢票失败", snatching: false });
        wx.showToast({ title: result.error || "抢票失败", icon: "none", duration: 2500 });
      }
    } catch (e: any) {
      wx.hideLoading();
      this.setData({ stage: "failed", stageText: e.error || "网络错误", snatching: false });
      wx.showToast({ title: e.error || "网络错误", icon: "none" });
    }
  },

  // ---- 带自动重试的抢票 ----
  async _snatchWithRetry(
    sessionId: string,
    items: { ticketTypeId: string; quantity: number }[],
  ): Promise<{ success: boolean; orderId?: string; totalAmount?: number; latencyMs?: number; expireAt?: string; error?: string }> {
    let lastError: any = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await app.request({
          url: "/orders/snatch-v2",
          method: "POST",
          data: { sessionId, items },
        });

        if (res.success) return res;

        // 明确不可重试的错误
        if (res.errorCode === "need_verify" || res.errorCode === "limit_exceeded") {
          return { success: false, error: res.error };
        }

        // 库存不足 / 过于频繁 → 退避重试
        lastError = res;

        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 50;
        await this._sleep(delay);
      } catch (e) {
        lastError = e;
        if ((e as any).statusCode === 401) throw e; // 不重试 401
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await this._sleep(delay);
      }
    }

    return {
      success: false,
      error: lastError?.error || "已达最大重试次数",
    };
  },

  _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  },

  // ---- 票种操作 ----
  onSessionChange(e: any) {
    const idx = Number(e.detail.value);
    const session = this.data.sessions[idx];
    let selected: Record<string, number> = {};
    if (session && session.ticketTypes) {
      session.ticketTypes.forEach((t: any) => {
        selected[t.id] = 0;
      });
    }

    // 切换场次：重连 WS
    this._cleanup();
    if (session) {
      this._startCountdown(session.sale_start_time, session.sale_end_time);
      this._connectStock(session.id);
    }

    this.setData({
      activeSessionIdx: idx,
      selectedTickets: selected,
      totalPrice: 0,
      preflightOk: false,
      stage: "idle",
      stageText: "",
    });
  },

  onIncrease(e: any) {
    const id = e.currentTarget.dataset.id;
    const selected = { ...this.data.selectedTickets };
    selected[id] = Math.min(6, (selected[id] || 0) + 1);
    this._updateTotal(selected);
  },

  onDecrease(e: any) {
    const id = e.currentTarget.dataset.id;
    const selected = { ...this.data.selectedTickets };
    selected[id] = Math.max(0, (selected[id] || 0) - 1);
    this._updateTotal(selected);
  },

  _updateTotal(selected: Record<string, number>) {
    const session = this.data.sessions[this.data.activeSessionIdx];
    let total = 0;
    if (session && session.ticketTypes) {
      session.ticketTypes.forEach((t: any) => {
        total += (t.original_price || 0) * (selected[t.id] || 0);
      });
    }
    this.setData({ selectedTickets: selected, totalPrice: total });
  },
});
