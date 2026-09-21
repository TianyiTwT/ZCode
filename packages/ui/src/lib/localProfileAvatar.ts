import { normalizeLocalProfileAvatarDataUrl } from "@/lib/localProfile.js";

/**
 * 本地头像图片处理 —— 解码 → 按取景框换算裁剪区域 → 编码成 data URL。
 *
 * 必须压缩的原因：头像要跟着其他 UI 偏好写进 localStorage，
 * 一张手机原图动辄数 MB，直接存会吃满 5MB 配额，
 * 之后所有偏好写入都会被 QuotaExceededError 静默丢弃。
 */

/** 输出边长。侧边栏头像最大按 40px 渲染，256px 足够覆盖 3x 屏且留出余量。 */
export const LOCAL_PROFILE_AVATAR_SIZE_PX = 256;

/**
 * 取景框边长（px）。
 * 固定尺寸才能把预览里的拖拽位移稳定换算回原图坐标；
 * 如果取景框跟着容器自适应，同一份 transform 在不同宽度下会裁出不同结果。
 */
export const LOCAL_PROFILE_AVATAR_STAGE_SIZE_PX = 240;

export const MIN_LOCAL_PROFILE_AVATAR_ZOOM = 1;
export const MAX_LOCAL_PROFILE_AVATAR_ZOOM = 4;

export type LocalProfileAvatarErrorCode =
  | "unsupported-type"
  | "decode-failed"
  | "encode-failed"
  | "too-large";

export class LocalProfileAvatarError extends Error {
  readonly code: LocalProfileAvatarErrorCode;

  constructor(code: LocalProfileAvatarErrorCode) {
    super(code);
    this.name = "LocalProfileAvatarError";
    this.code = code;
  }
}

export interface LocalProfileAvatarSource {
  image: HTMLImageElement;
  width: number;
  height: number;
  /** 解码时创建的 object URL，预览直接引用它。换图或卸载时必须 dispose。 */
  objectUrl: string;
  dispose: () => void;
}

export interface LocalProfileAvatarCropTransform {
  zoom: number;
  /** 预览里图片中心相对取景框中心的位移（px），正值代表图片向右/向下移。 */
  offsetX: number;
  offsetY: number;
}

export interface LocalProfileAvatarCropGeometry {
  /** 原图像素 → 预览像素的缩放比（已含 cover 基准与 zoom）。 */
  scale: number;
  displayWidth: number;
  displayHeight: number;
  /** 收敛到边界内的实际位移；预览与裁剪都以此为准。 */
  offsetX: number;
  offsetY: number;
  /** 换算回原图后真正被裁走的正方形区域。 */
  sourceX: number;
  sourceY: number;
  sourceSize: number;
}

export interface LocalProfileAvatarSize {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  // 末位 +0 是为了把 -0 归一成 0：Math.min(0, -0) 会返回 -0，
  // 它会以 "-0px" 的形式渗进 inline style，也让状态比较和测试读起来都很别扭。
  return Math.min(max, Math.max(min, value)) + 0;
}

export function normalizeLocalProfileAvatarZoom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, MIN_LOCAL_PROFILE_AVATAR_ZOOM, MAX_LOCAL_PROFILE_AVATAR_ZOOM)
    : MIN_LOCAL_PROFILE_AVATAR_ZOOM;
}

/**
 * 把预览位移收敛到「图片始终铺满取景框」的范围内。
 * 取景框内切圆比矩形小，所以保证矩形被铺满就等于保证圆内不会露出底色。
 */
export function clampLocalProfileAvatarCropOffset({
  width,
  height,
  zoom,
  offsetX,
  offsetY,
}: LocalProfileAvatarSize & LocalProfileAvatarCropTransform): { offsetX: number; offsetY: number } {
  const stageSize = LOCAL_PROFILE_AVATAR_STAGE_SIZE_PX;
  const scale =
    Math.max(stageSize / width, stageSize / height) * normalizeLocalProfileAvatarZoom(zoom);
  const maxOffsetX = Math.max(0, (width * scale - stageSize) / 2);
  const maxOffsetY = Math.max(0, (height * scale - stageSize) / 2);

  return {
    offsetX: clamp(offsetX, -maxOffsetX, maxOffsetX),
    offsetY: clamp(offsetY, -maxOffsetY, maxOffsetY),
  };
}

/**
 * 解析出预览尺寸与最终裁剪区域。
 * 纯计算、不碰 DOM，方便单测覆盖边界；预览渲染与编码都调用它，
 * 避免两处各算一份导致「看到的」和「存下的」不一致。
 */
export function resolveLocalProfileAvatarCropGeometry(
  source: LocalProfileAvatarSize,
  transform: LocalProfileAvatarCropTransform,
): LocalProfileAvatarCropGeometry {
  const stageSize = LOCAL_PROFILE_AVATAR_STAGE_SIZE_PX;
  const { width, height } = source;
  if (!(width > 0) || !(height > 0)) {
    throw new LocalProfileAvatarError("decode-failed");
  }

  const zoom = normalizeLocalProfileAvatarZoom(transform.zoom);
  // cover 基准：短边先对齐取景框，避免初帧就出现留白。
  const scale = Math.max(stageSize / width, stageSize / height) * zoom;
  const { offsetX, offsetY } = clampLocalProfileAvatarCropOffset({
    width,
    height,
    zoom,
    offsetX: transform.offsetX,
    offsetY: transform.offsetY,
  });
  const sourceSize = stageSize / scale;

  // 取景框中心映射回原图坐标后，再向左上退半个裁剪边长。
  // 位移已被收敛，这里再夹一次纯粹是浮点保护。
  const sourceX = clamp(width / 2 - offsetX / scale - sourceSize / 2, 0, width - sourceSize);
  const sourceY = clamp(height / 2 - offsetY / scale - sourceSize / 2, 0, height - sourceSize);

  return {
    scale,
    displayWidth: width * scale,
    displayHeight: height * scale,
    offsetX,
    offsetY,
    sourceX,
    sourceY,
    sourceSize,
  };
}

function loadImageElement(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new LocalProfileAvatarError("decode-failed"));
    image.src = objectUrl;
  });
}

export async function decodeLocalProfileAvatarImageFile(
  file: File,
): Promise<LocalProfileAvatarSource> {
  if (!file.type.startsWith("image/")) {
    throw new LocalProfileAvatarError("unsupported-type");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!(width > 0) || !(height > 0)) {
      throw new LocalProfileAvatarError("decode-failed");
    }

    return {
      image,
      width,
      height,
      objectUrl,
      // object URL 只在解码期间需要维持；像素数据已进入内存，释放后 drawImage 仍然可用。
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export function renderLocalProfileAvatarCrop(
  source: LocalProfileAvatarSource,
  transform: LocalProfileAvatarCropTransform,
): string {
  const geometry = resolveLocalProfileAvatarCropGeometry(source, transform);

  const canvas = document.createElement("canvas");
  canvas.width = LOCAL_PROFILE_AVATAR_SIZE_PX;
  canvas.height = LOCAL_PROFILE_AVATAR_SIZE_PX;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new LocalProfileAvatarError("encode-failed");
  }

  context.drawImage(
    source.image,
    geometry.sourceX,
    geometry.sourceY,
    geometry.sourceSize,
    geometry.sourceSize,
    0,
    0,
    LOCAL_PROFILE_AVATAR_SIZE_PX,
    LOCAL_PROFILE_AVATAR_SIZE_PX,
  );

  const pngDataUrl = canvas.toDataURL("image/png");
  if (normalizeLocalProfileAvatarDataUrl(pngDataUrl)) {
    return pngDataUrl;
  }

  // 高细节照片编码成 PNG 会超出本地存储预算；退回 JPEG 再压一次。
  // 代价是丢掉透明通道，但这是"存不下"和"能存下"之间的取舍。
  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.9);
  const normalizedJpegDataUrl = normalizeLocalProfileAvatarDataUrl(jpegDataUrl);
  if (!normalizedJpegDataUrl) {
    throw new LocalProfileAvatarError("too-large");
  }

  return normalizedJpegDataUrl;
}
