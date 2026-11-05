'use client';

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronDown, Info } from 'lucide-react';

interface ExpandableNoteProps {
  /** 触发器文字；icon 变体下只作为无障碍标签。 */
  label: string;
  /** 展开后的说明正文。 */
  children?: ReactNode;
  variant?: 'pill' | 'icon';
  /** 浮层优先对齐边：贴右的触发器用 end，靠左的用 start；最终再按视口夹取，保证不溢出屏幕。 */
  align?: 'start' | 'end';
  className?: string;
}

// 与 .note-panel-wrap 的 width: min(320px, calc(100vw - 28px)) 保持一致，供夹取计算用。
const PANEL_MAX_WIDTH = 320;
const PANEL_EDGE_GAP = 14;

/**
 * 说明类小字的统一收纳：常态只留一个触发器，点击（触屏）或鼠标悬停展开浮层，
 * 浮层绝对定位，不改变周边版面高度。只用于口径/规则说明；
 * 阻塞操作的原因与临床结论保持常显，不放进这里。
 */
export function ExpandableNote({ label, children, variant = 'pill', align = 'end', className }: ExpandableNoteProps) {
  const [open, setOpen] = useState(false);
  // 悬停打开的浮层移开即收；点击固定后必须再次点击或按 Esc/点空白才关，避免触屏上闪退。
  const [pinned, setPinned] = useState(false);
  // 触发器可能落在行尾（如表单标签行右侧），纯 CSS 的 left/right 锚定会让浮层溢出屏幕；
  // 打开时量一次触发器位置，把浮层水平夹回视口内（只改 left，纵向仍由 CSS 的 top:100% 决定）。
  const [panelLeft, setPanelLeft] = useState<number | null>(null);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setPinned(false); setPanelLeft(null); };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // 触发器可能落在行尾（如表单标签行右侧），纯 CSS 的 left/right 锚定会让浮层溢出屏幕；
  // 打开的瞬间量一次触发器位置，把浮层水平夹回视口内（只改 left，纵向仍由 CSS 的 top:100% 决定）。
  const openPanel = () => {
    const root = rootRef.current;
    if (root) {
      const rect = root.getBoundingClientRect();
      const width = Math.min(PANEL_MAX_WIDTH, window.innerWidth - PANEL_EDGE_GAP * 2);
      const preferred = align === 'start' ? rect.left : rect.right - width;
      const clamped = Math.min(Math.max(PANEL_EDGE_GAP, preferred), window.innerWidth - width - PANEL_EDGE_GAP);
      setPanelLeft(clamped - rect.left);
    }
    setOpen(true);
  };
  const closePanel = () => { setOpen(false); setPinned(false); setPanelLeft(null); };

  const onHoverStart = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType === 'mouse') openPanel(); };
  const onHoverEnd = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType === 'mouse' && !pinned) closePanel(); };

  return (
    <div className={className ? `expandable-note ${className}` : 'expandable-note'} ref={rootRef} onPointerEnter={onHoverStart} onPointerLeave={onHoverEnd}>
      <button
        type="button"
        className={variant === 'icon' ? 'note-trigger note-trigger-icon' : 'note-trigger'}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={variant === 'icon' ? label : undefined}
        onClick={() => { if (open) closePanel(); else { openPanel(); setPinned(true); } }}
      >
        {variant === 'icon' ? <Info size={17} /> : <>{label}<ChevronDown size={13} /></>}
      </button>
      <div
        className={align === 'start' ? 'note-panel-wrap note-panel-start' : 'note-panel-wrap'}
        id={panelId}
        role="note"
        aria-label={label}
        hidden={!open}
        style={panelLeft === null ? undefined : { left: panelLeft, right: 'auto' }}
      >
        <div className="note-panel">{children}</div>
      </div>
    </div>
  );
}
