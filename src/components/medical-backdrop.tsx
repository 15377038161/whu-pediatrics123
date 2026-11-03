import type { ReactNode } from 'react';
import styles from './medical-backdrop.module.css';

/** 岛外页面的浅青绿医学底纹：手机竖版、桌面横版，内容始终位于遮罩之上。 */
export function MedicalBackdrop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className ? `${styles.backdrop} ${className}` : styles.backdrop}>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
