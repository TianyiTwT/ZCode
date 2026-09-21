import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  clampLocalProfileAvatarCropOffset,
  decodeLocalProfileAvatarImageFile,
  LOCAL_PROFILE_AVATAR_STAGE_SIZE_PX,
  LocalProfileAvatarError,
  MAX_LOCAL_PROFILE_AVATAR_ZOOM,
  MIN_LOCAL_PROFILE_AVATAR_ZOOM,
  normalizeLocalProfileAvatarZoom,
  renderLocalProfileAvatarCrop,
  resolveLocalProfileAvatarCropGeometry,
  type LocalProfileAvatarCropTransform,
  type LocalProfileAvatarSource,
} from "@/lib/localProfileAvatar.js";

/**
 * 头像裁剪弹窗。
 *
 * 先取景再保存：原图直接居中裁切会把证件照、截图、带水印的图裁到不希望的位置，
 * 所以这里给一个固定方形取景框，由用户拖动和缩放确定构图。
 * 预览与编码共用 resolveLocalProfileAvatarCropGeometry，
 * 保证「看到的圆形范围」就是「存下来的圆形范围」。
 */

const INITIAL_TRANSFORM: LocalProfileAvatarCropTransform = {
  zoom: MIN_LOCAL_PROFILE_AVATAR_ZOOM,
  offsetX: 0,
  offsetY: 0,
};

const ARROW_KEY_STEPS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

const WHEEL_ZOOM_STEP = 1.08;

export function LocalProfileAvatarCropDialog({
  open,
  file,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  file: File | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (avatarDataUrl: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originOffsetX: number;
    originOffsetY: number;
  } | null>(null);
  const [source, setSource] = useState<LocalProfileAvatarSource | null>(null);
  const [transform, setTransform] = useState<LocalProfileAvatarCropTransform>(INITIAL_TRANSFORM);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // 滚轮监听是原生绑定、不随 render 重建，用 ref 读取最新 zoom 才能保证连续滚轮是叠加而不是被重置。
  const latestZoomRef = useRef(transform.zoom);
  latestZoomRef.current = transform.zoom;

  useEffect(() => {
    if (!file) {
      return;
    }

    let isCancelled = false;
    let activeSource: LocalProfileAvatarSource | null = null;
    setSource(null);
    setErrorId(null);
    setTransform(INITIAL_TRANSFORM);

    void decodeLocalProfileAvatarImageFile(file)
      .then((decoded) => {
        if (isCancelled) {
          // 用户在解码完成前换图或关闭弹窗，这里的 object URL 必须由自己释放。
          decoded.dispose();
          return;
        }
        activeSource = decoded;
        setSource(decoded);
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        const code = error instanceof LocalProfileAvatarError ? error.code : "unknown";
        logger.warn("[localProfile] 头像解码失败", { code });
        setErrorId(
          code === "unsupported-type"
            ? "settings.localProfile.avatarUnsupportedType"
            : "settings.localProfile.avatarError",
        );
      });

    return () => {
      isCancelled = true;
      activeSource?.dispose();
    };
  }, [file]);

  const geometry = useMemo(
    () => (source ? resolveLocalProfileAvatarCropGeometry(source, transform) : null),
    [source, transform],
  );

  const applyZoom = useCallback(
    (nextZoom: number) => {
      if (!source) {
        return;
      }
      setTransform((previous) => {
        const zoom = normalizeLocalProfileAvatarZoom(nextZoom);
        // 以取景框中心为缩放锚点：位移同比缩放，中心对齐的原图位置保持不变，视觉上不跳变。
        const ratio = previous.zoom === 0 ? 1 : zoom / previous.zoom;
        const { offsetX, offsetY } = clampLocalProfileAvatarCropOffset({
          width: source.width,
          height: source.height,
          zoom,
          offsetX: previous.offsetX * ratio,
          offsetY: previous.offsetY * ratio,
        });
        return { zoom, offsetX, offsetY };
      });
    },
    [source],
  );

  /** 按绝对位移落盘（拖拽用），越界时收敛。 */
  const applyOffset = useCallback(
    (offsetX: number, offsetY: number) => {
      if (!source) {
        return;
      }
      setTransform((previous) => {
        const next = clampLocalProfileAvatarCropOffset({
          width: source.width,
          height: source.height,
          zoom: previous.zoom,
          offsetX,
          offsetY,
        });
        return { ...previous, offsetX: next.offsetX, offsetY: next.offsetY };
      });
    },
    [source],
  );

  /** 在当前位移上叠加增量（方向键微调用）。 */
  const nudgeBy = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!source) {
        return;
      }
      setTransform((previous) => {
        const next = clampLocalProfileAvatarCropOffset({
          width: source.width,
          height: source.height,
          zoom: previous.zoom,
          offsetX: previous.offsetX + deltaX,
          offsetY: previous.offsetY + deltaY,
        });
        return { ...previous, offsetX: next.offsetX, offsetY: next.offsetY };
      });
    },
    [source],
  );

  useEffect(() => {
    const node = stageRef.current;
    if (!node || !source) {
      return;
    }

    // React 的 onWheel 走根节点委托且是 passive 监听，preventDefault 会失效；
    // 这里挂原生非 passive 监听，避免滚轮缩放时连带滚动弹窗容器。
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
      applyZoom(latestZoomRef.current * factor);
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", handleWheel);
    };
  }, [applyZoom, source]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!geometry) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originOffsetX: geometry.offsetX,
      originOffsetY: geometry.offsetY,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    // 拖拽落点用「起点位移 + 指针增量」的绝对值，而不是在上一帧结果上累加，
    // 否则越界收敛后的位置会被当成新的基准，指针回拉时手感会粘住。
    applyOffset(
      drag.originOffsetX + (event.clientX - drag.startX),
      drag.originOffsetY + (event.clientY - drag.startY),
    );
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setIsDragging(false);
  };

  const handleStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_KEY_STEPS[event.key];
    if (!step) {
      return;
    }
    event.preventDefault();
    const multiplier = event.shiftKey ? 10 : 1;
    nudgeBy(step.dx * multiplier, step.dy * multiplier);
  };

  const handleConfirm = () => {
    if (!source) {
      return;
    }
    try {
      onConfirm(renderLocalProfileAvatarCrop(source, transform));
    } catch (error) {
      const code = error instanceof LocalProfileAvatarError ? error.code : "unknown";
      logger.warn("[localProfile] 头像编码失败", { code });
      setErrorId(
        code === "too-large"
          ? "settings.localProfile.avatarTooLarge"
          : "settings.localProfile.avatarError",
      );
    }
  };

  const stageSize = LOCAL_PROFILE_AVATAR_STAGE_SIZE_PX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "settings.localProfile.cropTitle" })}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.localProfile.cropDescription" })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          {errorId ? (
            <div
              role="alert"
              className="flex items-center justify-center rounded-xl border border-border bg-surface p-4 text-center text-ui-base text-destructive"
              style={{ width: stageSize, height: stageSize }}
            >
              {intl.formatMessage({ id: errorId })}
            </div>
          ) : (
            <div
              ref={stageRef}
              role="group"
              tabIndex={0}
              aria-label={intl.formatMessage({ id: "settings.localProfile.cropCanvasLabel" })}
              className={cn(
                "relative touch-none overflow-hidden rounded-xl border border-border bg-surface outline-none select-none",
                "focus-visible:border-input-border-focused",
                isDragging ? "cursor-grabbing" : "cursor-grab",
              )}
              style={{ width: stageSize, height: stageSize }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={handleStageKeyDown}
            >
              {source && geometry ? (
                <img
                  src={source.objectUrl}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="pointer-events-none absolute max-w-none"
                  style={{
                    width: geometry.displayWidth,
                    height: geometry.displayHeight,
                    left: stageSize / 2 + geometry.offsetX,
                    top: stageSize / 2 + geometry.offsetY,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              ) : (
                <div className="flex size-full items-center justify-center text-ui-base text-foreground-subtle">
                  {intl.formatMessage({ id: "common.loading" })}
                </div>
              )}
              {/* 圆外压暗：100x100 视口里 r=100 + strokeWidth=100 的环只覆盖半径 50 以外的区域，
                  正好等于「取景框内切圆之外」，不需要额外声明 mask。 */}
              <svg
                className="pointer-events-none absolute inset-0 size-full"
                viewBox="0 0 100 100"
                aria-hidden="true"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="100"
                  fill="none"
                  stroke="black"
                  strokeOpacity="0.45"
                  strokeWidth="100"
                />
              </svg>
              <div className="pointer-events-none absolute inset-0 rounded-full border border-foreground-subtlest/50" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <ZoomOut className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
          <input
            type="range"
            min={MIN_LOCAL_PROFILE_AVATAR_ZOOM}
            max={MAX_LOCAL_PROFILE_AVATAR_ZOOM}
            step={0.01}
            value={transform.zoom}
            disabled={!source}
            aria-label={intl.formatMessage({ id: "settings.localProfile.cropZoom" })}
            onChange={(event) => applyZoom(Number(event.currentTarget.value))}
            className="h-7 w-full min-w-0 accent-primary"
          />
          <ZoomIn className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
          <span className="w-12 shrink-0 text-right text-ui-sm tabular-nums text-foreground-subtle">
            {Math.round(transform.zoom * 100)}%
          </span>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: "settings.localProfile.cropCancel" })}
          </Button>
          <Button type="button" size="lg" disabled={!source} onClick={handleConfirm}>
            {intl.formatMessage({ id: "settings.localProfile.cropConfirm" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
