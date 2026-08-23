@echo off
chcp 65001 >nul
title 跨境电商标题工作流工具
echo ================================
echo   跨境电商标题工作流工具 启动器
echo ================================
echo.

REM 切换到脚本所在目录
cd /d %~dp0

REM 使用 D 盘虚拟环境运行
set PY=D:\WorkBuddyPython\envs\crossborder\Scripts\python.exe

if not exist "%PY%" (
    echo [错误] 未找到 Python 虚拟环境，请确认安装路径
    pause
    exit /b
)

echo 正在启动服务...
echo 启动后请在浏览器打开提示的地址（默认 http://localhost:8080）
echo 按 Ctrl+C 可停止服务
echo.
"%PY%" app.py
pause
