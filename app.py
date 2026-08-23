"""
跨境电商标题工作流工具 - 本地调试用 Flask 服务
生产环境由 Netlify Functions（netlify/functions/api.py）提供同样接口，
前端统一访问 /api/*，本地和云端都不冲突。
"""
import os
from pathlib import Path

from dotenv import set_key
from flask import Flask, jsonify, request, send_from_directory

import core
import config

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"

app = Flask(__name__)


@app.route("/")
def index():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    # 兜底：静态资源（css/js）从 public 目录提供
    return send_from_directory(PUBLIC_DIR, filename)


@app.route("/api/status", methods=["GET"])
def status():
    has_key = bool(config.DEEPSEEK_API_KEY) and not config.DEEPSEEK_API_KEY.startswith(
        "sk-your"
    )
    return jsonify(
        {"ok": True, "has_key": has_key, "version": config.APP_VERSION}
    )


@app.route("/api/save-key", methods=["POST"])
def save_key():
    """本地调试用：把 Key 写入 .env（Netlify 上请用环境变量）"""
    data = request.get_json(silent=True) or {}
    key = (data.get("api_key") or "").strip()
    if not key:
        return jsonify({"ok": False, "msg": "Key 不能为空"})
    config.DEEPSEEK_API_KEY = key
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        env_path.write_text("")
    set_key(env_path, "DEEPSEEK_API_KEY", key)
    return jsonify({"ok": True, "msg": "Key 已保存到本地 .env"})


@app.route("/api/generate-title", methods=["POST"])
def generate_title():
    data = request.get_json(silent=True) or {}
    api_key = data.get("api_key")
    fields = data.get("fields", {})
    platform = data.get("platform", "amazon")
    language = data.get("language", "cn")
    result = core.generate_title(
        fields=fields, platform=platform, language=language, api_key=api_key
    )
    if result.startswith("ERROR"):
        return jsonify({"ok": False, "msg": result})
    return jsonify({"ok": True, "result": result})


@app.route("/api/analyze-image", methods=["POST"])
def analyze_image():
    data = request.get_json(silent=True) or {}
    api_key = data.get("api_key")
    b64 = data.get("image_base64", "")
    mime = data.get("mime", "image/jpeg")
    if not b64:
        return jsonify({"ok": False, "msg": "未收到图片数据"})
    try:
        img_bytes = core.base64.b64decode(b64)
    except Exception:
        return jsonify({"ok": False, "msg": "图片数据解析失败"})
    raw = core.analyze_image(img_bytes, mime, api_key=api_key)
    if raw.startswith("ERROR"):
        return jsonify({"ok": False, "msg": raw})
    parsed = core.parse_analysis(raw)
    return jsonify({"ok": True, "result": raw, "parsed": parsed})


@app.route("/api/check-update", methods=["GET"])
def check_update():
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
