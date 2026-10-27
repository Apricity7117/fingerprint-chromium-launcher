#!/bin/sh
# 模拟 Chromium 主进程：解析 --user-data-dir 并写入 SingletonLock（<hostname>-<pid>），
# 收到 SIGTERM 时删除锁后退出；带 --fake-ignore-term 时忽略 SIGTERM，用于验证超时强杀。
dir=""
ignore_term=0
for arg in "$@"; do
  case "$arg" in
    --version) echo "Chromium 142.0.7444.175"; exit 0 ;;
    --user-data-dir=*) dir="${arg#--user-data-dir=}" ;;
    --fake-ignore-term) ignore_term=1 ;;
  esac
done
[ -n "$dir" ] || exit 2
mkdir -p "$dir"
ln -sf "$(hostname)-$$" "$dir/SingletonLock"
if [ "$ignore_term" = "1" ]; then
  trap '' TERM
else
  trap 'rm -f "$dir/SingletonLock"; exit 0' TERM
fi
while :; do
  sleep 1
done
