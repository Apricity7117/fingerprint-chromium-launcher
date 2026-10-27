// configs/ 下的可调参数与选项表，编译期打包，与 Rust 端共用同一份 JSON
import defaultsJson from "../../configs/defaults.json";
import presetsJson from "../../configs/fingerprint-presets.json";

export const defaults = defaultsJson;
export const presets = presetsJson;
