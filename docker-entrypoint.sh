#!/bin/sh
set -e

# 确保 config.json 存在且对运行用户可写（挂载卷权限兜底）
if [ -f /app/config.json ]; then
  chown app:app /app/config.json 2>/dev/null || true
else
  # 首次部署且未挂载 config.json：复制范例作为默认配置
  if [ -f /app/config.example.json ]; then
    cp /app/config.example.json /app/config.json
    chown app:app /app/config.json
  fi
fi

# 以非 root 用户运行
exec su-exec app node dist/index.js
