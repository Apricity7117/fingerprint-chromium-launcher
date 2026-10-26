# 日志

- 使用 `log` 宏 + `tauri-plugin-log`（默认输出到 stdout 与应用日志目录，macOS 为 `~/Library/Logs/<identifier>/`），级别 `Info`。
- 必须记录：
  - `info`：应用数据目录；每次启动的环境 ID、PID 与完整命令；停止结果。
  - `warn`：使用 `--disable-encryption`；`SingletonLock` 无法解析；Preferences / settings 损坏后重建或回退；进程超时被 SIGKILL。
- 不记录 Cookie、密码等浏览器数据；代理地址会出现在启动命令中，属用户自有配置，可记录。
- 日志文本使用中文，格式参数内联（`{id}`），方法调用结果用位置参数（`{}` + `path.display()`）。
