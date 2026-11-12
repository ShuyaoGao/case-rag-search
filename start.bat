@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  案例语义搜索：正在启动本地服务器……
echo  （浏览器不允许直接双击打开的 file:// 页面读取数据，所以要用本地服务器）
echo.
where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo  没有找到 Python。请先安装 Python 3：https://www.python.org/downloads/
    pause
    exit /b 1
  )
  py -3 -X utf8 build\serve.py 8765
) else (
  python -X utf8 build\serve.py 8765
)
pause
