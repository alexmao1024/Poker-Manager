# 炸金花前端收尾 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成炸金花模式前端交互与自动阶段设置移除，补齐比牌（含平局）、看牌与补码操作。

**Architecture:** 前端按 `gameType` 分支渲染，复用同一房间/牌桌结构；炸金花动作统一走 `applyAction` 并补充 `targetId/result`；云端规则判断仍在 `roomAction`，前端只做展示与参数准备。

**Tech Stack:** 微信小程序（WXML/WXSS/JS）、Node.js assert 测试。

---

### Task 1: 扩展 roomService 测试与参数透传

**Files:**
- Modify: `miniprogram/services/__tests__/roomService.test.js`
- Modify: `miniprogram/services/roomService.js`

**Step 1: Write the failing test**

```js
  await service.applyAction("room-id", {
    action: "compare",
    targetId: "player-2",
    result: "tie",
  });
  assert.equal(calls[1].data.action, "applyAction");
  assert.equal(calls[1].data.targetId, "player-2");
  assert.equal(calls[1].data.result, "tie");
```

**Step 2: Run test to verify it fails**

Run: `node miniprogram/services/__tests__/roomService.test.js`
Expected: FAIL if `targetId/result` 未透传。

**Step 3: Write minimal implementation**

```js
async applyAction(roomId, payload) {
  return callCloudFunction({
    name: "roomAction",
    data: {
      action: "applyAction",
      roomId,
      ...payload,
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `node miniprogram/services/__tests__/roomService.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add miniprogram/services/__tests__/roomService.test.js miniprogram/services/roomService.js
git commit -m "test: cover applyAction compare params"
```

---

### Task 2: Lobby 移除自动阶段设置 + 规则摘要

**Files:**
- Modify: `miniprogram/pages/lobby/lobby.js`
- Modify: `miniprogram/pages/lobby/lobby.wxml`
- Modify: `miniprogram/pages/lobby/lobby.wxss`

**Step 1: Update view model**

```js
function buildPlayersView(players, gameType) {
  return (players || []).map((player) => {
    const positionTag = player.isDealer ? "庄" : "";
    return {
      ...player,
      positionTag: gameType === "zhajinhua" ? positionTag : player.positionTag,
    };
  });
}
```

**Step 2: Update Lobby WXML**

- 删除自动推进阶段开关。
- 增加玩法与规则摘要区块：炸金花显示底注/封顶轮数/最早看牌/可比牌轮数，德州显示盲注。

**Step 3: Add styles**

```css
.meta-secondary {
  color: #a3a8b3;
  font-size: 12px;
  line-height: 1.6;
}
```

**Step 4: Manual verify**

- 打开 lobby：无“自动推进阶段”设置。
- 切换炸金花/德州时规则摘要正确。

**Step 5: Commit**

```bash
git add miniprogram/pages/lobby/lobby.js miniprogram/pages/lobby/lobby.wxml miniprogram/pages/lobby/lobby.wxss
git commit -m "feat: update lobby for zhajinhua rules"
```

---

### Task 3: Table WXML 增加炸金花交互区与比牌弹窗

**Files:**
- Modify: `miniprogram/pages/table/table.wxml`

**Step 1: 玩家卡片增加看牌标签**

```xml
<view class="player-name">{{item.name}}</view>
<view wx:if="{{item.seenLabel}}" class="player-tag">{{item.seenLabel}}</view>
```

**Step 2: 炸金花操作区**

- 按 `isZhj` 分支展示“闷跟/明跟、看牌、比牌、加注、全下、弃牌”。
- 当前跟注金额展示 `displayCallNeed`。

**Step 3: 比牌弹窗**

```xml
<view wx:if="{{showCompare}}" class="rules-modal" bindtap="closeCompare">
  <view class="settle-card" catchtap="noop">
    <view class="settle-title">比牌</view>
    <view class="settle-subtitle">选择对手</view>
    <view class="settle-grid">
      <view
        wx:for="{{compareTargets}}"
        wx:key="id"
        class="settle-chip {{compareTargetId === item.id ? 'is-active' : ''}}"
        data-id="{{item.id}}"
        bindtap="selectCompareTarget"
      >{{item.name}}</view>
    </view>
    <view class="settle-subtitle">结果</view>
    <view class="settle-grid">
      <view class="settle-chip {{compareResult === 'win' ? 'is-active' : ''}}" data-value="win" bindtap="selectCompareResult">我赢</view>
      <view class="settle-chip {{compareResult === 'lose' ? 'is-active' : ''}}" data-value="lose" bindtap="selectCompareResult">我输</view>
      <view class="settle-chip {{compareResult === 'tie' ? 'is-active' : ''}}" data-value="tie" bindtap="selectCompareResult">平局</view>
    </view>
    <view class="modal-actions">
      <button class="btn btn-ghost" bindtap="closeCompare">取消</button>
      <button class="btn btn-primary" bindtap="confirmCompare">确认</button>
    </view>
  </view>
</view>
```

**Step 4: Manual verify**

- 比牌弹窗可选择对手与结果。

**Step 5: Commit**

```bash
git add miniprogram/pages/table/table.wxml
git commit -m "feat: add zhajinhua compare ui"
```

---

### Task 4: Table 逻辑补齐炸金花动作与显示

**Files:**
- Modify: `miniprogram/pages/table/table.js`

**Step 1: Add helpers**

```js
function calcZhjCurrentBet(players, baseBet) {
  const maxBet = (players || []).reduce((max, item) => Math.max(max, item.bet || 0), 0);
  return Math.max(maxBet, Number(baseBet || 0));
}

function getZhjRoundLabel(roundCount, maxRounds) {
  if (!roundCount) return "未开始";
  if (maxRounds && roundCount >= maxRounds) return `第${roundCount}轮 · 开牌`;
  return `第${roundCount}轮`;
}
```

**Step 2: Update syncView**

- 计算 `isZhj/baseBet/currentBet/callNeed/displayCallNeed`。
- `displayCallNeed`：看牌玩家 = `callNeed * 2`。
- `canSee`：未看牌且达到最早看牌轮数。
- `canCompare`：已看牌且达到可比牌轮数。
- 生成 `compareTargets`：除自己外、未弃牌/未出局。

**Step 3: Add handlers**

```js
async onSee() {
  await this.applyAction({ action: "see" });
}

openCompare() {
  this.setData({ showCompare: true, compareTargetId: "", compareResult: "win" });
}

confirmCompare() {
  const { compareTargetId, compareResult } = this.data;
  if (!compareTargetId) return wx.showToast({ title: "请选择对手", icon: "none" });
  this.applyAction({ action: "compare", targetId: compareTargetId, result: compareResult });
  this.closeCompare();
}

async onCheckCall() {
  await this.applyAction({ action: "call" });
}
```

**Step 4: Add error mapping**

```js
const errorText = {
  CANNOT_SEE: "未到可看牌轮数",
  CANNOT_COMPARE: "未到可比牌轮数",
  NO_TARGET: "请选择对手",
  INVALID_TARGET: "对手不可比",
};
```

**Step 5: Manual verify**

- 炸金花操作区按钮显隐正确。
- 比牌/看牌/加注/闷跟提示正确。

**Step 6: Commit**

```bash
git add miniprogram/pages/table/table.js
git commit -m "feat: finish zhajinhua actions"
```

---

### Task 5: Table 样式补齐（比牌结果/说明）

**Files:**
- Modify: `miniprogram/pages/table/table.wxss`

**Step 1: Add styles**

```css
.rules-text {
  color: #8b90a0;
  font-size: 12px;
  line-height: 1.6;
}

.compare-result {
  font-weight: 600;
}
```

**Step 2: Manual verify**

- 弹窗与规则说明文本可读。

**Step 3: Commit**

```bash
git add miniprogram/pages/table/table.wxss
git commit -m "style: zhajinhua compare modal"
```

---

### Task 6: 回归测试

**Step 1: 云函数测试**

Run:

```powershell
Get-ChildItem cloudfunctions/roomAction/tests/*.test.js | ForEach-Object { node $_.FullName }
```

Expected: all exit code 0

**Step 2: 小程序服务测试**

Run:

```powershell
node miniprogram/services/__tests__/roomService.test.js
node miniprogram/utils/__tests__/gameConfig.test.js
node miniprogram/utils/__tests__/roomPayloads.test.js
```

Expected: all exit code 0

**Step 3: Commit test run note (optional)**

- 不需要代码变更则不提交。
