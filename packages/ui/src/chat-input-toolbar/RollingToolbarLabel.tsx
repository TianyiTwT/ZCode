import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/components/lib/utils.js";

const LABEL_ROLL_TRANSITION = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1],
} as const;

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setPrefersReducedMotion(query.matches);
    };
    update();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => {
        query.removeEventListener("change", update);
      };
    }

    query.addListener(update);
    return () => {
      query.removeListener(update);
    };
  }, []);

  return prefersReducedMotion;
}

/**
 * 外层容器负责定高与裁切，内层行负责「单行不换行 + 右侧截断」。
 * 两层结构必须在动效和关闭动效两种分支里保持一致：
 * 调用方会按 [&>span>span] 这类后代选择器给内层行加 display，一旦某个分支少了一层，
 * 那条规则就会落到 prefix/value 上把它们拆成上下两行，再被外层 overflow-hidden 裁掉半行。
 */
const LABEL_WRAPPER_CLASS_NAME =
  "relative inline-flex h-[1.3em] min-w-0 max-w-full items-center overflow-hidden leading-[1.25]";

const LABEL_ROW_CLASS_NAME =
  "inline-flex min-w-0 max-w-full flex-nowrap items-center whitespace-nowrap leading-[1.25]";

export function RollingToolbarLabel({
  label,
  className,
  prefix,
  prefixClassName,
  value,
}: {
  label: string;
  className?: string;
  prefix?: string;
  prefixClassName?: string;
  value?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const content =
    prefix !== undefined && value !== undefined ? (
      <>
        {/* prefix 固定不收缩，宽度不够时只截断 value，避免把 "DeepSeek/" 也一起吃掉。 */}
        <span className={cn("shrink-0", prefixClassName)}>{prefix}</span>
        <span className="min-w-0 truncate">{value}</span>
      </>
    ) : (
      label
    );

  if (reducedMotion) {
    return (
      <span className={cn(LABEL_WRAPPER_CLASS_NAME, className)} title={label}>
        <span className={LABEL_ROW_CLASS_NAME}>{content}</span>
      </span>
    );
  }

  return (
    <span className={cn(LABEL_WRAPPER_CLASS_NAME, className)} title={label}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label}
          className={LABEL_ROW_CLASS_NAME}
          initial={{ y: "0.75em", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-0.75em", opacity: 0 }}
          transition={LABEL_ROLL_TRANSITION}
        >
          {content}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
