const QUOTA_PER_USD = 500000;
const money = (value) => `$${(Number(value || 0) / QUOTA_PER_USD).toFixed(4)}`;

export function mountCompanionAccountUI({ container, client, onModeChange = () => {}, onStateChange = () => {} }) {
  const root = document.createElement("section");
  root.className = "companion-account";
  root.innerHTML = `
    <div class="companion-account-modes" role="group" aria-label="陪玩额度模式">
      <button type="button" data-mode="personal" aria-pressed="true">使用我的额度 · 推荐</button>
      <button type="button" data-mode="free" aria-pressed="false">限量免费旁白</button>
    </div>
    <p>个人模式仅在你主动连接并开启陪玩后使用本人账户额度。</p>
    <details class="companion-account-settings">
      <summary>个人额度设置</summary>
      <div class="companion-account-controls">
        <button type="button" data-load>加载个人账户信息</button>
        <label>账户分组 <select data-group disabled><option>请先加载账户信息</option></select></label>
        <label>专用 Key 预算（USD） <input data-budget type="number" min="0.01" max="10" step="0.01" value="0.10" disabled></label>
        <label class="companion-account-consent"><input type="checkbox" data-consent disabled> 我确认创建 30 天有效、仅限 DeepSeek Flash 的陪玩专用 Key；实际聊天从本站账户额度计费。Key 预算不是充值或预扣，原钱包余额不转移。停用可到 API 密钥页操作；明文不持久保存，开启后按需读取专用 Key。</label>
        <button type="button" data-connect disabled>确认并接入</button>
        <div data-manage hidden>
          <p data-record></p>
          <label>更改分组 <select data-change-group disabled></select></label>
          <button type="button" data-change disabled>更改分组</button>
          <button type="button" data-disable>禁用专用 Key</button>
        </div>
        <a href="/keys" target="_blank" rel="noopener">打开 API 密钥页</a>
        <p data-account-status role="status" aria-live="polite"></p>
      </div>
    </details>`;
  const form = container.querySelector("[data-companion-form]");
  if (!form?.parentElement) throw new Error("陪玩设置表单不可用");
  form.parentElement.insertBefore(root, form);
  const $ = (selector) => root.querySelector(selector);
  const modeButtons = [...root.querySelectorAll("[data-mode]")];
  const loadButton = $(`[data-load]`), groupSelect = $(`[data-group]`), budget = $(`[data-budget]`),
    consent = $(`[data-consent]`), connectButton = $(`[data-connect]`), manage = $(`[data-manage]`),
    recordText = $(`[data-record]`), changeSelect = $(`[data-change-group]`), changeButton = $(`[data-change]`),
    disableButton = $(`[data-disable]`), accountStatus = $(`[data-account-status]`);
  let mode = "personal", groups = [], record = null, loaded = false, busy = false, alive = true;
  const unsubscribeSession = client.onSessionChange?.((event) => {
    if (!alive || !["signed_out", "account_changed", "authenticated"].includes(event?.type)) return;
    groups = [];
    record = null;
    loaded = false;
    consent.checked = false;
    groupSelect.replaceChildren(new Option("请先加载账户信息", ""));
    changeSelect.replaceChildren();
    budget.value = "0.10";
    budget.disabled = true;
    consent.disabled = true;
    renderRecord();
    loadButton.disabled = false;
    showStatus("账户已变化；为避免在新账户自动使用额度，请重新加载账户信息并手动开启陪玩。");
    onModeChange(mode);
    onStateChange();
  });
  const showStatus = (text) => { accountStatus.textContent = text; };
  const syncConnect = () => { connectButton.disabled = busy || !loaded || !groups.length || !consent.checked || !!record; };
  function setMode(next) {
    if (next !== "personal" && next !== "free") return;
    mode = next;
    for (const button of modeButtons) button.setAttribute("aria-pressed", String(button.dataset.mode === next));
    onModeChange(mode);
  }
  function fillGroups(select, selected = "") {
    select.replaceChildren();
    for (const item of groups) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.id} · 倍率 ${item.ratio}${item.description ? ` · ${item.description}` : ""}`;
      select.append(option);
    }
    if (selected && groups.some((item) => item.id === selected)) select.value = selected;
    select.disabled = !groups.length;
  }
  function renderRecord() {
    budget.disabled = busy || Boolean(record);
    consent.disabled = busy || Boolean(record);
    groupSelect.disabled = busy || !groups.length || Boolean(record);
    manage.hidden = !record;
    if (!record) return;
    const expires = Number(record.expired_time) ? new Date(Number(record.expired_time) * 1000).toLocaleString() : "未知";
    const state = record.expired ? " · 已过期" : record.exhausted ? " · 额度已用完" : record.disabled
      ? " · 已禁用" : record.connected ? " · 可用（开启后按需读取专用 Key）" : " · 暂不可用";
    recordText.textContent = `${record.name} · 分组 ${record.group} · 剩余 ${money(record.remaining_quota)} / 已用 ${money(record.used_quota)} · 到期 ${expires}${state}`;
    changeSelect.value = record.group || "";
    changeSelect.disabled = busy || !record.connected;
    changeButton.disabled = busy || !record.connected;
    disableButton.disabled = busy || record.disabled;
    syncConnect();
  }
  for (const button of modeButtons) button.addEventListener("click", () => setMode(button.dataset.mode));
  loadButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true; loadButton.disabled = true; showStatus("正在读取登录账户的可用分组和专用 Key…");
    try {
      const [catalog, current] = await Promise.all([client.catalog(), client.status()]);
      if (!alive) return;
      groups = catalog.groups || []; record = current?.id ? current : null; loaded = true;
      fillGroups(groupSelect, record?.group); fillGroups(changeSelect, record?.group);
      budget.disabled = !!record; consent.disabled = !!record;
      renderRecord(); showStatus(!groups.length ? "账户没有可用分组。" : record && record.expired ? "专用 Key 已过期，请在 API 密钥页检查。" : record && record.exhausted ? "专用 Key 额度已用完，请在 API 密钥页检查。" : record && record.disabled ? "专用 Key 已禁用，请在 API 密钥页检查。" : record ? "已找到可用专用 Key；明文不持久保存，开启陪玩后按需读取。" : "账户信息已加载；尚未连接时不会创建 Key。");
    } catch (error) { if (alive) showStatus(error?.code === "not_authenticated" || /请先登录/.test(error?.message || "") ? "请打开正式站点并登录 NewAPI 账户后，再加载个人账户信息。" : error?.message || "读取失败，请确认已登录正式站点。"); }
    finally { busy = false; loadButton.disabled = false; syncConnect(); renderRecord(); onStateChange(); }
  });
  consent.addEventListener("change", syncConnect);
  connectButton.addEventListener("click", async () => {
    const amount = Number(budget.value);
    if (!consent.checked) return showStatus("请先勾选明确同意。");
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 10) return showStatus("预算需在 $0.01 到 $10 之间。");
    busy = true; syncConnect(); showStatus("正在创建个人额度专用 Key…");
    try { record = await client.connect({ group: groupSelect.value, budgetUsd: amount, consent: true }); renderRecord(); showStatus("已接入。开启 AI 陪玩后才会发起聊天请求。"); }
    catch (error) { showStatus(error?.message || "接入失败。"); }
    finally { busy = false; renderRecord(); onStateChange(); }
  });
  changeButton.addEventListener("click", async () => {
    if (!record || !changeSelect.value || changeSelect.value === record.group) return;
    const nextGroup = changeSelect.value;
    busy = true; renderRecord(); showStatus("正在更新专用 Key 分组…");
    try { record = await client.changeGroup(nextGroup); showStatus("专用 Key 分组已更新。"); }
    catch (error) { showStatus(error?.message || "更新失败。"); }
    finally { busy = false; renderRecord(); onStateChange(); }
  });
  disableButton.addEventListener("click", async () => {
    if (!record || record.disabled) return;
    busy = true; renderRecord(); showStatus("正在禁用本陪玩专用 Key…");
    try { record = await client.disable(); showStatus("专用 Key 已禁用；其他令牌未更改。"); }
    catch (error) { showStatus(error?.message || "禁用失败。"); }
    finally { busy = false; renderRecord(); onStateChange(); }
  });
  return { get mode() { return mode; }, get connected() { return Boolean(record?.connected && !record.disabled); }, destroy() { alive = false; unsubscribeSession?.(); root.remove(); } };
}
