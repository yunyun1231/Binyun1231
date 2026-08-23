"""
自动更新模块
思路：
1. 从 GitHub / Gitee 仓库读取最新版本号（version.txt）
2. 若本地版本低于最新版本，则拉取最新代码（git pull）并重启服务
注意：使用前需先在 config 或环境变量配置仓库地址
"""
import os
import subprocess
import sys

import config

# 仓库地址（用户后续把项目推到 GitHub/Gitee 后填入）
REPO_URL = os.getenv("REPO_URL", "")
VERSION_FILE_URL = os.getenv(
    "VERSION_FILE_URL", ""
)  # 例如 https://raw.githubusercontent.com/用户名/仓库/main/version.txt

GIT_PATH = config.BASE_DIR / ".git"


def fetch_latest_version() -> str:
    """从远程读取最新版本号"""
    if not VERSION_FILE_URL:
        return config.APP_VERSION
    try:
        import requests

        resp = requests.get(VERSION_FILE_URL, timeout=10)
        if resp.ok:
            return resp.text.strip()
    except Exception:
        pass
    return config.APP_VERSION


def compare_version(v1: str, v2: str) -> int:
    """返回 v1 < v2 时 -1，相等 0，v1 > v2 时 1"""
    a = [int(x) for x in v1.split(".") if x.isdigit()]
    b = [int(x) for x in v2.split(".") if x.isdigit()]
    while len(a) < len(b):
        a.append(0)
    while len(b) < len(a):
        b.append(0)
    if a < b:
        return -1
    if a > b:
        return 1
    return 0


def pull_latest() -> bool:
    """拉取最新代码"""
    if not GIT_PATH.exists():
        return False
    try:
        subprocess.run(["git", "pull"], cwd=config.BASE_DIR, check=True)
        return True
    except Exception:
        return False


def restart_service():
    """重启当前服务进程"""
    os.execv(sys.executable, [sys.executable, str(config.BASE_DIR / "app.py")])


def check_and_update(auto_restart: bool = False) -> dict:
    """统一入口：检查更新，必要时拉取并重启"""
    latest = fetch_latest_version()
    current = config.APP_VERSION
    if compare_version(current, latest) < 0:
        pulled = pull_latest()
        if pulled and auto_restart:
            restart_service()
        return {
            "ok": True,
            "update_available": True,
            "current_version": current,
            "latest_version": latest,
            "pulled": pulled,
        }
    return {
        "ok": True,
        "update_available": False,
        "current_version": current,
        "latest_version": latest,
    }
