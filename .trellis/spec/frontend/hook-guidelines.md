# Hook 规范

- eslint-plugin-react-hooks v7（React Compiler 规则）启用：**effect 主体中不能同步调用 setState**。
  - 数据加载：在 Promise 回调中 setState（`fetch().then(apply)`），并用 `cancelled` 标记防止卸载后写入；
  - 需要「先进入加载态再请求」时，在事件处理函数里 setState（如 `useProfiles().retry`）；
  - 订阅外部状态（媒体查询等）用 `useSyncExternalStore`。
- `useRunningStatus`：按 `configs/defaults.json` 的 `status_poll_interval_ms` 轮询，`document.hidden` 时暂停；操作后调用 `refresh()`，并在启动后延迟一次刷新等待 `SingletonLock` 写入。
- `useLocalStorage`：读写失败时退回内存状态；当前使用的键：`fcl-active-group`、`fcl-view-mode`、`fcl-theme`。
