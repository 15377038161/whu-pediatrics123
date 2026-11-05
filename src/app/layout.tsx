import type { Metadata } from 'next';
import '@/app/globals.css';
import { OAuthCallbackHandler } from '@/app/components/oauth-callback-handler';

export const metadata: Metadata = {
  title: '珞珈儿科智训 Luojia Pediatric Intelligent Training',
  description: '武汉大学儿科学统一教学智能体 Wuhan University Pediatrics',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <OAuthCallbackHandler />
        {children}
      </body>
    </html>
  );
}
