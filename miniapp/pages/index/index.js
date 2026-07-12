// pages/index/index.js
const app = getApp();

Page({
  data: {
    shows: [],
    cities: [],
    categories: [
      { label: "全部", value: "" },
      { label: "演唱会", value: "concert" },
      { label: "体育", value: "sports" },
      { label: "话剧", value: "drama" },
      { label: "展览", value: "exhibition" },
      { label: "音乐节", value: "music_festival" },
      { label: "市民通票", value: "city_pass" },
    ],
    activeCategory: "",
    activeCity: "",
    keyword: "",
    page: 1,
    hasMore: true,
    loading: false,
  },

  onLoad() {
    this.loadCities();
    this.loadShows(true);
  },

  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true }, () => {
      this.loadShows(true).then(() => wx.stopPullDownRefresh());
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadShows(false);
    }
  },

  async loadCities() {
    try {
      const cities = await app.request({ url: "/shows/cities/list" });
      this.setData({ cities: ["全国", ...cities] });
    } catch (e) {
      console.error("加载城市失败", e);
    }
  },

  async loadShows(refresh) {
    if (this.data.loading) return;
    this.setData({ loading: true });

    const { activeCategory, activeCity, keyword, page } = this.data;
    const params = {
      status: "on_sale",
      page: refresh ? 1 : page,
      pageSize: 20,
    };
    if (activeCategory) params.category = activeCategory;
    if (activeCity && activeCity !== "全国") params.city = activeCity;
    if (keyword) params.keyword = keyword;

    try {
      const res = await app.request({ url: "/shows", data: params });
      const list = refresh ? res.list : [...this.data.shows, ...res.list];
      this.setData({
        shows: list,
        page: res.pagination.page + 1,
        hasMore: res.pagination.page < res.pagination.totalPages,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  onCategoryChange(e) {
    const v = e.currentTarget.dataset.value;
    this.setData({ activeCategory: v, page: 1, hasMore: true }, () => this.loadShows(true));
  },

  onCityChange(e) {
    const idx = e.detail.value;
    this.setData({ activeCity: this.data.cities[idx], page: 1, hasMore: true }, () =>
      this.loadShows(true)
    );
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.setData({ page: 1, hasMore: true }, () => this.loadShows(true));
  },

  onTapShow(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/show/show?id=${id}` });
  },
});
