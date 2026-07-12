// ============================================
// Ticket Hunter v2.0 — 全局入口
// 功能: JWT + Token 刷新 + WebSocket 管理 + NTP 校时
// ============================================

const API_BASE = "https://your-api-domain.com/api";
const WS_BASE = "wss://your-api-domain.com/ws/stock";

App({
  globalData: {
    API_BASE,
    WS_BASE,
    accessToken: null,
    refreshToken: null,
    userInfo: null,

    // NTP 同步偏移量 (ms): serverTime = Date.now() + timeOffset
    timeOffset: 0,

    // 活跃的 WebSocket 连接: sessionId → { ws, listeners }
    wsConnections: {},

    // 全局倒计时状态
    countdownRef: null,
  },

  onLaunch() {
    const at = wx.getStorageSync("accessToken");
    const rt = wx.getStorageSync("refreshToken");
    const to = wx.getStorageSync("timeOffset");
    if (at) this.globalData.accessToken = at;
    if (rt) this.globalData.refreshToken = rt;
    if (to !== "") this.globalData.timeOffset = Number(to) || 0;

    // NTP 校时
    this._syncTime();
  },

  // ---- NTP 时间同步 ----
  async _syncTime() {
    const t0 = Date.now();
    try {
      const res = await this._doRequest({ url: "/health", method: "GET", skipAuth: true });
      const t1 = Date.now();
      const rtt = t1 - t0;

      // 服务端时间戳 (ISO → ms)
      const serverTime = new Date(res.timestamp).getTime();

      // 假设 RTT 对称: offset = serverTime - (t0 + RTT/2)
      const offset = serverTime - (t0 + rtt / 2);
      this.globalData.timeOffset = offset;

      wx.setStorageSync("timeOffset", offset);
      console.log("[ntp] sync done, offset:", offset.toFixed(0), "ms, rtt:", rtt, "ms");
    } catch (e) {
      console.warn("[ntp] sync failed, using cached offset");
    }

    // 每 5 分钟重新同步
    setTimeout(() => this._syncTime(), 300000);
  },

  // 获取校准后的当前时间
  serverNow(): number {
    return Date.now() + this.globalData.timeOffset;
  },

  // ---- WebSocket 连接管理 ----
  connectStockWS(sessionId: string, onUpdate: (stocks: any) => void): () => void {
    const existing = this.globalData.wsConnections[sessionId];
    if (existing && existing.ws && existing.ws.readyState === 1) {
      // 复用已有连接
      existing.listeners.push(onUpdate);
      return () => {
        existing.listeners = existing.listeners.filter((l) => l !== onUpdate);
      };
    }

    const token = this.globalData.accessToken;
    if (!token) return () => {};

    try {
      const ws = wx.connectSocket({
        url: WS_BASE + "?sessionId=" + sessionId + "&token=" + token,
      });

      const listeners = [onUpdate];
      const conn = { ws, listeners };

      ws.onOpen(() => {
        console.log("[ws] connected, session:", sessionId);
      });

      ws.onMessage((msg: any) => {
        try {
          const data = JSON.parse(typeof msg.data === "string" ? msg.data : "");
          if (data.type === "snapshot" || data.type === "stock_update") {
            for (const fn of listeners) {
              fn(data.stocks);
            }
          }
        } catch {
          // ignore
        }
      });

      ws.onError((_err: any) => {
        console.warn("[ws] error, session:", sessionId);
      });

      ws.onClose(() => {
        delete this.globalData.wsConnections[sessionId];
      });

      this.globalData.wsConnections[sessionId] = conn;

      return () => {
        conn.listeners = conn.listeners.filter((l) => l !== onUpdate);
        if (conn.listeners.length === 0) {
          ws.close({});
          delete this.globalData.wsConnections[sessionId];
        }
      };
    } catch {
      return () => {};
    }
  },

  // ---- HTTP 请求封装 ----
  request(options: any) {
    return this._doRequest(options).catch(async (err) => {
      if (err && err.statusCode === 401 && this.globalData.refreshToken) {
        try {
          const refreshed = await this._doRequest({
            url: "/users/refresh",
            method: "POST",
            data: { refreshToken: this.globalData.refreshToken },
            skipAuth: true,
          });
          this.globalData.accessToken = refreshed.accessToken;
          this.globalData.refreshToken = refreshed.refreshToken;
          wx.setStorageSync("accessToken", refreshed.accessToken);
          wx.setStorageSync("refreshToken", refreshed.refreshToken);
          return this._doRequest(options);
        } catch {
          this._clearToken();
          wx.navigateTo({ url: "/pages/login/login" });
          throw err;
        }
      }
      if (err && err.statusCode === 401) {
        this._clearToken();
        wx.navigateTo({ url: "/pages/login/login" });
      }
      throw err;
    });
  },

  _doRequest(options: any) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: API_BASE + options.url,
        method: options.method || "GET",
        data: options.data,
        header: {
          "Content-Type": "application/json",
          Authorization: options.skipAuth
            ? ""
            : this.globalData.accessToken
              ? "Bearer " + this.globalData.accessToken
              : "",
          ...options.header,
        },
        success(res: any) {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
          else reject({ statusCode: res.statusCode, ...res.data });
        },
        fail: reject,
      });
    });
  },

  _clearToken() {
    wx.removeStorageSync("accessToken");
    wx.removeStorageSync("refreshToken");
    this.globalData.accessToken = null;
    this.globalData.refreshToken = null;
    this.globalData.userInfo = null;
  },
});
