#!/bin/sh
set -e

# 强制手动初始化：config.json 必须由用户在宿主机复制并修改密码后挂载进来。
# 不再自动复制范例，避免默认密码 CHANGE_ME 静默上线（与 index.js 的启动守卫呼应）。
if [ ! -f /app/config.json ]; then
  echo "错误：未找到 /app/config.json。" >&2
  echo "请先在项目目录执行以下命令，然后重新启动：" >&2
  echo "  cp config.example.json config.json" >&2
  echo "  编辑 config.json，把 admin.password 的 CHANGE_ME 改为你自己的强密码" >&2
  echo "  如同时挂载了 config.json 卷，请检查 docker-compose.yml 的挂载路径" >&2
  exit 1
fi

# 确保 config.json 对运行用户可写（挂载卷权限兜底）
chown app:app /app/config.json 2>/dev/null || true

# 以非 root 用户运行
exec su-exec app node dist/index.js
