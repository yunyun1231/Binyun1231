/**
 * Netlify Functions 入口（生产环境，Node.js ESM）
 * 前端访问 /.netlify/functions/api/<endpoint> 或 /api/<endpoint>
 */

const APP_VERSION = "1.1.0";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const TEXT_MODEL = "deepseek-v4-flash";
const VISION_MODEL = "deepseek-v4-flash-vision-exp";

// ===== 平台违规词库（中英文，按平台区分）=====
// 类别：absolute 绝对化/夸大；medical 医疗宣称；promo 虚假促销；brand 侵权品牌；sensitive 敏感词
const VIOLATION_WORDS = {
  amazon: {
    absolute: ["best", "top", "first-class", "highest", "perfect", "100%", "#1", "number one", "super", "ultimate", "amazing", "premium", "original", "genuine", "最", "第一", "顶级", "国家级", "最佳", "万能", "百分百", "极品", "极致", "第一品牌", "唯一", "绝对", "史上", "销量第一"],
    medical: ["cure", "treat", "heal", "prevent", "diagnose", "therapy", "antiviral", "治愈", "治疗", "根治", "消炎", "杀菌", "防病毒", "疗效", "药用"],
    promo: ["free shipping", "cheapest", "guaranteed", "money back", "免费送", "最低价", "亏本", "跳楼价", "史上最低", "清仓", "免费"],
    brand: ["Amazon", "Prime", "Apple", "Samsung", "Nike", "Disney", "Lego", "Adidas", "Nintendo", "PlayStation", "Xbox", "iPhone", "iPad"],
    sensitive: ["COVID", "coronavirus", "疫情", "FDA approved", "FDA"],
  },
  temu: {
    absolute: ["best", "top", "first-class", "highest", "perfect", "100%", "#1", "number one", "super", "ultimate", "amazing", "最", "第一", "顶级", "国家级", "最佳", "万能", "百分百", "极品", "极致", "第一品牌", "唯一", "绝对", "史上", "销量第一", "爆款", "神器"],
    medical: ["cure", "treat", "heal", "prevent", "diagnose", "therapy", "antiviral", "治愈", "治疗", "根治", "消炎", "杀菌", "防病毒", "疗效", "药用"],
    promo: ["free shipping", "cheapest", "guaranteed", "money back", "免费送", "最低价", "亏本", "跳楼价", "史上最低", "清仓", "免费", "免费领"],
    brand: ["Apple", "Samsung", "Nike", "Disney", "Lego", "Adidas", "Nintendo", "PlayStation", "Xbox", "iPhone", "iPad"],
    sensitive: ["COVID", "coronavirus", "疫情", "FDA approved", "FDA"],
  },
};

const CATEGORY_LABEL = {
  absolute: "绝对化/夸大用语",
  medical: "医疗/功效宣称",
  promo: "虚假促销用语",
  brand: "侵权/品牌词",
  sensitive: "敏感词",
};

// 静态扫描：在文本中找出命中的违规词
function scanViolations(text, platform) {
  const lists = VIOLATION_WORDS[platform] || VIOLATION_WORDS.amazon;
  const found = [];
  const seen = new Set();
  for (const cat of Object.keys(lists)) {
    for (const w of lists[cat]) {
      let hit = false;
      if (/^[\x00-\x7F]+$/.test(w)) {
        // 纯 ASCII：用单词边界，避免 desktop 误匹配 top
        const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])", "i");
        hit = re.test(text);
      } else {
        hit = text.includes(w);
      }
      if (hit && !seen.has(w + cat)) {
        seen.add(w + cat);
        found.push({ word: w, category: cat, label: CATEGORY_LABEL[cat] || cat });
      }
    }
  }
  return found;
}

// AI 合规复核 + 改写规避（双重检测的第二层）
async function complianceReview(text, platformLabel, apiKey) {
  const sys =
    `你是跨境电商平台合规审核专家。请审核以下文本是否违反 ${platformLabel} 平台的商品发布规则，` +
    `重点检查：1) 绝对化/夸大用语；2) 医疗/功效宣称；3) 虚假促销用语；4) 未经授权的品牌/侵权词；` +
    `5) 其他平台违规表述。请输出一个合规版本（保留原意，只改掉违规处），并列出你修改/规避了哪些词及其原因。` +
    `严格只返回如下 JSON，不要任何额外文字：\n` +
    `{"clean":"合规后文本","changes":[{"word":"原违规词","reason":"规避原因"}]}`;
  const messages = [
    { role: "system", content: sys },
    { role: "user", content: text },
  ];
  const raw = await callDeepSeek(messages, apiKey, TEXT_MODEL, 1200, 15000);
  if (raw.startsWith("ERROR")) return { clean: text, changes: [], error: raw };
  // 解析 JSON（兼容 ```json 包裹）
  let jsonStr = raw.trim();
  const m = jsonStr.match(/\{[\s\S]*\}/);
  if (m) jsonStr = m[0];
  try {
    const obj = JSON.parse(jsonStr);
    return {
      clean: (obj.clean || text).toString(),
      changes: Array.isArray(obj.changes) ? obj.changes : [],
    };
  } catch {
    return { clean: text, changes: [], error: "AI 合规结果解析失败，已保留原文" };
  }
}

function getKey(provided) {
  return (provided || process.env.DEEPSEEK_API_KEY || "").trim();
}

async function callDeepSeek(messages, apiKey, model = TEXT_MODEL, maxTokens = 2000, timeoutMs = 25000, jsonMode = false) {
  const key = getKey(apiKey);
  if (!key || key.startsWith("sk-your")) {
    return "ERROR: 请先配置有效的 DeepSeek API Key";
  }

  const payload = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
  };
  if (jsonMode) payload.response_format = { type: "json_object" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let hint = "";
      if (resp.status === 401) hint = "API Key 无效或复制不完整";
      else if (resp.status === 402) hint = "DeepSeek 账户余额不足，请充值";
      else if (resp.status === 429) hint = "请求太频繁被限流，请稍等几秒再试";
      else if (resp.status === 400) hint = "请求参数或模型名有误";
      return `ERROR: DeepSeek 接口返回错误 - HTTP ${resp.status} ${hint} ${text.slice(0, 200)}`;
    }
    const data = await resp.json();
    const m0 = data.choices?.[0]?.message || {};
    // 防御：去掉推理模型可能混入正文的自言自语
    const cleaned = (m0.content || "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();
    if (cleaned) return cleaned;
    // 兼容推理模型：内容在 reasoning_content 里
    const reasoning = (m0.reasoning_content || "").trim();
    if (reasoning) return reasoning;
    return `ERROR: DeepSeek 返回为空 finish_reason=${data.choices?.[0]?.finish_reason || "unknown"}`;
  } catch (err) {
    return `ERROR: 调用失败 - ${err.message || err}`;
  }
}

function buildTitleMessages(platform, language, fields) {
  const product = fields.product || "";
  const category = fields.category || "";
  const keywords = fields.keywords || "";
  const audience = fields.audience || "";
  const features = fields.features || "";
  const existingTitle = fields.existing_title || "";

  const pf = platform === "amazon" ? "Amazon" : "Temu";

  const complianceNote =
    `注意平台合规：不要使用绝对化用语(best/最/顶级等)、医疗功效宣称(治愈/cure等)、` +
    `虚假促销用语、未经授权的品牌/侵权词，避免被${pf}下架或警告。`;

  const longTailNote =
    language === "cn"
      ? `标题策略要求（铺货长尾词打法）：\n` +
        `1. 避开 "storage bins" 等红海大词，不要堆砌宽泛词；\n` +
        `2. 多用「场景 + 人群 + 用途」结构的具体长尾词，例如 "small drawer organizer for makeup"、"under bed storage for shoes"、"带盖透明衣柜收纳盒"；\n` +
        `3. 从买家真实搜索角度出发，写清这个 SKU 解决什么具体生活问题；\n` +
        `4. 每条标题聚焦一个细分使用场景，让新品也能通过长尾流量获得曝光。`
      : `Title strategy (long-tail dropshipping approach):\n` +
        `1. Avoid red-ocean broad terms like "storage bins" and do not keyword-stuff;\n` +
        `2. Use specific long-tail phrases in the format "scene + audience + use", e.g. "small drawer organizer for makeup", "under bed storage for shoes";\n` +
        `3. Write from the buyer's real search intent and clearly state what specific life problem this SKU solves;\n` +
        `4. Focus each title on one narrow usage scenario so new listings can gain exposure through long-tail traffic.`;

  const titleLang = language === "cn" ? "中文" : "英文";
  const fmt =
    "直接输出一个 JSON 对象（不要输出任何解释、前言、思考过程或 markdown 代码块标记）。对象必须包含名为 titles 的数组，数组里恰好 3 个对象，每个对象有两个字段：\n" +
    "- title：字符串，根据上面的商品信息现写的一条真实完整的" + titleLang + "标题；严禁照抄任何示例文字、严禁占位符、严禁省略号\n" +
    "- point：字符串，该条标题主打的、与其他两条不同的核心卖点，用中文写一句话\n" +
    "三条 title 的切入角度必须互不相同（例如角度1=材质安全、角度2=场景适用、角度3=设计细节）。除 JSON 本身外不要输出任何其他文字。";

  const lead = existingTitle
    ? `你是资深跨境电商运营。下面是一段已有标题，请保留其商品信息，为${pf}平台优化出 3 条${titleLang}标题，每条主打一个互不相同卖点。`
    : `你是一个资深跨境电商运营。请基于商品信息，为${pf}平台生成 3 条${titleLang}标题，每条主打一个互不相同卖点。`;

  const diffNote =
    "三条标题之间要有明显差异，不要雷同（例如角度1=容量大、角度2=省空间、角度3=材质耐用）。三条都必须输出，缺一不可。除了 JSON 本身，不要输出任何其他文字。";

  const sys = lead + "\n" + diffNote + "\n\n" + fmt + "\n\n" + longTailNote + "\n\n" + complianceNote;

  const user = `商品名称: ${product}\n品类: ${category}\n核心关键词: ${keywords}\n目标人群: ${audience}\n核心卖点/功能: ${features}\n`;
  if (existingTitle) {
    return [sys, `${user}已有标题: ${existingTitle}\n`];
  }
  return [sys, user];
}

// 从模型输出里解析出 3 条标题（每条带独立卖点），兼容全角/半角冒号及 . 、 - 等分隔符
function parseTitles(text) {
  const out = [];
  const seen = new Set();
  let cur = null;
  const reTitle = /^\s*标题\s*([1-9])\s*[：:．.、\-]\s*(.+?)\s*$/;
  const reTrans = /^\s*翻译\s*([1-9])\s*[：:．.、\-]\s*(.+?)\s*$/;
  const rePoint = /^\s*卖点\s*([1-9])\s*[：:．.、\-]\s*(.+?)\s*$/;
  // 无效内容：占位符/省略号/空白装饰符/模板照抄
  const isJunk = (s) => !s || /^</.test(s) || /^[…‥\.。·•\-—_~]+$/.test(s) || TEMPLATE_ECHO_PAT.test(s);
  for (const line of (text || "").split(/\r?\n/)) {
    const mt = line.match(reTitle);
    const mr = line.match(reTrans);
    const mp = line.match(rePoint);
    if (mt) {
      if (seen.has(mt[1])) continue; // 编号重复时只保留第一次，防止多余卡片
      seen.add(mt[1]);
      cur = { n: mt[1], title: mt[2].trim(), translation: "", point: "" };
      out.push(cur);
    } else if (mr && cur) {
      cur.translation = mr[2].trim();
    } else if (mp && cur) {
      cur.point = mp[2].trim();
    }
  }
  return out
    .filter((t) => !isJunk(t.title))
    .map((t) => ({ ...t, point: isJunk(t.point) ? "" : t.point }))
    .slice(0, 3);
}

// 模板照抄/占位符检测：模型把格式示例词原样抄出来时视为无效
const TEMPLATE_ECHO_PAT = /合规后标题|原卖点|原违规词|规避原因|这里写|第[一二三]条.+标题/;

// 从模型输出解析标题 JSON（失败则回退到行式解析）
function extractTitles(text) {
  const isJunk = (s) =>
    !s || TEMPLATE_ECHO_PAT.test(s) || /^</.test(s.trim()) || /^[…‥\.。·•\-—_~\s]+$/.test(s.trim());
  let s = (text || "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      const arr = Array.isArray(obj.titles) ? obj.titles : [];
      const out = arr
        .map((t) => ({
          title: String(t.title || "").trim(),
          point: String(t.point || "").trim(),
        }))
        .filter((t) => !isJunk(t.title))
        .slice(0, 3);
      if (out.length) return out;
    } catch { /* 回退到行式解析 */ }
  }
  return parseTitles(text).map((t) => ({ title: t.title, point: t.point }));
}

// 标题合规改写：JSON 进 JSON 出，保持结构不被破坏
async function complianceFixTitles(titles, platformLabel, apiKey) {
  if (!titles.length) return { titles, changes: [] };
  const sys =
    `你是跨境电商平台合规审核专家。用户消息是 ${platformLabel} 平台的商品标题（JSON，titles 数组，每项有 title 和 point 字段）。` +
    `请逐条检查 title 是否有违规表述（绝对化/夸大用语、医疗功效宣称、虚假促销、未经授权品牌词等），只修改违规处，保留原意、原语言和条数，point 保持原文。` +
    `严格只返回一个 JSON 对象，不要任何解释、前言或 markdown 标记：对象包含 titles 数组（与输入一一对应、字段同名、内容为合规后的真实标题，必须根据输入现写，严禁照抄任何示例）和 changes 数组（每项含 word、reason 两个字段，word 填你实际改掉的违规词；没有违规则 changes 为空数组）。`;
  const messages = [
    { role: "system", content: sys },
    { role: "user", content: JSON.stringify({ titles: titles.map((t) => ({ title: t.title, point: t.point })) }) },
  ];
  const raw = await callDeepSeek(messages, apiKey, TEXT_MODEL, 1200, 15000, true);
  if (raw.startsWith("ERROR")) return { titles, changes: [] };
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : raw);
    const arr = Array.isArray(obj.titles) ? obj.titles : [];
    // 校验：防模板照抄（返回「合规后标题/原卖点」这类示例词）、防条数不符；任一发生就弃用改写、保留原标题
    const badTitle = (s) =>
      !s || TEMPLATE_ECHO_PAT.test(s) || /^</.test(s) || /^[…‥\.。·•\-—_~\s]+$/.test(s);
    const fixed = arr
      .map((t) => ({ title: String(t.title || "").trim(), point: String(t.point || "").trim() }))
      .filter((t) => !badTitle(t.title));
    if (fixed.length !== titles.length) {
      return { titles, changes: [] };
    }
    const changes = (Array.isArray(obj.changes) ? obj.changes : []).filter(
      (c) => c && c.word && !TEMPLATE_ECHO_PAT.test(String(c.word)) && !TEMPLATE_ECHO_PAT.test(String(c.reason || ""))
    );
    return { titles: fixed, changes };
  } catch {
    return { titles, changes: [] };
  }
}

async function generateTitle(fields, platform, language, apiKey, strict = false) {
  const [sysMsg, userMsg] = buildTitleMessages(platform, language, fields);
  const sys = strict
    ? sysMsg +
      "\n\n【格式硬性要求】必须直接输出 JSON 对象，titles 数组恰好 3 个对象。" +
      "必须写真实的标题和卖点内容，严禁输出 <full title> 或「…」等占位符，严禁只输出 1 个对象，严禁输出 JSON 以外的任何文字。"
    : sysMsg;
  const messages = [
    { role: "system", content: sys },
    { role: "user", content: userMsg },
  ];
  return callDeepSeek(messages, apiKey, TEXT_MODEL, 1600, 25000, true);
}

async function analyzeImage(imageBase64, mime, apiKey) {
  const prompt =
    "你是一个跨境电商选品与文案专家。请仔细分析这张商品图片。必须严格按以下格式输出，用中文，不要省略或合并任何一节，每一节内容写在该节标题下方：\n" +
    "【商品识别】\n一句话描述这是什么商品、什么材质/类型\n" +
    "【热搜词】\n8-12 个适合 Amazon/Temu 搜索的高热度关键词（英文，逗号分隔）\n" +
    "【用户痛点】\n3-5 条这类商品常见的用户痛点/顾虑，每条一行，以短横线开头\n" +
    "【卖点提炼】\n3-5 条可放进标题和详情页的核心卖点，每条一行，以短横线开头\n\n" +
    "合规要求：输出中不要使用绝对化用语(best/最/顶级等)、医疗功效宣称(治愈/cure等)、" +
    "虚假促销用语、未经授权的品牌/侵权词，避免违反平台规则。";

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${imageBase64}` },
        },
      ],
    },
  ];

  return callDeepSeek(messages, apiKey, VISION_MODEL, 1500);
}

function parseAnalysis(text) {
  const out = { product: "", hotwords: "", painpoints: [], sellingpoints: [] };
  const parts = text.split(/【|】/);
  for (let i = 1; i < parts.length - 1; i += 2) {
    const key = parts[i].trim();
    const val = parts[i + 1]?.trim() || "";
    if (key.includes("商品")) out.product = val;
    else if (key.includes("热搜")) out.hotwords = val;
    else if (key.includes("痛点")) {
      out.painpoints = val
        .split("\n")
        .map((line) => line.replace(/^[-•]\s*/, "").trim())
        .filter(Boolean);
    } else if (key.includes("卖点")) {
      out.sellingpoints = val
        .split("\n")
        .map((line) => line.replace(/^[-•]\s*/, "").trim())
        .filter(Boolean);
    }
  }
  return out;
}

function okResponse(data) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ ok: true, ...data }),
  };
}

function errResponse(msg) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ ok: false, msg }),
  };
}

exports.handler = async function handler(event, context) {
  const method = event.httpMethod || "GET";
  const path = event.path || "/";
  const endpoint = path.replace(/\/$/, "").split("/").pop() || "";

  let body = {};
  if (event.body) {
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
  }

  if (endpoint === "status") {
    const hasKey = Boolean(getKey().length);
    return okResponse({ has_key: hasKey, version: APP_VERSION });
  }

  if (endpoint === "save-key") {
    return okResponse({
      msg: "云端环境请在 Netlify 后台配置环境变量 DEEPSEEK_API_KEY；本页填写的 Key 会保存在你浏览器本地，同样可用。",
    });
  }

  if (endpoint === "generate-title" && method === "POST") {
    const apiKey = body.api_key || "";
    const platform = body.platform || "amazon";
    const language = body.language || "cn";
    const fields = body.fields || {};
    let raw = await generateTitle(fields, platform, language, apiKey);
    if (raw.startsWith("ERROR")) {
      return errResponse(raw);
    }
    // 保险：如果模型没按 JSON 格式输出（解析不到 2 条以上），带更严格指令重试一次
    let titles = extractTitles(raw);
    if (titles.length < 2) {
      const retry = await generateTitle(fields, platform, language, apiKey, true);
      if (!retry.startsWith("ERROR")) {
        const retryTitles = extractTitles(retry);
        if (retryTitles.length > titles.length) {
          raw = retry;
          titles = retryTitles;
        }
      }
    }
    if (!titles.length) {
      return errResponse("AI 没有返回有效标题，请重试一次。原始返回：" + raw.slice(0, 150));
    }
    // 合规：静态扫描 + AI 逐条改写（JSON 进 JSON 出，不破坏结构）
    const pfLabel = platform === "amazon" ? "Amazon" : "Temu";
    const joined = titles.map((t) => t.title).join("\n");
    let staticHits = scanViolations(joined, platform);
    const fix = await complianceFixTitles(titles, pfLabel, apiKey);
    if (fix.titles.length) titles = fix.titles;
    staticHits = scanViolations(titles.map((t) => t.title).join("\n"), platform);
    const result = titles
      .map((t, i) => `标题${i + 1}：${t.title}\n卖点${i + 1}：${t.point || "—"}`)
      .join("\n\n");
    return okResponse({
      result,
      raw_result: raw,
      titles,
      avoided: fix.changes,
      static_hits: staticHits,
    });
  }

  if (endpoint === "analyze-image" && method === "POST") {
    const apiKey = body.api_key || "";
    const b64 = body.image_base64 || "";
    const mime = body.mime || "image/jpeg";
    if (!b64) {
      return errResponse("未收到图片数据");
    }
    const rawText = await analyzeImage(b64, mime, apiKey);
    if (rawText.startsWith("ERROR")) {
      return errResponse(rawText);
    }
    // 图片分析面向 Amazon/Temu 双平台，合规复核同时扫两个词库
    const review = await complianceReview(rawText, "Amazon/Temu 跨境电商", apiKey);
    const parsed = parseAnalysis(review.clean);
    const staticHits = scanViolations(review.clean, "amazon").concat(
      scanViolations(review.clean, "temu")
    );
    return okResponse({
      result: review.clean,
      raw_result: rawText,
      avoided: review.changes,
      parsed,
      static_hits: staticHits,
    });
  }

  if (endpoint === "check-update") {
    return okResponse({
      update_available: false,
      current_version: APP_VERSION,
      latest_version: APP_VERSION,
      msg: "云端由 Netlify 自动部署实现更新，git push 即生效",
    });
  }

  return {
    statusCode: 404,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ok: false, msg: "接口不存在" }),
  };
}
