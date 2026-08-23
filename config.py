"""
配置文件：负责读取 .env 中的设置，并提供全局配置项
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# 项目根目录
BASE_DIR = Path(__file__).resolve().parent

# 加载 .env（如果存在）
load_dotenv(BASE_DIR / ".env")

# 上传文件保存目录
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# DeepSeek 配置
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

# 服务配置
HOST = os.getenv("HOST", "0.0.0.0")
try:
    PORT = int(os.getenv("PORT", "8080"))
except ValueError:
    PORT = 8080

# 版本号（用于更新检测）
APP_VERSION = "1.0.0"

# 允许的图片后缀
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
