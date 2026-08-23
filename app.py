"""
跨境电商标题工作流工具 - 后端主程序
功能：
1. 标题生成 / 优化（Amazon / Temu 平台，中英文）
2. 图片 AI 识别生成热搜词 / 痛点 / 卖点
3. DeepSeek API Key 配置入口
4. 版本检查与自动更新
"""
import base64
import json
import os
import re
import uuid
from pathlib import Path

import requests
from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    send_from_directory,
)
from dotenv import set_key

import config

app = Flask(__name__)

# 图片转 base64 的工具函数
def image_to_base64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def get_deepseek_key() -> str:
    """优先使用内存中的最新 key（已通过 /api/save-key 更新），否则用 .env"""
    return config.DEEPSEEK_API_KEY


def call_deepseek(messages: list, max_tokens: int = 2000) -> str:
    """调用 DeepSeek 对话接口，返回文本内容"""
    api_key = get_deepseek_key()
    if not api_key or api_key.startswith("sk-your"):
        return "ERROR: 请先在设置中填写有效的 DeepSeek API Key"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "deepseek-chat",
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }
    try:
        resp = requests.post(
            config.DEEPSEEK_API_URL, headers=headers, json=payload, timeout=60
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    except requests.exceptions.HTTPError as e:
        return f"ERROR: DeepSeek 接口返回错误 - {e}"
    except Exception as e:
        return f"ERROR: 调用失败 - {e}"


# ============ 页面路由 ============
@app.route("/")
def index():
    return render_template(
        "index.html", app_version=config.APP_VERSION
    )


@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(config.UPLOAD_DIR, filename)


# ============ API 路由 ============

@app.route("/api/save-key", methods=["POST"])
def save_key():
    """保存 DeepSeek API Key 到 .env"""
    data = request.get_json(silent=True) or {}
    key = (data.get("api_key") or "").strip()
    if not key:
        return jsonify({"ok": False, "msg": "Key 不能为空"})
    # 更新内存中的配置
    config.DEEPSEEK_API_KEY = key
    # 写入 .env 文件（持久化）
    env_path = config.BASE_DIR / ".env"
    if not env_path.exists():
        env_path.write_text("")
    set_key(env_path, "DEEPSEEK_API_KEY", key)
    return jsonify({"ok": True, "msg": "Key 已保存"})


@app.route("/api/status", methods=["GET"])
def status():
    """返回当前 key 是否配置、版本号"""
    has_key = bool(get_deepseek_key()) and not get_deepseek_key().startswith(
        "sk-your"
    )
    return jsonify({"ok": True, "has_key": has_key, "version": config.APP_VERSION})


@app.route("/api/generate-title", methods=["POST"])
def generate_title():
    """根据表单字段生成商品标题"""
    data = request.get_json(silent=True) or {}
    platform = data.get("platform", "amazon")  # amazon / temu
    language = data.get("language", "cn")       # cn / en
    fields = data.get("fields", {})

    # 把表单字段组织成提示词
    product = fields.get("product", "")
    category = fields.get("category", "")
    keywords = fields.get("keywords", "")
    audience = fields.get("audience", "")
    features = fields.get("features", "")
    existing_title = fields.get("existing_title", "")

    if language == "cn":
        lang_name = "中文"
        if existing_title:
            task = (
                "你是一个资深跨境电商运营。下面是一段已有标题，请基于提供的商品信息"
                "对其进行优化，使其更符合{platform}平台的搜索曝光规则，突出卖点与关键词。"
                "只输出优化后的标题，不要解释。"
            ).format(platform=("Amazon" if platform == "amazon" else "Temu"))
        else:
            task = (
                "你是一个资深跨境电商运营。请基于以下商品信息，为{platform}平台生成"
                "5 条高质量{lang}商品标题，每行一条，突出关键词与卖点，符合平台搜索习惯。"
            ).format(
                platform=("Amazon" if platform == "amazon" else "Temu"),
                lang=lang_name,
            )
    else:
        lang_name = "英文"
        if existing_title:
            task = (
                "You are a senior cross-border e-commerce operator. Optimize the "
                "existing title below for the {platform} platform's search algorithm, "
                "emphasizing keywords and selling points. Output only the optimized "
                "title, no explanation."
            ).format(platform=("Amazon" if platform == "amazon" else "Temu"))
        else:
            task = (
                "You are a senior cross-border e-commerce operator. Based on the "
                "product info below, generate 5 high-quality {lang} product titles "
                "for the {platform} platform, one per line, emphasizing keywords and "
                "selling points, following platform search habits."
            ).format(
                platform=("Amazon" if platform == "amazon" else "Temu"),
                lang=lang_name,
            )

    info = (
        f"商品名称: {product}\n品类: {category}\n核心关键词: {keywords}\n"
        f"目标人群: {audience}\n核心卖点/功能: {features}\n"
    )
    if existing_title:
        info += f"\n已有标题: {existing_title}\n"

    messages = [
        {"role": "system", "content": task},
        {"role": "user", "content": info},
    ]
    result = call_deepseek(messages)
    if result.startswith("ERROR"):
        return jsonify({"ok": False, "msg": result})
    return jsonify({"ok": True, "result": result})


@app.route("/api/analyze-image", methods=["POST"])
def analyze_image():
    """上传素材图，AI 识别生成热搜词 / 痛点 / 卖点"""
    if "image" not in request.files:
        return jsonify({"ok": False, "msg": "未检测到图片"})

    file = request.files["image"]
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in config.ALLOWED_IMAGE_EXT:
        return jsonify({"ok": False, "msg": "不支持的图片格式"})

    # 保存上传图片
    filename = f"{uuid.uuid4().hex}{ext}"
    save_path = config.UPLOAD_DIR / filename
    file.save(save_path)

    # 转 base64，构建多模态提示
    b64 = image_to_base64(str(save_path))
    # 判断图片类型（简单按后缀映射 mime）
    mime = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
    }.get(ext, "image/jpeg")

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

    result = call_deepseek(messages, max_tokens=1500)
    if result.startswith("ERROR"):
        return jsonify({"ok": False, "msg": result})

    # 解析结果分段
    parsed = parse_analysis(result)
    return jsonify({"ok": True, "result": result, "parsed": parsed})


def parse_analysis(text: str) -> dict:
    """把 AI 返回的文本解析为结构化字段"""
    out = {"product": "", "hotwords": "", "painpoints": [], "sellingpoints": []}
    # 简单按标题块切分
    blocks = re.split(r"【|】", text)
    # blocks 形如 ['', '商品识别', '内容', '热搜词', '内容', ...]
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


@app.route("/api/check-update", methods=["GET"])
def check_update():
    """检查更新（调用 updater 模块）"""
    import updater

    do_update = request.args.get("do_update", "0") == "1"
    result = updater.check_and_update(auto_restart=do_update)
    if result["update_available"]:
        if do_update and result.get("pulled"):
            return jsonify({"ok": True, "msg": "已拉取新版本并重启，请刷新页面"})
        return jsonify(
            {
                "ok": True,
                "update_available": True,
                "current_version": result["current_version"],
                "latest_version": result["latest_version"],
                "msg": f"发现新版本 v{result['latest_version']}，点击确定更新",
            }
        )
    return jsonify(
        {
            "ok": True,
            "update_available": False,
            "current_version": result["current_version"],
            "latest_version": result["latest_version"],
            "msg": "已是最新版本",
        }
    )


if __name__ == "__main__":
    app.run(host=config.HOST, port=config.PORT, debug=False)
