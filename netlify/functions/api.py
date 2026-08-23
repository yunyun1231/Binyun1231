"""
Netlify Functions 入口（生产环境）
前端访问 /.netlify/functions/api/<endpoint>
逻辑全部复用根目录的 core.py（通过 netlify.toml 的 included_files 打包进来）
"""
import json
import os

# core.py 由 netlify.toml 的 included_files 打包到函数目录，直接 import 即可
import core

APP_VERSION = "1.0.0"


def handler(event, context):
    try:
        method = event.get("httpMethod", "GET")
        path = event.get("path", "/")
        # 提取 endpoint（path 最后一段）
        endpoint = path.rstrip("/").split("/")[-1]

        body = {}
        raw = event.get("body")
        if raw:
            try:
                body = json.loads(raw)
            except Exception:
                body = {}

        if endpoint == "status":
            has_key = bool(os.getenv("DEEPSEEK_API_KEY", "").strip())
            return _ok({"has_key": has_key, "version": APP_VERSION})

        if endpoint == "save-key":
            # serverless 无法落盘，提示去配置环境变量
            return _ok(
                {
                    "msg": "云端环境请在 Netlify 后台配置环境变量 DEEPSEEK_API_KEY；"
                    "本页填写的 Key 会保存在你浏览器本地，同样可用。"
                }
            )

        if endpoint == "generate-title" and method == "POST":
            api_key = (body.get("api_key") or "").strip() or os.getenv("DEEPSEEK_API_KEY", "").strip()
            fields = body.get("fields", {})
            platform = body.get("platform", "amazon")
            language = body.get("language", "cn")
            result = core.generate_title(
                fields=fields, platform=platform, language=language, api_key=api_key
            )
            if result.startswith("ERROR"):
                return _err(result)
            return _ok({"result": result})

        if endpoint == "analyze-image" and method == "POST":
            api_key = (body.get("api_key") or "").strip() or os.getenv("DEEPSEEK_API_KEY", "").strip()
            b64 = body.get("image_base64", "")
            mime = body.get("mime", "image/jpeg")
            if not b64:
                return _err("未收到图片数据")
            try:
                img_bytes = core.base64.b64decode(b64)
            except Exception:
                return _err("图片数据解析失败")
            raw_text = core.analyze_image(img_bytes, mime, api_key=api_key)
            if raw_text.startswith("ERROR"):
                return _err(raw_text)
            parsed = core.parse_analysis(raw_text)
            return _ok({"result": raw_text, "parsed": parsed})

        if endpoint == "check-update":
            return _ok(
                {
                    "update_available": False,
                    "current_version": APP_VERSION,
                    "latest_version": APP_VERSION,
                    "msg": "云端由 Netlify 自动部署实现更新，git push 即生效",
                }
            )

        return _err("未知接口: " + endpoint, 404)
    except Exception as e:
        return _err("服务器错误: " + str(e), 500)


def _ok(data):
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"ok": True, **data}, ensure_ascii=False),
    }


def _err(msg, code=400):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"ok": False, "msg": msg}, ensure_ascii=False),
    }
