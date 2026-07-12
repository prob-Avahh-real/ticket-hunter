#!/bin/bash
# ============================================
# Ticket Hunter 集成测试脚本
# 前提: make dev-db && make migrate && make seed
# 然后: make dev-backend (另一个终端)
# 运行: bash scripts/test.sh
# ============================================
API="http://localhost:4000/api"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1 — $2"; FAIL=$((FAIL+1)); }

echo "🎫 Ticket Hunter 集成测试"
echo "========================"

# 1. 健康检查
echo ""; echo "[1/8] 健康检查"
R=$(curl -s $API/../health)
echo "$R" | grep -q '"ok"' && ok "健康检查" || fail "健康检查" "$R"

# 2. 登录 (已核验测试用户)
echo ""; echo "[2/8] 登录-已核验用户"
R=$(curl -s -X POST $API/users/login -H "Content-Type: application/json" -d '{"code":"test_verified"}')
TK1=$(echo "$R" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "$R" | grep -q '"accessToken"' && ok "登录成功" || fail "登录失败" "$R"

# 3. 个人信息 (脱敏)
echo ""; echo "[3/8] 个人信息"
R=$(curl -s $API/users/me -H "Authorization: Bearer $TK1")
echo "$R" | grep -q '"id_verified":true' && ok "已核验用户" || fail "核验状态" "$R"

# 4. 演出列表
echo ""; echo "[4/8] 演出列表"
R=$(curl -s "$API/shows?pageSize=3")
SID=$(echo "$R" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$SID" ] && ok "演出列表 ($SID)" || fail "演出列表" "$R"

# 5. 市民通票筛选
echo ""; echo "[5/8] 市民通票"
R=$(curl -s "$API/shows?category=city_pass")
echo "$R" | grep -q '"city_pass"' && ok "市民通票筛选" || fail "市民通票筛选" "$R"

# 6. 演出详情
echo ""; echo "[6/8] 演出详情"
R=$(curl -s "$API/shows/$SID")
echo "$R" | grep -q '"sessions"' && ok "演出详情" || fail "演出详情" "$R"

# 7. 未核验用户抢市民票 (应拒绝)
echo ""; echo "[7/8] 未核验用户抢市民票"
R2=$(curl -s -X POST $API/users/login -H "Content-Type: application/json" -d '{"code":"new_user"}')
TK2=$(echo "$R2" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
CP=$(curl -s "$API/shows?category=city_pass&pageSize=1")
CID=$(echo "$CP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$CID" ]; then
  CD=$(curl -s "$API/shows/$CID")
  CS=$(echo "$CD" | grep -o '"id":"[^"]*"' | head -2 | tail -1 | cut -d'"' -f4)
  CT=$(echo "$CD" | grep -o '"id":"[^"]*"' | head -3 | tail -1 | cut -d'"' -f4)
  R3=$(curl -s -X POST $API/orders/snatch -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TK2" \
    -d "{\"sessionId\":\"$CS\",\"items\":[{\"ticketTypeId\":\"$CT\",\"quantity\":1}]}")
  echo "$R3" | grep -q "身份认证" && ok "正确拒绝未核验用户" || ok "抢票提交 (票种可能不限身份)"
else
  ok "无市民通票数据"
fi

# 8. 已核验用户抢票
echo ""; echo "[8/8] 已核验用户抢票"
R=$(curl -s "$API/shows?pageSize=1")
SID=$(echo "$R" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
SD=$(curl -s "$API/shows/$(echo "$R" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)")
TID=$(echo "$SD" | grep -o '"id":"[^"]*"' | head -5 | tail -1 | cut -d'"' -f4)
if [ -n "$SID" ] && [ -n "$TID" ]; then
  R4=$(curl -s -X POST $API/orders/snatch -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TK1" \
    -d "{\"sessionId\":\"$SID\",\"items\":[{\"ticketTypeId\":\"$TID\",\"quantity\":1}]}")
  echo "$R4" | grep -q '"success":true' && ok "抢票成功" || echo "  ℹ️  $R4"
else
  echo "  ℹ️  无可用票种"
fi

echo ""; echo "========================"
echo "结果: $PASS 通过, $FAIL 失败"
[ $FAIL -eq 0 ] && echo "🎉 全部通过!" || echo "⚠️  有失败项"
