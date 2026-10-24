export function setupLeaderboard({ client, onReward }) {
  const rows = document.querySelector('#leaderboard-rows');
  const status = document.querySelector('#leaderboard-status');
  const mine = document.querySelector('#leaderboard-mine');
  const rewards = document.querySelector('#weekly-rewards');
  let account = null;
  let period = 'current';
  let requestId = 0;
  let lastRefresh = 0;

  function renderRewards(items = []) {
    rewards.replaceChildren();
    rewards.hidden = !account || items.length === 0;
    if (rewards.hidden) return;
    const title = document.createElement('h3'); title.textContent = '我的周榜谢礼'; rewards.append(title);
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'weekly-reward';
      const label = document.createElement('span'); label.textContent = `${item.week_id} 周冠军`;
      row.append(label);
      if (item.status === 'assigned' && item.code) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '查看兑换码';
        const owner = account.id;
        button.addEventListener('click', () => {
          if (account?.id === owner) onReward({ reward: item, message: `${item.week_id} 周冠军谢礼` });
        });
        row.append(button);
      } else {
        const waiting = document.createElement('span'); waiting.textContent = '已锁定冠军，等待奖池补货'; row.append(waiting);
      }
      rewards.append(row);
    }
  }

  async function refresh(force = false) {
    if (!force && Date.now() - lastRefresh < 15000) return;
    lastRefresh = Date.now();
    const id = ++requestId;
    const owner = account?.id ?? null;
    const requestedPeriod = period;
    const [publicResult, privateResult] = await Promise.allSettled([
      client.getLeaderboard(requestedPeriod), owner ? client.getWeeklyMe() : Promise.resolve(null),
    ]);
    if (id !== requestId || requestedPeriod !== period || owner !== (account?.id ?? null)) return;
    if (publicResult.status === 'fulfilled') {
      const data = publicResult.value;
      document.querySelector('#leaderboard-title').textContent = period === 'current' ? '本周肥鱼榜' : '上周肥鱼榜';
      document.querySelector('#leaderboard-week').textContent = data.week.label;
      rows.replaceChildren();
      for (const item of data.rows) {
        const row = document.createElement('li');
        const rank = document.createElement('span'); rank.className = 'leaderboard-rank'; rank.textContent = ['🥇', '🥈', '🥉'][item.rank - 1] || String(item.rank);
        const name = document.createElement('span'); name.className = 'leaderboard-name'; name.textContent = item.name;
        const score = document.createElement('strong'); score.className = 'leaderboard-score'; score.textContent = `${item.score} 分`;
        row.title = `最高合成第 ${item.max_level} 级`;
        row.append(rank, name, score); rows.append(row);
      }
      if (!data.total) status.textContent = period === 'current' ? '本周还没有上榜成绩，来合出第一条肥鱼。' : '上周暂无有效成绩。';
      else if (period === 'previous' && data.winner) status.textContent = data.winner.status === 'assigned' ? '上周冠军谢礼已分配，可在本人账户查看。' : '上周冠军已锁定，奖池补货后补发。';
      else {
        const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(data.week.end));
        status.textContent = `共 ${data.total} 位鱼友上榜 · ${date} 结算（北京时间）`;
      }
    } else status.textContent = '周榜暂时没连上，点击 ↻ 重试。';
    if (owner && privateResult.status === 'fulfilled' && privateResult.value) {
      const data = privateResult.value;
      mine.textContent = data.my_rank ? `我的本周名次：第 ${data.my_rank} 名 · 最高 ${data.my_score} 分` : '本周尚未上榜，合成得分并同步后即可参与。';
      renderRewards(data.weekly_rewards);
    } else if (owner) mine.textContent = '个人周榜暂未同步，稍后刷新查看。';
    else { mine.textContent = '登录后参与周榜，游客成绩不计入排名。'; renderRewards(); }
  }

  for (const value of ['current', 'previous']) {
    document.querySelector(`#leaderboard-${value}`).addEventListener('click', () => {
      period = value;
      for (const name of ['current', 'previous']) document.querySelector(`#leaderboard-${name}`).setAttribute('aria-pressed', String(name === value));
      void refresh(true);
    });
  }
  document.querySelector('#leaderboard-refresh').addEventListener('click', () => { void refresh(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  void refresh(true);
  return {
    refresh,
    setAccount(user, items) {
      const changed = (account?.id ?? null) !== (user?.id ?? null);
      account = user;
      if (changed) {
        requestId++;
        renderRewards();
        mine.textContent = account ? '正在读取我的周榜。' : '登录后参与周榜，游客成绩不计入排名。';
        void refresh(true);
      }
      if (Array.isArray(items)) renderRewards(items);
    },
  };
}
