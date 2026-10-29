/**
 * iframe-route-sync 子页面 Next.js 接入。
 *
 * 已接入能力：
 * - 子 → 父：init() 后首屏 URL 会同步到父页面顶栏；子页面内 pushState 跳转也会自动同步
 */
'use client';

import { useEffect } from 'react';

export function useIframeRouteSync() {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const sync = window.IframeRouteSync;

    if (!sync) {
      return;
    }

    // dev 下 React StrictMode 会双执行 effect：cleanup 成对销毁首个实例，
    // 避免 popstate/hashchange 监听翻倍、URL 同步向父页面双发
    const instance = sync.child.create({ debug: false });
    instance.init();
    return () => instance.destroy();
  }, []);
}
