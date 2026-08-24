/**
 * Netlify Functions 入口（生产环境，Node.js ESM）
 * 前端访问 /.netlify/functions/api/<endpoint> 或 /api/<endpoint>
 */

const APP_VERSION = "1.0.0";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const TEXT_MODEL = "deepseek-v4-flash";
const VISION_MODEL = "deepseek-v4-flash-vision-exp";

function getKey(provided) {
  return (provided || process.env.DEEPSEEK_API_KEY || "").trim();
}

async function callDeepSeek(messages, apiKey, model = TEXT_MODEL, maxTokens = 2000) {
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
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
      return `ERROR: DeepSeek 接口返回错误 - HTTP ${resp.status} ${text.slice(0, 200)}`;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || "ERROR: DeepSeek 返回为空";
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

  let sys;
  if (language === "cn") {
    if (existingTitle) {
      sys = `你是一个资深跨境电商运营。下面是一段已有标题，请基于商品信息对其进行优化，使其更符合${pf}平台的搜索曝光规则，突出卖点与关键词。只输出优化后的标题，不要解释。`;
    } else {
      sys = `你是一个资深跨境电商运营。请基于商品信息，为${pf}平台生成5条高质量中文商品标题，每行一条，突出关键词与卖点，符合平台搜索习惯。`;
    }
  } else {
    if (existingTitle) {
      sys = `You are a senior cross-border e-commerce operator. Optimize the existing title below for the ${pf} platform's search algorithm, emphasizing keywords and selling points. Output only the optimized title, no explanation.`;
    } else {
      sys = `You are a senior cross-border e-commerce operator. Based on the product info below, generate 5 high-quality English product titles for the ${pf} platform, one per line, emphasizing keywords and selling points, following platform search habits.`;
    }
  }

  const user = `商品名称: ${product}\n品类: ${category}\n核心关键词: ${keywords}\n目标人群: ${audience}\n核心卖点/功能: ${features}\n`;
  if (existingTitle) {
    return [sys, `${user}已有标题: ${existingTitle}\n`];
  }
  return [sys, user];
}

async function generateTitle(fields, platform, language, apiKey) {
  const [sysMsg, userMsg] = buildTitleMessages(platform, language, fields);
  const messages = [
    { role: "system", content: sysMsg },
    { role: "user", content: userMsg },
  ];
  return callDeepSeek(messages, apiKey, TEXT_MODEL);
}

async function analyzeImage(imageBase64, mime, apiKey) {
  const prompt =
    "你是一个跨境电商选品与文案专家。请仔细分析这张商品图片，按以下格式输出，用中文，每一项用换行 + 短横线列出，尽量贴合真实跨境热销场景：\n" +
    "【商品识别】一句话描述这是什么商品、什么材质/类型\n" +
    "【热搜词】8-12 个适合 Amazon/Temu 搜索的高热度关键词（英文，逗号分隔）\n" +
    "【用户痛点】3-5 条这类商品常见的用户痛点/顾虑\n" +
    "【卖点提炼】3-5 条可放进标题和详情页的核心卖点";

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
    const result = await generateTitle(fields, platform, language, apiKey);
    if (result.startsWith("ERROR")) {
      return errResponse(result);
    }
    return okResponse({ result });
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
    const parsed = parseAnalysis(rawText);
    return okResponse({ result: rawText, parsed });
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
