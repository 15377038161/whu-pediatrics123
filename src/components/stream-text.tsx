'use client';

/**
 * 逐字呈现组件：新到达的对话回复以打字机方式逐步显示，历史消息直接全文。
 * - rAF 驱动（约 42 字/秒），不使用 setInterval；点击气泡立即全文；
 * - prefers-reduced-motion 在布局效应内直接回调完成（绘制前），不产生空帧闪烁；
 * - 读屏获得完整文本（可见的逐字部分 aria-hidden），避免朗读半句。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const CHARS_PER_SECOND = 42;

export interface StreamTextProps {
  text: string;
  /** 是否启用逐字呈现（新消息）；呈现完成后由父组件置回 false */
  animate: boolean;
  onDone?: () => void;
}

export function StreamText({ text, animate, onDone }: StreamTextProps) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  const progressRef = useRef(animate ? 0 : text.length);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useLayoutEffect(() => {
    if (!animate) {
      progressRef.current = text.length;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progressRef.current = text.length;
      onDoneRef.current?.();
      return;
    }
    progressRef.current = 0;
    let frame = 0;
    let last = performance.now();
    let finished = false;
    const step = (now: number) => {
      const delta = now - last;
      last = now;
      progressRef.current = Math.min(text.length, progressRef.current + (delta / 1000) * CHARS_PER_SECOND);
      setShown(Math.floor(progressRef.current));
      if (progressRef.current >= text.length) {
        if (!finished) {
          finished = true;
          onDoneRef.current?.();
        }
        return;
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [animate, text]);

  const streaming = animate && shown < text.length;
  const visible = animate ? text.slice(0, shown) : text;

  return (
    <span
      className="stream-text"
      data-streaming={streaming || undefined}
      title={streaming ? '点击立即显示全文' : undefined}
      onClick={() => {
        if (!streaming) return;
        progressRef.current = text.length;
        setShown(text.length);
      }}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {visible}
        {streaming && <i className="stream-caret" />}
      </span>
    </span>
  );
}
