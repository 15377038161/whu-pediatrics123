'use client';

import { useEffect } from 'react';

import '@/sdk/bind-error-sync';
import { useIframeRouteSync } from '@/sdk/bind-route-sync';

declare global {
  interface Window {
    IframeErrorSync?: {
      child: {
        create: (options?: { debug?: boolean; reporters?: string }) => {
          init: () => unknown;
        };
      };
    };
    IframeElementPicker?: {
      child: {
        create: (options?: {
          debug?: boolean;
          computedStyleProps?: string[];
        }) => { init: () => unknown; destroy: () => void };
      };
    };
  }
}

export function IframeSdkProvider({ children }: { children: React.ReactNode }) {
  useIframeRouteSync();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // 初始化 iframe-element-picker child；通过 CDN 加载，可能未就绪。
    // dev 下 React StrictMode 会双执行 effect：cleanup 成对销毁首个实例，
    // 否则双实例各自监听 document click，一次选中会向父页面双发 ELEMENT_PICKED
    if (window.IframeElementPicker) {
      const picker = window.IframeElementPicker.child.create({ debug: false });
      picker.init();
      return () => picker.destroy();
    }
  }, []);

  return <>{children}</>;
}
