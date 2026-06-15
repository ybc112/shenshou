const ethers = window.ethers;

const LAUNCHPAD_ABI = [
  "function vault() view returns (address)",
  "function creationFee() view returns (uint256)",
  "function projectCount() view returns (uint256)",
  "function getProjects(uint256 offset,uint256 limit) view returns (tuple(uint256 id,address token,address creator,string beastName,string tokenName,string tokenSymbol,string metadataURI,uint256 initialSupply,uint256 auraThreshold,uint8 beastType,uint256 createdAt)[] projects)",
  "function getProject(uint256 projectId) view returns (tuple(uint256 id,address token,address creator,string beastName,string tokenName,string tokenSymbol,string metadataURI,uint256 initialSupply,uint256 auraThreshold,uint8 beastType,uint256 createdAt) project)",
  "function createBeast((string beastName,string tokenName,string tokenSymbol,string metadataURI,uint256 initialSupply,uint256 auraThreshold,uint8 beastType) params) payable returns (address token)"
];

const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function stage() view returns (uint8)",
  "function aura() view returns (uint256)",
  "function auraThreshold() view returns (uint256)",
  "function tradingEnabled() view returns (bool)",
  "function withdrawableDividendOf(address account) view returns (uint256)",
  "function claimDividends() returns (uint256 amount)",
  "function triggerEvolution()"
];

const VAULT_ABI = [
  "function poolBalances(address token) view returns (uint256 evolution,uint256 fortune,uint256 risk,uint256 reward,uint256 treasury,uint256 burned,uint256 dividendReserve,uint256 dividendsDistributed,uint256 dividendsPaid)"
];

const BEAST_RUNES = ["麒", "凤", "貔", "狐", "龙", "虎", "玄", "兽"];
const STAGE_NAMES = ["神兽蛋", "幼兽", "成长期", "觉醒", "神兽降临"];
const PAGE_NAMES = ["home", "beasts", "create", "rank", "reward", "data", "help"];
const ZERO = 0n;

const state = {
  account: "",
  launchpadAddress: "",
  provider: null,
  signer: null,
  launchpad: null,
  vault: null,
  vaultAddress: "",
  projects: [],
  selectedProjectId: null,
  stageFilter: "all",
  creationFee: ZERO,
  activePage: "home"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function shortAddress(address) {
  if (!address || address === "--") return "--";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatToken(value, symbol = "") {
  if (value === null || value === undefined) return "--";
  const formatted = ethers.formatEther(value);
  const [whole, decimal = ""] = formatted.split(".");
  const trimmed = decimal.replace(/0+$/, "").slice(0, 4);
  const compact = trimmed ? `${whole}.${trimmed}` : whole;
  return symbol ? `${compact} ${symbol}` : compact;
}

function formatCount(value) {
  if (value === null || value === undefined || value === "--") return "--";
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function percentOf(value, threshold) {
  if (!threshold || threshold === ZERO) return 0;
  const pct = Number((value * 10_000n) / threshold) / 100;
  return Math.min(100, Math.max(0, pct));
}

function compareBigIntDesc(left, right) {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function setText(selector, value) {
  $$(selector).forEach((el) => {
    el.textContent = value;
  });
}

function showToast(message, type = "info") {
  const toast = $(".toast");
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function setLoading(isLoading, message = "读取链上数据中...") {
  document.body.classList.toggle("is-loading", isLoading);
  const grids = $$("[data-project-grid]");
  if (isLoading) {
    grids.forEach((grid) => {
      grid.innerHTML = emptyMarkup("loader-circle", message, "请稍等，正在从合约读取项目、税池和分红数据。");
    });
    refreshIcons();
  }
}

function emptyMarkup(icon, title, text) {
  return `
    <article class="empty-state">
      <i data-lucide="${icon}"></i>
      <strong>${title}</strong>
      <p>${text}</p>
    </article>
  `;
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }
}

function normalizeProject(project) {
  return {
    id: Number(project.id ?? project[0]),
    token: project.token ?? project[1],
    creator: project.creator ?? project[2],
    beastName: project.beastName ?? project[3],
    tokenName: project.tokenName ?? project[4],
    tokenSymbol: project.tokenSymbol ?? project[5],
    metadataURI: project.metadataURI ?? project[6],
    initialSupply: project.initialSupply ?? project[7],
    auraThreshold: project.auraThreshold ?? project[8],
    beastType: Number(project.beastType ?? project[9]),
    createdAt: Number(project.createdAt ?? project[10])
  };
}

function beastRune(project) {
  return BEAST_RUNES[Number(project?.beastType || 0)] || "兽";
}

function beastTone(project) {
  return `tone-${Number(project?.beastType || 0) % BEAST_RUNES.length}`;
}

function beastSigilMarkup(project, size = "") {
  return `<span class="beast-sigil ${size} ${beastTone(project)}" data-beast-type="${project.beastType}" aria-hidden="true">${beastRune(project)}</span>`;
}

function getStoredLaunchpadAddress() {
  const fromStorage = localStorage.getItem("ruyi.launchpadAddress") || "";
  const fromConfig = window.RUYI_CONFIG?.launchpadAddress || "";
  return fromStorage || fromConfig;
}

async function makeProvider() {
  if (!ethers) {
    throw new Error("ethers 加载失败，请检查 web/vendor/ethers.umd.min.js");
  }

  if (window.RUYI_CONFIG?.rpcUrl) {
    return new ethers.JsonRpcProvider(window.RUYI_CONFIG.rpcUrl);
  }

  if (window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum);
  }

  throw new Error("未检测到钱包或 RPC，请安装钱包插件，或在 config.js 配置 rpcUrl。");
}

async function connectContracts() {
  state.launchpadAddress = getStoredLaunchpadAddress().trim();
  const input = $("[data-address-form] input[name='launchpad']");
  if (input) input.value = state.launchpadAddress;

  if (!state.launchpadAddress || !ethers.isAddress(state.launchpadAddress)) {
    updateConnectionStatus("请填写有效的 Launchpad 合约地址。", false);
    clearChainData();
    return false;
  }

  state.provider = await makeProvider();
  state.launchpad = new ethers.Contract(state.launchpadAddress, LAUNCHPAD_ABI, state.provider);
  state.vaultAddress = await state.launchpad.vault();
  state.vault = new ethers.Contract(state.vaultAddress, VAULT_ABI, state.provider);
  state.creationFee = await state.launchpad.creationFee();

  const network = await state.provider.getNetwork();
  setText("[data-stat='networkName']", network.name === "unknown" ? `Chain ${network.chainId}` : network.name);
  setText("[data-creation-fee]", `${formatToken(state.creationFee)} ETH/BNB`);
  updateConnectionStatus(`已连接 Launchpad ${shortAddress(state.launchpadAddress)}，Vault ${shortAddress(state.vaultAddress)}。`, true);
  return true;
}

function updateConnectionStatus(message, ok) {
  const el = $("[data-connection-status]");
  const banner = $("[data-config-banner]");
  if (el) el.textContent = message;
  if (banner) banner.dataset.connected = ok ? "true" : "false";
}

function clearChainData() {
  state.projects = [];
  state.selectedProjectId = null;
  updateStats();
  renderAllViews();
}

async function loadProjects() {
  if (!state.launchpad || !state.vault) return;

  setLoading(true);
  try {
    const count = Number(await state.launchpad.projectCount());
    const rawProjects = count > 0 ? await state.launchpad.getProjects(0, Math.min(count, 48)) : [];
    const normalized = rawProjects.map(normalizeProject);
    state.projects = await Promise.all(normalized.map(enrichProject));
    state.projects.sort((a, b) => b.progress - a.progress || b.id - a.id);

    if (state.selectedProjectId === null && state.projects.length > 0) {
      state.selectedProjectId = state.projects[0].id;
    }

    updateStats();
    renderAllViews();
    await renderIdentity();
  } catch (error) {
    console.error(error);
    showToast(`读取失败：${shortError(error)}`, "error");
    updateConnectionStatus(`读取失败：${shortError(error)}`, false);
  } finally {
    setLoading(false);
  }
}

async function enrichProject(project) {
  const token = new ethers.Contract(project.token, TOKEN_ABI, state.provider);
  const [stage, aura, threshold, totalSupply, symbol, tradingEnabled, pools] = await Promise.all([
    token.stage().catch(() => 0n),
    token.aura().catch(() => ZERO),
    token.auraThreshold().catch(() => project.auraThreshold || ZERO),
    token.totalSupply().catch(() => project.initialSupply || ZERO),
    token.symbol().catch(() => project.tokenSymbol),
    token.tradingEnabled().catch(() => false),
    state.vault.poolBalances(project.token).catch(() => null)
  ]);

  const stageNumber = Number(stage);
  const auraValue = BigInt(aura);
  const thresholdValue = BigInt(threshold);
  const progress = percentOf(auraValue, thresholdValue);

  return {
    ...project,
    stage: stageNumber,
    aura: auraValue,
    auraThreshold: thresholdValue,
    totalSupply: BigInt(totalSupply),
    symbol,
    tradingEnabled,
    pools,
    progress,
    canEvolve: progress >= 100 && stageNumber < 4
  };
}

function updateStats() {
  const projectCount = state.projects.length;
  const evolvedCount = state.projects.filter((project) => project.stage > 0).length;
  const readyCount = state.projects.filter((project) => project.canEvolve).length;
  const byStage = [0, 1, 2].map((stage) => state.projects.filter((project) => project.stage === stage).length);
  const totalBurned = sumPools("burned");
  const dividendReserve = sumPools("dividendReserve");
  const dividendsDistributed = sumPools("dividendsDistributed");

  setText("[data-stat='projectCount']", formatCount(projectCount));
  setText("[data-stat='projectCountHero']", formatCount(projectCount));
  setText("[data-stat='evolvedCount']", formatCount(evolvedCount));
  setText("[data-stat='evolvedCountHero']", formatCount(evolvedCount));
  setText("[data-stat='totalBurned']", formatToken(totalBurned));
  setText("[data-stat='totalBurnedHero']", formatToken(totalBurned));
  setText("[data-stat='dividendReserve']", formatToken(dividendReserve));
  setText("[data-stat='dividendsDistributed']", formatToken(dividendsDistributed));

  setText("[data-stage-count='all']", formatCount(projectCount));
  setText("[data-stage-count='0']", formatCount(byStage[0]));
  setText("[data-stage-count='1']", formatCount(byStage[1]));
  setText("[data-stage-count='2']", formatCount(byStage[2]));
  setText("[data-stage-count='ready']", formatCount(readyCount));
}

function sumPools(key) {
  return state.projects.reduce((sum, project) => {
    const pools = normalizePools(project.pools);
    return sum + (pools[key] || ZERO);
  }, ZERO);
}

function normalizePools(pools) {
  if (!pools) {
    return {
      evolution: ZERO,
      fortune: ZERO,
      risk: ZERO,
      reward: ZERO,
      treasury: ZERO,
      burned: ZERO,
      dividendReserve: ZERO,
      dividendsDistributed: ZERO,
      dividendsPaid: ZERO
    };
  }

  return {
    evolution: BigInt(pools.evolution ?? pools[0]),
    fortune: BigInt(pools.fortune ?? pools[1]),
    risk: BigInt(pools.risk ?? pools[2]),
    reward: BigInt(pools.reward ?? pools[3]),
    treasury: BigInt(pools.treasury ?? pools[4]),
    burned: BigInt(pools.burned ?? pools[5]),
    dividendReserve: BigInt(pools.dividendReserve ?? pools[6]),
    dividendsDistributed: BigInt(pools.dividendsDistributed ?? pools[7]),
    dividendsPaid: BigInt(pools.dividendsPaid ?? pools[8])
  };
}

function filteredProjects() {
  if (state.stageFilter === "all") return state.projects;
  if (state.stageFilter === "ready") return state.projects.filter((project) => project.canEvolve);
  return state.projects.filter((project) => String(project.stage) === state.stageFilter);
}

function renderProjects() {
  const grids = $$("[data-project-grid]");
  if (grids.length === 0) return;

  const projects = filteredProjects();
  if (!state.launchpadAddress || !ethers.isAddress(state.launchpadAddress)) {
    grids.forEach((grid) => {
      grid.innerHTML = emptyMarkup("plug-zap", "等待合约地址", "填写并保存 Launchpad 地址后，神兽大厅会展示真实链上项目。");
    });
    refreshIcons();
    return;
  }

  if (projects.length === 0) {
    grids.forEach((grid) => {
      grid.innerHTML = emptyMarkup("egg", "暂无链上神兽", "可以使用下方创建表单上链创建第一只神兽。");
    });
    refreshIcons();
    return;
  }

  grids.forEach((grid) => {
    const pageProjects = grid.dataset.projectGrid === "hall" ? projectSearchAndSort(projects) : projects.slice(0, 4);
    if (pageProjects.length === 0) {
      grid.innerHTML = emptyMarkup("search", "没有匹配的神兽", "换个关键词或切换筛选条件后再查看。");
      return;
    }
    grid.innerHTML = pageProjects.map(projectCardMarkup).join("");
  });
  refreshIcons();
}

function projectSearchAndSort(projects) {
  const keyword = ($("[data-project-search]")?.value || "").trim().toLowerCase();
  const sort = $("[data-project-sort]")?.value || "progress";

  const searched = !keyword
    ? [...projects]
    : projects.filter((project) => {
        return [
          project.beastName,
          project.tokenName,
          project.symbol,
          project.token,
          project.creator
        ].some((value) => String(value || "").toLowerCase().includes(keyword));
      });

  return searched.sort((a, b) => {
    const poolsA = normalizePools(a.pools);
    const poolsB = normalizePools(b.pools);
    if (sort === "burned") return compareBigIntDesc(poolsB.burned, poolsA.burned);
    if (sort === "reward") return compareBigIntDesc(poolsB.reward + poolsB.dividendReserve, poolsA.reward + poolsA.dividendReserve);
    if (sort === "created") return b.createdAt - a.createdAt;
    return b.progress - a.progress || b.id - a.id;
  });
}

function projectCardMarkup(project, index) {
  const rank = index + 1;
  const pools = normalizePools(project.pools);
  const stageClass = project.canEvolve ? "warning" : "";
  const rankClass = rank === 2 ? "silver" : rank === 3 ? "bronze" : rank > 3 ? "dark" : "";
  const selectedClass = project.id === state.selectedProjectId ? "selected" : "";

  return `
    <article class="beast-card ${selectedClass}">
      <div class="rank-badge ${rankClass}">${rank}</div>
      <span class="stage-badge ${stageClass}">${project.canEvolve ? "可进化" : STAGE_NAMES[project.stage] || "未知"}</span>
      <div class="beast-art ${beastTone(project)}">
        <span>${beastRune(project)}</span>
      </div>
      <div class="beast-body">
        <div class="beast-heading">
          <h3>${escapeHtml(project.beastName || project.tokenName)}</h3>
          <span>${escapeHtml(project.symbol || project.tokenSymbol)}</span>
        </div>
        <div class="progress-line">
          <label>灵气值 <strong>${project.progress.toFixed(0)}%</strong></label>
          <div><span style="width: ${project.progress}%"></span></div>
        </div>
        <dl class="beast-meta">
          <div><dt>奖励池</dt><dd>${formatToken(pools.reward + pools.dividendReserve, project.symbol)}</dd></div>
          <div><dt>累计销毁</dt><dd>${formatToken(pools.burned, project.symbol)}</dd></div>
        </dl>
        <button class="gold-button full" type="button" data-enter-project="${project.id}">进入兽巢</button>
      </div>
    </article>
  `;
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.selectedProjectId) || null;
}

function renderSelectedProject(project) {
  if (!project) {
    setText("[data-selected-name]", "请选择一只神兽");
    setText("[data-selected-token]", "Token: --");
    setText("[data-selected-stage]", "--");
    setText("[data-selected-progress]", "--");
    setText("[data-selected-reward]", "--");
    setText("[data-selected-burned]", "--");
    setText("[data-selected-aura-label]", "--");
    $$("[data-selected-aura-bar]").forEach((bar) => {
      bar.style.width = "0%";
    });
    return;
  }

  const pools = normalizePools(project.pools);
  setText("[data-selected-name]", `${project.beastName} (${project.symbol})`);
  setText("[data-selected-token]", `Token: ${shortAddress(project.token)}`);
  setText("[data-selected-stage]", STAGE_NAMES[project.stage] || "未知");
  setText("[data-selected-progress]", `${project.progress.toFixed(2)}%`);
  setText("[data-selected-reward]", formatToken(pools.reward + pools.dividendReserve, project.symbol));
  setText("[data-selected-burned]", formatToken(pools.burned, project.symbol));
  setText("[data-selected-aura-label]", `${formatToken(project.aura, project.symbol)} / ${formatToken(project.auraThreshold, project.symbol)}`);
  $$("[data-selected-aura-bar]").forEach((bar) => {
    bar.style.width = `${project.progress}%`;
  });
}

function renderNextProject() {
  const next = [...state.projects]
    .filter((project) => project.stage < 4)
    .sort((a, b) => b.progress - a.progress)[0];

  if (!next) {
    const sigil = $("[data-next-sigil]");
    if (sigil) {
      sigil.textContent = "兽";
      sigil.dataset.beastType = "0";
      sigil.className = "beast-sigil mini tone-0";
    }
    setText("[data-next-name]", "暂无神兽");
    setText("[data-next-symbol]", "--");
    setText("[data-next-progress]", "--");
    setText("[data-next-desc]", "创建或读取项目后自动更新。");
    const bar = $("[data-next-bar]");
    if (bar) bar.style.width = "0%";
    return;
  }

  const sigil = $("[data-next-sigil]");
  if (sigil) {
    sigil.textContent = beastRune(next);
    sigil.dataset.beastType = String(next.beastType);
    sigil.className = `beast-sigil mini ${beastTone(next)}`;
  }
  setText("[data-next-name]", next.beastName);
  setText("[data-next-symbol]", next.symbol);
  setText("[data-next-progress]", `${next.progress.toFixed(0)}%`);
  setText("[data-next-desc]", next.canEvolve ? "灵气已满，可触发进化。" : `距离进化还差 ${(100 - next.progress).toFixed(0)}%。`);
  $("[data-next-bar]").style.width = `${next.progress}%`;
}

function renderAllViews() {
  renderProjects();
  renderSelectedProject(selectedProject());
  renderNextProject();
  renderRankTable();
  renderDataCenter();
  renderRewardProjects();
}

function renderRankTable() {
  const tbody = $("[data-rank-table]");
  if (!tbody) return;

  if (state.projects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">暂无链上神兽数据</td></tr>`;
    return;
  }

  tbody.innerHTML = [...state.projects]
    .sort((a, b) => b.progress - a.progress || b.stage - a.stage)
    .map((project, index) => {
      const pools = normalizePools(project.pools);
      return `
        <tr>
          <td><strong class="table-rank">${index + 1}</strong></td>
          <td>
            <div class="table-beast">
              ${beastSigilMarkup(project, "table")}
              <span>${escapeHtml(project.beastName)}<small>${escapeHtml(project.symbol)}</small></span>
            </div>
          </td>
          <td>${STAGE_NAMES[project.stage] || "未知"}</td>
          <td>${project.progress.toFixed(2)}%</td>
          <td>${formatToken(pools.reward + pools.dividendReserve, project.symbol)}</td>
          <td>${formatToken(pools.burned, project.symbol)}</td>
          <td><button class="outline-button table-action" type="button" data-enter-project="${project.id}">查看</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderDataCenter() {
  setText("[data-contract-launchpad]", `Launchpad: ${shortAddress(state.launchpadAddress)}`);
  const tbody = $("[data-pool-table]");
  if (!tbody) return;

  if (state.projects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">暂无税池数据</td></tr>`;
    return;
  }

  tbody.innerHTML = state.projects.map((project) => {
    const pools = normalizePools(project.pools);
    return `
      <tr>
        <td>${escapeHtml(project.beastName)} <small>${escapeHtml(project.symbol)}</small></td>
        <td>${formatToken(pools.evolution, project.symbol)}</td>
        <td>${formatToken(pools.fortune, project.symbol)}</td>
        <td>${formatToken(pools.risk, project.symbol)}</td>
        <td>${formatToken(pools.reward, project.symbol)}</td>
        <td>${formatToken(pools.treasury, project.symbol)}</td>
        <td>${formatToken(pools.burned, project.symbol)}</td>
        <td>${formatToken(pools.dividendReserve, project.symbol)}</td>
      </tr>
    `;
  }).join("");
}

function renderRewardProjects() {
  const container = $("[data-reward-projects]");
  if (!container) return;

  if (state.projects.length === 0) {
    container.innerHTML = emptyMarkup("gift", "暂无奖励数据", "读取神兽项目后，可在这里选择对应兽巢查看可领取分红。");
    refreshIcons();
    return;
  }

  container.innerHTML = state.projects.map((project) => {
    const pools = normalizePools(project.pools);
    const active = project.id === state.selectedProjectId ? "active" : "";
    return `
      <button class="mini-card ${active}" type="button" data-enter-project="${project.id}">
        ${beastSigilMarkup(project, "mini")}
        <span>${escapeHtml(project.beastName)}<small>${formatToken(pools.dividendReserve, project.symbol)} 可分红储备</small></span>
      </button>
    `;
  }).join("");
}

async function renderIdentity() {
  if (!state.account) {
    setText("[data-holder-title]", "未连接钱包");
    setText("[data-holder-balance]", "持仓：--");
    setText("[data-ticket-count]", "--");
    setText("[data-lucky-number]", "--");
    setText("[data-withdrawable-dividend]", "--");
    return;
  }

  const project = selectedProject();
  if (!project) {
    setText("[data-holder-title]", "普通兽主");
    setText("[data-holder-balance]", `钱包：${shortAddress(state.account)}`);
    setText("[data-ticket-count]", "--");
    setText("[data-lucky-number]", "--");
    setText("[data-withdrawable-dividend]", "--");
    return;
  }

  const token = new ethers.Contract(project.token, TOKEN_ABI, state.provider);
  const [balance, withdrawable] = await Promise.all([
    token.balanceOf(state.account).catch(() => ZERO),
    token.withdrawableDividendOf(state.account).catch(() => ZERO)
  ]);

  const formalThreshold = ethers.parseEther("1000000");
  const tickets = balance / ethers.parseEther("10000");

  setText("[data-holder-title]", balance >= formalThreshold ? "正式兽主" : balance > ZERO ? "普通兽主" : "观察者");
  setText("[data-holder-balance]", `持仓：${formatToken(balance, project.symbol)}`);
  setText("[data-ticket-count]", `${tickets.toString()} 张`);
  setText("[data-lucky-number]", state.account.slice(-2).toUpperCase());
  setText("[data-withdrawable-dividend]", formatToken(withdrawable, project.symbol));
}

async function connectWallet() {
  if (!window.ethereum) {
    showToast("未检测到钱包插件，请安装 MetaMask 或 OKX Wallet。", "error");
    return;
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  state.provider = provider;
  state.signer = await provider.getSigner();
  state.account = await state.signer.getAddress();
  setText("[data-wallet-label]", shortAddress(state.account));
  showToast("钱包已连接");

  if (state.launchpadAddress && ethers.isAddress(state.launchpadAddress)) {
    state.launchpad = new ethers.Contract(state.launchpadAddress, LAUNCHPAD_ABI, state.provider);
    state.vaultAddress = await state.launchpad.vault();
    state.vault = new ethers.Contract(state.vaultAddress, VAULT_ABI, state.provider);
    await loadProjects();
  }
}

function encodeJsonDataUri(payload) {
  const json = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return `data:application/json;base64,${encoded}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSize = 420;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/webp", 0.62));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

async function buildLocalMetadataURI(form, params) {
  const file = form.querySelector("[data-image-upload]")?.files?.[0] || null;
  let localImage = "";

  if (file) {
    if (!file.type.startsWith("image/")) {
      throw new Error("请选择图片文件");
    }
    if (file.size > 4 * 1024 * 1024) {
      throw new Error("图片不能超过 4MB");
    }
    localImage = await compressImageDataUrl(await readFileAsDataUrl(file));
  }

  return encodeJsonDataUri({
    name: params.beastName,
    tokenName: params.tokenName,
    symbol: params.tokenSymbol,
    beastType: params.beastType,
    image: localImage,
    storage: file ? "local-data-uri" : "generated-no-image",
    attributes: [
      { trait_type: "神兽类型", value: BEAST_RUNES[params.beastType] || "自定义" },
      { trait_type: "元数据来源", value: file ? "本地图片" : "前端生成" }
    ]
  });
}

async function updateUploadPreview(input) {
  const preview = input.closest("form")?.querySelector("[data-upload-preview]");
  if (!preview) return;

  const file = input.files?.[0];
  const title = preview.querySelector("strong");
  const desc = preview.querySelector("small");
  const sigil = preview.querySelector(".upload-sigil");
  preview.dataset.hasFile = file ? "true" : "false";

  if (!file) {
    preview.dataset.hasImage = "false";
    if (sigil) {
      sigil.style.backgroundImage = "";
      sigil.textContent = "兽";
    }
    if (title) title.textContent = "未选择图片";
    if (desc) desc.textContent = "选择本地图片后会写入本地元数据 URI";
    return;
  }

  if (sigil && file.type.startsWith("image/")) {
    const dataUrl = await readFileAsDataUrl(file);
    sigil.style.backgroundImage = `url("${dataUrl}")`;
    sigil.textContent = "";
    preview.dataset.hasImage = "true";
  }
  if (title) title.textContent = file.name;
  if (desc) desc.textContent = `${(file.size / 1024).toFixed(1)} KB，本地压缩后写入合约元数据`;
}

function resetUploadPreview(form) {
  const input = form.querySelector("[data-image-upload]");
  if (input) updateUploadPreview(input);
}

async function createBeast(event) {
  event.preventDefault();
  if (!(await ensureWritable())) return;

  const form = event.currentTarget;
  const data = new FormData(form);
  const initialSupply = data.get("initialSupply") ? ethers.parseEther(data.get("initialSupply")) : ZERO;
  const auraThreshold = data.get("auraThreshold") ? ethers.parseEther(data.get("auraThreshold")) : ZERO;

  const params = {
    beastName: data.get("beastName").trim(),
    tokenName: data.get("tokenName").trim(),
    tokenSymbol: data.get("tokenSymbol").trim(),
    metadataURI: "",
    initialSupply,
    auraThreshold,
    beastType: Number(data.get("beastType"))
  };

  try {
    params.metadataURI = await buildLocalMetadataURI(form, params);
    showToast("创建交易已发起，请在钱包确认。");
    const launchpadWithSigner = state.launchpad.connect(state.signer);
    const tx = await launchpadWithSigner.createBeast(
      [
        params.beastName,
        params.tokenName,
        params.tokenSymbol,
        params.metadataURI,
        params.initialSupply,
        params.auraThreshold,
        params.beastType
      ],
      { value: state.creationFee }
    );
    showToast("交易已提交，等待上链...");
    await tx.wait();
    showToast("神兽创建成功");
    form.reset();
    resetUploadPreview(form);
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`创建失败：${shortError(error)}`, "error");
  }
}

async function claimDividends() {
  const project = selectedProject();
  if (!project || !(await ensureWritable())) return;

  try {
    const token = new ethers.Contract(project.token, TOKEN_ABI, state.signer);
    const withdrawable = await token.withdrawableDividendOf(state.account);
    if (withdrawable === ZERO) {
      showToast("当前没有可领取分红。");
      return;
    }

    showToast("领取交易已发起，请在钱包确认。");
    const tx = await token.claimDividends();
    await tx.wait();
    showToast("分红领取成功");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`领取失败：${shortError(error)}`, "error");
  }
}

async function triggerEvolution() {
  const project = selectedProject();
  if (!project || !(await ensureWritable())) return;

  try {
    const token = new ethers.Contract(project.token, TOKEN_ABI, state.signer);
    showToast("进化交易已发起，请在钱包确认。");
    const tx = await token.triggerEvolution();
    await tx.wait();
    showToast("神兽进化成功");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`进化失败：${shortError(error)}`, "error");
  }
}

async function ensureWritable() {
  if (!state.launchpad || !state.launchpadAddress) {
    showToast("请先配置 Launchpad 合约地址。", "error");
    return false;
  }

  if (!state.account || !state.signer) {
    await connectWallet();
  }

  return Boolean(state.signer);
}

function shortError(error) {
  return error?.shortMessage || error?.reason || error?.message?.split("\n")[0] || "未知错误";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function copyTokenAddress() {
  const project = selectedProject();
  if (!project) return;
  navigator.clipboard?.writeText(project.token);
  showToast("Token 地址已复制");
}

function pageFromHash(hash = window.location.hash) {
  const page = String(hash || "#home").replace("#", "");
  return PAGE_NAMES.includes(page) ? page : "home";
}

function updateNavigationActive(page) {
  $$("[data-nav]").forEach((item) => {
    item.classList.toggle("active", pageFromHash(item.dataset.nav) === page);
  });

  $$(".top-tabs a[href^='#']").forEach((link) => {
    link.classList.toggle("active", pageFromHash(link.getAttribute("href")) === page);
  });
}

function showPage(pageName, options = {}) {
  const page = PAGE_NAMES.includes(pageName) ? pageName : "home";
  const { updateHash = true, scroll = true } = options;

  state.activePage = page;
  $$("[data-page]").forEach((view) => {
    view.classList.toggle("active", view.dataset.page === page);
  });
  updateNavigationActive(page);

  if (updateHash && window.location.hash !== `#${page}`) {
    window.history.pushState({ page }, "", `#${page}`);
  }

  if (scroll) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function setActiveButton(button) {
  const group = button.closest(".side-nav, .status-strip, .mobile-dock");
  if (!group) return;
  $$("button", group).forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}

function navigateTo(selector) {
  showPage(pageFromHash(selector));
}

function bindEvents() {
  $("[data-address-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = new FormData(event.currentTarget).get("launchpad").trim();
    if (!ethers.isAddress(address)) {
      showToast("请输入有效的合约地址。", "error");
      return;
    }
    localStorage.setItem("ruyi.launchpadAddress", address);
    await bootstrap();
  });

  $$("[data-create-form]").forEach((form) => {
    form.addEventListener("submit", createBeast);
  });

  $$("[data-image-upload]").forEach((input) => {
    input.addEventListener("change", () => {
      updateUploadPreview(input).catch((error) => showToast(shortError(error), "error"));
    });
  });

  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPage(pageFromHash(link.getAttribute("href")));
    });
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    setActiveButton(button);

    const nav = button.dataset.nav;
    if (nav) {
      showPage(pageFromHash(nav));
      return;
    }

    const projectId = button.dataset.enterProject;
    if (projectId !== undefined) {
      state.selectedProjectId = Number(projectId);
      renderAllViews();
      await renderIdentity();
      showPage("rank");
      return;
    }

    const action = button.dataset.action;
    if (action === "connect-wallet") await connectWallet();
    if (action === "refresh") await bootstrap();
    if (action === "claim-dividends") await claimDividends();
    if (action === "trigger-evolution") await triggerEvolution();
    if (action === "copy-token") copyTokenAddress();
    if (action === "select-first" && state.projects[0]) {
      state.selectedProjectId = state.projects[0].id;
      renderAllViews();
      await renderIdentity();
      showPage("rank");
    }
    if (action === "select-next") {
      const next = [...state.projects].filter((project) => project.stage < 4).sort((a, b) => b.progress - a.progress)[0];
      if (next) {
        state.selectedProjectId = next.id;
        renderAllViews();
        await renderIdentity();
        showPage("rank");
      }
    }
  });

  $$(".status-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.stageFilter = button.dataset.stageFilter;
      renderProjects();
    });
  });

  ["input", "change"].forEach((eventName) => {
    $("[data-project-search]")?.addEventListener(eventName, renderProjects);
    $("[data-project-sort]")?.addEventListener(eventName, renderProjects);
  });

  window.addEventListener("hashchange", () => showPage(pageFromHash(), { updateHash: false }));
  window.addEventListener("popstate", () => showPage(pageFromHash(), { updateHash: false }));
  window.ethereum?.on?.("accountsChanged", () => window.location.reload());
  window.ethereum?.on?.("chainChanged", () => window.location.reload());
}

async function bootstrap() {
  try {
    if (await connectContracts()) {
      await loadProjects();
    }
  } catch (error) {
    console.error(error);
    updateConnectionStatus(shortError(error), false);
    clearChainData();
  }
}

bindEvents();
showPage(pageFromHash(), { updateHash: false, scroll: false });
window.scrollTo({ top: 0, behavior: "auto" });
refreshIcons();
bootstrap();
