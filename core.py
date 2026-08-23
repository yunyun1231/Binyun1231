"""
核心 AI 逻辑模块（本地 Flask 与 Netlify Functions 共用）
- 调用 DeepSeek（文本模型 deepseek-v4-flash / 视觉模型 deepseek-v4-flash-vision-exp）
- 标题生成 / 优化
- 图片识别：热搜词 / 痛点 / 卖点
所有函数都是无状态的：API Key 由调用方传入，不在服务器落盘。
"""
import base64
import os
import re

import requests
from dotenv import load_dotenv

# 本地有 .env 就加载（Netlify 上无 .env 会自动跳过）
load_dotenv()

DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"
TEXT_MODEL = "deepseek-v4-flash"
VISION_MODEL = "deepseek-v4-flash-vision-exp"


def get_api_key(provided=None) -> str:
    """优先用调用方传入的 key，否则读环境变量"""
    if provided:
        return provided.strip()
    return os.getenv("DEEPSEEK_API_KEY", "").strip()


def call_deepseek(
    messages: list,
    api_key: str = None,
    model: str = TEXT_MODEL,
    max_tokens: int = 2000,
) -> str:
    """调用 DeepSeek 对话接口，返回文本内容"""
    key = get_api_key(api_key)
    if not key or key.startswith("sk-your"):
        return "ERROR: 请先配置有效的 DeepSeek API Key"

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }
    try:
        resp = requests.post(
            DEEPSEEK_API_URL, headers=headers, json=payload, timeout=90
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    except requests.exceptions.HTTPError as e:
        return f"ERROR: DeepSeek 接口返回错误 - {e}"
    except Exception as e:
        return f"ERROR: 调用失败 - {e}"


def build_title_messages(platform: str, language: str, fields: dict) -> tuple:
    """根据表单字段构造标题生成的提示词，返回 (system, user)"""
    product = fields.get("product", "")
    category = fields.get("category", "")
    keywords = fields.get("keywords", "")
    audience = fields.get("audience", "")
    features = fields.get("features", "")
    existing_title = fields.get("existing_title", "")

    pf = "Amazon" if platform == "amazon" else "Temu"

    if language == "cn":
        if existing_title:
            sys = (
                "你是一个资深跨境电商运营。下面是一段已有标题，请基于商品信息"
                "对其进行优化，使其更符合%s平台的搜索曝光规则，突出卖点与关键词。"
                "只输出优化后的标题，不要解释。" % pf
            )
        else:
            sys = (
                "你是一个资深跨境电商运营。请基于商品信息，为%s平台生成5条高质量"
                "中文商品标题，每行一条，突出关键词与卖点，符合平台搜索习惯。"
                % pf
            )
    else:
        if existing_title:
            sys = (
                "You are a senior cross-border e-commerce operator. Optimize the"
                " existing title below for the %s platform's search algorithm,"
                " emphasizing keywords and selling points. Output only the optimized"
                " title, no explanation." % pf
            )
        else:
            sys = (
                "You are a senior cross-border e-commerce operator. Based on the"
                " product info below, generate 5 high-quality English product titles"
                " for the %s platform, one per line, emphasizing keywords and selling"
                " points, following platform search habits." % pf
            )

    user = (
        f"商品名称: {product}\n品类: {category}\n核心关键词: {keywords}\n"
        f"目标人群: {audience}\n核心卖点/功能: {features}\n"
    )
    if existing_title:
        user += f"已有标题: {existing_title}\n"
    return sys, user


def generate_title(
    fields: dict, platform: str = "amazon", language: str = "cn", api_key: str = None
) -> str:
    sys_msg, user_msg = build_title_messages(platform, language, fields)
    messages = [
        {"role": "system", "content": sys_msg},
        {"role": "user", "content": user_msg},
    ]
    return call_deepseek(messages, api_key=api_key, model=TEXT_MODEL)


def analyze_image(image_bytes: bytes, mime: str, api_key: str = None) -> str:
    """上传素材图，AI 识别生成热搜词/痛点/卖点，返回原始文本"""
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    prompt = (
        "你是一个跨境电商选品与文案专家。请仔细分析这张商品图片，按以下格式输出，"
        "用中文，每一项用换行 + 短横线列出，尽量贴合真实跨境热销场景：\n"
        "【商品识别】一句话描述这是什么商品、什么材质/类型\n"
        "【热搜词】8-12 个适合 Amazon/Temu 搜索的高热度关键词（英文，逗号分隔）\n"
        "【用户痛点】3-5 条这类商品常见的用户痛点/顾虑\n"
        "【卖点提炼】3-5 条可放进标题和详情页的核心卖点"
    )
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                },
            ],
        }
    ]
    return call_deepseek(
        messages, api_key=api_key, model=VISION_MODEL, max_tokens=1500
    )


def parse_analysis(text: str) -> dict:
    """把 AI 返回的文本解析为结构化字段"""
    out = {"product": "", "hotwords": "", "painpoints": [], "sellingpoints": []}
    blocks = re.split(r"【|】", text)
    for i in range(1, len(blocks) - 1, 2):
        key = blocks[i].strip()
        val = blocks[i + 1].strip()
        if "商品" in key:
            out["product"] = val
        elif "热搜" in key:
            out["hotwords"] = val
        elif "痛点" in key:
            out["painpoints"] = [
                line.strip("-• ").strip()
                for line in val.splitlines()
                if line.strip()
            ]
        elif "卖点" in key:
            out["sellingpoints"] = [
                line.strip("-• ").strip()
                for line in val.splitlines()
                if line.strip()
            ]
    return out
