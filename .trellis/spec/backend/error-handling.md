# 错误处理

## 约定

- 所有 command 与业务方法返回 `Result<T, String>`（`type CmdResult<T>`），错误信息为**中文**、带上下文（路径、ID），前端直接 toast 展示。
- 用 `map_err(|e| format!("读取 {} 失败: {e}", path.display()))` 附加上下文；不要 `unwrap` / `expect` 用户数据或 I/O 结果。`expect` 仅用于编译期嵌入的配置解析（配置错误即构建缺陷）。
- 锁使用 `lock().unwrap_or_else(PoisonError::into_inner)`，不因 panic 污染而让整个应用不可用。

## 数据安全相关的错误策略

| 场景 | 处理 |
|---|---|
| `profiles.json` 解析失败 | 返回错误，**拒绝后续写入**，避免覆盖用户数据 |
| `settings.json` 缺失 / 损坏 | 记录 warn，回退到当前系统默认值 |
| `Preferences` 非对象 / 损坏 | 记录 warn，以启动器默认偏好重建 |
| `extra_args` 引号不成对 | 返回错误，不启动、不写 Preferences |
| 删除数据目录校验失败（名称非 `chrome_<8 位十六进制>`、是符号链接、不在前缀下） | 返回错误并跳过，绝不删除 |
| 批量删除时停止失败 | 该环境不删除，错误汇总到 `DeleteResult.errors` |
| 信号发送遇到 `ESRCH` | 视为已退出，返回成功 |

## 常见错误

- 在 `map_err` 闭包外再次借用已移动的值；先计算展示用字符串或改用引用。
- 让 Python 风格的「失败返回空列表」进入写路径——会把损坏文件覆盖成空数组。
