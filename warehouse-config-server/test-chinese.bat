@echo off
chcp 65001 >nul 2>&1
title 中文编码测试

echo.
echo ==========================================
echo           中文字符显示测试
echo ==========================================
echo.
echo 🚀 如果您能正常看到这些字符，说明编码设置成功！
echo.
echo 测试项目：
echo   ✅ 基本中文字符显示
echo   🔄 Emoji图标支持
echo   📁 特殊符号显示
echo   ⚠️  警告符号
echo   ❌ 错误符号
echo   📊 图表符号
echo   🌐 网络符号
echo   🔒 安全符号
echo.
echo 常用中文语句测试：
echo   - 配置管理服务器运行正常
echo   - 系统启动成功，端口监听中
echo   - 数据库连接已建立
echo   - 用户认证通过
echo   - 文件上传完成
echo.
echo 编码信息：
echo   - 当前代码页：65001 (UTF-8)
echo   - 支持中文：是
echo   - 支持Emoji：是
echo   - 控制台字体：建议使用 Consolas 或 宋体
echo.
echo ==========================================
echo              测试完成
echo ==========================================
echo.
echo 如果上述字符显示正常，说明编码修复成功！
echo 如果仍然看到乱码，请尝试：
echo   1. 右键点击窗口标题栏 → 属性 → 字体
echo   2. 选择支持中文的字体（如宋体、微软雅黑）
echo   3. 或使用PowerShell替代命令提示符
echo.

pause 