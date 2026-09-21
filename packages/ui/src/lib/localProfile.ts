import { readSafeLocalStorage, writeSafeLocalStorage } from "@/lib/browserEnvironment.js";

/**
 * 本地个人资料偏好 —— 侧边栏底部的头像与名称。
 *
 * ZCode 的界面身份不再来自账号：登录态只服务于需要远端的模型能力，
 * 侧边栏展示的名称/头像一律由本机配置决定，因此这里只读写 localStorage，
 * 不订阅 store 的 user 字段，也不发起任何网络请求。
 */
export const LOCAL_PROFILE_STORAGE_KEY = "zcode-local-profile";

/** 名称上限：直接受限于 footer 单行展示宽度，超出部分不落盘。 */
export const MAX_LOCAL_PROFILE_NAME_LENGTH = 24;

/**
 * 头像 data URL 上限。
 * 头像和其余 UI 偏好共用同一个 localStorage 域，单条记录必须远低于 5MB 配额，
 * 否则后续所有偏好写入都会静默失败（writeSafeLocalStorage 会吞掉 QuotaExceededError）。
 */
export const MAX_LOCAL_PROFILE_AVATAR_DATA_URL_LENGTH = 400_000;

export interface LocalProfileSettings {
  /** 是否在侧边栏底部展示头像与名称；关闭后该区域只保留设置入口。 */
  showInSidebar: boolean;
  /** 本机自定义名称；空字符串代表未设置，由调用方回退到默认文案。 */
  name: string;
  /** 本机自定义头像（data URL）；null 代表未设置，回退到名称首字母。 */
  avatarDataUrl: string | null;
}

export const DEFAULT_LOCAL_PROFILE_SETTINGS: LocalProfileSettings = {
  // 默认保持展示，改造前后侧边栏该区域的可见性一致，用户想隐藏再手动关。
  showInSidebar: true,
  name: "",
  avatarDataUrl: null,
};

/**
 * 名称归一化：折叠换行与连续空白，避免多行输入把 footer 撑高；
 * 只裁剪左侧空白，保留用户正在输入的行尾空格（否则输入 "John Doe" 时打不出空格）。
 */
export function normalizeLocalProfileName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trimStart().slice(0, MAX_LOCAL_PROFILE_NAME_LENGTH);
}

/**
 * 头像归一化：只接受 data:image/* 且体积在预算内的字符串。
 * 其余内容（外链 URL、损坏的 base64）一律丢弃，不要让非预期内容进入持久化。
 */
export function normalizeLocalProfileAvatarDataUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("data:image/")) {
    return null;
  }

  return trimmed.length <= MAX_LOCAL_PROFILE_AVATAR_DATA_URL_LENGTH ? trimmed : null;
}

export function normalizeLocalProfileSettings(value: unknown): LocalProfileSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_LOCAL_PROFILE_SETTINGS;
  }

  const candidate = value as Partial<LocalProfileSettings>;
  return {
    // 只有显式存了 false 才视为关闭，历史数据或脏数据都回退到默认展示。
    showInSidebar: candidate.showInSidebar !== false,
    name: normalizeLocalProfileName(candidate.name),
    avatarDataUrl: normalizeLocalProfileAvatarDataUrl(candidate.avatarDataUrl),
  };
}

export function loadLocalProfileSettings(): LocalProfileSettings {
  const raw = readSafeLocalStorage(LOCAL_PROFILE_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_LOCAL_PROFILE_SETTINGS;
  }

  try {
    return normalizeLocalProfileSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_LOCAL_PROFILE_SETTINGS;
  }
}

export function persistLocalProfileSettings(settings: LocalProfileSettings): void {
  writeSafeLocalStorage(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(settings));
}

/** 未设置头像时展示名称首字符，与账号头像的 fallback 规则保持一致。 */
export function getLocalProfileAvatarFallbackText(name: string): string {
  return name.trim()[0]?.toUpperCase() ?? "Z";
}
